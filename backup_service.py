"""Sauvegardes SQLite StockPilot : snapshots cohérents, rétention et restauration.

Sauvegardes locales dans /data et copies quotidiennes vérifiées sur volume externe optionnel.
"""
import fcntl
import hashlib
import json
import shutil
import time
import os
import re
import secrets
import sqlite3
import tempfile
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

BACKUP_KEEP_DAYS = 30
REQUIRED_TABLES = frozenset({'users', 'products', 'items', 'events', 'meta', 'sync_revision'})
BACKUP_NAME = re.compile(r'^(?:daily-\d{4}-\d{2}-\d{2}|manual-\d{8}T\d{6}-[0-9a-f]{8}|before-restore-\d{8}T\d{6}-[0-9a-f]{8})\.sqlite3$')


@contextmanager
def file_lock(data_dir):
    """Verrou transversal aux workers, même si plusieurs réplicas pointent sur /data."""
    path = Path(data_dir) / '.backup.lock'
    with path.open('a+b') as stream:
        os.chmod(path, 0o600)
        fcntl.flock(stream, fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(stream, fcntl.LOCK_UN)


def backup_directory(data_dir):
    folder = Path(data_dir) / 'backups' / 'managed'
    folder.mkdir(parents=True, exist_ok=True, mode=0o700)
    return folder


def validate_database(conn):
    check = conn.execute('PRAGMA quick_check').fetchone()
    if not check or check[0] != 'ok':
        raise ValueError('La sauvegarde SQLite est endommagée.')
    tables = {row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    if not REQUIRED_TABLES.issubset(tables):
        raise ValueError('La sauvegarde ne contient pas une base StockPilot complète.')
    return True


def list_backups(data_dir):
    folder = backup_directory(data_dir)
    result = []
    for path in folder.iterdir():
        if not path.is_file() or not BACKUP_NAME.fullmatch(path.name):
            continue
        stat = path.stat()
        result.append({
            'name': path.name,
            'size': stat.st_size,
            'createdAt': int(stat.st_mtime * 1000),
            'kind': 'auto' if path.name.startswith('daily-') else
                    'before_restore' if path.name.startswith('before-restore-') else 'manual',
        })
    result.sort(key=lambda item: (item['createdAt'], item['name']), reverse=True)
    return result


def resolve_backup(data_dir, name):
    if not isinstance(name, str) or not BACKUP_NAME.fullmatch(name):
        raise ValueError('Nom de sauvegarde invalide.')
    path = backup_directory(data_dir) / name
    if not path.is_file() or path.is_symlink():
        raise FileNotFoundError('Sauvegarde introuvable.')
    return path


def _snapshot(db_file, data_dir, name):
    folder = backup_directory(data_dir)
    final = folder / name
    fd, temp_name = tempfile.mkstemp(prefix='.snapshot-', suffix='.tmp', dir=folder)
    os.close(fd)
    temp = Path(temp_name)
    os.chmod(temp, 0o600)
    try:
        source = sqlite3.connect(f'{Path(db_file).resolve().as_uri()}?mode=ro',
                                 uri=True, timeout=20)
        try:
            destination = sqlite3.connect(temp, timeout=20)
            try:
                source.backup(destination, pages=200, sleep=0.1)
                validate_database(destination)
                destination.commit()
            finally:
                destination.close()
        finally:
            source.close()
        os.replace(temp, final)
        return final
    finally:
        temp.unlink(missing_ok=True)


def _trim_daily(data_dir):
    folder = backup_directory(data_dir)
    daily = sorted(folder.glob('daily-????-??-??.sqlite3'), reverse=True)
    for path in daily[BACKUP_KEEP_DAYS:]:
        path.unlink(missing_ok=True)


def ensure_daily_backup(db_file, data_dir, now=None):
    """Une sauvegarde par jour UTC, même en cas de redémarrage du conteneur."""
    date = (now or datetime.now(timezone.utc)).strftime('%Y-%m-%d')
    with file_lock(data_dir):
        name = f'daily-{date}.sqlite3'
        folder = backup_directory(data_dir)
        if not (folder / name).is_file():
            result = _snapshot(db_file, data_dir, name)
        else:
            result = folder / name
        _trim_daily(data_dir)
        return result


def create_manual_backup(db_file, data_dir, *, before_restore=False, now=None):
    prefix = 'before-restore' if before_restore else 'manual'
    timestamp = (now or datetime.now(timezone.utc)).strftime('%Y%m%dT%H%M%S')
    with file_lock(data_dir):
        name = f'{prefix}-{timestamp}-{secrets.token_hex(4)}.sqlite3'
        return _snapshot(db_file, data_dir, name)


def restore_backup(connection, db_file, data_dir, name):
    """Restaure une sauvegarde connue avec filet de sécurité sur le volume.
    L'appelant doit interdire les écritures concurrentes pendant cette opération.
    """
    with file_lock(data_dir):
        source_path = resolve_backup(data_dir, name)
        source = sqlite3.connect(f'{source_path.resolve().as_uri()}?mode=ro',
                                 uri=True, timeout=20)
        try:
            validate_database(source)
            current_revision = connection.execute(
                'SELECT revision FROM sync_revision WHERE id=1').fetchone()[0]
            safeguard = _snapshot(db_file, data_dir,
                'before-restore-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S')
                + '-' + secrets.token_hex(4) + '.sqlite3')
            try:
                source.backup(connection, pages=200, sleep=0.1)
                # La révision doit avancer, sinon les navigateurs déjà ouverts ne voient
                # pas une restauration d'un inventaire plus ancien.
                backup_revision = connection.execute(
                    'SELECT revision FROM sync_revision WHERE id=1').fetchone()[0]
                connection.execute(
                    'UPDATE sync_revision SET revision=? WHERE id=1',
                    (max(current_revision, backup_revision) + 1,))
                validate_database(connection)
            except Exception:
                # Si l'opération s'interrompt, restaurer immédiatement l'état initial.
                fallback = sqlite3.connect(f'{safeguard.resolve().as_uri()}?mode=ro',
                                           uri=True, timeout=20)
                try:
                    fallback.backup(connection)
                finally:
                    fallback.close()
                raise
            return safeguard.name
        finally:
            source.close()


# Le volume externe DOIT être monté depuis un autre support / serveur NAS.
# La configuration est volontairement facultative sur l'installation de développement.
EXTERNAL_STATUS_FILE = 'external-status.json'


def external_directory(data_dir, directory):
    """N'accepte jamais un dossier de sauvegardes à l'intérieur de /data."""
    if not directory:
        raise ValueError("Aucun stockage externe n'est configuré.")
    candidate = Path(directory)
    if not candidate.is_absolute():
        raise ValueError("Le chemin du stockage externe doit être absolu.")
    try:
        target = candidate.resolve(strict=True)
    except (OSError, RuntimeError):
        raise ValueError("Le dossier externe n'est pas monté ou accessible.") from None
    local = Path(data_dir).resolve()
    if not target.is_dir() or target == local or local in target.parents or target in local.parents:
        raise ValueError("Le stockage externe doit être un dossier distinct du volume principal.")
    return target


def _external_status_path(data_dir):
    return backup_directory(data_dir).parent / EXTERNAL_STATUS_FILE


def _save_external_status(data_dir, payload):
    path = _external_status_path(data_dir)
    fd, temporary = tempfile.mkstemp(prefix='.external-status-', dir=path.parent)
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as stream:
            os.fchmod(stream.fileno(), 0o600)
            json.dump(payload, stream, ensure_ascii=False)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        Path(temporary).unlink(missing_ok=True)


def _load_external_status(data_dir):
    try:
        path = _external_status_path(data_dir)
        if path.is_file():
            with path.open(encoding='utf-8') as source:
                value = json.load(source)
            return value if isinstance(value, dict) else {}
    except (ValueError, OSError, TypeError):
        pass
    return {}


def external_status(data_dir, directory):
    """Statut administrateur sans exposition de chemin de sauvegarde."""
    if not directory:
        return {'configured': False, 'status': 'not_configured'}
    metadata = _load_external_status(data_dir)
    try:
        target = external_directory(data_dir, directory)
        if not os.access(target, os.W_OK):
            raise ValueError("Dossier externe non inscriptible.")
        if metadata.get('destinationKey') != hashlib.sha256(str(target).encode()).hexdigest():
            return {'configured': True, 'status': 'error' if metadata.get('error') else 'pending',
                    'error': metadata.get('error') or ''}
        name = metadata.get('name', '')
        existing = target / name
        valid_file = BACKUP_NAME.fullmatch(name) and existing.is_file() and not existing.is_symlink()
        if not valid_file:
            return {'configured': True, 'status': 'error', 'error': 'La dernière copie externe est introuvable.'}
        valid_size = existing.stat().st_size == metadata.get('size')
        if not valid_size or metadata.get('error'):
            return {'configured': True, 'status': 'error',
                    'error': metadata.get('error') or 'Le fichier de sauvegarde externe a changé.'}
        return {'configured': True, 'status': 'ok',
                'lastVerifiedAt': metadata.get('verifiedAt'),
                'lastBackupName': name,
                'sameFilesystem': target.stat().st_dev == Path(data_dir).stat().st_dev}
    except (OSError, ValueError):
        return {'configured': True, 'status': 'error',
                'error': "Le stockage externe n'est pas accessible ou inscriptible."}


def _verify_restorable(path, data_dir):
    """Simule une restauration complète dans une base temporaire, jamais en production."""
    fd, temporary = tempfile.mkstemp(prefix='.restore-test-', suffix='.sqlite3',
                                     dir=backup_directory(data_dir))
    os.close(fd)
    try:
        source = sqlite3.connect(f'{Path(path).resolve().as_uri()}?mode=ro',
                                 uri=True, timeout=20)
        try:
            validate_database(source)
            destination = sqlite3.connect(temporary, timeout=20)
            try:
                source.backup(destination, pages=200, sleep=0.1)
                validate_database(destination)
                full = destination.execute('PRAGMA integrity_check').fetchone()
                if not full or full[0] != 'ok':
                    raise ValueError("La copie ne peut pas être restaurée.")
                if destination.execute('PRAGMA foreign_key_check').fetchone():
                    raise ValueError("La sauvegarde contient des références incohérentes.")
            finally:
                destination.close()
        finally:
            source.close()
        return True
    finally:
        Path(temporary).unlink(missing_ok=True)


def _digest(path):
    digest = hashlib.sha256()
    with Path(path).open('rb') as stream:
        while chunk := stream.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def _external_success(data_dir, target, name):
    file = target / name
    _save_external_status(data_dir, {
        'destinationKey': hashlib.sha256(str(target).encode()).hexdigest(),
        'name': name,
        'size': file.stat().st_size,
        'sha256': _digest(file),
        'verifiedAt': int(time.time() * 1000),
        'error': '',
    })


def record_external_failure(data_dir):
    """Conserver la dernière copie valide tout en signalant l'échec courant."""
    with file_lock(data_dir):
        status = _load_external_status(data_dir)
        status['error'] = 'Échec de la copie externe. Vérifiez le montage et les droits.'
        _save_external_status(data_dir, status)


def ensure_external_daily_backup(db_file, data_dir, external_dir, now=None):
    """Une copie par jour UTC, vérifiée par restauration sèche sur un autre volume."""
    if not external_dir:
        return None
    # La sauvegarde SQLite cohérente est produite avant le verrou de copie.
    local = ensure_daily_backup(db_file, data_dir, now=now)
    with file_lock(data_dir):
        target = external_directory(data_dir, external_dir)
        name = local.name
        remote = target / name
        meta = _load_external_status(data_dir)
        target_key = hashlib.sha256(str(target).encode()).hexdigest()
        if remote.is_file() and not remote.is_symlink() and meta.get('name') == name \
                and meta.get('destinationKey') == target_key and not meta.get('error') \
                and meta.get('size') == remote.stat().st_size:
            return remote
        fd, temporary = tempfile.mkstemp(prefix='.stockpilot-copy-', dir=target)
        try:
            with os.fdopen(fd, 'wb') as output, local.open('rb') as source:
                os.fchmod(output.fileno(), 0o600)
                shutil.copyfileobj(source, output, length=1024 * 1024)
                output.flush()
                os.fsync(output.fileno())
            if _digest(local) != _digest(temporary):
                raise ValueError("La copie externe diffère du fichier source.")
            _verify_restorable(temporary, data_dir)
            os.replace(temporary, remote)
            _external_success(data_dir, target, name)
            old = sorted(target.glob('daily-????-??-??.sqlite3'), reverse=True)
            for old_backup in old[BACKUP_KEEP_DAYS:]:
                if old_backup.is_file() and not old_backup.is_symlink():
                    old_backup.unlink()
            return remote
        finally:
            Path(temporary).unlink(missing_ok=True)


def verify_latest_external(data_dir, external_dir):
    """Test manuel complet de restauration sur copie éphémère, sans toucher au stock."""
    with file_lock(data_dir):
        target = external_directory(data_dir, external_dir)
        files = sorted((path for path in target.glob('daily-????-??-??.sqlite3')
                        if path.is_file() and not path.is_symlink()), reverse=True)
        if not files:
            raise ValueError("Aucune sauvegarde externe disponible à tester.")
        path = files[0]
        try:
            _verify_restorable(path, data_dir)
        except Exception:
            status = _load_external_status(data_dir)
            status['error'] = 'Échec du test de restauration de la copie externe.'
            _save_external_status(data_dir, status)
            raise
        _external_success(data_dir, target, path.name)
        return {'ok': True, 'name': path.name, 'verifiedAt': int(time.time() * 1000)}

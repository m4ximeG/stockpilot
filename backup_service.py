"""Sauvegardes SQLite StockPilot : snapshots cohérents, rétention et restauration.

Toutes les sauvegardes restent dans le volume /data, hors du répertoire web.
"""
import fcntl
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

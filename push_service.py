"""Web Push StockPilot — VAPID persistant, abonnements individuels et alertes de seuil."""
import base64
import json
import logging
import os
import time
from pathlib import Path
from urllib.parse import urlparse

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
from pywebpush import WebPushException, webpush

LOG = logging.getLogger(__name__)


def vapid_key_file(data_dir):
    return Path(data_dir) / 'stockpilot-vapid-private.pem'


def ensure_keys(data_dir):
    path = vapid_key_file(data_dir)
    if not path.exists():
        key = ec.generate_private_key(ec.SECP256R1())
        value = key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.TraditionalOpenSSL,
            encryption_algorithm=serialization.NoEncryption(),
        )
        try:
            descriptor = os.open(str(path), os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        except FileExistsError:
            pass
        else:
            with os.fdopen(descriptor, 'wb') as stream:
                stream.write(value)
    return path


def public_key(data_dir):
    key = serialization.load_pem_private_key(ensure_keys(data_dir).read_bytes(), password=None)
    raw = key.public_key().public_bytes(serialization.Encoding.X962,
                                       serialization.PublicFormat.UncompressedPoint)
    return base64.urlsafe_b64encode(raw).rstrip(b'=').decode('ascii')


def valid_subscription(value):
    if not isinstance(value, dict):
        raise ValueError('Abonnement de notification invalide.')
    endpoint = value.get('endpoint')
    keys = value.get('keys')
    if not isinstance(endpoint, str) or not (30 <= len(endpoint) <= 3000) or not isinstance(keys, dict):
        raise ValueError('Adresse de notification invalide.')
    try:
        url = urlparse(endpoint)
        host = (url.hostname or '').lower()
        port = url.port
    except ValueError:
        raise ValueError('Adresse de notification invalide.')
    # No arbitrary endpoint URL: sending notifications must not allow SSRF.
    domains = ('push.apple.com', 'push.services.mozilla.com',
               'fcm.googleapis.com', 'notify.windows.com')
    if (url.scheme != 'https' or port not in (None, 443) or url.username or url.password or
        not any(host == domain or host.endswith('.' + domain) for domain in domains)):
        raise ValueError('Fournisseur de notifications non autorisé.')
    result_keys = {}
    for name, length in (('p256dh', 65), ('auth', 16)):
        raw = keys.get(name)
        if not isinstance(raw, str) or len(raw) > 200 or not raw:
            raise ValueError('Clé de notification invalide.')
        try:
            decoded = base64.urlsafe_b64decode(raw + '=' * (-len(raw) % 4))
        except (ValueError, Exception):
            raise ValueError('Clé de notification invalide.')
        if len(decoded) != length:
            raise ValueError('Clé de notification invalide.')
        result_keys[name] = raw
    if not url.path or url.fragment:
        raise ValueError('Adresse de notification invalide.')
    return {'endpoint': endpoint, 'keys': result_keys}


def save_subscription(db, user_id, info):
    clean = valid_subscription(info)
    db.execute('''INSERT INTO push_subscriptions(endpoint,user_id,p256dh,auth,created_at)
                  VALUES(?,?,?,?,?)
                  ON CONFLICT(endpoint) DO UPDATE SET user_id=excluded.user_id,
                  p256dh=excluded.p256dh,auth=excluded.auth,created_at=excluded.created_at''',
               (clean['endpoint'], user_id, clean['keys']['p256dh'],
                clean['keys']['auth'], int(time.time())))
    # Avoid unbounded registrations for an account.
    db.execute('''DELETE FROM push_subscriptions WHERE user_id=?
                  AND endpoint NOT IN (SELECT endpoint FROM push_subscriptions
                  WHERE user_id=? ORDER BY created_at DESC, rowid DESC LIMIT 12)''',
               (user_id, user_id))
    return clean


def delete_subscription(db, user_id, endpoint):
    if not isinstance(endpoint, str):
        return
    db.execute('DELETE FROM push_subscriptions WHERE user_id=? AND endpoint=?', (user_id, endpoint))


def send_to_user_devices(db, data_dir, payload, user_id=None):
    query = '''SELECT s.endpoint,s.p256dh,s.auth FROM push_subscriptions s
               JOIN users u ON u.id=s.user_id WHERE u.enabled=1'''
    parameters = ()
    if user_id is not None:
        query += ' AND u.id=?'
        parameters = (user_id,)
    rows = db.execute(query, parameters).fetchall()
    if not rows:
        return 0
    key = str(ensure_keys(data_dir))
    sent = 0
    for row in rows:
        endpoint = row['endpoint']
        try:
            webpush(
                subscription_info={'endpoint': endpoint,
                                   'keys': {'p256dh': row['p256dh'], 'auth': row['auth']}},
                data=json.dumps(payload, ensure_ascii=False),
                vapid_private_key=key,
                vapid_claims={'sub': 'https://stockpilot.m4xim.eu'},
                ttl=3600,
                timeout=5,
            )
            sent += 1
        except WebPushException as exc:
            if exc.status_code in (404, 410):
                db.execute('DELETE FROM push_subscriptions WHERE endpoint=?', (endpoint,))
            else:
                LOG.warning('Erreur Web Push fournisseur : code=%s', exc.status_code)
        except Exception as exc:
            LOG.warning('Erreur de notification StockPilot : %s', type(exc).__name__)
    return sent


def send_stock_warning(db, data_dir, product, quantity, minimum):
    if minimum <= 0 or not product:
        return 0
    label = (' '.join((product['brand'] or '', product['model'] or ''))).strip()
    return send_to_user_devices(db, data_dir, {
        'title': 'StockPilot · Stock à réapprovisionner',
        'body': f'{label} : {quantity} disponible(s) (seuil : {minimum}).',
        'tag': 'low-stock-' + product['id'],
        'url': '/?page=products',
        'badge': '/app-icon-192.png',
    })

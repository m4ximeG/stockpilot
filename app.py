"""StockPilot — serveur multi-utilisateurs à stockage SQLite persistant."""
import io
import fcntl
import backup_service
import henrri_service
import os
import re
import secrets
import sqlite3
import tempfile
import time
from datetime import datetime, timezone
from functools import wraps
from pathlib import Path

import qrcode
import push_service
from flask import Flask, Response, abort, g, jsonify, redirect, render_template_string, request, send_file, send_from_directory, session, url_for
from werkzeug.middleware.proxy_fix import ProxyFix
from werkzeug.security import check_password_hash, generate_password_hash

ROOT = Path(__file__).resolve().parent
DATA_DIR = Path(os.environ.get('STOCKPILOT_DATA_DIR', '/data'))
DB_FILE = DATA_DIR / 'stockpilot.sqlite3'
DATA_DIR.mkdir(parents=True, exist_ok=True)

app = Flask(__name__, static_folder='static', static_url_path='/static')
app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1)
app.secret_key = os.environ.get('STOCKPILOT_SECRET_KEY') or secrets.token_hex(32)
app.config.update(
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE='Lax',
    SESSION_COOKIE_SECURE=os.environ.get('STOCKPILOT_SECURE_COOKIES', '0') == '1',
    PERMANENT_SESSION_LIFETIME=60 * 60 * 12,
    MAX_CONTENT_LENGTH=9 * 1024 * 1024,
)
DEMO_SEED = os.environ.get('STOCKPILOT_DEV_FIXTURES', '0') == '1'
ALLOW_RESET = os.environ.get('STOCKPILOT_ALLOW_RESET', '0') == '1'
ZONE_CODES = 'ABCDEFGHIJ'
SLOTS = [f'{z}-{level}' for z in ZONE_CODES for level in (1, 2, 3, 4, 5)]

PRODUCTS = [
('hp450','HP','ProBook 450 G10','PC portable','A','laptop','HP-PB450-G10'),
('hp640','HP','EliteBook 640 G10','PC portable','A','laptop','HP-EB640-G10'),
('hp255','HP','255 G10','PC portable','A','laptop','HP-255-G10'),
('dell5440','Dell','Latitude 5440','PC portable','B','laptop','DE-LAT5440'),
('dell3550','Dell','Vostro 3550','PC portable','B','laptop','DE-V3550'),
('lenT14','Lenovo','ThinkPad T14 Gen 5','PC portable','C','laptop','LE-T14-G5'),
('lenE16','Lenovo','ThinkPad E16','PC portable','C','laptop','LE-E16'),
('macair','Apple','MacBook Air M3','PC portable','D','laptop','AP-MBA-M3'),
('macmini','Apple','Mac mini M4','PC fixe','D','harddrive','AP-MINI-M4'),
('samsung24','Samsung','Moniteur 24” FHD','Écran','E','monitor','SA-24-FHD'),
('dell27','Dell','Moniteur 27” QHD','Écran','E','monitor','DE-27-QHD'),
('logi','Logitech','Souris M185','Accessoire','F','package','LO-M185'),
('dock','TERRA','Station d’accueil USB-C','Accessoire','F','package','TE-DOCK-USBC')]
SAMPLE_STOCK = {'A':['hp450','hp450','hp450','hp640','hp640','hp255'],
                'B':['dell5440','dell5440','dell5440','dell3550'],
                'C':['lenT14','lenT14','lenT14','lenE16'],
                'D':['macair','macair','macmini'],
                'E':['samsung24','samsung24','samsung24','dell27','dell27'],
                'F':['logi','logi','logi','dock','dock']}


def connect():
    con = sqlite3.connect(DB_FILE, timeout=10, isolation_level=None)
    con.row_factory = sqlite3.Row
    con.execute('PRAGMA foreign_keys=ON')
    con.execute('PRAGMA busy_timeout=10000')
    return con


def initialize():
    with connect() as con:
        con.executescript('''
        PRAGMA journal_mode=WAL;
        DROP INDEX IF EXISTS unique_occupied_slot;
        CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE,
          password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('admin','employee')),
          enabled INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS products (
          id TEXT PRIMARY KEY, brand TEXT NOT NULL, model TEXT NOT NULL,
          cat TEXT NOT NULL, zone TEXT NOT NULL, kind TEXT NOT NULL,
          ref TEXT NOT NULL UNIQUE COLLATE NOCASE, active INTEGER NOT NULL DEFAULT 1
        );
        CREATE TABLE IF NOT EXISTS items (
          id TEXT PRIMARY KEY, pid TEXT NOT NULL REFERENCES products(id),
          slot TEXT NOT NULL, serial TEXT, condition TEXT NOT NULL,
          in_at INTEGER NOT NULL, out_at INTEGER, in_by TEXT NOT NULL, out_by TEXT
        );
        CREATE INDEX IF NOT EXISTS items_location_idx ON items(slot) WHERE out_at IS NULL;
        CREATE UNIQUE INDEX IF NOT EXISTS unique_active_serial ON items(serial COLLATE NOCASE)
          WHERE out_at IS NULL AND serial IS NOT NULL AND serial <> '';
        CREATE INDEX IF NOT EXISTS item_status ON items(out_at, pid);
        CREATE TABLE IF NOT EXISTS events (
          id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL,
          item_id TEXT NOT NULL, pid TEXT NOT NULL, slot TEXT NOT NULL,
          at INTEGER NOT NULL, actor TEXT NOT NULL, detail TEXT DEFAULT ''
        );
        CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        -- Compteur global transactionnel, commun à tous les processus et appareils.
        -- Les triggers s'exécutent dans la même transaction que le changement métier.
        CREATE TABLE IF NOT EXISTS sync_revision (
          id INTEGER PRIMARY KEY CHECK(id = 1), revision INTEGER NOT NULL DEFAULT 0
        );
        INSERT OR IGNORE INTO sync_revision(id,revision) VALUES(1,0);

        CREATE TABLE IF NOT EXISTS push_subscriptions (
          endpoint TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id),
          p256dh TEXT NOT NULL, auth TEXT NOT NULL, created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS push_subscriptions_user_idx ON push_subscriptions(user_id);

        CREATE TABLE IF NOT EXISTS shelf_levels (
          slot TEXT PRIMARY KEY, size TEXT NOT NULL DEFAULT 'unknown',
          note TEXT NOT NULL DEFAULT ''
        );
        ''')
        # Détection automatique de TOUS les changements de stock (y compris les routes
        # historiques) sans mémoire locale : fonctionnement multi-workers / multi-appareils.
        for table in ('products', 'items', 'events', 'shelf_levels', 'users'):
            for operation in ('INSERT', 'UPDATE', 'DELETE'):
                con.execute(f"""CREATE TRIGGER IF NOT EXISTS sync_{table}_{operation.lower()}
                  AFTER {operation} ON {table} BEGIN
                    UPDATE sync_revision SET revision=revision+1 WHERE id=1;
                  END""")
        # Migration additive: la préférence d'emplacement n'affecte aucun ancien article.
        existing_columns = {row['name'] for row in con.execute('PRAGMA table_info(products)')}
        if 'preferred_slot' not in existing_columns:
            con.execute("ALTER TABLE products ADD COLUMN preferred_slot TEXT NOT NULL DEFAULT ''")
        # Seuil de réapprovisionnement par référence : migration additive et sans perte.
        if 'min_stock' not in existing_columns:
            con.execute("ALTER TABLE products ADD COLUMN min_stock INTEGER NOT NULL DEFAULT 0 CHECK(min_stock >= 0)")
        con.executemany("INSERT OR IGNORE INTO shelf_levels(slot,size,note) VALUES(?,'unknown','')", [(slot,) for slot in SLOTS])
        con.execute("INSERT OR IGNORE INTO meta(key,value) VALUES('location_mode','optional')")
        if not con.execute('SELECT 1 FROM users LIMIT 1').fetchone():
            password = os.environ.get('STOCKPILOT_ADMIN_PASSWORD', '')
            if len(password) < 12:
                raise RuntimeError('STOCKPILOT_ADMIN_PASSWORD doit contenir au moins 12 caractères au premier démarrage.')
            username = os.environ.get('STOCKPILOT_ADMIN_USERNAME', 'admin').strip() or 'admin'
            con.execute('INSERT INTO users(username,password_hash,role,created_at) VALUES (?,?,?,?)',
                        (username,generate_password_hash(password),'admin',int(time.time()*1000)))
        if not con.execute('SELECT 1 FROM products LIMIT 1').fetchone() and DEMO_SEED:
            con.executemany('INSERT INTO products(id,brand,model,cat,zone,kind,ref) VALUES (?,?,?,?,?,?,?)', PRODUCTS)
        if not con.execute("SELECT value FROM meta WHERE key='next_item'").fetchone():
            con.execute("INSERT INTO meta(key,value) VALUES('next_item','1')")
            if DEMO_SEED:
                con.execute("UPDATE meta SET value='236' WHERE key='next_item'")
                seed_stock(con)
        if not DEMO_SEED:
            purge_original_demo_stock(con)


def purge_original_demo_stock(con):
    """Retirer uniquement les 27 unités de la démo originale, jamais les vraies saisies."""
    if con.execute("SELECT 1 FROM meta WHERE key='original_demo_purged_v1'").fetchone():
        return
    originals = []
    for num in range(236, 263):
        item_id = f'STK-{num:06d}'
        expected_serial = 'SN' + str(33000 + num * 37)
        row = con.execute("SELECT id,pid FROM items WHERE id=? AND serial=? AND in_by='Équipe magasin'",
                          (item_id,expected_serial)).fetchone()
        if row:
            originals.append(row)
    if originals:
        con.commit()
        backup_dir = DATA_DIR / 'backups'
        backup_dir.mkdir(parents=True,exist_ok=True)
        backup_file = backup_dir / ('avant-retrait-demo-' + datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S') + '-' + secrets.token_hex(4) + '.sqlite3')
        snapshot = sqlite3.connect(str(backup_file))
        try:
            con.backup(snapshot)
        finally:
            snapshot.close()
        # Nettoie les mouvements rattachés aux appareils fictifs, sans toucher aux autres.
        con.execute('BEGIN IMMEDIATE')
        for row in originals:
            con.execute('DELETE FROM events WHERE item_id=?', (row['id'],))
            con.execute('DELETE FROM items WHERE id=?', (row['id'],))
        # Ne retire que les références originales qui ne sont plus utilisées
        # et dont le code interne est inchangé.
        for pid,brand,model,cat,zone,kind,ref in PRODUCTS:
            used = con.execute('SELECT 1 FROM items WHERE pid=? LIMIT 1',(pid,)).fetchone()
            current = con.execute('SELECT ref FROM products WHERE id=?',(pid,)).fetchone()
            if not used and current and current['ref']==ref and not con.execute('SELECT 1 FROM events WHERE pid=? LIMIT 1',(pid,)).fetchone():
                con.execute('DELETE FROM products WHERE id=?',(pid,))
    con.execute("INSERT OR IGNORE INTO meta(key,value) VALUES('original_demo_purged_v1','1')")



def seed_stock(con):
    now = int(time.time() * 1000)
    n = 236
    for zone, ids in SAMPLE_STOCK.items():
        slots = [s for s in SLOTS if s.startswith(zone + '-')]
        for index, pid in enumerate(ids):
            item_id = f'STK-{n:06d}'
            moment = now - (index + ord(zone) - 64) * 7_000_000
            serial = 'SN' + str(33000 + n * 37)
            con.execute('INSERT INTO items(id,pid,slot,serial,condition,in_at,in_by) VALUES (?,?,?,?,?,?,?)',
                        (item_id,pid,slots[index % len(slots)],serial,'Neuf',moment,'Équipe magasin'))
            con.execute('INSERT INTO events(type,item_id,pid,slot,at,actor) VALUES (?,?,?,?,?,?)',
                        ('in',item_id,pid,slots[index % len(slots)],moment,'Équipe magasin'))
            n += 1
    con.execute("UPDATE meta SET value=? WHERE key='next_item'", (str(n),))

initialize()


@app.before_request
def before_request():
    mutation = request.method not in ('GET', 'HEAD', 'OPTIONS')
    if mutation and request.endpoint not in ('login',):
        # Header non-simple + same-origin session cookie to mitigate cross-site form submissions.
        if request.headers.get('X-Requested-With') != 'StockPilot':
            abort(403)
        origin = request.headers.get('Origin')
        if origin and origin.rstrip('/') != request.host_url.rstrip('/'):
            abort(403)
    if mutation:
        # Verrou global pendant les écritures : une restauration ne peut pas
        # remplacer la base au milieu d'un enregistrement sur un autre poste.
        lock = (DATA_DIR / '.stockpilot-write.lock').open('a+b')
        try:
            os.chmod(DATA_DIR / '.stockpilot-write.lock', 0o600)
            fcntl.flock(lock, fcntl.LOCK_EX)
        except Exception:
            lock.close()
            raise
        g.write_lock = lock
    g.db = connect()


@app.teardown_request
def teardown_request(_exc):
    db = getattr(g, 'db', None)
    if db is not None:
        db.close()
    lock = getattr(g, 'write_lock', None)
    if lock is not None:
        fcntl.flock(lock, fcntl.LOCK_UN)
        lock.close()


def logged_in():
    user_id = session.get('user_id')
    if not user_id:
        return None
    return g.db.execute('SELECT id,username,role,enabled FROM users WHERE id=?', (user_id,)).fetchone()


def protected(admin=False):
    def decorator(fn):
        @wraps(fn)
        def inner(*args, **kwargs):
            user = logged_in()
            if not user or not user['enabled']:
                if request.path.startswith('/api/'):
                    return jsonify(error='Session expirée. Reconnectez-vous.', code='auth'), 401
                return redirect('/login')
            if admin and user['role'] != 'admin':
                return jsonify(error='Action réservée aux administrateurs.'), 403
            g.user = user
            return fn(*args, **kwargs)
        return inner
    return decorator


def bad(msg, status=400):
    return jsonify(error=msg), status


def clean_text(value, field, limit=100, required=False):
    if not isinstance(value, str):
        raise ValueError(f'Champ invalide : {field}')
    value = value.strip()
    if len(value) > limit or (required and not value):
        raise ValueError(f'Champ invalide : {field}')
    return value


def json_body():
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        raise ValueError('Format JSON invalide.')
    return data


def read_stock_threshold(value):
    """Quantité minimale entière, non négative et bornée."""
    if isinstance(value, bool) or value is None:
        raise ValueError('Seuil de stock invalide (entier de 0 à 99999).')
    if isinstance(value, str):
        if not value.strip().isdigit():
            raise ValueError('Seuil de stock invalide (entier de 0 à 99999).')
        value = int(value.strip())
    if not isinstance(value, int) or not 0 <= value <= 99999:
        raise ValueError('Seuil de stock invalide (entier de 0 à 99999).')
    return value


def row_dict(row):
    return dict(row)


LOGIN_HTML = '''<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#101a2d"><title>StockPilot — Connexion</title><link rel="manifest" href="/static/app.webmanifest"><link rel="apple-touch-icon" href="/apple-touch-icon.png"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-title" content="StockPilot">
<style>*,*:before,*:after{box-sizing:border-box}body{margin:0;background:#f1f5fb;color:#15223b;font:15px system-ui,-apple-system,Segoe UI,Arial,sans-serif;min-height:100vh;display:grid;place-items:center;padding:20px;background-image:radial-gradient(circle at 20% 10%,#e2ecff 0,transparent 40%),radial-gradient(circle at 90% 80%,#dce6f7 0,transparent 30%)}.wrap{width:min(100%,450px);background:#fff;padding:40px;border-radius:24px;box-shadow:0 22px 80px #243a5c20;border:1px solid #e3eaf5}.brand{display:flex;align-items:center;gap:12px;font-size:24px;font-weight:800}.mark{display:grid;place-items:center;width:42px;height:42px;border-radius:12px;background:#2262e4;color:#fff}.sub{color:#687a93;font-size:14px;line-height:1.6;margin:14px 0 32px}label{display:block;font-size:13px;font-weight:700;margin:17px 0 8px}input{height:48px;padding:0 14px;border:1px solid #d9e1ed;border-radius:11px;width:100%;font:inherit;outline:0}input:focus{border-color:#2870ef;box-shadow:0 0 0 3px #2970ef18}button{margin-top:26px;background:#2469e9;border:0;color:white;border-radius:11px;width:100%;height:48px;font:inherit;font-weight:700;cursor:pointer}p.err{background:#fff1f1;border:1px solid #fecaca;color:#b42318;padding:12px;border-radius:10px}.foot{color:#8b98ab;font-size:12px;text-align:center;margin-top:30px}.wrap{border-radius:12px;box-shadow:0 8px 30px #27394210;border-color:#dfe6e7}.brand{color:#223b48;letter-spacing:-.6px}.mark{background:#2f4f5d;border-radius:8px}body{background:#f5f6f5;background-image:none;color:#233840}input{border-radius:7px}input:focus{border-color:#74949a;box-shadow:0 0 0 3px #2f647115}button{background:#294a57;border-radius:7px}button:hover{background:#3e626f}.foot{color:#87969c}
/* Aurora login — the same storm-photo and frosted-glass design as the dashboard. */
body{background:
 linear-gradient(110deg,#061922bb 0%,#071e2355 65%,#09252a55),
 url("/static/aurora-storm.jpg") center 45%/cover fixed no-repeat,
 url("https://images.pexels.com/photos/39914828/pexels-photo-39914828/free-photo-of-stunning-thunderstorm-over-rural-wheat-field.png?auto=compress&dpr=1&w=2200") center 45%/cover fixed no-repeat,
 #061820;color:#fff;font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
body:before,body:after{display:none}
.wrap{position:relative;z-index:1;background:linear-gradient(180deg,rgba(255,255,255,.20),rgba(255,255,255,.26) 24%,rgba(255,255,255,.22));
 border:1px solid rgba(255,255,255,.24);border-radius:26px;box-shadow:0 22px 70px #02171c42;padding:42px;
 backdrop-filter:blur(26px) saturate(118%);-webkit-backdrop-filter:blur(26px) saturate(118%)}
.wrap:before{display:none}
.brand{font-size:25px;font-weight:700;letter-spacing:-1.1px;color:white}
.mark{background:#ffffff27;border:1px solid #ffffff44;border-radius:11px;color:white;box-shadow:none}
.sub{color:#ffffffe6;font-size:13px;line-height:1.7;margin:20px 0 30px}
label{color:#fff;font-size:11px;letter-spacing:.2px;font-weight:650}
input{background:#ffffff22;border:1px solid #ffffff60;color:#fff;border-radius:10px;box-shadow:none}
input:focus{border-color:#fff;box-shadow:0 0 0 3px #ffffff26}
button{background:#ffffffdb;color:#18323b;border:1px solid #fff;border-radius:10px;box-shadow:none;font-size:13px;transition:background .2s,transform .2s}
button:hover{background:white;color:#18323b;transform:translateY(-1px)}
.foot{color:#ffffffc4;letter-spacing:.5px}
p.err{background:#76393a85;border:1px solid #ffffff52;color:white}
@media(max-width:520px){.wrap{padding:28px 22px;border-radius:20px}.brand{font-size:23px}}
@media(prefers-reduced-motion:reduce){button{transition:none}}
</style></head><body><main class="wrap"><div class="brand"><span class="mark">▣</span> StockPilot</div><p class="sub">Votre inventaire, chaque mouvement, un seul endroit.<br>Connectez-vous à votre espace magasin.</p>{% if error %}<p class="err">{{error}}</p>{% endif %}<form method="post"><label for="username">Identifiant</label><input id="username" name="username" autocomplete="username" required autofocus><label for="password">Mot de passe</label><input id="password" type="password" name="password" autocomplete="current-password" required><button type="submit">Se connecter</button></form><div class="foot">StockPilot · Application interne</div></main><script>if('serviceWorker' in navigator && location.protocol==='https:')navigator.serviceWorker.register('/sw.js').catch(()=>{});</script></body></html>'''
_failed = {}


@app.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'GET':
        if logged_in():
            return redirect('/')
        return render_template_string(LOGIN_HTML, error=None)
    ip = request.remote_addr or 'unknown'
    tries, until = _failed.get(ip, (0, 0))
    if until > time.time():
        return render_template_string(LOGIN_HTML, error='Trop de tentatives. Réessayez dans quelques minutes.'), 429
    username = request.form.get('username', '')
    password = request.form.get('password', '')
    user = g.db.execute('SELECT * FROM users WHERE username=?', (username,)).fetchone()
    if not user or not user['enabled'] or not check_password_hash(user['password_hash'], password):
        tries += 1
        _failed[ip] = (tries, time.time() + 300 if tries >= 8 else 0)
        return render_template_string(LOGIN_HTML, error='Identifiant ou mot de passe incorrect.'), 401
    _failed.pop(ip, None)
    session.clear()
    session['user_id'] = user['id']
    session.permanent = True
    return redirect('/')


@app.get('/logout')
def logout():
    session.clear()
    return redirect('/login')


@app.get('/')
@protected()
def home():
    r = send_from_directory(app.static_folder, 'index.html')
    r.headers['Cache-Control'] = 'no-store'
    return r


@app.after_request
def prevent_stale_frontend_assets(response):
    # La DA a subi plusieurs refontes : interdire les anciennes versions
    # JS/CSS en cache évite les mélanges de pages et de styles.
    if request.path.startswith('/static/') and request.path.endswith(('.js', '.css')):
        response.headers['Cache-Control'] = 'no-store, max-age=0, must-revalidate'
        response.headers['Pragma'] = 'no-cache'
        response.headers['Expires'] = '0'
    return response


@app.get('/sw.js')
def service_worker():
    """Service worker scoped to the site; never cache user data."""
    response = send_from_directory(app.static_folder, 'sw.js', mimetype='application/javascript')
    response.headers['Cache-Control'] = 'no-cache, must-revalidate'
    response.headers['Service-Worker-Allowed'] = '/'
    return response


@app.get('/apple-touch-icon.png')
@app.get('/app-icon-<int:size>.png')
def mobile_icon(size=180):
    """Branded PNG icons generated without external image dependencies."""
    if size not in (180, 192, 512):
        abort(404)
    from PIL import Image, ImageDraw
    icon = Image.new('RGB', (size, size), '#26354e')
    draw = ImageDraw.Draw(icon)
    # Match the dark storm + frosted-glass identity on iOS and Android.
    for y in range(size):
        t = y / max(1, size - 1)
        col = tuple(round(a * (1 - t) + b * t) for a, b in zip((30, 45, 67), (64, 76, 99)))
        draw.line([(0, y), (size, y)], fill=col)
    edge = max(2, round(size / 135))
    draw.rounded_rectangle((edge, edge, size - edge - 1, size - edge - 1),
                           radius=round(size * .21), outline=(118, 142, 159), width=edge)
    scale = size / 80
    def pt(x, y):
        return (round((x + 8) * scale), round((y + 8) * scale))
    white, mint = '#F8FDFF', '#C8F6EC'
    thick = max(3, round(3.3 * scale))
    draw.line([pt(15, 7), pt(9, 7), pt(7, 9), pt(7, 15)],
              fill=mint, width=thick, joint='curve')
    draw.line([pt(49, 57), pt(55, 57), pt(57, 55), pt(57, 49)],
              fill=mint, width=thick, joint='curve')
    poly = [pt(32, 14), pt(49, 24), pt(49, 40), pt(32, 50), pt(15, 40), pt(15, 24), pt(32, 14)]
    draw.line(poly, fill=white, width=thick, joint='curve')
    draw.line([pt(16, 24), pt(32, 34), pt(48, 24)], fill=white, width=thick, joint='curve')
    draw.line([pt(32, 34), pt(32, 49)], fill=white, width=thick)
    draw.line([pt(25, 18), pt(41, 27)], fill=mint, width=max(2, round(2.5 * scale)))
    buf = io.BytesIO()
    icon.save(buf, format='PNG', optimize=True)
    buf.seek(0)
    response = send_file(buf, mimetype='image/png', max_age=86400)
    response.headers['X-Content-Type-Options'] = 'nosniff'
    return response


@app.get('/healthz')
def healthz():
    return jsonify(status='ok')


@app.get('/api/state')
@protected()
def state():
    db = g.db
    # Un instantané cohérent : les requêtes de la même réponse voient la même version.
    db.execute('BEGIN')
    try:
        products = [row_dict(x) for x in db.execute('SELECT id,brand,model,cat,zone,kind,ref,active,preferred_slot,min_stock FROM products ORDER BY brand,model')]
        items = [dict(id=x['id'],pid=x['pid'],slot=x['slot'],serial=x['serial'] or '',condition=x['condition'],inAt=x['in_at']) for x in db.execute('SELECT * FROM items WHERE out_at IS NULL ORDER BY in_at')]
        events = [dict(id='e'+str(x['id']),type=x['type'],itemId=x['item_id'],pid=x['pid'],slot=x['slot'],at=x['at'],actor=x['actor'],detail=x['detail']) for x in db.execute('SELECT * FROM events ORDER BY id DESC LIMIT 1500')]
        shelves = [dict(slot=r['slot'],size=r['size'],note=r['note']) for r in db.execute('SELECT slot,size,note FROM shelf_levels ORDER BY slot')]
        counter = int(db.execute("SELECT value FROM meta WHERE key='next_item'").fetchone()[0])
        location_mode = db.execute("SELECT value FROM meta WHERE key='location_mode'").fetchone()
        revision = db.execute('SELECT revision FROM sync_revision WHERE id=1').fetchone()[0]
        response = jsonify(items=items,events=events,counter=counter,catalog=products,shelves=shelves,me=dict(id=g.user['id'],username=g.user['username'],role=g.user['role']),allowReset=ALLOW_RESET and DEMO_SEED,locationMode='optional',revision=revision)
        response.headers['Cache-Control'] = 'private, no-store'
        return response

    finally:
        db.execute('ROLLBACK')

@app.get('/api/admin/henrri/valuation')
@protected(admin=True)
def henrri_stock_valuation():
    """Lecture seule : prix Henrri × quantités de StockPilot ; aucun document modifié."""
    status = henrri_service.public_status()
    if not status['configured']:
        response = jsonify(status)
    else:
        products = [dict(r) for r in g.db.execute(
            'SELECT id,brand,model,ref FROM products'
        )]
        stock_items = [dict(r) for r in g.db.execute(
            'SELECT pid,condition FROM items WHERE out_at IS NULL'
        )]
        try:
            result = henrri_service.valuation(
                products, stock_items, force=request.args.get('refresh') == '1'
            )
        except henrri_service.HenrriError as exc:
            response = jsonify(**status, status='error', error=str(exc))
            response.headers['Cache-Control'] = 'private, no-store'
            return response, 503
        response = jsonify(result)
    response.headers['Cache-Control'] = 'private, no-store'
    return response


@app.get('/api/sync/revision')
@protected()
def sync_revision():
    """Réponse minuscule pour vérifier le stock sans recharger les écrans.
    Le compteur persiste en SQLite et voit les écritures d'autres workers.
    """
    revision = g.db.execute('SELECT revision FROM sync_revision WHERE id=1').fetchone()[0]
    response = jsonify(revision=revision)
    response.headers['Cache-Control'] = 'private, no-store'
    return response


@app.get('/api/push/public-key')
@protected()
def push_public_key():
    return jsonify(publicKey=push_service.public_key(DATA_DIR))


@app.post('/api/push/subscriptions')
@protected()
def push_subscribe():
    try:
        sub = json_body()
        push_service.save_subscription(g.db, g.user['id'], sub)
        return jsonify(ok=True)
    except ValueError as exc:
        return bad(str(exc))


@app.delete('/api/push/subscriptions')
@protected()
def push_unsubscribe():
    try:
        endpoint = json_body().get('endpoint')
        push_service.delete_subscription(g.db, g.user['id'], endpoint)
        return jsonify(ok=True)
    except ValueError as exc:
        return bad(str(exc))


@app.post('/api/push/test')
@protected()
def push_test():
    # Test only the requesting user, never all employees.
    try:
        count = push_service.send_to_user_devices(g.db, DATA_DIR, {
            'title': 'StockPilot · Notifications activées',
            'body': 'Votre téléphone pourra recevoir les alertes de réapprovisionnement.',
            'tag': 'stockpilot-test',
            'url': '/?page=products',
        }, g.user['id'])
    except Exception:
        app.logger.exception('Échec de test Web Push')
        return bad('Service de notifications indisponible.', 503)
    return jsonify(ok=count > 0, devices=count)


@app.post('/api/receive')
@protected()
def receive_free_text():
    """Une seule transaction : référence existante OU nouvelle référence puis entrée."""
    db = g.db
    try:
        data=json_body()
        name=clean_text(data.get('name',''), 'Nom du produit', 120, True)
        serial=clean_text(data.get('serial',''), 'Numéro de série', 100)
        # Mode inventaire simple : aucune localisation n'est demandée.
        slot = ''
        condition=clean_text(data.get('condition','Neuf'), 'État',30,True)
        product_id=clean_text(data.get('product_id',''), 'Référence sélectionnée',64)
        if condition not in ('Neuf','Retour SAV','Réparation'):
            return bad('État invalide.')
        db.execute('BEGIN IMMEDIATE')
        created=False
        if product_id:
            product=db.execute('SELECT id FROM products WHERE id=? AND active=1',(product_id,)).fetchone()
            if not product:
                db.rollback()
                return bad('Référence sélectionnée indisponible.')
            pid=product['id']
        else:
            # Reconnait automatiquement une référence portant exactement ce nom.
            product=db.execute("""SELECT id FROM products WHERE active=1
                AND (lower(trim(brand || ' ' || model))=lower(?) OR lower(trim(model))=lower(?))
                ORDER BY id LIMIT 1""",(name,name)).fetchone()
            if product:
                pid=product['id']
            else:
                pid='p_'+secrets.token_hex(6)
                ref='REF-'+secrets.token_hex(5).upper()
                # Aucun renseignement de marque obligatoire au comptoir.
                db.execute("""INSERT INTO products(id,brand,model,cat,zone,kind,ref,preferred_slot)
                    VALUES(?, '', ?, 'Matériel', ?, 'package', ?, ?)""",
                    (pid,name,slot[0] if slot else 'A',ref,slot))
                created=True
        next_row=db.execute("SELECT value FROM meta WHERE key='next_item'").fetchone()
        num=int(next_row['value']) if next_row else 1
        # Compteur monotone : ne réutilise jamais un identifiant historique.
        while db.execute('SELECT 1 FROM items WHERE id=?',(f'STK-{num:06d}',)).fetchone():
            num+=1
        item_id=f'STK-{num:06d}'
        when=int(time.time()*1000)
        db.execute("""INSERT INTO items(id,pid,slot,serial,condition,in_at,in_by)
                    VALUES(?,?,?,?,?,?,?)""",(item_id,pid,slot,serial or None,condition,when,g.user['username']))
        db.execute("""INSERT INTO events(type,item_id,pid,slot,at,actor)
                    VALUES('in',?,?,?,?,?)""",(item_id,pid,slot,when,g.user['username']))
        db.execute("INSERT INTO meta(key,value) VALUES('next_item',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",(str(num+1),))
        db.commit()
        return jsonify(item=dict(id=item_id,pid=pid,slot=slot,serial=serial,
                   condition=condition,inAt=when),createdProduct=created),201
    except sqlite3.IntegrityError:
        db.rollback()
        return bad('Numéro de série déjà présent ou référence en conflit.',409)
    except ValueError as e:
        db.rollback()
        return bad(str(e))


@app.post('/api/items')
@protected()
def entry_item():
    try:
        data = json_body()
        pid = clean_text(data.get('pid'), 'Produit', 64, True)
        slot = ''  # Système sans emplacement : anciennes applications également compatibles.
        serial = clean_text(data.get('serial', ''), 'N° de série', 100)
        condition = clean_text(data.get('condition', 'Neuf'), 'État', 30, True)
        if condition not in ('Neuf','Retour SAV','Réparation','Reconditionné','Occasion'):
            return bad('État invalide.')
        db = g.db
        db.execute('BEGIN IMMEDIATE')
        p = db.execute('SELECT id FROM products WHERE id=? AND active=1', (pid,)).fetchone()
        if not p:
            db.rollback()
            return bad('Référence introuvable ou désactivée.')
        n = int(db.execute("SELECT value FROM meta WHERE key='next_item'").fetchone()[0])
        item_id = f'STK-{n:06d}'
        when = int(time.time()*1000)
        db.execute('INSERT INTO items(id,pid,slot,serial,condition,in_at,in_by) VALUES(?,?,?,?,?,?,?)',
                   (item_id,pid,slot,serial or None,condition,when,g.user['username']))
        db.execute('INSERT INTO events(type,item_id,pid,slot,at,actor) VALUES(?,?,?,?,?,?)',
                   ('in',item_id,pid,slot,when,g.user['username']))
        db.execute("UPDATE meta SET value=? WHERE key='next_item'", (str(n+1),))
        db.commit()
        return jsonify(item=dict(id=item_id,pid=pid,slot=slot,serial=serial,condition=condition,inAt=when)), 201
    except sqlite3.IntegrityError:
        g.db.rollback()
        return bad('Ce numéro de série est déjà enregistré dans le stock.', 409)
    except ValueError as e:
        return bad(str(e))


@app.post('/api/items/<item_id>/out')
@protected()
def exit_item(item_id):
    db = g.db
    db.execute('BEGIN IMMEDIATE')
    item = db.execute('SELECT * FROM items WHERE id=? AND out_at IS NULL', (item_id,)).fetchone()
    if not item:
        db.rollback()
        return bad('Cet article est déjà sorti ou introuvable.', 409)
    now = int(time.time()*1000)
    db.execute('UPDATE items SET out_at=?,out_by=? WHERE id=?', (now,g.user['username'],item_id))
    db.execute('INSERT INTO events(type,item_id,pid,slot,at,actor) VALUES(?,?,?,?,?,?)',
               ('out',item_id,item['pid'],item['slot'],now,g.user['username']))
    db.commit()
    # Notification uniquement lors du franchissement du seuil, pas à chaque scan.
    try:
        p = db.execute('SELECT id,brand,model,min_stock,active FROM products WHERE id=?',
                       (item['pid'],)).fetchone()
        if p and p['active'] and p['min_stock'] > 0 and item['condition'] not in ('Retour SAV','Réparation'):
            count = db.execute("""SELECT COUNT(*) FROM items WHERE pid=? AND out_at IS NULL
                                  AND condition NOT IN ('Retour SAV','Réparation')""",
                               (item['pid'],)).fetchone()[0]
            if count <= p['min_stock'] < count + 1:
                push_service.send_stock_warning(db, DATA_DIR, p, count, p['min_stock'])
    except Exception:
        app.logger.exception('Échec de notification de seuil')
    return jsonify(ok=True)


@app.post('/api/items/<item_id>/move')
@protected()
def move_item(item_id):
    try:
        slot = clean_text(json_body().get('slot', ''), 'Emplacement', 15)
        if slot and slot not in SLOTS:
            return bad('Emplacement inexistant.')
        location_mode = g.db.execute("SELECT value FROM meta WHERE key='location_mode'").fetchone()
        if not slot and location_mode and location_mode[0] == 'guided':
            return bad('Le rangement est obligatoire en mode guidé.')
        db = g.db
        db.execute('BEGIN IMMEDIATE')
        item = db.execute('SELECT * FROM items WHERE id=? AND out_at IS NULL', (item_id,)).fetchone()
        if not item:
            db.rollback()
            return bad('Article introuvable.', 404)
        if item['slot'] == slot:
            db.rollback()
            return bad('Article déjà à cet emplacement.')
        db.execute('UPDATE items SET slot=? WHERE id=?', (slot,item_id))
        db.execute('INSERT INTO events(type,item_id,pid,slot,at,actor,detail) VALUES(?,?,?,?,?,?,?)',
                   ('move',item_id,item['pid'],slot,int(time.time()*1000),g.user['username'],f"Depuis {item['slot']}"))
        db.commit()
        return jsonify(ok=True)
    except sqlite3.IntegrityError:
        g.db.rollback()
        return bad('Impossible de déplacer cet article.', 409)
    except ValueError as e:
        return bad(str(e))



@app.get('/label/<item_id>')
@protected()
def label_page(item_id):
    """PDF d'une seule page, découpé aux dimensions physiques d'un rouleau DYMO."""
    row = g.db.execute("""SELECT items.id, items.slot, items.serial, products.brand, products.model, products.ref
                          FROM items JOIN products ON items.pid=products.id WHERE items.id=?""", (item_id,)).fetchone()
    if not row:
        abort(404)
    # 11352 = 54 x 25 mm ; 11354 = 57 x 32 mm (à choisir selon le rouleau).
    formats = {'54x25': (54, 25), '57x32': (57, 32)}
    paper = request.args.get('size', '54x25')
    if paper not in formats:
        return bad('Format non pris en charge. Choisissez 54x25 ou 57x32.')
    width_mm, height_mm = formats[paper]

    from reportlab.pdfgen import canvas
    from reportlab.lib.units import mm
    from reportlab.pdfbase.pdfmetrics import stringWidth
    from reportlab.graphics.barcode.code128 import Code128
    from reportlab.graphics.barcode.qr import QrCodeWidget
    from reportlab.graphics import renderPDF
    from reportlab.graphics.shapes import Drawing

    width, height = width_mm * mm, height_mm * mm
    output = io.BytesIO()
    label = canvas.Canvas(output, pagesize=(width, height), pageCompression=1)
    label.setTitle('StockPilot - Etiquette ' + item_id)
    label.setAuthor('StockPilot')
    label.setFillColorRGB(0, 0, 0)

    def fit_line(text, font, width_limit, initial_size):
        text = str(text or '').replace('\n', ' ').strip()
        point = initial_size
        while point > 5 and stringWidth(text, font, point) > width_limit:
            point -= .25
        while len(text) > 4 and stringWidth(text, font, point) > width_limit:
            text = text[:-2] + '…'
        label.setFont(font, point)
        return text

    margin = 2.2 * mm
    label.setFont('Helvetica-Bold', 5.5)
    label.drawString(margin, height - 2.8 * mm, 'STOCKPILOT')
    display_name = ' '.join([row['brand'], row['model']]).strip()
    fitted_name = fit_line(display_name, 'Helvetica-Bold', width - 2 * margin, 8.3)
    label.drawString(margin, height - 5.3 * mm, fitted_name)
    reference = fit_line('REF ' + row['ref'], 'Helvetica', width - 2 * margin, 5.7)
    label.drawString(margin, height - 7.6 * mm, reference)

    qr_size = (10.9 if height_mm == 25 else 13) * mm
    code_width = width - margin * 2 - qr_size - 3 * mm
    code_height = (8.5 if height_mm == 25 else 11) * mm
    code = Code128(item_id, barHeight=code_height, barWidth=.61, quiet=False, humanReadable=False)
    if code.width > code_width:
        code = Code128(item_id, barHeight=code_height,
                       barWidth=.61 * code_width / code.width,
                       quiet=False, humanReadable=False)
    code.drawOn(label, margin, (5.3 if height_mm == 25 else 7) * mm)

    qr_code = QrCodeWidget(item_id)
    bounds = qr_code.getBounds()
    drawing = Drawing(bounds[2] - bounds[0], bounds[3] - bounds[1])
    drawing.add(qr_code)
    label.saveState()
    label.translate(width - margin - qr_size, (3.1 if height_mm == 25 else 4.4) * mm)
    label.scale(qr_size / drawing.width, qr_size / drawing.height)
    renderPDF.draw(drawing, label, -bounds[0], -bounds[1])
    label.restoreState()

    label.setFont('Courier-Bold', 7.2)
    label.drawString(margin, 2.1 * mm, item_id)
    label.showPage()
    label.save()
    output.seek(0)
    response = send_file(output, mimetype='application/pdf', as_attachment=False,
                         download_name=f'StockPilot-{item_id}-{paper}mm.pdf', max_age=0)
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['Cache-Control'] = 'private, no-store'
    return response


@app.get('/api/items/<item_id>/barcode.svg')
@protected()
def item_barcode(item_id):
    """Code-barres Code 128 réellement lisible par une douchette."""
    from barcode import Code128
    from barcode.writer import SVGWriter
    item = g.db.execute('SELECT id FROM items WHERE id=?', (item_id,)).fetchone()
    if not item:
        abort(404)
    image = Code128(item_id, writer=SVGWriter()).render(writer_options={
        'module_width': 0.23, 'module_height': 9, 'quiet_zone': 1.6,
        'font_size': 0, 'text_distance': 0, 'write_text': False,
    })
    response = send_file(io.BytesIO(image), mimetype='image/svg+xml', max_age=0)
    response.headers['X-Content-Type-Options'] = 'nosniff'
    return response


@app.get('/api/items/<item_id>/qr.png')
@protected()
def item_qr(item_id):
    item = g.db.execute('SELECT id FROM items WHERE id=?', (item_id,)).fetchone()
    if not item:
        abort(404)
    buf = io.BytesIO()
    qrcode.make(item_id, border=2, box_size=8).save(buf, format='PNG')
    buf.seek(0)
    return send_file(buf, mimetype='image/png', max_age=0)


@app.post('/api/settings/location-mode')
@protected(admin=True)
def update_location_mode():
    try:
        mode = clean_text(json_body().get('mode'), 'Mode de rangement', 24, True)
    except ValueError as exc:
        return bad(str(exc))
    if mode not in ('optional', 'guided'):
        return bad('Mode de rangement inconnu.')
    g.db.execute("INSERT INTO meta(key,value) VALUES('location_mode',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", (mode,))
    return jsonify(ok=True, locationMode=mode)


@app.patch('/api/shelves/<slot>')
@protected(admin=True)
def update_shelf(slot):
    if slot not in SLOTS:
        return bad('Étagère ou niveau inconnu.', 404)
    try:
        data = json_body()
        size = clean_text(data.get('size', 'unknown'), 'Taille', 16, True)
        note = clean_text(data.get('note', ''), 'Note', 120)
        if size not in ('unknown','small','medium','large'):
            return bad('Taille inconnue.')
        g.db.execute('UPDATE shelf_levels SET size=?, note=? WHERE slot=?', (size,note,slot))
        return jsonify(ok=True, slot=slot, size=size, note=note)
    except ValueError as e:
        return bad(str(e))


@app.post('/api/admin/clear-stock')
@protected(admin=True)
def clear_stock():
    """Destructive demo-to-real transition with explicit confirmation and server-side SQL backup."""
    data = request.get_json(silent=True)
    if not isinstance(data,dict) or data.get('confirmation') != 'VIDER LE STOCK':
        return bad('Saisissez exactement VIDER LE STOCK pour confirmer.', 400)
    db = g.db
    backup_dir = DATA_DIR / 'backups'
    backup_dir.mkdir(parents=True, exist_ok=True)
    backup_path = backup_dir / ('stockpilot-avant-vidage-' + datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S') + '-' + secrets.token_hex(4) + '.sqlite3')
    # Backup SQLite cohérente, y compris quand le journal WAL est actif.
    backup_connection = sqlite3.connect(str(backup_path))
    try:
        db.backup(backup_connection)
    except Exception:
        backup_connection.close()
        backup_path.unlink(missing_ok=True)
        raise
    finally:
        backup_connection.close()
    try:
        db.execute('BEGIN IMMEDIATE')
        db.execute('DELETE FROM events')
        db.execute('DELETE FROM items')
        db.execute('DELETE FROM products')
        db.commit()
    except Exception:
        db.rollback()
        return bad('Le nettoyage a échoué ; une sauvegarde a été conservée.', 500)
    return jsonify(ok=True, cleared=True, message='Stock, références et historique vidés. Comptes, règles de rangement et niveaux conservés.')


@app.post('/api/products')
@protected(admin=True)
def add_product():
    try:
        data = json_body()
        brand = clean_text(data.get('brand'), 'Marque', 60, True)
        model = clean_text(data.get('model'), 'Modèle', 100, True)
        cat = clean_text(data.get('cat'), 'Catégorie', 60, True)
        ref = clean_text(data.get('ref'), 'Référence', 80, True)
        zone = 'A'  # Colonne historique conservée uniquement pour compatibilité SQLite.
        preferred_slot = ''
        if preferred_slot and preferred_slot not in SLOTS:
            return bad('Emplacement conseillé inconnu.')
        if zone not in ZONE_CODES:
            return bad('Zone inconnue.')
        kind = {'PC portable':'laptop','PC fixe':'harddrive','Écran':'monitor'}.get(cat,'package')
        min_stock = read_stock_threshold(data.get('min_stock', 0))
        product_id = 'p_' + secrets.token_hex(6)
        g.db.execute('INSERT INTO products(id,brand,model,cat,zone,kind,ref,preferred_slot,min_stock) VALUES(?,?,?,?,?,?,?,?,?)',
                     (product_id,brand,model,cat,zone,kind,ref,preferred_slot,min_stock))
        return jsonify(id=product_id), 201
    except sqlite3.IntegrityError:
        return bad('Cette référence existe déjà.', 409)
    except ValueError as e:
        return bad(str(e))


@app.patch('/api/products/<product_id>')
@protected(admin=True)
def edit_product(product_id):
    try:
        data = json_body()
        p = g.db.execute('SELECT * FROM products WHERE id=?', (product_id,)).fetchone()
        if not p:
            return bad('Produit introuvable.', 404)
        fields = {}
        for field, limit in [('brand',60),('model',100),('cat',60),('ref',80),('zone',1)]:
            if field in data:
                fields[field] = clean_text(data[field],field,limit,True)
        if 'zone' in fields and fields['zone'] not in ZONE_CODES:
            return bad('Zone invalide.')
        if 'preferred_slot' in data:
            preferred_slot = clean_text(data['preferred_slot'], 'Emplacement conseillé', 15)
            if preferred_slot and preferred_slot not in SLOTS:
                return bad('Emplacement conseillé inconnu.')
            fields['preferred_slot'] = preferred_slot
        if 'active' in data:
            fields['active'] = 1 if data['active'] is True else 0
        if 'min_stock' in data:
            fields['min_stock'] = read_stock_threshold(data['min_stock'])
        if not fields:
            return bad('Aucun changement.')
        fields_sql = ','.join(f'{k}=?' for k in fields)
        g.db.execute(f'UPDATE products SET {fields_sql} WHERE id=?', [*fields.values(),product_id])
        # Activation d'un nouveau seuil déjà atteint : signalement unique.
        try:
            new_min = fields.get('min_stock')
            old_min = int(p['min_stock'])
            if new_min is not None and new_min > 0 and p['active']:
                qty = g.db.execute("""SELECT COUNT(*) FROM items WHERE pid=? AND out_at IS NULL
                                      AND condition NOT IN ('Retour SAV','Réparation')""",
                                   (product_id,)).fetchone()[0]
                if qty <= new_min and (old_min == 0 or qty > old_min):
                    push_service.send_stock_warning(g.db, DATA_DIR, p, qty, new_min)
        except Exception:
            app.logger.exception('Échec de notification de configuration')
        return jsonify(ok=True)
    except sqlite3.IntegrityError:
        return bad('Référence déjà utilisée.', 409)
    except ValueError as e:
        return bad(str(e))


@app.get('/api/users')
@protected(admin=True)
def list_users():
    return jsonify(users=[dict(id=x['id'],username=x['username'],role=x['role'],enabled=bool(x['enabled'])) for x in g.db.execute('SELECT id,username,role,enabled FROM users ORDER BY username')])


@app.post('/api/users')
@protected(admin=True)
def add_user():
    try:
        data = json_body()
        username = clean_text(data.get('username'), 'Identifiant', 50, True)
        password = clean_text(data.get('password'), 'Mot de passe', 250, True)
        role = clean_text(data.get('role', 'employee'), 'Rôle', 20)
        if len(password) < 12:
            return bad('Le mot de passe doit faire au moins 12 caractères.')
        if role not in ('admin','employee'):
            return bad('Rôle inconnu.')
        g.db.execute('INSERT INTO users(username,password_hash,role,created_at) VALUES(?,?,?,?)',
                     (username,generate_password_hash(password),role,int(time.time()*1000)))
        return jsonify(ok=True), 201
    except sqlite3.IntegrityError:
        return bad('Cet identifiant est déjà utilisé.', 409)
    except ValueError as e:
        return bad(str(e))


@app.patch('/api/users/<int:user_id>')
@protected(admin=True)
def edit_user(user_id):
    try:
        data = json_body()
        target = g.db.execute('SELECT * FROM users WHERE id=?', (user_id,)).fetchone()
        if not target:
            return bad('Utilisateur introuvable.', 404)
        fields = {}
        if 'role' in data:
            if data['role'] not in ('admin','employee'):
                return bad('Rôle inconnu.')
            fields['role'] = data['role']
        if 'enabled' in data:
            fields['enabled'] = 1 if data['enabled'] is True else 0
        if 'password' in data:
            pw = clean_text(data['password'],'Mot de passe',250,True)
            if len(pw) < 12:
                return bad('Mot de passe trop court (12 caractères minimum).')
            fields['password_hash'] = generate_password_hash(pw)
        if target['id'] == g.user['id'] and (fields.get('enabled') == 0 or fields.get('role') == 'employee'):
            return bad('Impossible de vous désactiver ou de retirer votre propre accès administrateur.')
        admins = g.db.execute("SELECT count(*) FROM users WHERE role='admin' AND enabled=1").fetchone()[0]
        if target['role'] == 'admin' and target['enabled'] and admins <= 1 and (fields.get('enabled') == 0 or fields.get('role') == 'employee'):
            return bad('Le dernier administrateur doit rester actif.')
        if not fields:
            return bad('Aucun changement.')
        g.db.execute('UPDATE users SET '+','.join(f'{k}=?' for k in fields)+' WHERE id=?', (*fields.values(),user_id))
        return jsonify(ok=True)
    except ValueError as e:
        return bad(str(e))


@app.post('/api/me/password')
@protected()
def change_password():
    try:
        data = json_body()
        old = clean_text(data.get('old_password'), 'Ancien mot de passe', 250, True)
        new = clean_text(data.get('new_password'), 'Nouveau mot de passe', 250, True)
        u = g.db.execute('SELECT password_hash FROM users WHERE id=?', (g.user['id'],)).fetchone()
        if not check_password_hash(u['password_hash'],old):
            return bad('Ancien mot de passe incorrect.', 403)
        if len(new)<12:
            return bad('Le nouveau mot de passe doit faire au moins 12 caractères.')
        g.db.execute('UPDATE users SET password_hash=? WHERE id=?', (generate_password_hash(new),g.user['id']))
        return jsonify(ok=True)
    except ValueError as e:
        return bad(str(e))


@app.get('/api/backup')
@protected(admin=True)
def download_backup():
    temp = tempfile.TemporaryFile()
    # Online SQLite backup is consistent while writes may be in progress.
    copy = sqlite3.connect(':memory:')
    g.db.backup(copy)
    script = '\n'.join(copy.iterdump()).encode('utf-8')
    copy.close()
    temp.write(script)
    temp.seek(0)
    return send_file(temp,mimetype='application/sql',as_attachment=True,download_name=f'stockpilot-{datetime.now(timezone.utc):%Y%m%d-%H%M}.sql')


@app.get('/api/admin/backups')
@protected(admin=True)
def list_managed_backups():
    result = jsonify(backups=backup_service.list_backups(DATA_DIR),
                     retentionDays=backup_service.BACKUP_KEEP_DAYS)
    result.headers['Cache-Control'] = 'private, no-store'
    return result


@app.post('/api/admin/backups')
@protected(admin=True)
def create_managed_backup():
    path = backup_service.create_manual_backup(DB_FILE, DATA_DIR)
    return jsonify(ok=True, name=path.name), 201


@app.get('/api/admin/backups/<name>/download')
@protected(admin=True)
def download_managed_backup(name):
    try:
        path = backup_service.resolve_backup(DATA_DIR, name)
    except (ValueError, FileNotFoundError):
        return bad('Sauvegarde introuvable.', 404)
    response = send_file(path, mimetype='application/vnd.sqlite3', as_attachment=True,
                         download_name=path.name, max_age=0)
    response.headers['Cache-Control'] = 'private, no-store'
    response.headers['X-Content-Type-Options'] = 'nosniff'
    return response


@app.post('/api/admin/backups/<name>/restore')
@protected(admin=True)
def restore_managed_backup(name):
    try:
        data = json_body()
        if data.get('confirmation') != 'RESTAURER LE STOCK':
            return bad('Écrivez RESTAURER LE STOCK pour confirmer.', 400)
        password = data.get('password')
        if not isinstance(password, str) or not check_password_hash(
            g.db.execute('SELECT password_hash FROM users WHERE id=?',
                         (g.user['id'],)).fetchone()['password_hash'], password
        ):
            return bad('Mot de passe administrateur incorrect.', 403)
        try:
            backup_service.resolve_backup(DATA_DIR, name)
        except (ValueError, FileNotFoundError):
            return bad('Sauvegarde introuvable.', 404)
        safeguard = backup_service.restore_backup(g.db, DB_FILE, DATA_DIR, name)
        return jsonify(ok=True, previousStateBackup=safeguard,
                       message='Stock restauré. Les autres appareils se synchroniseront automatiquement.')
    except (ValueError, sqlite3.DatabaseError, OSError) as exc:
        app.logger.exception('Échec restauration sauvegarde StockPilot')
        return bad('Restauration impossible : ' + str(exc), 409)


@app.post('/api/admin/reset')
@protected(admin=True)
def reset_demo():
    if not (ALLOW_RESET and DEMO_SEED):
        return bad('Réinitialisation désactivée sur ce serveur.', 403)
    db = g.db
    db.execute('BEGIN IMMEDIATE')
    db.execute('DELETE FROM events')
    db.execute('DELETE FROM items')
    db.execute('DELETE FROM products')
    db.executemany('INSERT INTO products(id,brand,model,cat,zone,kind,ref) VALUES(?,?,?,?,?,?,?)',PRODUCTS)
    db.execute("UPDATE meta SET value='236' WHERE key='next_item'")
    seed_stock(db)
    db.commit()
    return jsonify(ok=True)


@app.errorhandler(404)
def not_found(e):
    if request.path.startswith('/api/'):
        return bad('Ressource introuvable.', 404)
    return 'Page introuvable', 404


if __name__ == '__main__':
    app.run('127.0.0.1', int(os.environ.get('PORT', '8080')), debug=False)

"""StockPilot — serveur multi-utilisateurs à stockage SQLite persistant."""
import io
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
    MAX_CONTENT_LENGTH=256 * 1024,
)
DEMO_SEED = os.environ.get('STOCKPILOT_DEMO_SEED', '0') == '1'
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
        CREATE TABLE IF NOT EXISTS shelf_levels (
          slot TEXT PRIMARY KEY, size TEXT NOT NULL DEFAULT 'unknown',
          note TEXT NOT NULL DEFAULT ''
        );
        ''')
        # Migration additive: la préférence d'emplacement n'affecte aucun ancien article.
        existing_columns = {row['name'] for row in con.execute('PRAGMA table_info(products)')}
        if 'preferred_slot' not in existing_columns:
            con.execute("ALTER TABLE products ADD COLUMN preferred_slot TEXT NOT NULL DEFAULT ''")
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
            con.execute("INSERT INTO meta(key,value) VALUES('next_item','236')")
            if DEMO_SEED:
                seed_stock(con)


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
    g.db = connect()
    if request.method not in ('GET', 'HEAD', 'OPTIONS') and request.endpoint not in ('login',):
        # Header non-simple + same-origin session cookie to mitigate cross-site form submissions.
        if request.headers.get('X-Requested-With') != 'StockPilot':
            abort(403)
        origin = request.headers.get('Origin')
        if origin and origin.rstrip('/') != request.host_url.rstrip('/'):
            abort(403)


@app.teardown_request
def teardown_request(_exc):
    db = getattr(g, 'db', None)
    if db is not None:
        db.close()


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


def row_dict(row):
    return dict(row)


LOGIN_HTML = '''<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#101a2d"><title>StockPilot — Connexion</title>
<style>*,*:before,*:after{box-sizing:border-box}body{margin:0;background:#f1f5fb;color:#15223b;font:15px system-ui,-apple-system,Segoe UI,Arial,sans-serif;min-height:100vh;display:grid;place-items:center;padding:20px;background-image:radial-gradient(circle at 20% 10%,#e2ecff 0,transparent 40%),radial-gradient(circle at 90% 80%,#dce6f7 0,transparent 30%)}.wrap{width:min(100%,450px);background:#fff;padding:40px;border-radius:24px;box-shadow:0 22px 80px #243a5c20;border:1px solid #e3eaf5}.brand{display:flex;align-items:center;gap:12px;font-size:24px;font-weight:800}.mark{display:grid;place-items:center;width:42px;height:42px;border-radius:12px;background:#2262e4;color:#fff}.sub{color:#687a93;font-size:14px;line-height:1.6;margin:14px 0 32px}label{display:block;font-size:13px;font-weight:700;margin:17px 0 8px}input{height:48px;padding:0 14px;border:1px solid #d9e1ed;border-radius:11px;width:100%;font:inherit;outline:0}input:focus{border-color:#2870ef;box-shadow:0 0 0 3px #2970ef18}button{margin-top:26px;background:#2469e9;border:0;color:white;border-radius:11px;width:100%;height:48px;font:inherit;font-weight:700;cursor:pointer}p.err{background:#fff1f1;border:1px solid #fecaca;color:#b42318;padding:12px;border-radius:10px}.foot{color:#8b98ab;font-size:12px;text-align:center;margin-top:30px}</style></head><body><main class="wrap"><div class="brand"><span class="mark">▣</span> StockPilot</div><p class="sub">Gestion du stock et guidage de rangement.<br>Connectez-vous pour accéder au magasin.</p>{% if error %}<p class="err">{{error}}</p>{% endif %}<form method="post"><label for="username">Identifiant</label><input id="username" name="username" autocomplete="username" required autofocus><label for="password">Mot de passe</label><input id="password" type="password" name="password" autocomplete="current-password" required><button type="submit">Se connecter</button></form><div class="foot">StockPilot · Application interne</div></main></body></html>'''
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


@app.get('/healthz')
def healthz():
    return jsonify(status='ok')


@app.get('/api/state')
@protected()
def state():
    db = g.db
    products = [row_dict(x) for x in db.execute('SELECT id,brand,model,cat,zone,kind,ref,active,preferred_slot FROM products ORDER BY brand,model')]
    items = [dict(id=x['id'],pid=x['pid'],slot=x['slot'],serial=x['serial'] or '',condition=x['condition'],inAt=x['in_at']) for x in db.execute('SELECT * FROM items WHERE out_at IS NULL ORDER BY in_at')]
    events = [dict(id='e'+str(x['id']),type=x['type'],itemId=x['item_id'],pid=x['pid'],slot=x['slot'],at=x['at'],actor=x['actor'],detail=x['detail']) for x in db.execute('SELECT * FROM events ORDER BY id DESC LIMIT 1500')]
    shelves = [dict(slot=r['slot'],size=r['size'],note=r['note']) for r in db.execute('SELECT slot,size,note FROM shelf_levels ORDER BY slot')]
    counter = int(db.execute("SELECT value FROM meta WHERE key='next_item'").fetchone()[0])
    location_mode = db.execute("SELECT value FROM meta WHERE key='location_mode'").fetchone()
    return jsonify(items=items,events=events,counter=counter,catalog=products,shelves=shelves,me=dict(id=g.user['id'],username=g.user['username'],role=g.user['role']),allowReset=ALLOW_RESET,locationMode=location_mode[0] if location_mode else 'optional')


@app.post('/api/items')
@protected()
def entry_item():
    try:
        data = json_body()
        pid = clean_text(data.get('pid'), 'Produit', 64, True)
        slot = clean_text(data.get('slot', ''), 'Emplacement', 15)
        serial = clean_text(data.get('serial', ''), 'N° de série', 100)
        condition = clean_text(data.get('condition', 'Neuf'), 'État', 30, True)
        if slot and slot not in SLOTS:
            return bad('Emplacement inexistant.')
        location_mode = g.db.execute("SELECT value FROM meta WHERE key='location_mode'").fetchone()
        if not slot and location_mode and location_mode[0] == 'guided':
            return bad('Choisissez une étagère pour cette entrée.')
        if condition not in ('Neuf','Reconditionné','Occasion','Retour SAV'):
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
    row = g.db.execute("""SELECT items.id, items.slot, items.serial, products.brand, products.model, products.ref
                          FROM items JOIN products ON items.pid=products.id WHERE items.id=?""", (item_id,)).fetchone()
    if not row:
        abort(404)
    html = """<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Étiquette {{i.id}}</title><style>@page{size:70mm 50mm;margin:2mm}*{box-sizing:border-box}body{font:11px Arial,sans-serif;margin:0;padding:2mm;color:#111}.paper{width:66mm;min-height:45mm;padding:3mm 3mm 1mm;border:1px solid #eee}.name{font-size:13px;font-weight:800;margin:7px 0 3px}.top{font-size:10px;font-weight:900;letter-spacing:.8px}.slot{font-size:12px;font-weight:900;margin:6px 0}.line{color:#555;font-size:9px}.below{display:flex;gap:8px;align-items:center;justify-content:space-between;margin-top:4px}.qr{width:24mm;height:24mm;image-rendering:pixelated}.code{font:700 11px monospace}.buttons{padding:20px}.buttons button{background:#2768e8;color:#fff;border:0;border-radius:8px;padding:11px;cursor:pointer}@media print{.buttons{display:none}.paper{border:0}body{padding:0}}</style></head><body><div class="paper"><div class="top">▣ STOCKPILOT</div><div class="name">{{i.brand}} {{i.model}}</div><div class="line">{{i.ref}} · SN: {{i.serial or 'Non renseigné'}}</div><div class="slot">Zone {{i.slot[0] if i.slot else '—'}} · Niveau {{i.slot.split('-')[1] if i.slot else 'non renseigné'}}</div><div class="below"><img class="qr" src="/api/items/{{i.id}}/qr.png" onload="window.labelReady=true" alt="QR du produit"><div><div class="code">{{i.id}}</div><div class="line">Scanner à la sortie</div></div></div></div><div class="buttons"><button onclick="print()">Imprimer l'étiquette</button></div><script>window.addEventListener('load',()=>setTimeout(()=>{if(window.labelReady)window.print()},500));</script></body></html>"""
    return render_template_string(html, i=dict(row))

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
    import shutil
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
        zone = clean_text(data.get('zone'), 'Zone', 1, True).upper()
        preferred_slot = clean_text(data.get('preferred_slot', ''), 'Emplacement conseillé', 15)
        if preferred_slot and preferred_slot not in SLOTS:
            return bad('Emplacement conseillé inconnu.')
        if zone not in ZONE_CODES:
            return bad('Zone inconnue.')
        kind = {'PC portable':'laptop','PC fixe':'harddrive','Écran':'monitor'}.get(cat,'package')
        product_id = 'p_' + secrets.token_hex(6)
        g.db.execute('INSERT INTO products(id,brand,model,cat,zone,kind,ref,preferred_slot) VALUES(?,?,?,?,?,?,?,?)',
                     (product_id,brand,model,cat,zone,kind,ref,preferred_slot))
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
        if not fields:
            return bad('Aucun changement.')
        fields_sql = ','.join(f'{k}=?' for k in fields)
        g.db.execute(f'UPDATE products SET {fields_sql} WHERE id=?', [*fields.values(),product_id])
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


@app.post('/api/admin/reset')
@protected(admin=True)
def reset_demo():
    if not ALLOW_RESET:
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

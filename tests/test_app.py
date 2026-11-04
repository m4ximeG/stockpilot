import importlib
import os
import tempfile
import unittest
from pathlib import Path

# Ces tests s'exécutent en environnement CI après l'installation des dépendances.
_tmp = tempfile.TemporaryDirectory(prefix='stockpilot-ci-')
os.environ['STOCKPILOT_DATA_DIR'] = _tmp.name
os.environ['STOCKPILOT_ADMIN_PASSWORD'] = 'UnMotDePasseTestTresLong#42'
os.environ['STOCKPILOT_SECRET_KEY'] = 'cle-test-test-test-test-test-test-test-test'
os.environ['STOCKPILOT_DEV_FIXTURES'] = '1'
os.environ['STOCKPILOT_ALLOW_RESET'] = '1'
os.environ['STOCKPILOT_SECURE_COOKIES'] = '0'
import app as stock  # noqa: E402


class StockPilotTests(unittest.TestCase):
    def setUp(self):
        self.client = stock.app.test_client()
        result = self.client.post('/login', data={'username':'admin','password':'UnMotDePasseTestTresLong#42'})
        self.assertEqual(result.status_code, 302)
        self.headers = {'X-Requested-With': 'StockPilot'}
        self.assertEqual(self.client.post('/api/admin/reset', json={}, headers=self.headers).status_code, 200)

    def test_managed_daily_backups_retention_and_integrity(self):
        import backup_service
        from datetime import datetime, timedelta, timezone
        data_dir=Path(stock.DATA_DIR)
        self.assertFalse(self.client.get('/api/admin/backups').status_code != 200)
        # La première sauvegarde est un instantané SQLite binaire cohérent.
        now=datetime(2026, 11, 4, tzinfo=timezone.utc)
        daily=backup_service.ensure_daily_backup(stock.DB_FILE,data_dir,now=now)
        self.assertEqual(daily.name,'daily-2026-11-04.sqlite3')
        self.assertTrue(daily.is_file())
        with stock.connect() as live:
            before_count=live.execute('SELECT COUNT(*) FROM items WHERE out_at IS NULL').fetchone()[0]
        import sqlite3
        with sqlite3.connect(daily) as snapshot:
            backup_service.validate_database(snapshot)
            self.assertEqual(snapshot.execute('SELECT COUNT(*) FROM items WHERE out_at IS NULL').fetchone()[0],
                             before_count)
        product=self.client.post('/api/receive',json={'name':'Produit à ne pas sauvegarder'},
                                 headers=self.headers)
        self.assertEqual(product.status_code,201,product.text)
        again=backup_service.ensure_daily_backup(stock.DB_FILE,data_dir,now=now)
        self.assertEqual(again,daily)
        with sqlite3.connect(again) as saved:
            self.assertEqual(saved.execute('SELECT COUNT(*) FROM items WHERE out_at IS NULL').fetchone()[0],
                             before_count)
        for days in range(1,33):
            backup_service.ensure_daily_backup(stock.DB_FILE,data_dir,
                now=now+timedelta(days=days))
        auto=[item for item in backup_service.list_backups(data_dir)
              if item['kind']=='auto']
        self.assertEqual(len(auto),30)
        self.assertFalse((data_dir/'backups'/'managed'/'daily-2026-11-04.sqlite3').exists())
        self.assertFalse((data_dir/'backups'/'managed'/'daily-2026-11-05.sqlite3').exists())
        self.assertTrue((data_dir/'backups'/'managed'/'daily-2026-12-06.sqlite3').exists())

    def test_admin_manual_backup_and_restore_with_confirmation(self):
        import sqlite3
        from unittest.mock import patch
        import backup_service
        info=self.client.get('/api/admin/backups')
        self.assertEqual(info.status_code,200,info.text)
        self.assertIn('retentionDays',info.json)
        manual=self.client.post('/api/admin/backups',headers=self.headers,json={})
        self.assertEqual(manual.status_code,201,manual.text)
        name=manual.json['name']
        self.assertTrue(name.startswith('manual-'))
        download=self.client.get(f'/api/admin/backups/{name}/download')
        self.assertEqual(download.status_code,200)
        self.assertIn(b'SQLite format 3',download.data[:30])
        self.assertEqual(self.client.get('/api/admin/backups/../../etc/passwd/download').status_code,404)
        self.assertEqual(self.client.get('/api/admin/backups/fake.sqlite3/download').status_code,404)
        db_before=self.client.get('/api/state').json
        product=self.client.post('/api/receive',headers=self.headers,
            json={'name':'Produit ajouté après sauvegarde'})
        self.assertEqual(product.status_code,201,product.text)
        rev=self.client.get('/api/sync/revision').json['revision']
        self.assertGreater(len(self.client.get('/api/state').json['items']),len(db_before['items']))
        endpoint=f'/api/admin/backups/{name}/restore'
        self.assertEqual(self.client.post(endpoint,headers=self.headers,
            json={'confirmation':'non','password':'UnMotDePasseTestTresLong#42'}).status_code,400)
        self.assertEqual(self.client.post(endpoint,headers=self.headers,
            json={'confirmation':'RESTAURER LE STOCK','password':'erreur'}).status_code,403)
        self.assertEqual(self.client.post(endpoint,json={
            'confirmation':'RESTAURER LE STOCK',
            'password':'UnMotDePasseTestTresLong#42'}).status_code,403)
        restored=self.client.post(endpoint,headers=self.headers,json={
            'confirmation':'RESTAURER LE STOCK',
            'password':'UnMotDePasseTestTresLong#42'
        })
        self.assertEqual(restored.status_code,200,restored.text)
        self.assertEqual(len(self.client.get('/api/state').json['items']),len(db_before['items']))
        self.assertGreater(self.client.get('/api/sync/revision').json['revision'],rev)
        safeguard=restored.json['previousStateBackup']
        path=backup_service.resolve_backup(stock.DATA_DIR,safeguard)
        with sqlite3.connect(path) as previous:
            self.assertTrue(backup_service.validate_database(previous))
            self.assertEqual(previous.execute('SELECT COUNT(*) FROM items WHERE out_at IS NULL').fetchone()[0],
                             len(db_before['items'])+1)

    def test_backups_are_admin_only_and_inaccessible_to_employees(self):
        employee=self.client.post('/api/users',headers=self.headers,json={
            'username':'backup_employee','password':'BackupTestPassword#4242','role':'employee'
        })
        self.assertEqual(employee.status_code,201,employee.text)
        other=stock.app.test_client()
        self.assertEqual(other.post('/login',data={
            'username':'backup_employee','password':'BackupTestPassword#4242'
        }).status_code,302)
        for path in ['/api/admin/backups','/api/admin/backups/test/download']:
            self.assertEqual(other.get(path).status_code,403,path)
        self.assertEqual(other.post('/api/admin/backups',
                                   headers=self.headers,json={}).status_code,403)
        self.assertEqual(other.post('/api/admin/backups/test/restore',
                                   headers=self.headers,json={}).status_code,403)

    def test_realtime_sync_revision_is_transactional_and_shared(self):
        # Les anciens terminaux voient les écritures d'un autre client sans redémarrage.
        first = self.client.get('/api/sync/revision')
        self.assertEqual(first.status_code, 200, first.text)
        self.assertEqual(first.headers.get('Cache-Control'), 'private, no-store')
        rev1 = first.json['revision']
        self.assertEqual(self.client.get('/api/state').json['revision'], rev1)

        second = stock.app.test_client()
        login = second.post('/login', data={
            'username': 'admin', 'password': 'UnMotDePasseTestTresLong#42'
        })
        self.assertEqual(login.status_code, 302)
        created = second.post('/api/products', headers=self.headers, json={
            'brand': 'TERRA', 'model': 'Temps réel', 'ref': 'SYNC-TEST-001',
            'cat': 'PC portable', 'min_stock': 0
        })
        self.assertEqual(created.status_code, 201, created.text)
        rev2 = self.client.get('/api/sync/revision').json['revision']
        self.assertGreater(rev2, rev1)
        snapshot = self.client.get('/api/state')
        self.assertEqual(snapshot.json['revision'], rev2)
        self.assertTrue(any(p['ref'] == 'SYNC-TEST-001' for p in snapshot.json['catalog']))

        product_id = created.json['id']
        receive = second.post('/api/items', headers=self.headers, json={
            'pid': product_id, 'condition': 'Neuf'
        })
        self.assertEqual(receive.status_code, 201, receive.text)
        rev3 = self.client.get('/api/sync/revision').json['revision']
        self.assertGreater(rev3, rev2)
        self.assertTrue(any(item['id'] == receive.json['item']['id']
                            for item in self.client.get('/api/state').json['items']))
        removed = second.post(f"/api/items/{receive.json['item']['id']}/out",
                              headers=self.headers, json={})
        self.assertEqual(removed.status_code, 200, removed.text)
        rev4 = self.client.get('/api/sync/revision').json['revision']
        self.assertGreater(rev4, rev3)
        self.assertFalse(any(item['id'] == receive.json['item']['id']
                             for item in self.client.get('/api/state').json['items']))
        anonymous = stock.app.test_client()
        self.assertIn(anonymous.get('/api/sync/revision').status_code, (401, 403, 302))

    def test_failed_sqlite_transaction_does_not_emit_false_revision(self):
        before = self.client.get('/api/sync/revision').json['revision']
        with stock.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            db.execute('INSERT INTO events(type,item_id,pid,slot,at,actor) '
                       "VALUES('in','STK-TEMP','temporary','',123,'test')")
            db.execute('ROLLBACK')
        after = self.client.get('/api/sync/revision').json['revision']
        self.assertEqual(before, after)

    def test_push_api_permissions_validations_and_private_subscriptions(self):
        import base64
        import push_service
        key = self.client.get('/api/push/public-key')
        self.assertEqual(key.status_code, 200, key.text)
        self.assertTrue(len(key.json['publicKey']) >= 80)
        def enc(size):
            return base64.urlsafe_b64encode(bytes([7] * size)).decode().rstrip('=')
        payload = {
            'endpoint': 'https://web.push.apple.com/v1/demo123',
            'keys': {'p256dh': enc(65), 'auth': enc(16)}
        }
        self.assertEqual(self.client.post('/api/push/subscriptions', json=payload, headers=self.headers).status_code, 200)
        with stock.connect() as db:
            row = db.execute('SELECT user_id FROM push_subscriptions WHERE endpoint=?', (payload['endpoint'],)).fetchone()
            self.assertIsNotNone(row)
            self.assertEqual(row[0], 1)
        invalid = {**payload, 'endpoint': 'https://127.0.0.1/admin'}
        self.assertEqual(self.client.post('/api/push/subscriptions', json=invalid, headers=self.headers).status_code, 400)
        invalid = {**payload, 'endpoint': 'http://web.push.apple.com/v1/demo123'}
        self.assertEqual(self.client.post('/api/push/subscriptions', json=invalid, headers=self.headers).status_code, 400)
        self.assertEqual(self.client.post('/api/push/subscriptions', json=payload).status_code, 403)
        from unittest.mock import patch
        with patch.object(push_service, 'send_to_user_devices', return_value=1) as send:
            response = self.client.post('/api/push/test', json={}, headers=self.headers)
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json['devices'], 1)
            self.assertEqual(send.call_args.args[-1], 1)
        self.assertEqual(self.client.delete('/api/push/subscriptions',
                                            json={'endpoint': payload['endpoint']},
                                            headers=self.headers).status_code, 200)
        with stock.connect() as db:
            self.assertIsNone(db.execute('SELECT 1 FROM push_subscriptions WHERE endpoint=?',
                                         (payload['endpoint'],)).fetchone())

    def test_low_stock_push_fires_only_on_threshold_crossing(self):
        from unittest.mock import patch
        import push_service
        product = self.client.post('/api/products', json={
            'brand': 'TERRA', 'model': 'Test Push', 'cat': 'PC portable',
            'ref': 'TEST-PUSH', 'min_stock': 2
        }, headers=self.headers)
        self.assertEqual(product.status_code, 201)
        pid = product.json['id']
        ids=[]
        for _ in range(4):
            response=self.client.post('/api/items', json={'pid': pid, 'condition': 'Neuf'},
                                      headers=self.headers)
            self.assertEqual(response.status_code, 201)
            ids.append(response.json['item']['id'])
        with patch.object(push_service,'send_stock_warning',return_value=1) as send:
            self.assertEqual(self.client.post(f'/api/items/{ids[0]}/out',
                                              json={},headers=self.headers).status_code,200)
            self.assertEqual(send.call_count,0)
            self.assertEqual(self.client.post(f'/api/items/{ids[1]}/out',
                                              json={},headers=self.headers).status_code,200)
            self.assertEqual(send.call_count,1)
            self.assertEqual(send.call_args.args[-2:], (2, 2))
            self.assertEqual(self.client.post(f'/api/items/{ids[2]}/out',
                                              json={},headers=self.headers).status_code,200)
            self.assertEqual(send.call_count,1)
        # Une configuration facultative non activée ne déclenche rien.
        self.assertEqual(self.client.patch(f'/api/products/{pid}',json={'min_stock':0},
                                           headers=self.headers).status_code,200)

    def test_mobile_app_resources_are_public_and_do_not_cache_stock(self):
        import json
        manifest = self.client.get('/static/app.webmanifest')
        self.assertEqual(manifest.status_code, 200)
        data = json.loads(manifest.data)
        self.assertEqual(data['display'], 'standalone')
        self.assertEqual(data['start_url'], '/')
        self.assertEqual([i['sizes'] for i in data['icons']], ['192x192', '512x512'])

        worker = self.client.get('/sw.js')
        self.assertEqual(worker.status_code, 200)
        self.assertIn(b'javascript', worker.content_type.encode())
        self.assertEqual(worker.headers.get('Service-Worker-Allowed'), '/')
        self.assertIn(b"event.request.mode==='navigate'", worker.data)
        self.assertNotIn(b"caches.open('/api", worker.data)

        for route in ['/apple-touch-icon.png', '/app-icon-192.png', '/app-icon-512.png']:
            icon = self.client.get(route)
            self.assertEqual(icon.status_code, 200, route)
            self.assertEqual(icon.data[:8], bytes.fromhex('89504e470d0a1a0a'), route)
            self.assertTrue(icon.content_type.startswith('image/png'), route)
        self.assertEqual(self.client.get('/app-icon-999.png').status_code, 404)

        home = self.client.get('/')
        self.assertEqual(home.status_code, 200)
        self.assertIn(b'app.webmanifest', home.data)
        self.assertIn(b'mobile-app.css', home.data)

    def test_initial_stock_and_occupancy(self):
        state = self.client.get('/api/state').json
        self.assertEqual(len(state['catalog']), 13)
        self.assertEqual(len(state['items']), 27)
        self.assertEqual(state['me']['role'], 'admin')
        self.assertLessEqual(len({x['slot'] for x in state['items']}), 30)
        self.assertEqual(state['locationMode'], 'optional')

    def test_complete_movement_and_uniqueness(self):
        data={'pid':'hp450','slot':'A-3','serial':'UNIQUE-SERIAL-111','condition':'Neuf'}
        created=self.client.post('/api/items',json=data,headers=self.headers)
        self.assertEqual(created.status_code, 201, created.text)
        item_id=created.json['item']['id']
        collision=self.client.post('/api/items',json={**data,'slot':'A-3'},headers=self.headers)
        self.assertEqual(collision.status_code, 409)  # même numéro de série, pas même étagère
        moved=self.client.post(f'/api/items/{item_id}/move',json={'slot':'A-4'},headers=self.headers)
        self.assertEqual(moved.status_code, 200, moved.text)
        qr=self.client.get(f'/api/items/{item_id}/qr.png')
        self.assertEqual(qr.status_code, 200)
        self.assertTrue(qr.data.startswith(b'\x89PNG'))
        label=self.client.get(f'/label/{item_id}')
        self.assertEqual(label.status_code, 200)
        self.assertEqual(label.content_type, 'application/pdf')
        self.assertTrue(label.data.startswith(b'%PDF-'))
        out=self.client.post(f'/api/items/{item_id}/out',json={},headers=self.headers)
        self.assertEqual(out.status_code, 200)
        self.assertEqual(self.client.post(f'/api/items/{item_id}/out',json={},headers=self.headers).status_code,409)
        types=[e['type'] for e in self.client.get('/api/state').json['events'] if e['itemId']==item_id]
        self.assertEqual(set(types), {'in','out','move'})

    def test_simple_barcode_stock_without_location(self):
        product=self.client.post('/api/products',json={
            'brand':'TERRA','model':'Mobile 1517','cat':'PC portable','ref':'TERRA-BARCODE'
        },headers=self.headers)
        self.assertEqual(product.status_code,201,product.text)
        pid=product.json['id']
        self.assertEqual(next(p for p in self.client.get('/api/state').json['catalog'] if p['id']==pid)['preferred_slot'],'')
        # L'ancien paramètre guidé ne bloque plus les réceptions.
        self.assertEqual(self.client.post('/api/settings/location-mode',json={'mode':'guided'},headers=self.headers).status_code,200)
        first=self.client.post('/api/receive',json={'name':'TERRA Mobile 1517','product_id':pid,
            'slot':'H-3','condition':'Neuf','serial':''},headers=self.headers)
        self.assertEqual(first.status_code,201,first.text)
        self.assertEqual(first.json['item']['slot'],'')
        second=self.client.post('/api/receive',json={'name':'TERRA Mobile 1517','product_id':pid,
            'condition':'Retour SAV','serial':''},headers=self.headers)
        self.assertEqual(second.status_code,201,second.text)
        self.assertNotEqual(first.json['item']['id'],second.json['item']['id'])
        self.assertEqual(self.client.get('/api/state').json['locationMode'],'optional')
        barcode=self.client.get(f"/api/items/{first.json['item']['id']}/barcode.svg")
        self.assertEqual(barcode.status_code,200)
        self.assertIn('image/svg+xml',barcode.content_type)
        self.assertIn(b'<svg',barcode.data)
        label=self.client.get(f"/label/{first.json['item']['id']}")
        self.assertEqual(label.status_code,200)
        self.assertTrue(label.data.startswith(b'%PDF-'))
        self.assertEqual(label.content_type, 'application/pdf')
        import re
        page_size = re.search(rb'/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]', label.data)
        self.assertIsNotNone(page_size)
        self.assertAlmostEqual(float(page_size.group(1)), 54 * 72 / 25.4, delta=.2)
        self.assertAlmostEqual(float(page_size.group(2)), 25 * 72 / 25.4, delta=.2)
        bigger=self.client.get(f"/label/{first.json['item']['id']}?size=57x32")
        self.assertTrue(bigger.data.startswith(b'%PDF-'))
        bigger_size=re.search(rb'/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]', bigger.data)
        self.assertIsNotNone(bigger_size)
        self.assertAlmostEqual(float(bigger_size.group(1)), 57 * 72 / 25.4, delta=.2)
        self.assertEqual(self.client.get(f"/label/{first.json['item']['id']}?size=A4").status_code,400)
        self.assertEqual(self.client.post(f"/api/items/{first.json['item']['id']}/out",json={},headers=self.headers).status_code,200)

    def test_stock_threshold_persists_for_each_reference(self):
        created=self.client.post('/api/products',json={
            'brand':'TERRA','model':'Test seuil stock','cat':'PC portable','ref':'TEST-STOCK-THRESHOLD','min_stock':4
        },headers=self.headers)
        self.assertEqual(created.status_code,201,created.text)
        pid=created.json['id']
        def stock():
            return next(x for x in self.client.get('/api/state').json['catalog'] if x['id']==pid)
        self.assertEqual(stock()['min_stock'],4)
        self.assertEqual(self.client.patch(f'/api/products/{pid}',json={'min_stock':2},headers=self.headers).status_code,200)
        self.assertEqual(stock()['min_stock'],2)
        self.assertEqual(self.client.patch(f'/api/products/{pid}',json={'model':'Test modifié'},headers=self.headers).status_code,200)
        self.assertEqual(stock()['min_stock'],2)
        for invalid in (-1,1.5,True,100000,'invalide',None):
            response=self.client.patch(f'/api/products/{pid}',json={'min_stock':invalid},headers=self.headers)
            self.assertEqual(response.status_code,400,str(invalid))
        self.assertEqual(stock()['min_stock'],2)
        self.assertEqual(self.client.patch(f'/api/products/{pid}',json={'min_stock':0},headers=self.headers).status_code,200)
        self.assertEqual(stock()['min_stock'],0)

    def test_catalog_sans_emplacements(self):
        product=self.client.post('/api/products',json={
            'brand':'TERRA','model':'Mobile 1517','cat':'PC portable','ref':'TE-MOB-1517'
        },headers=self.headers)
        self.assertEqual(product.status_code,201,product.text)
        pid=product.json['id']
        info=next(p for p in self.client.get('/api/state').json['catalog'] if p['id']==pid)
        self.assertEqual(info['preferred_slot'],'')
        self.assertEqual(info['zone'],'A')
        created=self.client.post('/api/items',json={'pid':pid,'slot':'B-5','serial':'FIVE-LEVEL-TEST','condition':'Neuf'},headers=self.headers)
        self.assertEqual(created.status_code,201,created.text)
        self.assertEqual(created.json['item']['slot'],'')
        update=self.client.patch('/api/products/'+pid,json={'model':'Mobile 1517 Mk2'},headers=self.headers)
        self.assertEqual(update.status_code,200,update.text)

    def test_admin_can_create_product_and_user(self):
        product=self.client.post('/api/products',json={'brand':'TERRA','model':'Mobile 1517','cat':'PC portable','zone':'A','ref':'TE-1517-NEW'},headers=self.headers)
        self.assertEqual(product.status_code,201,product.text)
        userid=self.client.post('/api/users',json={'username':'reception','password':'NouveauMotDePasseFort#1','role':'employee'},headers=self.headers)
        self.assertEqual(userid.status_code,201,userid.text)
        self.client.get('/logout')
        self.client.post('/login', data={'username':'reception','password':'NouveauMotDePasseFort#1'})
        forbidden=self.client.post('/api/products',json={'brand':'X','model':'Y','cat':'Autre','zone':'F','ref':'NEVER'},headers=self.headers)
        self.assertEqual(forbidden.status_code,403)
        self.assertEqual(self.client.patch('/api/products/'+product.json['id'],json={'min_stock':10},headers=self.headers).status_code,403)
        self.assertEqual(self.client.post('/api/settings/location-mode',json={'mode':'guided'},headers=self.headers).status_code,403)

    def test_real_reserve_shelves_and_explicit_cleanup(self):
        state=self.client.get('/api/state').json
        self.assertEqual(len(state['shelves']),50)
        self.assertEqual(len(set(x['slot'][0] for x in state['shelves'])),10)
        self.assertEqual(self.client.patch('/api/shelves/J-5',json={'size':'large','note':'Cartons très hauts'},headers=self.headers).status_code,200)
        self.assertEqual(self.client.patch('/api/shelves/J-9',json={'size':'small','note':''},headers=self.headers).status_code,404)
        self.assertEqual(self.client.patch('/api/shelves/J-5',json={'size':'huge','note':''},headers=self.headers).status_code,400)
        self.assertEqual(self.client.post('/api/admin/clear-stock',json={'confirmation':'oui'},headers=self.headers).status_code,400)
        self.assertEqual(len(self.client.get('/api/state').json['items']),27)
        done=self.client.post('/api/admin/clear-stock',json={'confirmation':'VIDER LE STOCK'},headers=self.headers)
        self.assertEqual(done.status_code,200,done.text)
        state=self.client.get('/api/state').json
        self.assertEqual(state['items'],[])
        self.assertEqual(state['events'],[])
        self.assertEqual(state['catalog'],[])
        level=next(x for x in state['shelves'] if x['slot']=='J-5')
        self.assertEqual(level['size'],'large')
        self.assertEqual(level['note'],'Cartons très hauts')
        self.assertEqual(state['me']['role'],'admin')
        self.assertEqual(len(list((Path(stock.DATA_DIR) / 'backups').glob('stockpilot-avant-vidage-*.sqlite3'))),1)
        add=self.client.post('/api/products',json={'brand':'TERRA','model':'1517','cat':'PC portable','zone':'J','preferred_slot':'J-5','ref':'TERRA-NEW'},headers=self.headers)
        self.assertEqual(add.status_code,201,add.text)
        item=self.client.post('/api/items',json={'pid':add.json['id'],'slot':'J-5','serial':'REAL-DEMO-1','condition':'Neuf'},headers=self.headers)
        self.assertEqual(item.status_code,201,item.text)
        self.assertEqual(len(self.client.get('/api/state').json['items']),1)

    def test_reception_libre_creation_reutilisation_et_etats(self):
        initial=self.client.get('/api/state').json
        count=len(initial['catalog'])
        data={'name':'TERRA Mobile 1610','serial':'','slot':'H-3','condition':'Réparation'}
        first=self.client.post('/api/receive',json=data,headers=self.headers)
        self.assertEqual(first.status_code,201,first.text)
        self.assertTrue(first.json['createdProduct'])
        self.assertEqual(first.json['item']['condition'],'Réparation')
        self.assertEqual(first.json['item']['slot'],'')
        other=self.client.post('/api/receive',json={**data,'condition':'Retour SAV'},headers=self.headers)
        self.assertEqual(other.status_code,201,other.text)
        self.assertFalse(other.json['createdProduct'])
        state=self.client.get('/api/state').json
        self.assertEqual(len(state['catalog']),count+1)
        self.assertEqual(state['items'][-1]['condition'],'Retour SAV')
        self.assertEqual(self.client.post('/api/receive',json={**data,'serial':'A-UNIQUE'},headers=self.headers).status_code,201)
        self.assertEqual(self.client.post('/api/receive',json={**data,'serial':'A-UNIQUE'},headers=self.headers).status_code,409)
        self.assertEqual(self.client.post('/api/receive',json={**data,'condition':'Occasion'},headers=self.headers).status_code,400)

    def test_purge_cible_donnees_demonstration(self):
        # Le nettoyage doit conserver une vraie entrée ajoutée dans le stock.
        inserted=self.client.post('/api/receive',json={'name':'Station AMS vraie','slot':'I-2','serial':'REEL-008','condition':'Neuf'},headers=self.headers)
        self.assertEqual(inserted.status_code,201,inserted.text)
        real_id=inserted.json['item']['id']
        with stock.connect() as con:
            stock.purge_original_demo_stock(con)
        state=self.client.get('/api/state').json
        self.assertIn(real_id,[i['id'] for i in state['items']])
        self.assertNotIn('STK-000236',[i['id'] for i in state['items']])
        self.assertTrue(all(i['serial']!='SN41732' for i in state['items']))
        # Les modèles fictifs inutilisés sont également retirés.
        self.assertFalse(any(p['id']=='hp450' for p in state['catalog']))
        self.assertTrue(list((Path(stock.DATA_DIR) / 'backups').glob('avant-retrait-demo-*.sqlite3')))

    def test_accueil_sans_plan_de_reserve(self):
        index=self.client.get('/')
        self.assertEqual(index.status_code,200)
        self.assertIn(b'barcode-only.js',index.data)
        self.assertNotIn(b'Plan du d\xc3\xa9p\xc3\xb4t',index.data)
        self.assertNotIn(b'reference.css',index.data)

    def test_security_and_backup(self):
        self.assertEqual(self.client.post('/api/items',json={},headers={}).status_code,403)
        b=self.client.get('/api/backup')
        self.assertEqual(b.status_code,200)
        self.assertIn(b'CREATE TABLE',b.data)
        self.assertEqual(self.client.get('/healthz').status_code,200)

    def test_reset_demo(self):
        result=self.client.post('/api/admin/reset',json={},headers=self.headers)
        self.assertEqual(result.status_code,200)
        self.assertEqual(len(self.client.get('/api/state').json['items']),27)


if __name__=='__main__':
    unittest.main()

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
        self.assertIn(item_id.encode(), label.data)
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
        self.assertIn(b'/barcode.svg',label.data)
        self.assertNotIn(b'tag',label.data.lower())  # pas de rayon ou étagère
        self.assertEqual(self.client.post(f"/api/items/{first.json['item']['id']}/out",json={},headers=self.headers).status_code,200)

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

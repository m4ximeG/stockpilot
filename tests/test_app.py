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

    def test_shared_shelf_and_optional_location(self):
        headers=self.headers
        first=self.client.post('/api/items', json={'pid':'hp450','slot':'B-4','serial':'SHARED-1','condition':'Neuf'},headers=headers)
        second=self.client.post('/api/items', json={'pid':'hp450','slot':'B-4','serial':'SHARED-2','condition':'Neuf'},headers=headers)
        self.assertEqual(first.status_code, 201, first.text)
        self.assertEqual(second.status_code, 201, second.text)
        loose=self.client.post('/api/items', json={'pid':'hp450','slot':'','serial':'UNPLACED-1','condition':'Neuf'},headers=headers)
        self.assertEqual(loose.status_code, 201, loose.text)
        label=self.client.get(f"/label/{loose.json['item']['id']}")
        self.assertEqual(label.status_code, 200, label.text)
        self.assertIn(b'non renseign', label.data)
        self.assertEqual(self.client.post(f"/api/items/{loose.json['item']['id']}/move",json={'slot':'B-4'},headers=headers).status_code,200)
        self.assertEqual(self.client.post('/api/settings/location-mode',json={'mode':'guided'},headers=headers).status_code,200)
        self.assertEqual(self.client.post('/api/items',json={'pid':'hp450','slot':'','serial':'UNPLACED-2','condition':'Neuf'},headers=headers).status_code,400)
        self.assertEqual(self.client.get('/api/state').json['locationMode'],'guided')
        self.assertEqual(self.client.post('/api/settings/location-mode',json={'mode':'optional'},headers=headers).status_code,200)

    def test_five_levels_and_preferred_location_rules(self):
        product=self.client.post('/api/products',json={
            'brand':'TERRA','model':'Mobile 1517','cat':'PC portable','zone':'B',
            'preferred_slot':'B-5','ref':'TE-MOB-1517'
        },headers=self.headers)
        self.assertEqual(product.status_code,201,product.text)
        pid=product.json['id']
        info=next(p for p in self.client.get('/api/state').json['catalog'] if p['id']==pid)
        self.assertEqual(info['preferred_slot'],'B-5')
        created=self.client.post('/api/items',json={'pid':pid,'slot':'B-5','serial':'FIVE-LEVEL-TEST','condition':'Neuf'},headers=self.headers)
        self.assertEqual(created.status_code,201,created.text)
        # Changer la règle ne déplace jamais les produits déjà en rayon.
        edit=self.client.patch('/api/products/'+pid,json={'preferred_slot':'C-2'},headers=self.headers)
        self.assertEqual(edit.status_code,200,edit.text)
        item=next(i for i in self.client.get('/api/state').json['items'] if i['pid']==pid)
        self.assertEqual(item['slot'],'B-5')
        self.assertEqual(self.client.patch('/api/products/'+pid,json={'preferred_slot':'F-9'},headers=self.headers).status_code,400)
        self.assertEqual(self.client.patch('/api/products/'+pid,json={'preferred_slot':''},headers=self.headers).status_code,200)

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

    def test_photo_de_reserve_stockee_sur_nas(self):
        from PIL import Image
        from io import BytesIO
        stock.WAREHOUSE_PHOTO.unlink(missing_ok=True)
        self.assertEqual(self.client.get('/api/warehouse-photo').status_code,404)
        photo=BytesIO()
        Image.new('RGB',(320,240),(180,166,145)).save(photo,'PNG')
        photo.seek(0)
        result=self.client.post('/api/warehouse-photo',
            data={'photo':(photo,'reserve.png')},
            content_type='multipart/form-data',headers=self.headers)
        self.assertEqual(result.status_code,200,result.text)
        self.assertTrue(self.client.get('/api/state').json['warehousePhoto'])
        loaded=self.client.get('/api/warehouse-photo')
        self.assertEqual(loaded.status_code,200)
        self.assertIn('image/webp',loaded.content_type)
        self.assertEqual(loaded.data[:4],b'RIFF')
        self.assertEqual(self.client.delete('/api/warehouse-photo',headers=self.headers).status_code,200)
        self.assertFalse(self.client.get('/api/state').json['warehousePhoto'])
        self.assertEqual(self.client.get('/api/warehouse-photo').status_code,404)

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

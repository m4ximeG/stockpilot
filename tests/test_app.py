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
os.environ['STOCKPILOT_DEMO_SEED'] = '1'
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
        self.assertEqual(len({x['slot'] for x in state['items']}), 27)

    def test_complete_movement_and_uniqueness(self):
        data={'pid':'hp450','slot':'A-2-3','serial':'UNIQUE-SERIAL-111','condition':'Neuf'}
        created=self.client.post('/api/items',json=data,headers=self.headers)
        self.assertEqual(created.status_code, 201, created.text)
        item_id=created.json['item']['id']
        collision=self.client.post('/api/items',json={**data,'slot':'A-2-2'},headers=self.headers)
        self.assertEqual(collision.status_code, 409)
        moved=self.client.post(f'/api/items/{item_id}/move',json={'slot':'A-2-4'},headers=self.headers)
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

    def test_admin_can_create_product_and_user(self):
        product=self.client.post('/api/products',json={'brand':'TERRA','model':'Mobile 1517','cat':'PC portable','zone':'A','ref':'TE-1517-NEW'},headers=self.headers)
        self.assertEqual(product.status_code,201,product.text)
        userid=self.client.post('/api/users',json={'username':'reception','password':'NouveauMotDePasseFort#1','role':'employee'},headers=self.headers)
        self.assertEqual(userid.status_code,201,userid.text)
        self.client.get('/logout')
        self.client.post('/login', data={'username':'reception','password':'NouveauMotDePasseFort#1'})
        forbidden=self.client.post('/api/products',json={'brand':'X','model':'Y','cat':'Autre','zone':'F','ref':'NEVER'},headers=self.headers)
        self.assertEqual(forbidden.status_code,403)

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

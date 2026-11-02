const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

function expose(file, exportName) {
  const context={window:{}};
  vm.runInNewContext(fs.readFileSync(file,'utf8'),context,{filename:file});
  assert.ok(context.window[exportName],exportName+' must be exported');
  return context.window[exportName];
}
const basic=expose('static/barcode-only.js','SPBasic');
const receive=expose('static/reception.js','SPV3');
const product={id:'terra1',brand:'TERRA',model:'Mobile 1517',ref:'T-1517',cat:'PC portable',active:1};
const item={id:'STK-000010',pid:'terra1',serial:'',condition:'Neuf',slot:'',inAt:Date.now()};
const db={items:[item],catalog:[product],events:[{itemId:item.id,pid:product.id,type:'in',actor:'Admin',at:Date.now()}],shelves:[]};
const context={db,me:{username:'Admin',role:'admin'},product:id=>db.catalog.find(p=>p.id===id),
  heading:(k,t)=>'<h1>'+t+'</h1>',btn:()=>'<button>Créer</button>',ico:()=>'<svg></svg>',
  tableFilter:'',tableType:'all',itemById:id=>db.items.find(i=>i.id===id),modal:{id:item.id},scanResult:item};

test('entrée en stock sans emplacement obligatoire',()=>{
 const html=receive.entry(context);
 assert.match(html,/id="rx-name"/);
 assert.match(html,/id="rx-serial"/);
 assert.match(html,/Retour SAV/);
 assert.doesNotMatch(html,/data-slot|rayonnage|Plan du dépôt/);
});
test('tableau de bord affiche les stocks sans plan',()=>{
 const html=basic.dashboard(context);
 assert.match(html,/Articles en stock/);
 assert.match(html,/Sorties aujourd’hui/);
 assert.doesNotMatch(html,/shelf|warehouse|emplacement|3D/);
});
test('inventaire, scanner, historique et configuration sans rangement',()=>{
 for(const fn of ['inventory','history','settings','exit','detailModal']){
   const html=basic[fn](context);
   assert.ok(html.length>100,fn);
   assert.doesNotMatch(html,/rayonnage|Plan du dépôt|Emplacement conseillé|Déplacer/);
 }
});
test('index charge les nouveaux modules uniquement',()=>{
 const index=fs.readFileSync('static/index.html','utf8');
 assert.match(index,/barcode-only\.js/);
 assert.match(index,/barcode-only\.css/);
 assert.doesNotMatch(index,/warehouse-scene\.js|reference\.css|Plan du dépôt/);
});

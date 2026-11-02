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
 assert.match(html,/Stock central/);
 assert.match(html,/Gestion du stock/);
 assert.match(html,/Sorties du jour/);
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


test('démarrage réel du script principal avec réponse /api/state',async()=>{
 const html=fs.readFileSync('static/index.html','utf8');
 const scripts=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(x=>x[1]).filter(Boolean);
 assert.equal(scripts.length,1);
 const appElement={innerHTML:'',className:''};
 const elements={'#app':appElement,'#toasts':{appendChild:()=>{}}};
 const fakeDocument={
  body:{classList:{toggle:()=>{}}},
  querySelector:(s)=>elements[s]||null,
  createElement:()=>({innerHTML:'',className:'',remove:()=>{}})
 };
 const simulatedWindow={addEventListener:()=>{},scrollTo:()=>{},open:()=>({}),location:{href:'/'}};
 const fakeState={items:[],events:[],catalog:[],shelves:[],counter:1,me:{username:'Admin',role:'admin'},locationMode:'optional',allowReset:false};
 const fakeFetch=async(url)=>{assert.equal(url,'/api/state');return {ok:true,status:200,headers:{get:()=> 'application/json'},json:async()=>fakeState};};
 const context={window:simulatedWindow,document:fakeDocument,
  fetch:fakeFetch,history:{scrollRestoration:'auto'},
  requestAnimationFrame:cb=>cb(),setInterval:()=>0,setTimeout:()=>0,
  navigator:{},URL,console};
 // Charger les scripts externes, comme le navigateur avant le script principal.
 for(const path of ['static/barcode-only.js','static/reception.js']){
   vm.runInNewContext(fs.readFileSync(path,'utf8'),context,{filename:path});
 }
 context.SPBasic=simulatedWindow.SPBasic;
 context.SPV3=simulatedWindow.SPV3;
 vm.runInNewContext(scripts[0],context,{filename:'static/index.html'});
 await new Promise(resolve=>setTimeout(resolve,25));
 assert.match(appElement.innerHTML,/Tableau de bord/);
 assert.match(appElement.innerHTML,/Stock central/);
 assert.doesNotMatch(appElement.innerHTML,/Connexion au serveur impossible|Can't find variable/);
});


test('Aurora est chargé et reproduit la structure sans supprimer les fonctions',()=>{
 const html=fs.readFileSync('static/index.html','utf8');
 const css=fs.readFileSync('static/aurora.css','utf8');
 assert.match(html,/aurora\.css\?v=aurora-20261102-2/);
 assert.match(html,/barcode-only\.js\?v=polish-20261102-2/);
 assert.match(css,/\.aurora-dashboard/);
 assert.match(css,/\.aur-rail-main/);
 assert.match(css,/\.aur-metrics/);
 assert.match(css,/\.aur-wave-main/);
 assert.match(css,/@keyframes aurDraw/);
 assert.match(css,/@media\(max-width:860px\)/);
 assert.match(css,/@media\(prefers-reduced-motion:reduce\)/);
 const markup=basic.dashboard(context);
 assert.match(markup,/Gestion du stock/);
 assert.match(markup,/centralisé/);
 assert.match(markup,/Réceptions du jour/);
 assert.match(markup,/Sorties du jour/);
 assert.match(markup,/Stock central/);
 assert.match(markup,/aur-wave/);
 assert.match(markup,/data-nav="entry"/);
 assert.match(markup,/data-nav="exit"/);
 assert.match(markup,/data-nav="products"/);
 assert.doesNotMatch(markup,/facet-shard|facet-hero|rayonnage/);
});

test('Aurora utilise un vrai fond local et ne mélange jamais ancienne page et styles',()=>{
 const css=fs.readFileSync('static/aurora.css','utf8');
 const img=fs.readFileSync('static/aurora-storm.jpg');
 assert.ok(img.length>50000,'Le fond JPG doit être inclus au build');
 assert.match(css,/url\("\/static\/aurora-storm\.jpg"\)/);
 assert.doesNotMatch(css,/images\.pexels\.com/);
 assert.match(css,/body\.aurora-on \.pagehead/);
 const html=basic.dashboard(context);
 assert.match(html,/class="aurora-dashboard"/);
 assert.doesNotMatch(html,/Votre stock en un coup d’œil/);
});


test('Finitions : aucune topbar secondaire, icônes vectorielles et nouvelles CSS',()=>{
 const html=fs.readFileSync('static/index.html','utf8');
 const css=fs.readFileSync('static/polish.css','utf8');
 assert.doesNotMatch(html,/<header class="topbar">/);
 assert.match(html,/\/static\/polish\.css\?v=2/);
 assert.match(html,/body\.classList\.toggle\('aurora-on'/);
 assert.match(html,/settings:'<path d="M4 7h9/);
 assert.match(css,/\.settings-board/);
 assert.match(css,/\.settings-column/);
 assert.match(css,/\.settingscard \.field label/);
 assert.match(css,/\.basic-manual-list button/);
 assert.match(css,/\.slim-table td/);
 assert.match(css,/@media\(max-width:520px\)/);
});
test('Paramètres et scanner : aucune structure blanche ni carte accolée',()=>{
 const cfg=basic.settings(context);
 assert.equal((cfg.match(/class="settings-column"/g)||[]).length,2);
 assert.equal((cfg.match(/class="settings-board"/g)||[]).length,1);
 assert.doesNotMatch(cfg,/class="flowgrid"/);
 const scan=basic.exit(context);
 assert.match(scan,/class="basic-manual-list"/);
 assert.match(scan,/data-action="selectscan"/);
 const preview=receive.entry(context);
 assert.match(preview,/class="basic-example-bars"/);
 assert.match(preview,/basic-help-symbol/);
});

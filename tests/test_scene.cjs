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
  addEventListener:()=>{},
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
 assert.match(html,/barcode-only\.js\?v=henrri-20261110-1/);
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


test('Fond identique pour l’accueil et les pages secondaires',()=>{
 const harmony=fs.readFileSync('static/harmony.css','utf8');
 const html=fs.readFileSync('static/index.html','utf8');
 assert.match(html,/\/static\/harmony\.css\?v=6/);
 assert.match(harmony,/var\(--sp-storm-image\) center 45% \/ cover fixed no-repeat/);
 assert.match(harmony,/\.aurora-dashboard\s*\{\s*background:transparent!important;/);
 assert.match(harmony,/--sp-storm-image:url\("\/static\/aurora-storm\.jpg"\)/);
 assert.doesNotMatch(harmony,/images\.pexels\.com/);
});
test('Logo vectoriel et code-barres cohérents, netteté à toutes les tailles',()=>{
 const svg=fs.readFileSync('static/stockpilot-mark.svg','utf8');
 const html=fs.readFileSync('static/index.html','utf8');
 assert.match(svg,/<svg[^>]+viewBox="0 0 64 64"/);
 assert.match(svg,/<title id="title">StockPilot<\/title>/);
 assert.match(html,/class="sp-logo" src="\/static\/stockpilot-mark\.svg\?v=1"/);
 assert.match(html,/rel="icon" type="image\/svg\+xml"/);
 assert.match(html,/barcode:'<path d="M4 9V6/);
});
test('Retour à l’accueil : animations Aurora originales intactes',()=>{
 const html=fs.readFileSync('static/index.html','utf8');
 const css=fs.readFileSync('static/aurora.css','utf8');
 const route=fs.readFileSync('static/liquid-route.css','utf8');
 assert.match(html,/if\(page==='dashboard'\)\{/);
 assert.match(html,/return;\s*\}\s*\/\/ Pages secondaires/);
 assert.doesNotMatch(html,/stage\.classList\.add\('sp-no-intro'\)/);
 assert.doesNotMatch(route.replace(/\/\*[\s\S]*?\*\//g,''),/sp-no-intro|sp-route-active|\.aur-welcome|\.aur-rail button/);
 for(const animation of ['aurSlideR','aurRise','aurLine','aurPop','aurDraw','aurFill','aurSheen']){
   assert.match(css,new RegExp('@keyframes '+animation));
 }
 assert.match(css,/\.aur-rail button\{[\s\S]{0,600}animation:aurSlideR/);
 assert.match(css,/\.aur-wave-main\{[\s\S]{0,180}animation:aurDraw/);
});
test('Les autres pages réutilisent exactement les animations d\'accueil en cascade',()=>{
 const html=fs.readFileSync('static/index.html','utf8');
 const css=fs.readFileSync('static/liquid-route.css','utf8');
 const aurora=fs.readFileSync('static/aurora.css','utf8');
 const harmony=fs.readFileSync('static/harmony.css','utf8');
 assert.match(html,/\/static\/liquid-route\.css\?v=6/);
 assert.match(html,/content\.innerHTML=renderPage\(\)/);
 assert.match(html,/stage\.classList\.add\('sp-route-in'\)/);
 assert.match(html,/panel\.style\.setProperty\('--sp-order'/);
 assert.match(html,/className='sp-route-headline'/);
 assert.match(html,/if\(reduced\)return/);
 assert.match(html,/\},2400\)/);
 assert.doesNotMatch(html,/startViewTransition|sp-glass-sweep|sp-route-light/);
 assert.doesNotMatch(harmony,/::view-transition|sp-page-enter/);
 for(const name of ['aurWipeRight','aurLine','aurWipeDown','aurPop','aurSlideR']){
   assert.match(aurora,new RegExp('@keyframes '+name));
   assert.match(css,new RegExp('animation:'+name));
 }
 assert.match(css,/\.sp-route-in \.sp-motion-panel \{/);
 assert.match(css,/animation-delay:calc\(\.8s \+ var\(--sp-order,0\) \* \.11s\)/);
 assert.doesNotMatch(css,/sp-glass-sweep|sp-refract|sp-rim-glint|sp-route-light|linear-gradient/);
 assert.doesNotMatch(css.replace(/\/\*[\s\S]*?\*\//g,''),/filter:blur\(|backdrop-filter:/);
 assert.match(css,/@media\(prefers-reduced-motion:reduce\)/);
 const script=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(x=>x[1]).join('\n');
 assert.doesNotThrow(()=>new Function(script));
});

test('L’actualisation périodique de l’accueil conserve les éléments animés',()=>{
 const html=fs.readFileSync('static/index.html','utf8');
 assert.ok(html.includes("if(page==='dashboard'){syncDashboardData();return}"));
 assert.ok(html.includes('function syncDashboardData()'));
 assert.ok(html.includes("syncText('.aur-metric-value strong"));
 assert.ok(html.includes("syncInlineText('.aur-chart-label"));
 assert.ok(html.includes("currentPath.setAttribute('d',d)"));
 assert.ok(!html.includes("if(!silent||['dashboard'"));
 assert.ok(html.includes("setInterval(syncStockAcrossDevices,1200)"));
 assert.ok(html.includes("function patchLiveStockView()"));
 assert.ok(html.includes("'.si-summary','.si-list','.si-footer'"));
});
test('Les liens du rail possèdent des icônes explicites et une déconnexion identifiable',()=>{
 const html=fs.readFileSync('static/index.html','utf8');
 const css=fs.readFileSync('static/harmony.css','utf8');
 for(const name of ['dashboard-tiles','package-plus','scan-out','stock-boxes','history-clock','settings-gear','log-out']){
  assert.ok(html.includes("'"+name+"':")||name!=='log-out'&&html.includes("'"+name+"'"),name);
 }
 assert.ok(html.includes("['entry','Entrée en stock','package-plus']"));
 assert.ok(html.includes("['exit','Scanner une sortie','scan-out']"));
 assert.ok(html.includes("['products','Produits en stock','stock-boxes']"));
 assert.ok(html.includes("['settings','Paramètres','settings-gear']"));
 assert.ok(html.includes('href="/logout" class="sp-logout" title="Se déconnecter" aria-label="Se déconnecter"'));
 assert.ok(html.includes("ico('log-out',24)"));
 assert.ok(html.includes('/static/harmony.css?v=6'));
 assert.ok(css.includes('.sidebar .sidebottom > a.sp-logout::after{content:none!important'));
 assert.ok(css.includes('content:attr(aria-label)'));
 assert.ok(css.includes('aria-label="Scanner une sortie"'));
});

test('Les modales utilisent des labels contrastés et les champs restent lisibles',()=>{
 const css=fs.readFileSync('static/harmony.css','utf8');
 for(const selector of [
  '.overlay .modal{',
  '.overlay .modal .modal-body .field label{',
  '.overlay .modal .ruleitem{',
  '.overlay .modal .field input:not([type="checkbox"])',
  '.overlay .modal .btn.primary{',
  '.overlay .modal .btn:disabled{'
 ])assert.ok(css.includes(selector),selector);
 assert.match(css,/\.overlay \.modal \.modal-body \.field label\{[\s\S]*?color:#e7f1f7!important/);
});
test('Les suggestions de références évitent le vieux fond vert',()=>{
 const css=fs.readFileSync('static/harmony.css','utf8');
 assert.match(css,/body:not\(\.aurora-on\) \.basic-suggestions:not\(:empty\)/);
 assert.match(css,/\.basic-suggestion small/);
 assert.match(css,/\.basic-create small/);
});

test('Les fenêtres et suggestions ont la palette bleu-gris du fond orageux, sans vert',()=>{
 const css=fs.readFileSync('static/harmony.css','utf8');
 const modal=css.match(/\/\* SP contrast fix[\s\S]*?\.overlay \.modal\{([^}]*)\}/);
 assert.ok(modal,'style commun des fenêtres');
 assert.match(modal[1],/rgba\(55,64,86,\.985\)/);
 assert.match(modal[1],/rgba\(37,46,67,\.99\)/);
 assert.match(css,/body:not\(\.aurora-on\) \.basic-suggestions:not\(:empty\)\{\s*background:rgba\(47,56,77,\.97\)/);
 assert.match(css,/body:not\(\.aurora-on\) \.basic-suggestion>b\{\s*color:#d0dcff!important/);
});

test('Scanner mobile : aucune sélection du dernier article et bouton caméra unique',()=>{
 const html=fs.readFileSync('static/index.html','utf8');
 const js=fs.readFileSync('static/barcode-only.js','utf8');
 const out=basic.exit(context);
 assert.doesNotMatch(out,/data-action="sample"|Sélectionner le dernier article/);
 assert.match(out,/data-action="camera"/);
 assert.doesNotMatch(html,/case'sample':/);
 assert.match(html,/case'camera':startCamera\(\)/);
 assert.match(html,/function stopCamera\(\)/);
 assert.match(html,/window\.addEventListener\('pagehide',stopCamera\)/);
});
test('Scanner caméra : QR Code et Code 128 sur iOS/Android',()=>{
 const html=fs.readFileSync('static/index.html','utf8');
 const css=fs.readFileSync('static/harmony.css','utf8');
 assert.match(html,/html5-qrcode\/2\.3\.8\/html5-qrcode\.min\.js/);
 assert.match(html,/Html5QrcodeSupportedFormats/);
 assert.match(html,/format\.QR_CODE,format\.CODE_128,format\.CODE_39/);
 assert.match(html,/\{facingMode:'environment'\}/);
 assert.match(html,/await stopCamera\(\)/);
 assert.match(html,/if\(page==='exit'\)lookup\(id\)/);
 assert.match(html,/ensureScannerLibrary\(\)/);
 assert.match(css,/#scan-panel\.sp-camera-active/);
 assert.match(css,/#sp-camera-reader video/);
});

test('Application iPhone / Android : manifeste et protections des données',()=>{
 const fs=require('node:fs');
 const app=fs.readFileSync('app.py','utf8');
 const html=fs.readFileSync('static/index.html','utf8');
 const manifest=JSON.parse(fs.readFileSync('static/app.webmanifest','utf8'));
 const worker=fs.readFileSync('static/sw.js','utf8');
 assert.equal(manifest.display,'standalone');
 assert.equal(manifest.start_url,'/');
 assert.deepEqual(manifest.icons.map(i=>i.sizes),['192x192','512x512']);
 assert.match(html,/rel="manifest" href="\/static\/app\.webmanifest"/);
 assert.match(html,/apple-touch-icon/);
 assert.match(html,/navigator\.serviceWorker\.register\('\/sw\.js\?version=2'\)/);
 assert.match(html,/\/static\/mobile-app\.css\?v=4/);
 assert.match(app,/@app\.get\('\/sw\.js'\)/);
 assert.match(app,/@app\.get\('\/apple-touch-icon\.png'\)/);
 assert.doesNotMatch(worker,/cache\.addAll\(\[['"][\/]api/);
 assert.match(worker,/event\.request\.mode==='navigate'/);
});

test('Installation guidée depuis les paramètres mobiles',()=>{
 const html=fs.readFileSync('static/index.html','utf8');
 const code=fs.readFileSync('static/barcode-only.js','utf8');
 const css=fs.readFileSync('static/mobile-app.css','utf8');
 assert.match(html,/case'installapp':installMobileApp\(\)/);
 assert.match(html,/beforeinstallprompt/);
 assert.match(code,/data-action="installapp"/);
 assert.match(code,/sp-mobile-install/);
 assert.match(css,/\.sp-mobile-install\{display:none!important\}/);
});

test('Inventaire : popup produit au lieu de menu déroulant, seuil facultatif en PC',()=>{
 const ctx={...context,db:{...db,items:[item,{...item,id:'STK-000011'}],catalog:[{...product,min_stock:3}]},tableStockFilter:'all'};
 const html=basic.inventory(ctx);
 assert.match(html,/si-inventory/);
 assert.match(html,/si-is-alert/);
 assert.match(html,/Stock faible · à commander/);
 assert.match(html,/Minimum : 3/);
 assert.match(html,/data-action="stockproduct"/);
 assert.doesNotMatch(html,/data-action="newentryproduct"/);
 assert.doesNotMatch(html,/data-action="newentry"/);
 assert.doesNotMatch(html,/<details/);
 assert.match(html,/data-action="pushsubscribe"/);
 assert.match(html,/data-action="exportstocksummary"/);
 assert.equal((html.match(/class="si-record /g)||[]).length,1);
 const p=ctx.db.catalog[0];
 const modal=basic.stockProductModal({...ctx,modal:{id:p.id},product:id=>id===p.id?p:null});
 assert.match(modal,/role="dialog" aria-modal="true"/);
 assert.match(modal,/STK-000010/);
 assert.match(modal,/STK-000011/);
 assert.match(modal,/barcode.svg/);
 assert.equal((modal.match(/data-action="print"/g)||[]).length,2);
 assert.match(modal,/data-action="stockthreshold"/);
 assert.match(modal,/si-desktop-alert/);
 const zero=basic.inventory({...ctx,db:{...ctx.db,items:[],catalog:[{...p,min_stock:0}]}});
 assert.match(zero,/Sans alerte/);
 assert.doesNotMatch(zero,/Rupture · à commander/);
 assert.match(basic.inventory({...ctx,tableStockFilter:'low'}),/Alerte/);
 const noAlerts=basic.inventory({...ctx,db:{...ctx.db,items:[],catalog:[{...p,min_stock:0}]},tableStockFilter:'low'});
 assert.match(noAlerts,/Aucun produit ne correspond/);
 const sav=basic.inventory({...ctx,db:{...ctx.db,items:[{...item,condition:'Retour SAV'}]}});
 assert.match(sav,/1 en SAV \/ réparation/);
 const userModal=basic.stockProductModal({...ctx,me:{role:'employee'},modal:{id:p.id},product:id=>id===p.id?p:null});
 assert.doesNotMatch(userModal,/data-action="stockthreshold"/);
 assert.match(userModal,/STK-000010/);
});
test('iPhone : interface verticale et rebond désactivé sans casser le défilement',()=>{
 const css=fs.readFileSync('static/mobile-app.css','utf8');
 const html=fs.readFileSync('static/index.html','utf8');
 assert.match(css,/overscroll-behavior-y:none!important/);
 const inventoryCss=fs.readFileSync('static/inventory-ui.css','utf8');
 assert.match(inventoryCss,/\.si-record-summary/);
 assert.match(inventoryCss,/\.si-toolbar/);
 assert.match(inventoryCss,/\.si-inventory/);
 assert.match(css,/@media\(max-width:860px\)/);
 assert.match(html,/function disableViewportRubberBand\(\)/);
 assert.match(html,/\{passive:false\}/);
 assert.match(html,/case'stockthreshold'/);
 assert.match(html,/case'stockfilter'/);
});
test('Étiquettes DYMO : PDF à l’échelle choisie depuis les paramètres',()=>{
 const html=fs.readFileSync('static/index.html','utf8');
 const app=fs.readFileSync('app.py','utf8');
 const settings=basic.settings({...context,labelSize:'57x32'});
 assert.match(app,/application\/pdf/);
 assert.match(app,/from reportlab\.pdfgen import canvas/);
 assert.match(app,/formats = \{'54x25': \(54, 25\), '57x32': \(57, 32\)\}/);
 assert.match(settings,/id="label-size"/);
 assert.match(settings,/option value="57x32" selected/);
 assert.match(html,/stockPilotLabelSize\(\)/);
});

test('iPhone : fond unique stable dans la composition, sans parallax Safari',()=>{
 const html=fs.readFileSync('static/index.html','utf8');
 const css=fs.readFileSync('static/mobile-layout.css','utf8');
 assert.match(html,/\/static\/mobile-layout\.css\?v=5/);
 assert.match(css,/body::before\s*\{/);
 assert.match(css,/position:fixed; top:0; left:0/);
 assert.match(css,/height:100lvh/);
 assert.match(css,/url\("\/static\/aurora-storm\.jpg"\) 64% 52% \/ cover no-repeat/);
 assert.match(css,/body\.aurora-on \.aurora-dashboard\s*\{[\s\S]*?background:transparent!important;background-image:none!important/);
 assert.match(css,/background-attachment:scroll!important/);
 assert.doesNotMatch(css,/background-attachment:fixed!important/);
});
test('Navigation mobile : cinq onglets lisibles et actions secondaires accessibles',()=>{
 const html=fs.readFileSync('static/index.html','utf8');
 const css=fs.readFileSync('static/mobile-layout.css','utf8');
 assert.match(html,/<nav class="mobilebottom" aria-label="Navigation mobile"/);
 assert.match(html,/data-action="mobilemore"/);
 assert.match(html,/id="sp-mobile-menu"/);
 assert.match(html,/data-nav="history"/);
 assert.match(html,/data-nav="settings"/);
 assert.match(html,/href="\/logout"/);
 assert.match(html,/function toggleMobileMore\(force\)/);
 assert.match(html,/case'mobilemore':toggleMobileMore\(\)/);
 assert.match(html,/case'closemobilemore':toggleMobileMore\(false\)/);
 assert.match(css,/\.mobilebottom\s*\{[\s\S]*?grid-template-columns:repeat\(5,minmax\(0,1fr\)\)/);
 assert.match(css,/body:not\(\.aurora-on\) \.sidebar,body\.aurora-on \.sidebar\s*\{[\s\S]*?display:none!important/);
 assert.match(css,/\.sp-mobile-menu\[hidden\],\.sp-mobile-scrim\[hidden\]\{display:none!important\}/);
});
test('iPhone : accueil en flux vertical et champs sans zoom',()=>{
 const css=fs.readFileSync('static/mobile-layout.css','utf8');
 assert.match(css,/\.aur-rail\s*\{[\s\S]*?order:2;position:relative!important/);
 assert.match(css,/\.aur-metrics\s*\{[\s\S]*?order:3;position:relative!important/);
 assert.match(css,/\.aur-chart\s*\{[\s\S]*?order:4;position:relative!important/);
 assert.match(css,/\.basic-entry-grid,\.settings-board,\.flowgrid\s*\{[\s\S]*?grid-template-columns:minmax\(0,1fr\)!important/);
 assert.match(css,/\.field textarea,[\s\S]*?font-size:16px!important/);
 assert.match(css,/env\(safe-area-inset-bottom,0px\)/);
});

test('Barre de navigation iPhone toujours visible hors accueil malgré polish.css',()=>{
 const fs=require('node:fs');
 const oldCss=fs.readFileSync('static/polish.css','utf8');
 const mobile=fs.readFileSync('static/mobile-layout.css','utf8');
 const html=fs.readFileSync('static/index.html','utf8');
 assert.match(oldCss,/body:not\(\.aurora-on\) \.mobilebottom\{display:none!important\}/);
 assert.match(mobile,/body:not\(\.aurora-on\) \.mobilebottom,\s*body\.aurora-on \.mobilebottom\s*\{[^}]*display:grid!important/);
 assert.match(mobile,/visibility:visible!important/);
 assert.match(html,/<nav class="mobilebottom" aria-label="Navigation mobile"/);
 assert.match(html,/\/static\/mobile-layout\.css\?v=5/);
 const polishPosition=html.indexOf('/static/polish.css');
 const mobilePosition=html.indexOf('/static/mobile-layout.css');
 assert.ok(mobilePosition>polishPosition,'Les règles mobiles doivent venir après polish.css');
});

test('Animation inventaire : une apparition homogène, sans cascade sur chaque ligne',()=>{
 const html=fs.readFileSync('static/index.html','utf8');
 const css=fs.readFileSync('static/inventory-ui.css','utf8');
 assert.match(html,/const selectors='\.basic-entry-form,\.basic-entry-help,\.basic-table-card,\.settingscard,\.formcard,\.card';/);
 assert.doesNotMatch(html,/\.sp-stock-overview>div,\.sp-stock-row/);
 assert.match(css,/#content\.sp-route-in \.si-inventory\s*\{[\s\S]*?animation:aurSlideR/);
 assert.match(html,/\/static\/inventory-ui\.css\?v=4/);
 const start=html.indexOf('/static/mobile-layout.css'),last=html.indexOf('/static/inventory-ui.css');
 assert.ok(last>start);
});
test('Desktop et iPhone : tableau compact et détails accessibles',()=>{
 const css=fs.readFileSync('static/inventory-ui.css','utf8');
 assert.match(css,/grid-template-columns:minmax\(0,1fr\) 130px minmax\(185px,\.65fr\) 83px/);
 assert.match(css,/@media\(max-width:700px\)/);
 assert.match(css,/grid-template-areas:"product quantity" "status expand"/);
 assert.match(css,/\.si-alert-controls\[hidden\]\{display:none!important\}/);
 assert.match(css,/\.si-record-summary::\-webkit-details-marker\{display:none\}/);
 assert.match(css,/@media\(prefers-reduced-motion:reduce\)/);
});

test('Réception depuis le stock : produit existant déjà sélectionné',()=>{
 const p={...product,active:1};
 receive.prefill(p);
 const html=receive.entry({...context,db:{...db,catalog:[p]}});
 assert.match(html,/id="rx-name"[^>]*value="TERRA Mobile 1517"/);
 assert.match(html,/Référence existante : T-1517/);
 receive.reset();
});
test('Assets inventaire récents : Safari ne garde pas les anciens styles et scripts',()=>{
 const html=fs.readFileSync('static/index.html','utf8');
 assert.match(html,/\/static\/barcode-only\.js\?v=henrri-20261110-1/);
 assert.match(html,/\/static\/reception\.js\?v=13/);
 assert.match(html,/\/static\/inventory-ui\.css\?v=4/);
 assert.match(html,/\/static\/mobile-layout\.css\?v=5/);
});

test('Notifications : inscription consentie, pas de seuil à configurer sur iPhone',()=>{
 const js=fs.readFileSync('static/index.html','utf8');
 const sw=fs.readFileSync('static/sw.js','utf8');
 const css=fs.readFileSync('static/inventory-ui.css','utf8');
 const more=fs.readFileSync('static/mobile-layout.css','utf8');
 assert.match(js,/case'pushsubscribe':togglePushSubscription\(a\)/);
 assert.match(js,/Notification.requestPermission\(\)/);
 assert.match(js,/pushManager.subscribe/);
 assert.match(sw,/self.addEventListener\('push'/);
 assert.match(sw,/self.registration.showNotification/);
 assert.match(sw,/self.addEventListener\('notificationclick'/);
 assert.match(css,/@media\(max-width:860px\)/);
 assert.match(css,/\.si-desktop-alert\{display:none!important\}/);
 assert.match(css,/\.si-export\{display:none!important\}/);
 assert.match(more,/spMobileMenuArrive/);
});

test('Docker embarque les modules nécessaires au démarrage de Gunicorn',()=>{
 const docker=fs.readFileSync('Dockerfile','utf8');
 const app=fs.readFileSync('app.py','utf8');
 assert.match(app,/^import push_service$/m);
 assert.ok(docker.includes('COPY app.py push_service.py backup_service.py henrri_service.py gunicorn_conf.py ./'));
 assert.ok(docker.includes('"--config", "gunicorn_conf.py"'));
 assert.match(docker,/python -c "import app; assert app\.app\.test_client\(\)\.get\('\/healthz'\)\.status_code == 200"/);
 assert.match(docker,/USER stockpilot/);
 assert.match(docker,/VOLUME \["\/data"\]/);
 assert.ok(fs.existsSync('push_service.py'));
  assert.ok(fs.existsSync('henrri_service.py'));
});

test('iPhone : aide à la réception absente mais conservée sur ordinateur',()=>{
 const html=receive.entry(context);
 const css=fs.readFileSync('static/mobile-layout.css','utf8');
 assert.match(html,/class="card basic-entry-help"/);
 assert.match(html,/Comment ça marche \?/);
 assert.match(css,/@media screen and \(max-width:860px\)/);
 assert.match(css,/body:not\(\.aurora-on\) \.basic-entry-help\{display:none!important\}/);
});
test('iPhone : historique en journal lisible, version tableau préservée sur PC',()=>{
 const ev=[
  {itemId:'STK-000010',pid:'terra1',type:'in',actor:'Admin',at:new Date('2026-11-03T10:30:00Z').getTime()},
  {itemId:'STK-000011',pid:'terra1',type:'out',actor:'Employé',at:new Date('2026-11-03T10:10:00Z').getTime()}
 ];
 const ctx={...context,db:{...db,events:ev}};
 const html=basic.history(ctx);
 const css=fs.readFileSync('static/mobile-layout.css','utf8');
 assert.match(html,/class="sp-history-page"/);
 assert.match(html,/class="sp-mobile-history"/);
 assert.match(html,/<h1>Historique<\/h1>/);
 assert.match(html,/sp-mh-event sp-mh-in/);
 assert.match(html,/sp-mh-event sp-mh-out/);
 assert.match(html,/STK-000010/);
 assert.match(html,/STK-000011/);
 assert.match(html,/class="slim-table basic-table"/);
 assert.equal((html.match(/class="sp-mh-day"/g)||[]).length,1);
 assert.match(css,/\.sp-history-page > \.basic-table-card\{display:none!important\}/);
 assert.match(css,/\.sp-mobile-history[\s\S]*?display:block!important/);
 assert.match(css,/\.sp-history-page \.pagehead \.head-actions/);
});
test('iPhone : paramètres épurés sans empêcher les réglages bureau',()=>{
 const html=basic.settings(context);
 const css=fs.readFileSync('static/mobile-layout.css','utf8');
 const js=fs.readFileSync('static/index.html','utf8');
 assert.match(html,/class="sp-mobile-settings"/);
 assert.match(html,/<h1>Paramètres<\/h1>/);
 assert.match(html,/class="sp-ms-card sp-ms-profile"/);
 assert.match(html,/id="mobile-password-form"/);
 assert.match(html,/class="sp-ms-card sp-ms-password"/);
 assert.match(html,/data-action="pushsubscribe"/);
 assert.match(html,/Étiquettes DYMO LabelWriter 450/);
 assert.match(html,/Gérer les utilisateurs/);
 assert.match(css,/\.sp-settings-page > \.settings-board\{display:none!important\}/);
 assert.match(css,/\.sp-mobile-settings\{display:grid!important/);
 assert.match(js,/mobile-password-form/);
});
test('iPhone : carte notification masquée quand l’abonnement est actif',()=>{
 const html=fs.readFileSync('static/index.html','utf8');
 const css=fs.readFileSync('static/mobile-layout.css','utf8');
 const stock=basic.inventory(context);
 assert.match(stock,/class="si-mobile-push"[^>]* hidden/);
 assert.match(html,/if\(page==='products'\|\|page==='settings'\)updatePushButton\(\)/);
 assert.match(html,/if\(visibleBanner\)visibleBanner.hidden=active/);
 assert.match(css,/\.si-mobile-push\[hidden\]\{display:none!important\}/);
});

test('Synchronisation : vérifie une révision puis met à jour sans recréer le formulaire en cours',async()=>{
 const html=fs.readFileSync('static/index.html','utf8');
 const scripts=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(x=>x[1]).filter(Boolean);
 const callbacks={};
 const intervals=[];
 let changes=0,revision=10,updatedProduct=false;
 const app={
  markup:'',
  set innerHTML(value){this.markup=value;changes++},
  get innerHTML(){return this.markup}
 };
 const el={'#app':app,'#toasts':{appendChild:()=>{}}};
 const fakeDocument={
  hidden:false,
  addEventListener:(event,callback)=>{callbacks['document:'+event]=callback},
  getElementById:()=>null,querySelector:(sel)=>el[sel]||null,
  querySelectorAll:()=>[],
  body:{classList:{toggle:()=>{},remove:()=>{}}},
  createElement:()=>({innerHTML:'',className:'',remove:()=>{}})
 };
 const windowListeners={};
 const fakeWindow={
  addEventListener:(event,callback)=>{windowListeners[event]=callback},
  scrollTo:()=>{},open:()=>({}),location:{href:'/'}
 };
 const fakeFetch=async(url)=>{
  let body;
  if(url==='/api/state')body={
   items:[],events:[],catalog:updatedProduct?[{id:'new',brand:'Nouveau',model:'PC',ref:'T-001',cat:'PC portable',active:1}]:[],
   shelves:[],counter:1,revision,me:{username:'Admin',role:'admin'}
  };
  else if(url==='/api/sync/revision')body={revision};
  else throw new Error('Unexpected request: '+url);
  return {ok:true,status:200,headers:{get:()=> 'application/json'},json:async()=>body};
 };
 const ctx={
  window:fakeWindow,document:fakeDocument,fetch:fakeFetch,URL,console,
  history:{scrollRestoration:'auto'},
  navigator:{},requestAnimationFrame:cb=>cb(),
  setTimeout:()=>0,setInterval:(fn,delay)=>{intervals.push({fn,delay});return 1}
 };
 for(const path of ['static/barcode-only.js','static/reception.js']){
  vm.runInNewContext(fs.readFileSync(path,'utf8'),ctx,{filename:path});
 }
 ctx.SPBasic=fakeWindow.SPBasic;
 ctx.SPV3=fakeWindow.SPV3;
 vm.runInNewContext(scripts[0],ctx,{filename:'static/index.html'});
 await new Promise(resolve=>setTimeout(resolve,35));
 assert.equal(changes,2,'Écran de chargement initial puis premier rendu');
 assert.equal(intervals.length,2);
  assert.equal(intervals[1].delay,60*60*1000);
 assert.equal(intervals[0].delay,1200);
 assert.match(app.markup,/Stock central/);

 // L'utilisateur navigue et commence une saisie : celle-ci ne doit pas disparaître.
 const target={closest:sel=>sel==='[data-nav]'?{dataset:{nav:'entry'}}:null};
 windowListeners.click({target});
 assert.match(app.markup,/id="rx-name"/);
 const changesBefore=changes;
 ctx.SPV3.onInput({target:{id:'rx-name',value:'Travail non enregistré'}}, {catalog:[],items:[]});
 revision=11;updatedProduct=true;
 await intervals[0].fn();
 assert.equal(changes,changesBefore,'Aucun renderApp/innerHTML lors du changement distant');
 assert.match(ctx.SPV3.entry({db:{items:[],catalog:[]}}),/value="Travail non enregistré"/);
 assert.doesNotMatch(app.markup,/Connexion au serveur impossible/);

 // L'application reçoit aussi le signal dès son retour au premier plan.
 assert.equal(typeof callbacks['document:visibilitychange'],'function');
 assert.equal(typeof windowListeners.focus,'function');
});
test('Historique mobile : animation uniquement à la navigation',()=>{
 const css=fs.readFileSync('static/mobile-layout.css','utf8');
 const js=fs.readFileSync('static/index.html','utf8');
 assert.match(css,/@keyframes spHistoryHeadingEnter/);
 assert.match(css,/@keyframes spHistoryJournalEnter/);
 assert.match(css,/#content\.sp-route-in \.sp-history-page \.sp-mobile-pagehead/);
 assert.match(css,/#content\.sp-route-in \.sp-history-page \.sp-mobile-history/);
 assert.match(js,/\.sp-mobile-history \.sp-mh-list/);
 assert.doesNotMatch(js,/setInterval\(\(\)=>\{if\(!document.hidden&&!modal&&page!=='entry'/);
});
test('Notifications iPhone : préférence persistante et réparation du serveur sans nouveau consentement',()=>{
 const html=fs.readFileSync('static/index.html','utf8');
 assert.match(html,/PUSH_PREFERENCE_KEY='stockpilot-notifications-enabled'/);
 assert.match(html,/function restorePushOnAppLaunch\(\)/);
 assert.match(html,/rememberPushPreference\(true\)/);
 assert.match(html,/rememberPushPreference\(false\)/);
 assert.match(html,/await api\('\/api\/push\/subscriptions','POST',sub.toJSON\(\)\)/);
 assert.match(html,/if\(!sub&&wantsPushNotifications\(\)\)/);
 assert.match(html,/await restorePushOnAppLaunch\(\)/);
});

test('Sauvegardes PC : fenêtre de gestion et restauration confirmée',()=>{
 const html=fs.readFileSync('static/index.html','utf8');
 const basic=fs.readFileSync('static/barcode-only.js','utf8');
 const app=fs.readFileSync('app.py','utf8');
 const css=fs.readFileSync('static/backup-ui.css','utf8');
 assert.match(basic,/data-action="managebackups"/);
 assert.match(html,/\/static\/backup-ui\.css\?v=1/);
 assert.match(html,/modal\.type==='backups'/);
 assert.match(html,/modal\.type==='backuprestore'/);
 assert.match(html,/data-action="restorebackup"/);
 assert.match(html,/RESTAURER LE STOCK/);
 assert.match(html,/data-action="createbackup"/);
 assert.match(app,/@app\.get\('\/api\/admin\/backups'\)/);
 assert.match(app,/@app\.post\('\/api\/admin\/backups'\)/);
 assert.match(app,/@app\.post\('\/api\/admin\/backups\/<name>\/restore'\)/);
 assert.match(css,/\.sp-backups-modal/);
});

test('Synchronisation ciblée : conserve les saisies et réactualise le scan et les popups',()=>{
 const html=fs.readFileSync('static/index.html','utf8');
 const reception=fs.readFileSync('static/reception.js','utf8');
 const exit=fs.readFileSync('static/barcode-only.js','utf8');
 assert.match(html,/function patchLiveStockView\(\)/);
 assert.match(html,/SPV3\.refreshSuggestions\(db\)/);
 assert.match(html,/\.sp-scan-result/);
 assert.match(html,/\.si-modal-units/);
 assert.match(html,/\.basic-manual-list/);
 assert.match(html,/old\.contains\(document\.activeElement\)/);
 assert.match(reception,/function refreshSuggestions\(db\)/);
 assert.match(exit,/class="sp-scan-result"/);
 assert.doesNotMatch(html,/else if\(!modal && \['products','history','settings'\]/);
 assert.match(html,/setInterval\(syncStockAcrossDevices,1200\)/);
});

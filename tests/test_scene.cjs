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
 assert.ok(html.includes("else if(page==='dashboard')syncDashboardData()"));
 assert.ok(html.includes('function syncDashboardData()'));
 assert.ok(html.includes("syncText('.aur-metric-value strong"));
 assert.ok(html.includes("syncInlineText('.aur-chart-label"));
 assert.ok(html.includes("currentPath.setAttribute('d',d)"));
 assert.ok(!html.includes("if(!silent||['dashboard'"));
 assert.ok(html.includes("setInterval(()=>{if(!document.hidden"));
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
 assert.match(html,/navigator\.serviceWorker\.register\('\/sw\.js'\)/);
 assert.match(html,/\/static\/mobile-app\.css\?v=2/);
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

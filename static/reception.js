/* StockPilot — réception simple avec recherche/création et code-barres individuel. */
(function(){
'use strict';
const esc=v=>String(v??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const name=p=>[p?.brand,p?.model].filter(Boolean).join(' ');
const blank=()=>({name:'',pid:'',serial:'',condition:'Neuf',saving:false,suggestions:true,received:null});
let state=blank();
const choices=db=>{const needle=state.name.trim().toLocaleLowerCase('fr');return needle?db.catalog.filter(p=>p.active&&(name(p).toLocaleLowerCase('fr').includes(needle)||(p.ref||'').toLocaleLowerCase('fr').includes(needle))).slice(0,6):[]};
function hints(db){
 if(!state.name.trim()||!state.suggestions)return '';
 const matches=choices(db),exact=matches.some(p=>name(p).toLocaleLowerCase('fr')===state.name.trim().toLocaleLowerCase('fr'));
 return '<div class="basic-suggest-title">Références existantes</div>'+matches.map(p=>'<button type="button" class="basic-suggestion" data-rx="choose" data-id="'+esc(p.id)+'"><span class="basic-suggestion-icon">▣</span><span><strong>'+esc(name(p))+'</strong><small>'+esc(p.ref)+' · '+db.items.filter(i=>i.pid===p.id).length+' en stock</small></span><b>Choisir</b></button>').join('')+
 (!exact?'<button type="button" class="basic-create" data-rx="newproduct"><span>＋</span><div><strong>Créer « '+esc(state.name.trim())+' »</strong><small>Nouvelle référence ajoutée à la réception</small></div></button>':'');
}
function entry(ctx){
 const db=ctx.db;
 if(state.received){
  const item=state.received,product=db.catalog.find(p=>p.id===item.pid);
  return '<div class="basic-entry"><div class="basic-entry-heading"><div><span>RÉCEPTION VALIDÉE</span><h1>Produit ajouté au stock</h1><p>L’article et son étiquette sont prêts.</p></div></div><section class="card basic-result"><div class="basic-result-icon">✓</div><h2>'+esc(product?name(product):state.name)+'</h2><p>Identifiant : <strong>'+esc(item.id)+'</strong></p><p>État : '+esc(item.condition||state.condition)+'</p><div class="basic-result-actions"><button type="button" class="basic-btn primary" data-rx="print" data-id="'+esc(item.id)+'">Imprimer l’étiquette</button><button type="button" class="basic-btn" data-rx="again">Ajouter un autre produit</button></div></section></div>';
 }
 const p=db.catalog.find(p=>p.id===state.pid);
 return '<div class="basic-entry"><div class="basic-entry-heading"><div><span>NOUVELLE RÉCEPTION</span><h1>Entrée en stock</h1><p>Enregistrez un article, puis imprimez son étiquette pour le retrouver au scanner.</p></div><span class="basic-entry-tag">Code-barres individuel</span></div><div class="basic-entry-grid"><section class="card basic-entry-form"><h2>Informations du produit</h2><p class="basic-intro">Un article existant est proposé pendant la saisie. Sinon, la référence sera créée automatiquement.</p><div class="basic-field"><label for="rx-name">Nom du produit *</label><input id="rx-name" maxlength="120" autocomplete="off" value="'+esc(state.name)+'" placeholder="Ex. TERRA Mobile 1517, souris Logitech…" /><div id="rx-suggestions" class="basic-suggestions">'+hints(db)+'</div>'+(p?'<span class="basic-reused">✓ Référence existante : '+esc(p.ref)+'</span>':'')+'</div><div class="basic-dual-fields"><div class="basic-field"><label for="rx-serial">Numéro de série <small>(facultatif)</small></label><input id="rx-serial" maxlength="100" autocomplete="off" value="'+esc(state.serial)+'" placeholder="À laisser vide si inutile"></div><div class="basic-field"><label>État de l’article</label><div class="basic-conditions">'+['Neuf','Retour SAV','Réparation'].map(c=>'<button type="button" data-rx="condition" data-value="'+esc(c)+'" class="'+(state.condition===c?'active':'')+'">'+esc(c)+'</button>').join('')+'</div></div></div><div class="basic-info">Une étiquette unique sera générée après l’enregistrement. Vous pourrez la réimprimer depuis l’inventaire.</div><button type="button" class="basic-submit" data-rx="save" '+(!state.name.trim()||state.saving?'disabled':'')+'>'+(state.saving?'Enregistrement…':'Enregistrer le produit')+' <span>→</span></button></section><section class="card basic-entry-help"><div class="basic-entry-help-head"><span class="basic-help-symbol">'+(ctx.ico?ctx.ico('barcode',24):'')+'</span><h2>Comment ça marche ?</h2></div><div class="basic-steps"><div><b>1</b><span><strong>Réceptionnez l’article</strong><small>Indiquez son nom, éventuellement le numéro de série et son état.</small></span></div><div><b>2</b><span><strong>Imprimez son étiquette</strong><small>Chaque unité obtient un identifiant unique et un QR code imprimable.</small></span></div><div><b>3</b><span><strong>Scannez à la sortie</strong><small>Le produit disparaît du stock disponible et la sortie reste dans l’historique.</small></span></div></div><div class="basic-example-label"><div><strong>STOCKPILOT</strong><small>EXEMPLE D’ÉTIQUETTE</small></div><p>TERRA Mobile 1517</p><div class="basic-example-bottom"><span class="basic-example-bars" aria-hidden="true"></span><span>STK-000001<small>Scanner pour identifier</small></span></div></div></section></div></div>';
}
function onInput(ev,db){
 if(ev.target.id==='rx-name'){
  state.name=ev.target.value;state.pid='';state.suggestions=true;
  const hintsEl=document.getElementById('rx-suggestions');if(hintsEl)hintsEl.innerHTML=hints(db);
  const save=document.querySelector('[data-rx="save"]');if(save)save.disabled=!state.name.trim();
  document.querySelector('.basic-reused')?.remove();
  return true;
 }
 if(ev.target.id==='rx-serial'){state.serial=ev.target.value;return true;}
 return false;
}
function onClick(ev,ctx){
 const el=ev.target.closest('[data-rx]');if(!el)return false;
 const action=el.dataset.rx,db=ctx.db;
 if(action==='choose'){const p=db.catalog.find(p=>p.id===el.dataset.id);if(p){state.name=name(p);state.pid=p.id;state.suggestions=false;ctx.renderContent();}}
 else if(action==='newproduct'){state.pid='';state.suggestions=false;ctx.renderContent();}
 else if(action==='condition'){state.condition=el.dataset.value;ctx.renderContent();}
 else if(action==='again'){state=blank();ctx.renderContent();}
 else if(action==='print'){ctx.printLabel(el.dataset.id);}
 else if(action==='save'){
  if(!state.name.trim()||state.saving)return true;
  state.saving=true;
  const data={name:state.name.trim(),product_id:state.pid,serial:state.serial.trim(),condition:state.condition};
  ctx.renderContent();
  (async()=>{try{
   const response=await ctx.api('/api/receive','POST',data);
   state.received=response.item;
   await ctx.refreshState(true);
   ctx.renderContent();
   ctx.toast('Produit ajouté au stock');
  }catch(error){state.saving=false;ctx.renderContent();ctx.toast(error.message,true)}})();
 }
 return true;
}
function refreshSuggestions(db){
 if(state.received||!state.suggestions)return;
 const panel=document.getElementById('rx-suggestions');
 if(!panel||panel.contains(document.activeElement))return;
 const next=hints(db);
 if(panel.innerHTML!==next)panel.innerHTML=next;
}
function reset(){state=blank();}
function prefill(product){
 state=blank();
 if(product){state.name=name(product);state.pid=product.id;state.suggestions=false;}
}
function onChange(){return false;}
window.SPV3={entry,onInput,onClick,onChange,reset,prefill,refreshSuggestions,selectSlot(){}};
})();
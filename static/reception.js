/* StockPilot 3.0 — réception atelier, suggestions et rayonnages interactifs */
(function () {
'use strict';
const e = v => String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const sizes={unknown:'À préciser',small:'Petit niveau',medium:'Niveau moyen',large:'Grand niveau'};
const initial=()=>({name:'',pid:'',serial:'',condition:'Neuf',slot:'',received:null,suggestions:true,saving:false});
let state=initial();
const cleanName=p=>(p.brand+' '+p.model).trim();
function find(db){const search=state.name.trim().toLocaleLowerCase('fr');if(!search)return [];return db.catalog.filter(p=>p.active && (cleanName(p).toLocaleLowerCase('fr').includes(search)||(p.ref||'').toLowerCase().includes(search))).slice(0,6)}
function hint(db){
 const matches=find(db);
 if(!state.suggestions||!state.name.trim())return '';
 const exact=matches.some(p=>cleanName(p).toLocaleLowerCase('fr')===state.name.trim().toLocaleLowerCase('fr'));
 return '<div class="rx-suggest-title">Références correspondantes</div>'+matches.map(p=>{
 const count=db.items.filter(i=>i.pid===p.id).length;
 return '<button type="button" data-rx="choose" data-id="'+e(p.id)+'" class="rx-suggest-row"><span class="rx-product-icon">▣</span><span><strong>'+e(cleanName(p))+'</strong><small>'+e(p.ref)+' · '+count+' en stock</small></span><span class="rx-match">Utiliser</span></button>';
 }).join('')+(!exact?'<button type="button" data-rx="newproduct" class="rx-suggest-new"><span class="rx-new-plus">+</span><span><strong>Créer « '+e(state.name.trim())+' »</strong><small>La référence sera créée à la validation de l’entrée</small></span></button>':'');
}
function shelfPlan(db,photo,admin){return window.StockPilotWarehouse.render(db,state.slot,photo,admin);}
function entry(ctx) {
 const db=ctx.db;
 if(state.received){
 const item=state.received,p=db.catalog.find(p=>p.id===item.pid);
 return '<div class="rx-root"><div class="rx-heading"><span class="rx-overline">RÉCEPTION VALIDÉE</span><h1>Produit enregistré</h1><p>L’entrée est dans le stock partagé du magasin.</p></div>'+
 '<section class="rx-panel rx-result"><span class="rx-check">✓</span><h2>'+e(p?cleanName(p):state.name)+'</h2><p>Identifiant de suivi : <strong>'+e(item.id)+'</strong></p><p>Emplacement : <strong>'+e(item.slot||'Non renseigné')+'</strong></p><div class="rx-result-actions"><button type="button" class="rx-action" data-rx="print" data-id="'+e(item.id)+'">Imprimer l’étiquette</button><button type="button" class="rx-alt" data-rx="again">Nouvelle réception</button></div></section></div>';
 }
 const picked=db.catalog.find(p=>p.id===state.pid);
 const n=state.slot?db.items.filter(i=>String(i.slot||'').split('-').slice(0,2).join('-')===state.slot).length:0;
 return '<div class="rx-root"><div class="rx-heading"><div class="rx-heading-content"><span class="rx-overline">MOUVEMENTS / RÉCEPTION</span><h1>Entrée en stock</h1><p>Renseignez le produit, choisissez son emplacement et validez la réception.</p></div><span class="rx-instruction">01 — Article &nbsp; / &nbsp; 02 — Rangement</span></div>'+
 '<div class="rx-columns"><section class="rx-panel rx-form"><div class="rx-section-head"><span class="rx-step">01</span><div><h2>Informations de l’article</h2><p>Recherchez un modèle déjà connu ou créez-en un nouveau directement.</p></div></div>'+
 '<div class="rx-field"><label for="rx-name">Nom du produit <b>*</b></label><div class="rx-search-wrap"><input id="rx-name" value="'+e(state.name)+'" autocomplete="off" maxlength="120" placeholder="Ex. TERRA Mobile 1517, souris Logitech, écran 24”..." spellcheck="false" /><span class="rx-search-glyph">⌕</span></div><div id="rx-suggestions" class="rx-suggestions">'+hint(db)+'</div>'+(picked?'<p class="rx-identified">✓ Référence existante · '+e(picked.ref)+'</p>':'')+'</div>'+
 '<div class="rx-fields-line"><div class="rx-field"><label for="rx-serial">Numéro de série <span>facultatif</span></label><input id="rx-serial" value="'+e(state.serial)+'" maxlength="100" autocomplete="off" placeholder="À laisser vide si inutile" /></div><div class="rx-field"><label>État de l’article</label><div class="rx-conditions">'+[['Neuf','Neuf'],['Retour SAV','Retour SAV'],['Réparation','Réparation']].map(([key,val])=>'<button type="button" class="'+(state.condition===key?'active':'')+'" data-rx="condition" data-value="'+key+'">'+e(val)+'</button>').join('')+'</div></div></div>'+
 '<div class="rx-info-strip"><span class="rx-info-icon">i</span>La création d’une nouvelle référence se fait automatiquement lors de la première entrée. Aucun numéro de série n’est obligatoire.</div>'+
 '<div class="rx-selected-box"><div><span class="rx-muted">Emplacement choisi</span><strong>'+e(state.slot||'Aucun emplacement')+'</strong></div><div><span class="rx-muted">Produits déjà sur ce niveau</span><strong>'+n+'</strong></div></div>'+
 '<button type="button" class="rx-action rx-submit" data-rx="save" '+(!state.name.trim()||state.saving?'disabled':'')+'>'+(state.saving?'Enregistrement…':'Enregistrer l’entrée et préparer l’étiquette')+'<span>→</span></button><p class="rx-form-footnote">Le stock sera actualisé immédiatement. L’impression peut être lancée juste après.</p></section>'+
 '<section class="rx-panel rx-location"><div class="rx-section-head"><span class="rx-step">02</span><div><h2>Choisir un emplacement</h2><p>Retrouvez vos rayonnages et sélectionnez directement le niveau de rangement.</p></div></div>'+
 shelfPlan(db,db.warehousePhoto,ctx.me?.role==='admin')+'<input type="file" id="rx-photo-input" accept="image/jpeg,image/png,image/webp" hidden />'+
 '<button type="button" class="rx-omit-location" data-rx="clear-slot">Enregistrer sans emplacement pour le moment</button></section></div></div>';
}
function onInput(ev,db){
 if(ev.target.id==='rx-name'){state.name=ev.target.value;state.pid='';state.suggestions=true;const dropdown=document.getElementById('rx-suggestions');if(dropdown)dropdown.innerHTML=hint(db);const save=document.querySelector('[data-rx="save"]');if(save)save.disabled=!state.name.trim();const selected=document.querySelector('.rx-identified');if(selected)selected.remove();return true;}
 if(ev.target.id==='rx-serial'){state.serial=ev.target.value;return true}
 return false;
}
function onClick(ev,ctx){
 const a=ev.target.closest('[data-rx]');if(!a)return false;
 const action=a.dataset.rx,db=ctx.db;
 if(action==='rack'){if(ctx.page==='map'){ctx.setSlot(a.dataset.rack+'-3')}else{state.slot=a.dataset.rack+'-3';ctx.renderContent()}return true}
 if(action==='upload-photo'){document.querySelector('#rx-photo-input')?.click();return true}
 if(action==='choose'){const p=db.catalog.find(p=>p.id===a.dataset.id);if(p){state.pid=p.id;state.name=cleanName(p);state.suggestions=false;if(p.preferred_slot&&!state.slot)state.slot=p.preferred_slot;ctx.renderContent()}}
 else if(action==='newproduct'){state.pid='';state.suggestions=false;ctx.renderContent()}
 else if(action==='slot'){if(ctx.page==='map')ctx.setSlot(a.dataset.slot);else{state.slot=a.dataset.slot;ctx.renderContent()}}
 else if(action==='clear-slot'){state.slot='';ctx.renderContent()}
 else if(action==='condition'){state.condition=a.dataset.value;ctx.renderContent()}
 else if(action==='again'){state=initial();ctx.renderContent()}
 else if(action==='print'){ctx.printLabel(a.dataset.id)}
 else if(action==='save'){
  if(!state.name.trim()||state.saving)return true;
  const data={name:state.name.trim(),product_id:state.pid,serial:state.serial.trim(),slot:state.slot,condition:state.condition};
  state.saving=true;ctx.renderContent();
  (async()=>{try{const res=await ctx.api('/api/receive','POST',data);state.received=res.item;await ctx.refreshState(true);ctx.renderContent();ctx.toast('Entrée enregistrée dans le stock')}catch(err){state.saving=false;ctx.renderContent();ctx.toast(err.message,true)}})();
 }
 return true;
}
function reset(slot=''){state=initial();if(slot)state.slot=slot;}
function onChange(ev,ctx){
 if(ev.target.id!=='rx-photo-input')return false;
 const file=ev.target.files?.[0];if(!file)return true;
 if(!['image/jpeg','image/png','image/webp'].includes(file.type)){ctx.toast('Choisissez une image JPG, PNG ou WEBP',true);return true}
 if(file.size>8*1024*1024){ctx.toast('La photo ne doit pas dépasser 8 Mo',true);return true}
 const form=new FormData();form.append('photo',file);
 (async()=>{try{const res=await fetch('/api/warehouse-photo',{method:'POST',credentials:'same-origin',headers:{'X-Requested-With':'StockPilot'},body:form});const data=await res.json();if(!res.ok)throw new Error(data.error||'Échec du transfert');await ctx.refreshState(true);ctx.renderContent();ctx.toast('Photo de la réserve enregistrée sur le NAS')}catch(error){ctx.toast(error.message,true)}})();
 return true;
}
window.SPV3={entry,onInput,onClick,onChange,reset,selectSlot(slot){state.slot=slot}};
})();
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
  return '<div class="ref-entry-wrap"><div class="ref-page-heading"><div class="ref-heading-icon">▣</div><div><h1>Réception enregistrée</h1><p>Votre produit est désormais disponible dans le stock.</p></div></div>'+
  '<section class="ref-success"><div class="ref-success-check">✓</div><h2>'+e(p?cleanName(p):state.name)+'</h2><p>Identifiant : <strong>'+e(item.id)+'</strong> · Emplacement : <strong>'+e(item.slot||'Non renseigné')+'</strong></p><div class="rx-result-actions"><button type="button" class="ref-primary-btn" data-rx="print" data-id="'+e(item.id)+'">▤ &nbsp; Imprimer l’étiquette</button><button type="button" class="rx-alt" data-rx="again">Nouvelle réception</button></div></section></div>';
 }
 const picked=db.catalog.find(p=>p.id===state.pid);
 const num=state.slot?window.StockPilotWarehouse.quantity(db,state.slot):0;
 const names=['Neuf','Retour SAV','Réparation'];
 return '<div class="ref-entry-wrap">'+
 '<div class="ref-page-heading"><div class="ref-heading-icon">⬡</div><div class="ref-heading-copy"><h1>Réceptionner un produit</h1><p>Ajoutez un produit existant ou créez-en un nouveau directement depuis ce formulaire.</p></div><div class="ref-help"><div class="ref-help-icon">☼</div><div><strong>Besoin d’aide ?</strong><small>Sélectionnez un produit, choisissez un emplacement et enregistrez pour imprimer l’étiquette.</small></div><span class="ref-help-link">Guide d’utilisation</span></div></div>'+
 '<div class="ref-dual-layout">'+
 '<section class="ref-form-pane"><div class="ref-section-heading"><span class="ref-section-number">1</span><div><h2>Informations du produit</h2><p>Recherchez un produit existant ou créez-en un nouveau. S’il n’existe pas, son nom sera automatiquement enregistré.</p></div></div>'+
 '<div class="ref-field"><label for="rx-name">Produit <em>*</em></label><div class="ref-name-input"><span>⌕</span><input id="rx-name" value="'+e(state.name)+'" maxlength="120" autocomplete="off" placeholder="Ex. TERRA Mobile 1517, souris Logitech, écran 24″…" /><span class="ref-input-clear" data-rx="clear-product" role="button" aria-label="Effacer le nom">×</span></div><div class="rx-suggestions ref-suggestions" id="rx-suggestions">'+hint(db)+'</div></div>'+
 (picked?'<div class="ref-existing-reference">● &nbsp; Référence existante · '+e(picked.ref)+'</div>':'')+
 '<div class="ref-field-row"><div class="ref-field"><label for="rx-serial">Numéro de série <small>(facultatif)</small></label><div class="ref-serial-field"><span>▥</span><input id="rx-serial" value="'+e(state.serial)+'" maxlength="100" autocomplete="off" placeholder="Ex. CND3412ABC" /></div></div><div class="ref-field"><label>État <em>*</em></label><div class="ref-condition-group">'+names.map((name,i)=>'<button type="button" data-rx="condition" data-value="'+e(name)+'" class="'+(state.condition===name?'active':'')+'"><span>'+(i===0?'✧':i===1?'↺':'⚒')+'</span>'+e(name)+'</button>').join('')+'</div></div></div>'+
 '<div class="ref-selected-location"><div class="ref-location-icon">♧</div><div class="ref-location-name"><span>Emplacement sélectionné</span><strong>'+e(state.slot||'Aucun')+'</strong></div><div class="ref-location-count">⬡ &nbsp; '+num+' article'+(num>1?'s':'')+' déjà présent'+(num>1?'s':'')+'</div></div>'+
 '<button type="button" class="ref-primary-btn ref-save-btn" data-rx="save" '+(!state.name.trim()||state.saving?'disabled':'')+'><span>▤</span> '+(state.saving?'Enregistrement en cours…':'Enregistrer et imprimer l’étiquette')+' <b>→</b></button>'+
 '<button type="button" class="ref-no-location" data-rx="clear-slot">Continuer sans emplacement</button></section>'+
 '<section class="ref-warehouse-pane"><div class="ref-section-heading"><span class="ref-section-number">2</span><div><h2>Choisir un emplacement sur le schéma</h2><p>Cliquez sur un niveau pour sélectionner l’emplacement de stockage.</p></div><div class="ref-size-legend"><span>Tailles des niveaux :</span><i>⬡ &nbsp; Petit</i><i>⬢ &nbsp; Moyen</i><i>⬟ &nbsp; Grand</i></div></div>'+
 window.StockPilotWarehouse.render(db,state.slot,db.warehousePhoto,ctx.me?.role==='admin')+
 '</section></div></div>';
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
 if(action==='clear-product'){state.name='';state.pid='';state.suggestions=false;ctx.renderContent();return true}
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
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
function shelfPlan(db){
 const z=['A','B','C','D','E','F','G','H','I','J'].map((id,i)=>({id,label: i<4?'Gauche '+(i+1):'Droite '+(i-3)}));
 const shelf=(zone)=>{
  const levels=[5,4,3,2,1].map(n=>{
   const slot=zone.id+'-'+n;
   const cfg=db.shelves?.find(x=>x.slot===slot)||{size:'unknown',note:''};
   const qty=db.items.filter(i=>String(i.slot||'').split('-').slice(0,2).join('-')===slot).length;
   const selected=state.slot===slot;
   const size=cfg.size||'unknown';
   return '<button type="button" class="rx-level'+(selected?' selected':'')+(qty?' occupied':'')+' rx-size-'+e(size)+'" data-rx="slot" data-slot="'+slot+'" title="'+slot+' · '+sizes[size]+' · '+qty+' produits" aria-label="Étagère '+zone.id+', niveau '+n+', '+qty+' produits"><span class="rx-level-code">'+n+'</span><span class="rx-level-amount">'+qty+'</span></button>';
  }).join('');
  return '<div class="rx-rack"><div class="rx-rack-title"><span class="rx-rack-id">'+zone.id+'</span><span>'+zone.label+'</span></div><div class="rx-rack-body">'+levels+'</div></div>';
 };
 return '<div class="rx-room"><div class="rx-room-top">FOND DE LA RÉSERVE</div><div class="rx-room-main"><div class="rx-room-side">'+z.slice(0,4).reverse().map(shelf).join('')+'</div><div class="rx-corridor"><span>ALLÉE</span></div><div class="rx-room-side">'+z.slice(4).reverse().map(shelf).join('')+'</div></div><div class="rx-room-entry">ENTRÉE MAGASIN</div></div>';
}
function entry(ctx) {
 const db=ctx.db;
 if(state.received){
 const item=state.received,p=db.catalog.find(p=>p.id===item.pid);
 return '<div class="rx-root"><div class="rx-heading"><span class="rx-overline">RÉCEPTION VALIDÉE</span><h1>Produit enregistré</h1><p>L’entrée est dans le stock partagé du magasin.</p></div>'+
 '<section class="rx-panel rx-result"><span class="rx-check">✓</span><h2>'+e(p?cleanName(p):state.name)+'</h2><p>Identifiant de suivi : <strong>'+e(item.id)+'</strong></p><p>Emplacement : <strong>'+e(item.slot||'Non renseigné')+'</strong></p><div class="rx-result-actions"><button type="button" class="rx-action" data-rx="print" data-id="'+e(item.id)+'">Imprimer l’étiquette</button><button type="button" class="rx-alt" data-rx="again">Nouvelle réception</button></div></section></div>';
 }
 const picked=db.catalog.find(p=>p.id===state.pid);
 const config=db.shelves?.find(x=>x.slot===state.slot);
 const n=state.slot?db.items.filter(i=>String(i.slot||'').split('-').slice(0,2).join('-')===state.slot).length:0;
 return '<div class="rx-root"><div class="rx-heading"><div class="rx-heading-content"><span class="rx-overline">MOUVEMENTS / RÉCEPTION</span><h1>Entrée en stock</h1><p>Renseignez le produit, choisissez son emplacement et validez la réception.</p></div><span class="rx-instruction">01 — Article &nbsp; / &nbsp; 02 — Rangement</span></div>'+
 '<div class="rx-columns"><section class="rx-panel rx-form"><div class="rx-section-head"><span class="rx-step">01</span><div><h2>Informations de l’article</h2><p>Recherchez un modèle déjà connu ou créez-en un nouveau directement.</p></div></div>'+
 '<div class="rx-field"><label for="rx-name">Nom du produit <b>*</b></label><div class="rx-search-wrap"><input id="rx-name" value="'+e(state.name)+'" autocomplete="off" maxlength="120" placeholder="Ex. TERRA Mobile 1517, souris Logitech, écran 24”..." spellcheck="false" /><span class="rx-search-glyph">⌕</span></div><div id="rx-suggestions" class="rx-suggestions">'+hint(db)+'</div>'+(picked?'<p class="rx-identified">✓ Référence existante · '+e(picked.ref)+'</p>':'')+'</div>'+
 '<div class="rx-fields-line"><div class="rx-field"><label for="rx-serial">Numéro de série <span>facultatif</span></label><input id="rx-serial" value="'+e(state.serial)+'" maxlength="100" autocomplete="off" placeholder="À laisser vide si inutile" /></div><div class="rx-field"><label>État de l’article</label><div class="rx-conditions">'+[['Neuf','Neuf'],['Retour SAV','Retour SAV'],['Réparation','Réparation']].map(([key,val])=>'<button type="button" class="'+(state.condition===key?'active':'')+'" data-rx="condition" data-value="'+key+'">'+e(val)+'</button>').join('')+'</div></div></div>'+
 '<div class="rx-info-strip"><span class="rx-info-icon">i</span>La création d’une nouvelle référence se fait automatiquement lors de la première entrée. Aucun numéro de série n’est obligatoire.</div>'+
 '<div class="rx-selected-box"><div><span class="rx-muted">Emplacement choisi</span><strong>'+e(state.slot||'Aucun emplacement')+'</strong></div><div><span class="rx-muted">Produits déjà sur ce niveau</span><strong>'+n+'</strong></div></div>'+
 '<button type="button" class="rx-action rx-submit" data-rx="save" '+(!state.name.trim()||state.saving?'disabled':'')+'>'+(state.saving?'Enregistrement…':'Enregistrer l’entrée et préparer l’étiquette')+'<span>→</span></button><p class="rx-form-footnote">Le stock sera actualisé immédiatement. L’impression peut être lancée juste après.</p></section>'+
 '<section class="rx-panel rx-location"><div class="rx-section-head"><span class="rx-step">02</span><div><h2>Choisir un emplacement</h2><p>Vue des rayonnages : 4 à gauche et 6 à droite. Cliquez sur un niveau.</p></div></div>'+
 '<div class="rx-plan-legend"><span><i class="rx-swatch"></i> Libre</span><span><i class="rx-swatch occupied"></i> Avec articles</span><span><i class="rx-swatch chosen"></i> Sélectionné</span></div>'+
 shelfPlan(db)+
 '<div class="rx-location-info"><div><span class="rx-muted">Niveau</span><strong>'+e(state.slot||'Non sélectionné')+'</strong></div><div><span class="rx-muted">Taille configurée</span><strong>'+e(config?sizes[config.size]||'À préciser':'—')+'</strong></div><div><span class="rx-muted">Articles présents</span><strong>'+n+'</strong></div></div>'+
 (config?.note?'<p class="rx-level-note">'+e(config.note)+'</p>':'')+
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
 if(action==='choose'){const p=db.catalog.find(p=>p.id===a.dataset.id);if(p){state.pid=p.id;state.name=cleanName(p);state.suggestions=false;if(p.preferred_slot&&!state.slot)state.slot=p.preferred_slot;ctx.renderContent()}}
 else if(action==='newproduct'){state.pid='';state.suggestions=false;ctx.renderContent()}
 else if(action==='slot'){state.slot=a.dataset.slot;ctx.renderContent()}
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
window.SPV3={entry,onInput,onClick,reset,selectSlot(slot){state.slot=slot}};
})();
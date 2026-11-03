/* StockPilot — réception simple avec recherche/création et code-barres individuel. */
(function(){
'use strict';
const esc=v=>String(v??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const name=p=>[p?.brand,p?.model].filter(Boolean).join(' ');
const TYPES=['Matériel','Ordinateur portable','Ordinateur fixe','Écran','Imprimante','Réseau','Périphérique','Téléphone / tablette','Composant','Autre'];
const TECH={
 'Ordinateur portable':[['cpu','Processeur','Ex. Intel Core i5-1235U'],['cores','Nombre de cœurs','Ex. 10'],['ram_gb','RAM (Go)','Ex. 16'],['storage','Stockage','Ex. SSD 512 Go'],['os','Système installé','Ex. Windows 11 Pro'],['gpu','Carte graphique','Ex. Intel Iris Xe']],
 'Ordinateur fixe':[['cpu','Processeur','Ex. AMD Ryzen 5'],['cores','Nombre de cœurs','Ex. 6'],['ram_gb','RAM (Go)','Ex. 16'],['storage','Stockage','Ex. SSD 1 To'],['os','Système installé','Ex. Windows 11 Pro'],['gpu','Carte graphique','Ex. RTX 4060']],
 'Écran':[['size_inches','Taille de l’écran','Ex. 24 pouces'],['resolution','Résolution','Ex. 1920 × 1080'],['connection','Connectiques','Ex. HDMI / DisplayPort']],
 'Imprimante':[['technology','Technologie','Ex. Laser couleur'],['connection','Connexion','Ex. USB / Ethernet']],
 'Réseau':[['mac','Adresse MAC','Ex. 00:11:22:33:44:55'],['ip','Adresse IP','Ex. 192.168.1.10'],['connection','Connexion','Ex. Wi-Fi / Ethernet']],
 'Périphérique':[['connection','Connexion','Ex. USB-C / Bluetooth']],
 'Téléphone / tablette':[['ram_gb','RAM (Go)','Ex. 8'],['storage','Stockage','Ex. 128 Go'],['os','Système','Ex. Android / iOS']],
 'Composant':[['model_detail','Précisions','Ex. DDR5 4800 MHz']]
};
const categoryOf=p=>{
 const raw=p?.cat||'Matériel';
 return ({'PC portable':'Ordinateur portable','PC fixe':'Ordinateur fixe','Ordinateur':'Ordinateur fixe',
  'Laptop':'Ordinateur portable','Moniteur':'Écran','Téléphone':'Téléphone / tablette'})[raw]||(TYPES.includes(raw)?raw:'Matériel');
};
const isPc=type=>type==='Ordinateur portable'||type==='Ordinateur fixe';
const blank=()=>({name:'',pid:'',category:'Matériel',serial:'',condition:'Neuf',prep_status:'not_required',specs:{},saving:false,suggestions:true,received:null});
let state=blank();
const choices=db=>{const needle=state.name.trim().toLocaleLowerCase('fr');return needle?db.catalog.filter(p=>p.active&&(name(p).toLocaleLowerCase('fr').includes(needle)||(p.ref||'').toLocaleLowerCase('fr').includes(needle))).slice(0,6):[]};
function hints(db){
 if(!state.name.trim()||!state.suggestions)return '';
 const matches=choices(db),exact=matches.some(p=>name(p).toLocaleLowerCase('fr')===state.name.trim().toLocaleLowerCase('fr'));
 return '<div class="basic-suggest-title">Références existantes</div>'+matches.map(p=>'<button type="button" class="basic-suggestion" data-rx="choose" data-id="'+esc(p.id)+'"><span class="basic-suggestion-icon">▣</span><span><strong>'+esc(name(p))+'</strong><small>'+esc(p.ref)+' · '+db.items.filter(i=>i.pid===p.id).length+' en stock</small></span><b>Choisir</b></button>').join('')+
 (!exact?'<button type="button" class="basic-create" data-rx="newproduct"><span>＋</span><div><strong>Créer « '+esc(state.name.trim())+' »</strong><small>Nouvelle référence ajoutée à la réception</small></div></button>':'');
}
function specsFields(category,specs={}){
 const fields=TECH[category]||[];
 if(!fields.length)return '';
 return '<section class="rx-tech"><div class="rx-tech-title"><strong>Caractéristiques '+(isPc(category)?'de l’ordinateur':'du matériel')+'</strong>'+
 '<small>Facultatif — vous pourrez compléter ces informations ultérieurement.</small></div>'+
 '<div class="rx-tech-grid">'+fields.map(([key,label,placeholder])=>
 '<div class="basic-field"><label for="rx-spec-'+key+'">'+esc(label)+'</label>'+
 '<input id="rx-spec-'+key+'" type="'+(['cores','ram_gb'].includes(key)?'number':'text')+'"'+
 (['cores','ram_gb'].includes(key)?' inputmode="numeric" min="1" step="1"':' maxlength="120"')+
 ' placeholder="'+esc(placeholder)+'" value="'+esc(specs[key]??'')+'"></div>').join('')+'</div></section>';
}
function prepButtons(status){
 return '<section class="rx-preparation"><div class="rx-tech-title"><strong>Préparation de l’ordinateur</strong>'+
 '<small>Vous pouvez compléter sa fiche technique après réception.</small></div>'+
 '<div class="rx-prep-choices" role="group" aria-label="État de préparation">'+
 [['pending','En attente'],['in_progress','En préparation'],['ready','Préparation terminée']].map(([key,text])=>
 '<button type="button" class="'+(status===key?'active':'')+'" data-rx="prep" data-value="'+key+'">'+text+'</button>').join('')+
 '</div></section>';
}
function entry(ctx){
 const db=ctx.db;
 if(state.received){
  const item=state.received,product=db.catalog.find(p=>p.id===item.pid);
  const prep=isPc(categoryOf(product))?'<p>Préparation : <strong>'+({'pending':'En attente','in_progress':'En préparation','ready':'Prête'})[item.prepStatus||'pending']+'</strong></p>':'';
  return '<div class="basic-entry"><div class="basic-entry-heading"><div><span>RÉCEPTION VALIDÉE</span><h1>Produit ajouté au stock</h1><p>L’article et son étiquette sont prêts.</p></div></div><section class="card basic-result"><div class="basic-result-icon">✓</div><h2>'+esc(product?name(product):state.name)+'</h2><p>Identifiant : <strong>'+esc(item.id)+'</strong></p><p>État : '+esc(item.condition||state.condition)+'</p>'+prep+'<div class="basic-result-actions"><button type="button" class="basic-btn primary" data-rx="print" data-id="'+esc(item.id)+'">Imprimer l’étiquette</button><button type="button" class="basic-btn" data-rx="again">Ajouter un autre produit</button></div></section></div>';
 }
 const p=db.catalog.find(p=>p.id===state.pid);
 const category=p?categoryOf(p):state.category;
 const typeOptions=TYPES.map(type=>'<option value="'+esc(type)+'"'+(type===category?' selected':'')+'>'+esc(type)+'</option>').join('');
 return '<div class="basic-entry"><div class="basic-entry-heading"><div><span>NOUVELLE RÉCEPTION</span><h1>Entrée en stock</h1><p>Enregistrez un article, puis imprimez son étiquette pour le retrouver au scanner.</p></div><span class="basic-entry-tag">Code-barres individuel</span></div><div class="basic-entry-grid"><section class="card basic-entry-form"><h2>Informations du produit</h2><p class="basic-intro">Choisissez une catégorie : les champs s’adaptent automatiquement au type d’article.</p>'+
 '<div class="basic-field"><label for="rx-category">Type de matériel *</label><select id="rx-category" class="rx-category-select">'+typeOptions+'</select></div>'+
 '<div class="basic-field"><label for="rx-name">Nom du produit *</label><input id="rx-name" maxlength="120" autocomplete="off" value="'+esc(state.name)+'" placeholder="Ex. TERRA Mobile 1517, souris Logitech…" /><div id="rx-suggestions" class="basic-suggestions">'+hints(db)+'</div>'+(p?'<span class="basic-reused">✓ Référence existante : '+esc(p.ref)+'</span>':'')+'</div>'+
 '<div class="basic-dual-fields"><div class="basic-field"><label for="rx-serial">Numéro de série <small>(facultatif)</small></label><input id="rx-serial" maxlength="100" autocomplete="off" value="'+esc(state.serial)+'" placeholder="À laisser vide si inutile"></div>'+
 '<div class="basic-field"><label>État de l’article</label><div class="basic-conditions">'+['Neuf','Retour SAV','Réparation'].map(c=>'<button type="button" data-rx="condition" data-value="'+esc(c)+'" class="'+(state.condition===c?'active':'')+'">'+esc(c)+'</button>').join('')+'</div></div></div>'+
 specsFields(category,state.specs)+(isPc(category)?prepButtons(state.prep_status):'')+
 '<div class="basic-info">Une étiquette unique sera générée après l’enregistrement. Les caractéristiques manquantes pourront être renseignées dans la fiche du stock.</div>'+
 '<button type="button" class="basic-submit" data-rx="save" '+(!state.name.trim()||state.saving?'disabled':'')+'>'+(state.saving?'Enregistrement…':'Enregistrer le produit')+' <span>→</span></button></section>'+
 '<section class="card basic-entry-help"><div class="basic-entry-help-head"><span class="basic-help-symbol">'+(ctx.ico?ctx.ico('barcode',24):'')+'</span><h2>Comment ça marche ?</h2></div><div class="basic-steps"><div><b>1</b><span><strong>Réceptionnez l’article</strong><small>Choisissez le type de matériel, son nom et les informations disponibles.</small></span></div><div><b>2</b><span><strong>Imprimez son étiquette</strong><small>Chaque unité obtient un identifiant unique et un QR code imprimable.</small></span></div><div><b>3</b><span><strong>Complétez sa préparation</strong><small>Les détails techniques inconnus à réception peuvent être ajoutés plus tard.</small></span></div></div><div class="basic-example-label"><div><strong>STOCKPILOT</strong><small>EXEMPLE D’ÉTIQUETTE</small></div><p>TERRA Mobile 1517</p><div class="basic-example-bottom"><span class="basic-example-bars" aria-hidden="true"></span><span>STK-000001<small>Scanner pour identifier</small></span></div></div></section></div></div>';
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
 if(ev.target.id?.startsWith('rx-spec-')){state.specs[ev.target.id.slice(8)]=ev.target.value;return true;}
 return false;
}
function onClick(ev,ctx){
 const el=ev.target.closest('[data-rx]');if(!el)return false;
 const action=el.dataset.rx,db=ctx.db;
 if(action==='choose'){const p=db.catalog.find(p=>p.id===el.dataset.id);if(p){state.name=name(p);state.pid=p.id;state.category=categoryOf(p);state.prep_status=isPc(state.category)?'pending':'not_required';state.specs={};state.suggestions=false;ctx.renderContent();}}
 else if(action==='newproduct'){state.pid='';state.suggestions=false;ctx.renderContent();}
 else if(action==='condition'){state.condition=el.dataset.value;ctx.renderContent();}
 else if(action==='prep'){state.prep_status=el.dataset.value;ctx.renderContent();}
 else if(action==='again'){state=blank();ctx.renderContent();}
 else if(action==='print'){ctx.printLabel(el.dataset.id);}
 else if(action==='save'){
  if(!state.name.trim()||state.saving)return true;
  state.saving=true;
  const data={name:state.name.trim(),product_id:state.pid,category:state.category,
   serial:state.serial.trim(),condition:state.condition,
   specs:state.specs,prep_status:isPc(state.category)?state.prep_status:'not_required'};
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
function reset(){state=blank();}
function prefill(product){
 state=blank();
 if(product){state.name=name(product);state.pid=product.id;state.category=categoryOf(product);
   state.prep_status=isPc(state.category)?'pending':'not_required';state.suggestions=false;}
}
function onChange(ev,ctx){
 if(ev.target.id!=='rx-category')return false;
 if(!TYPES.includes(ev.target.value))return true;
 state.category=ev.target.value;state.pid='';state.specs={};
 state.prep_status=isPc(state.category)?'pending':'not_required';
 state.suggestions=false;
 ctx.renderContent();
 return true;
}
window.SPV3={entry,onInput,onClick,onChange,reset,prefill,selectSlot(){}};
})();
/* StockPilot — mode inventaire et codes-barres, sans gestion d'emplacement. */
(function(){
'use strict';
const escape = v => String(v ?? '').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const name = p => p ? [p.brand,p.model].filter(Boolean).join(' ') : 'Produit inconnu';
const stamp = (ms) => ms ? new Date(ms).toLocaleString('fr-FR',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}) : '—';
const actionButton=(action,text,extra='')=>'<button type="button" class="basic-btn '+extra+'" data-action="'+action+'">'+text+'</button>';
function dashboard(c){
 const db=c.db, now=new Date(), today=new Date(now.getFullYear(),now.getMonth(),now.getDate());
 const movements=db.events.filter(e=>e.type==='in'||e.type==='out');
 const todayEvents=movements.filter(e=>new Date(e.at)>=today);
 const entries=todayEvents.filter(e=>e.type==='in').length, exits=todayEvents.filter(e=>e.type==='out').length;
 const refs=new Set(db.items.map(i=>i.pid)).size;
 const sav=db.items.filter(i=>(i.condition||'').toLowerCase().includes('sav')).length;
 const repair=db.items.filter(i=>(i.condition||'').toLowerCase().includes('réparation')).length;
 const total=db.items.length, num=n=>new Intl.NumberFormat('fr-FR').format(n);
 const metrics=[['Articles',total,'package'],['Références',refs,'layers'],['Entrées',entries,'in'],
  ['Sorties',exits,'out'],['Retour SAV',sav,'history'],['Réparation',repair,'wrench']];
 const metricHTML=metrics.map(([label,value,icon],i)=>
  '<div class="aur-metric" style="--seq:'+i+'"><span>'+label+'</span><div class="aur-metric-value"><strong>'+num(value)+'</strong>'+c.ico(icon,20)+'</div></div>').join('');
 const railList=[
  ['Réceptions du jour','Produits enregistrés',entries,'in','entry'],
  ['Sorties du jour','Articles retirés',exits,'out','history'],
  ['Articles à traiter','Retour SAV et réparation',sav+repair,'alert','products']
 ];
 const railHTML=railList.map(([title,subtitle,value,icon,target],i)=>
  '<button type="button" data-nav="'+target+'" class="aur-rail-mini aur-sheen" style="--seq:'+i+'">'+
  '<span><strong>'+title+'</strong><small>'+subtitle+'</small></span><span class="aur-rail-count">'+num(value)+c.ico(icon,21)+'</span></button>').join('');
 const days=[],counts=[];
 for(let n=6;n>=0;n--){
  const day=new Date(today);day.setDate(day.getDate()-n);
  const next=new Date(day);next.setDate(next.getDate()+1);
  counts.push(movements.filter(e=>{const at=new Date(e.at);return at>=day&&at<next}).length);
  days.push(day.toLocaleDateString('fr-FR',{weekday:'short'}).replace('.',''));
 }
 const max=Math.max(1,...counts),pts=counts.map((v,i)=>({x:i*150,y:153-(v/max)*82}));
 const line=pts.map((p,i)=>{if(!i)return 'M '+p.x+' '+p.y;
  const q=pts[i-1],mx=(p.x+q.x)/2;return ' C '+mx+' '+q.y+', '+mx+' '+p.y+', '+p.x+' '+p.y}).join('');
 const area=line+' L 900 220 L 0 220 Z';
 const week=counts.reduce((a,b)=>a+b,0);
 const chart='<svg viewBox="0 0 900 220" class="aur-wave" preserveAspectRatio="none" role="img" aria-label="'+week+' mouvements sur les sept derniers jours">'+
 '<defs><linearGradient id="aur-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stop-color="#f7ffff" stop-opacity=".39"/><stop offset="100%" stop-color="#e6f3f5" stop-opacity=".02"/></linearGradient></defs>'+
 '<path class="aur-wave-fill" d="'+area+'" fill="url(#aur-fill)"/>'+
 '<path class="aur-wave-glow" d="'+line+'" fill="none" stroke="#fff" stroke-width="10" opacity=".15"/>'+
 '<path class="aur-wave-main" d="'+line+'" fill="none" stroke="#fff" stroke-width="3.4" stroke-linecap="round" pathLength="1"/></svg>';
 const dayRow=days.map((d,i)=>'<span class="'+(i===6?'on':'')+'">'+escape(d)+'</span>').join('');
 return '<section class="aurora-dashboard" aria-label="Tableau de bord du stock">'+
 '<header class="aur-header"><div class="aur-welcome"><span>Bienvenue sur</span><strong>StockPilot</strong></div>'+
 '<div class="aur-tools"><button data-nav="entry" title="Nouvelle réception" aria-label="Nouvelle réception">'+c.ico('plus',23)+'</button>'+
 '<button data-nav="products" title="Rechercher" aria-label="Rechercher un article">'+c.ico('search',23)+'</button>'+
 '<button data-nav="history" title="Historique" aria-label="Voir les mouvements">'+c.ico('history',23)+'</button>'+
 '<button data-nav="settings" title="Mon compte" aria-label="Mon compte" class="aur-avatar">SP</button></div></header>'+
 '<div class="aur-copy"><span class="aur-chip aur-sheen">'+c.ico('package',17)+' Gestion des stocks</span>'+
 '<h1><span class="aur-headline"><span>Gestion du stock</span></span><span class="aur-headline"><span>centralisé</span></span></h1>'+
 '<p>Suivez vos produits, vos entrées, vos sorties et vos étiquettes en un seul endroit. Gardez une vision claire de votre stock et restez toujours à jour.</p></div>'+
 '<div class="aur-metrics" role="group" aria-label="Statistiques du stock">'+metricHTML+'</div>'+
 '<div class="aur-chart"><div class="aur-chart-label">'+c.ico('package',17)+' '+week+' mouvement'+(week>1?'s':'')+' en 7 jours</div>'+chart+
 '<div class="aur-days">'+dayRow+'</div></div>'+
 '<div class="aur-rail"><button type="button" data-nav="products" class="aur-rail-main aur-sheen"><div class="aur-rail-main-title">'+c.ico('package',23)+' <strong>Stock central</strong></div>'+
 '<div class="aur-primary-number">'+num(total)+'</div><div class="aur-primary-sub">article'+(total>1?'s':'')+' disponible'+(total>1?'s':'')+'</div>'+
 '<div class="aur-rail-mini-metrics"><div>'+c.ico('in',18)+'<strong>'+entries+'</strong><span>entrées</span></div>'+
 '<div>'+c.ico('out',18)+'<strong>'+exits+'</strong><span>sorties</span></div>'+
 '<div>'+c.ico('layers',18)+'<strong>'+refs+'</strong><span>réf.</span></div>'+
 '<div>'+c.ico('alert',18)+'<strong>'+(sav+repair)+'</strong><span>à traiter</span></div></div></button>'+railHTML+'</div>'+
 '<div class="aur-action-row"><button data-nav="entry">'+c.ico('in',18)+' Entrée en stock <span>→</span></button>'+
 '<button data-nav="exit">'+c.ico('barcode',18)+' Scanner une sortie <span>→</span></button>'+
 '<button data-nav="products">'+c.ico('package',18)+' Inventaire <span>→</span></button></div></section>';
}
function inventory(c){
 const search=(c.tableFilter||'').trim().toLocaleLowerCase('fr'),filter=c.tableStockFilter||'all';
 const cats=[...new Set(c.db.catalog.map(p=>p.cat).filter(Boolean))].sort();
 const byProduct=new Map();
 c.db.items.forEach(i=>{if(!byProduct.has(i.pid))byProduct.set(i.pid,[]);byProduct.get(i.pid).push(i)});
 const products=c.db.catalog.map(p=>{
  const units=byProduct.get(p.id)||[];
  const qty=units.filter(i=>!/(sav|répar|repar)/i.test(i.condition||'Neuf')).length;
  const min=Math.max(0,Number(p.min_stock)||0);
  return {p,units,qty,min,pending:units.length-qty,alert:p.active!==0&&min>0&&qty<=min};
 });
 const alerts=products.filter(x=>x.alert).length,total=products.reduce((sum,x)=>sum+x.qty,0);
 const visible=products.filter(x=>{
  if((c.tableType||'all')!=='all'&&c.tableType!==x.p.cat)return false;
  if(filter==='low'&&!x.alert)return false;
  if(filter==='in'&&x.qty===0)return false;
  return !search||[name(x.p),x.p.ref,x.p.cat,...x.units.flatMap(i=>[i.id,i.serial||''])].join(' ').toLocaleLowerCase('fr').includes(search);
 }).sort((a,b)=>Number(b.alert)-Number(a.alert)||name(a.p).localeCompare(name(b.p),'fr'));
 const seg=(value,label)=>'<button type="button" class="si-segment'+(filter===value?' is-selected':'')+
  '" data-action="stockfilter" data-status="'+value+'" aria-pressed="'+(filter===value)+'">'+label+'</button>';
 const rows=visible.map(x=>{
  const p=x.p,id=escape(p.id),q=x.qty,min=x.min;
  const status=min===0?'<span class="si-badge si-neutral">Sans alerte</span>':
   x.alert?'<span class="si-badge '+(q===0?'si-critical':'si-warning')+'">'+
    (q===0?'Rupture · à commander':'Stock faible · à commander')+'</span>':
    '<span class="si-badge si-safe">Stock suffisant</span>';
  const alertEditor=c.me?.role==='admin'?[
   '<section class="si-alert-editor" aria-label="Alerte pour '+escape(name(p))+'">',
   '<div class="si-alert-description"><strong>Alerte de réapprovisionnement</strong>',
   '<p>Facultative. Signaler cette référence quand la quantité atteint le minimum.</p></div>',
   '<label class="si-alert-toggle" for="si-alert-'+id+'"><input id="si-alert-'+id+'" type="checkbox"'+(min>0?' checked':'')+'><span>Activer</span></label>',
   '<div class="si-alert-controls" data-si-min="'+id+'"'+(min>0?'':' hidden')+'>',
   '<label for="si-min-'+id+'">Seuil minimum</label>',
   '<input id="si-min-'+id+'" type="number" min="1" max="99999" step="1" inputmode="numeric" value="'+(min||1)+'"></div>',
   '<button type="button" class="si-save" data-action="stockthreshold" data-id="'+id+'">Enregistrer</button></section>'
  ].join(''):'<p class="si-alert-readonly">'+(min>0?'Alerte activée à '+min+' unité'+(min>1?'s':'')+'.':'Aucune alerte configurée.')+'</p>';
  const unitList=x.units.length?[
   '<details class="si-units"><summary>Unités et étiquettes <span>'+x.units.length+'</span></summary>',
   '<div class="si-units-list">',
   ...x.units.slice().sort((a,b)=>(b.inAt||0)-(a.inAt||0)).map(i=>[
    '<div class="si-unit"><div><strong>'+escape(i.id)+'</strong><small>'+escape(i.serial||'Sans numéro de série')+
      ' · '+escape(i.condition||'Neuf')+'</small></div>',
    '<div class="si-unit-actions"><button type="button" data-action="details" data-id="'+escape(i.id)+'">Détails</button>',
    '<button type="button" data-action="print" data-id="'+escape(i.id)+'">Étiquette</button></div></div>'
   ].join('')),
   '</div></details>'
  ].join(''):'<p class="si-empty-units">Aucune unité enregistrée.</p>';
  return [
   '<details class="si-record'+(x.alert?' si-is-alert':'')+'" data-inventory-id="'+id+'">',
   '<summary class="si-record-summary">',
   '<span class="si-product"><strong>'+escape(name(p))+'</strong><small>'+escape(p.ref||'Sans référence')+
    (p.cat?' · '+escape(p.cat):'')+(x.pending?' · '+x.pending+' en SAV / réparation':'')+'</small></span>',
   '<span class="si-quantity"><b>'+q+'</b><small>disponible'+(q!==1?'s':'')+'</small></span>',
   '<span class="si-status">'+status+(min>0?'<small>Minimum : '+min+'</small>':'')+'</span>',
   '<span class="si-expand"><span>Détails</span><span class="si-chevron" aria-hidden="true"></span></span>',
   '</summary><div class="si-record-details">',
   '<div class="si-record-actions"><div><strong>Gestion du produit</strong><p>Réceptions, alertes et étiquettes.</p></div>',
   '<button type="button" class="si-receive" data-action="newentryproduct" data-id="'+id+'">+ Réceptionner</button></div>',
   alertEditor,unitList,'</div></details>'
  ].join('');
 }).join('');
 const summary=[
  '<div class="si-summary"><div class="si-summary-numbers">',
  '<span><strong>'+total+'</strong> unités disponibles</span><i aria-hidden="true"></i>',
  '<span><strong>'+products.length+'</strong> références</span></div>',
  alerts?'<button type="button" class="si-summary-alert" data-action="stockfilter" data-status="low">'+
   alerts+' alerte'+(alerts>1?'s':'')+' de stock</button>':
   '<span class="si-summary-clear">Aucune alerte active</span>',
  '</div>'
 ].join('');
 const toolbar=[
  '<div class="si-toolbar"><input id="filter-products" type="search" value="'+escape(c.tableFilter||'')+'" autocomplete="off"',
  ' placeholder="Rechercher un produit, une référence…" aria-label="Rechercher dans le stock">',
  '<select id="filter-type" aria-label="Filtrer par catégorie"><option value="all">Toutes les catégories</option>',
  ...cats.map(cat=>'<option value="'+escape(cat)+'"'+(c.tableType===cat?' selected':'')+'>'+escape(cat)+'</option>'),
  '</select></div>'
 ].join('');
 const tabs=[
  '<div class="si-controls"><div class="si-segments" role="group" aria-label="Filtrer le stock">',
  seg('all','Tous ('+products.length+')'),
  seg('low','À commander'+(alerts?' ('+alerts+')':'')),
  seg('in','Disponibles'),
  '</div><button type="button" class="si-export" data-action="exportstocksummary">Exporter CSV</button></div>'
 ].join('');
 return c.heading('INVENTAIRE','Produits en stock',
  'Consultez les quantités et définissez une alerte seulement si nécessaire.',
  c.btn('Nouvelle entrée','newentry','plus'))+
  '<section class="si-inventory" aria-label="Inventaire des produits">'+summary+toolbar+tabs+
  '<div class="si-list" aria-label="Références en stock">'+
  '<div class="si-columns" aria-hidden="true"><span>Produit</span><span>Disponible</span><span>Alerte</span><span></span></div>'+
  (rows||'<div class="si-empty">Aucun produit ne correspond à ces filtres.</div>')+'</div>'+
  '<footer class="si-footer">'+visible.length+' référence'+(visible.length>1?'s':'')+
  ' affichée'+(visible.length>1?'s':'')+'</footer></section>';
}
function history(c){
 const ev=[...c.db.events].filter(x=>x.type==='in'||x.type==='out').sort((a,b)=>b.at-a.at);
 return c.heading('TRAÇABILITÉ','Historique des mouvements','Toutes les entrées et sorties, avec la date et l’opérateur.',c.btn('Exporter le journal','exporthistory','arrow',''))+
 '<section class="card basic-table-card"><div class="table-wrap"><table class="slim-table basic-table"><thead><tr><th>Date</th><th>Mouvement</th><th>Produit</th><th>Identifiant</th><th>Opérateur</th></tr></thead><tbody>'+ (ev.length?ev.map(e=>'<tr><td>'+stamp(e.at)+'</td><td><span class="pill '+(e.type==='in'?'green':'red')+'">'+(e.type==='in'?'Entrée':'Sortie')+'</span></td><td>'+escape(name(c.product(e.pid)))+'</td><td class="basic-id">'+escape(e.itemId)+'</td><td>'+escape(e.actor)+'</td></tr>').join(''):'<tr><td colspan="5" class="basic-table-empty">Aucune entrée ni sortie enregistrée.</td></tr>')+'</tbody></table></div></section>';
}
function settings(c){
 const userCard='<section class="card settingscard"><h2>Mon compte</h2><p>Connecté : <strong>'+escape(c.me.username)+'</strong> · '+(c.me.role==='admin'?'Administrateur':'Employé')+'</p><form id="password-form"><div class="field"><label>Mot de passe actuel</label><input name="old_password" type="password" autocomplete="current-password" required></div><div class="field"><label>Nouveau mot de passe (12 caractères minimum)</label><input name="new_password" type="password" autocomplete="new-password" minlength="12" required></div><button class="btn primary" type="submit">Modifier mon mot de passe</button></form><p style="margin-top:18px"><a href="/logout">Se déconnecter</a></p></section>';
 const catalog='<section class="card settingscard"><h2>Références produits</h2><p>Les références peuvent aussi être créées directement lors d’une entrée en stock.</p><form id="catalog-form" class="catalog-form"><div class="twofields"><div class="field"><label>Marque *</label><input name="brand" maxlength="60" required placeholder="Ex. TERRA"></div><div class="field"><label>Modèle *</label><input name="model" maxlength="100" required placeholder="Ex. Mobile 1517"></div></div><div class="twofields"><div class="field"><label>Catégorie</label><select name="cat"><option>PC portable</option><option>PC fixe</option><option>Écran</option><option>Accessoire</option><option>Autre</option></select></div><div class="field"><label>Référence interne *</label><input name="ref" maxlength="80" required placeholder="Ex. TE-MOB1517"></div></div><div class="field"><label>Seuil d’alerte (0 = désactivé)</label><input name="min_stock" type="number" min="0" max="99999" step="1" inputmode="numeric" value="0" required></div><button class="btn primary" type="submit">Ajouter la référence</button></form><div class="basic-catalog">'+c.db.catalog.map(p=>'<div class="basic-catalog-row"><div><strong>'+escape(name(p))+'</strong><small>'+escape(p.ref)+(p.active?'':' · Désactivée')+'</small></div><button class="btn" type="button" data-action="editproduct" data-id="'+escape(p.id)+'">Modifier</button></div>').join('')+'</div></section>';
 const access='<section class="card settingscard"><h2>Accès employés</h2><p>Chaque opération est associée au compte qui l’a réalisée.</p><form id="user-form"><div class="field"><label>Identifiant</label><input name="username" maxlength="50" required placeholder="Ex. accueil1"></div><div class="field"><label>Mot de passe initial</label><input name="password" type="password" minlength="12" required></div><div class="field"><label>Rôle</label><select name="role"><option value="employee">Employé</option><option value="admin">Administrateur</option></select></div><button class="btn primary" type="submit">Créer un compte</button></form><div class="basic-management"><button class="btn" data-action="listusers">Gérer les utilisateurs</button><button class="btn" data-action="backup">Télécharger une sauvegarde</button></div><p>La base de données reste enregistrée dans le volume Docker du NAS.</p></section>';
 const labelSize=c.labelSize||'54x25';
 const labelCard='<section class="card settingscard sp-label-settings"><h2>Étiquettes DYMO LabelWriter 450</h2>'+
  '<p>Une seule étiquette par PDF, sans page blanche autour. Sélectionnez les dimensions inscrites sur votre rouleau DYMO.</p>'+
  '<div class="field"><label for="label-size">Format des étiquettes</label>'+
  '<select id="label-size"><option value="54x25"'+(labelSize==='54x25'?' selected':'')+'>54 × 25 mm · DYMO 11352</option>'+
  '<option value="57x32"'+(labelSize==='57x32'?' selected':'')+'>57 × 32 mm · DYMO 11354</option></select></div>'+
  '<p>Pour imprimer depuis le PC relié à la DYMO : papier du même format, échelle 100 %, marges à zéro, sans ajustement automatique.</p></section>';
 const installCard='<section class="card settingscard sp-mobile-install"><h2>Application mobile</h2><p>Installez StockPilot sur votre téléphone : les comptes, le stock et le scanner restent reliés au même serveur.</p><button class="btn primary" type="button" data-action="installapp">Installer StockPilot</button><p class="sp-install-steps"><strong>iPhone :</strong> ouvrez le site dans Safari, touchez Partager puis « Sur l’écran d’accueil ».<br><strong>Android :</strong> ouvrez le site dans Chrome, menu ⋮ puis « Installer l’application ».</p></section>';
 const cleanup='<section class="card settingscard basic-danger"><h2>Réinitialisation du stock</h2><p>Cette action efface l’inventaire, le catalogue et l’historique. Une sauvegarde est créée avant toute suppression. Ne l’utilisez pas pour simplement retirer un produit.</p><button type="button" class="btn negative" data-action="clearstock">Vider totalement le stock</button></section>';
 return c.heading('PARAMÈTRES','Configuration','Gérez les références, les utilisateurs et les accès au stock.')+'<div class="settings-board"><div class="settings-column">'+userCard+labelCard+installCard+(c.me.role==='admin'?access:'')+'</div>'+(c.me.role==='admin'?'<div class="settings-column">'+catalog+cleanup+'</div>':'')+'</div>';
}
function exit(c){
 const i=c.scanResult&&c.itemById(c.scanResult.id),p=i&&c.product(i.pid);
 const card=i?'<div class="productpick"><div class="prodicon">'+c.ico(p?.kind||'package',25)+'</div><div><strong>'+escape(name(p))+'</strong><small>'+escape(i.id)+' · '+escape(p?.ref||'')+'</small></div></div><div class="basic-scanned"><div><span>Numéro de série</span><strong>'+escape(i.serial||'Non renseigné')+'</strong></div><div><span>État</span><strong>'+escape(i.condition||'Neuf')+'</strong></div></div><button class="btn negative full" data-action="confirmout" data-id="'+escape(i.id)+'">'+c.ico('out',18)+' Confirmer la sortie du stock</button>':'<div class="basic-scan-empty">'+c.ico('package',34)+'<p>Aucun article scanné pour le moment.</p></div>';
 return c.heading('SORTIE DU STOCK','Scanner une étiquette','Scannez le code-barres ou le QR code d’un article pour le retirer de l’inventaire.')+
 '<div class="flowgrid"><section class="card formcard"><h2>Scanner un article</h2><p class="intro">Utilisez une douchette USB/Bluetooth, votre caméra ou saisissez l’identifiant manuellement.</p><div class="scan-panel" id="scan-panel">'+c.ico('barcode',55)+'<strong>Prêt pour un scan</strong><p>Exemple : STK-000001</p></div><div class="basic-scan-buttons"><button class="btn" data-action="camera">'+c.ico('camera',17)+' Activer la caméra</button></div><label for="scan-code">Identifiant du produit</label><div class="scan-input"><input id="scan-code" placeholder="STK-000001" autocomplete="off"><button class="btn primary" data-action="lookup">Rechercher</button></div></section>'+
 '<section class="card formcard"><h2>Produit identifié</h2><p class="intro">Vérifiez le produit avant de confirmer la sortie.</p>'+card+'<div class="basic-manual-list"><h3>Derniers articles en stock</h3>'+c.db.items.slice(-7).reverse().map(i=>'<button type="button" data-action="selectscan" data-id="'+escape(i.id)+'"><span>'+escape(name(c.product(i.pid)))+'</span><strong>'+escape(i.id)+'</strong></button>').join('')+'</div></section></div>';
}
function detailModal(c){
 const i=c.itemById(c.modal?.id);if(!i)return '';
 const p=c.product(i.pid);
 return '<div class="overlay" data-action="backdrop"><div class="modal" role="dialog" aria-modal="true" aria-label="Détails produit"><div class="modal-head"><h2>Détail de l’article</h2><button class="closebtn" data-action="closemodal">×</button></div><div class="modal-body"><div class="productpick"><div class="prodicon">'+c.ico(p?.kind||'package',23)+'</div><div><strong>'+escape(name(p))+'</strong><small>'+escape(p?.ref||'')+'</small></div></div><div class="basic-scanned"><div><span>Identifiant</span><strong>'+escape(i.id)+'</strong></div><div><span>Numéro de série</span><strong>'+escape(i.serial||'Non renseigné')+'</strong></div><div><span>État</span><strong>'+escape(i.condition||'Neuf')+'</strong></div><div><span>Entrée</span><strong>'+stamp(i.inAt)+'</strong></div></div></div><div class="modal-foot"><button class="btn" data-action="print" data-id="'+escape(i.id)+'">Imprimer l’étiquette</button><button class="btn negative" data-action="outfrommodal" data-id="'+escape(i.id)+'">Sortir du stock</button><button class="btn" data-action="closemodal">Fermer</button></div></div></div>';
}
function editModal(c){
 const p=c.product(c.modal?.id);if(!p)return '';
 return '<div class="overlay" data-action="backdrop"><div class="modal" role="dialog" aria-modal="true"><div class="modal-head"><h2>Modifier une référence</h2><button class="closebtn" data-action="closemodal">×</button></div><form id="edit-product-form" data-id="'+escape(p.id)+'"><div class="modal-body"><div class="field"><label>Marque</label><input name="brand" required value="'+escape(p.brand)+'"></div><div class="field"><label>Modèle</label><input name="model" required value="'+escape(p.model)+'"></div><div class="field"><label>Catégorie</label><input name="cat" required value="'+escape(p.cat)+'"></div><div class="field"><label>Référence</label><input name="ref" required value="'+escape(p.ref)+'"></div><div class="field"><label>Seuil d’alerte (0 = désactivé)</label><input name="min_stock" type="number" min="0" max="99999" step="1" inputmode="numeric" required value="'+(Number(p.min_stock)||0)+'"></div><label><input type="checkbox" name="active" '+(p.active?'checked':'')+'> Référence active</label></div><div class="modal-foot"><button class="btn" type="button" data-action="closemodal">Annuler</button><button class="btn primary" type="submit">Enregistrer</button></div></form></div></div>';
}
window.SPBasic={dashboard,inventory,history,settings,exit,detailModal,editModal};
})();
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
 const filter=(c.tableFilter||'').toLocaleLowerCase('fr');
 const rows=c.db.items.filter(i=>{const p=c.product(i.pid),v=[name(p),i.id,i.serial||'',p?.ref||'',p?.cat||''].join(' ').toLocaleLowerCase('fr');return v.includes(filter)&&(c.tableType==='all'||c.tableType===p?.cat)}).sort((a,b)=>b.inAt-a.inAt);
 const categories=[...new Set(c.db.catalog.map(p=>p.cat).filter(Boolean))].sort();
 return c.heading('INVENTAIRE','Produits en stock','Recherchez vos articles et réimprimez les étiquettes si nécessaire.',c.btn('Nouvelle entrée','newentry','plus'))+
 '<section class="card basic-table-card"><div class="cardhead"><div><h2>Inventaire actuel</h2><p>'+rows.length+' article(s) disponible(s).</p></div><button class="more" data-action="export">Exporter CSV</button></div>'+
 '<div class="basic-filters"><input id="filter-products" value="'+escape(c.tableFilter)+'" placeholder="Rechercher un produit, une référence, un numéro de série…" autocomplete="off"/><select id="filter-type"><option value="all">Toutes les catégories</option>'+categories.map(cat=>'<option value="'+escape(cat)+'"'+(c.tableType===cat?' selected':'')+'>'+escape(cat)+'</option>').join('')+'</select></div>'+
 '<div class="table-wrap"><table class="slim-table basic-table"><thead><tr><th>Produit</th><th>Identifiant</th><th>N° de série</th><th>État</th><th>Entrée le</th><th></th></tr></thead><tbody>'+
 (rows.length?rows.map(i=>{const p=c.product(i.pid);return '<tr class="clickrow" data-action="details" data-id="'+escape(i.id)+'"><td><strong>'+escape(name(p))+'</strong><small>'+escape(p?.ref||'')+'</small></td><td class="basic-id">'+escape(i.id)+'</td><td>'+escape(i.serial||'—')+'</td><td>'+escape(i.condition||'Neuf')+'</td><td>'+stamp(i.inAt)+'</td><td><button class="linkbtn" data-action="details" data-id="'+escape(i.id)+'">Voir →</button></td></tr>'}).join(''):'<tr><td colspan="6" class="basic-table-empty">Aucun article en stock pour cette recherche.</td></tr>')+'</tbody></table></div></section>';
}
function history(c){
 const ev=[...c.db.events].filter(x=>x.type==='in'||x.type==='out').sort((a,b)=>b.at-a.at);
 return c.heading('TRAÇABILITÉ','Historique des mouvements','Toutes les entrées et sorties, avec la date et l’opérateur.',c.btn('Exporter le journal','exporthistory','arrow',''))+
 '<section class="card basic-table-card"><div class="table-wrap"><table class="slim-table basic-table"><thead><tr><th>Date</th><th>Mouvement</th><th>Produit</th><th>Identifiant</th><th>Opérateur</th></tr></thead><tbody>'+ (ev.length?ev.map(e=>'<tr><td>'+stamp(e.at)+'</td><td><span class="pill '+(e.type==='in'?'green':'red')+'">'+(e.type==='in'?'Entrée':'Sortie')+'</span></td><td>'+escape(name(c.product(e.pid)))+'</td><td class="basic-id">'+escape(e.itemId)+'</td><td>'+escape(e.actor)+'</td></tr>').join(''):'<tr><td colspan="5" class="basic-table-empty">Aucune entrée ni sortie enregistrée.</td></tr>')+'</tbody></table></div></section>';
}
function settings(c){
 const userCard='<section class="card settingscard"><h2>Mon compte</h2><p>Connecté : <strong>'+escape(c.me.username)+'</strong> · '+(c.me.role==='admin'?'Administrateur':'Employé')+'</p><form id="password-form"><div class="field"><label>Mot de passe actuel</label><input name="old_password" type="password" autocomplete="current-password" required></div><div class="field"><label>Nouveau mot de passe (12 caractères minimum)</label><input name="new_password" type="password" autocomplete="new-password" minlength="12" required></div><button class="btn primary" type="submit">Modifier mon mot de passe</button></form><p style="margin-top:18px"><a href="/logout">Se déconnecter</a></p></section>';
 const catalog='<section class="card settingscard"><h2>Références produits</h2><p>Les références peuvent aussi être créées directement lors d’une entrée en stock.</p><form id="catalog-form" class="catalog-form"><div class="twofields"><div class="field"><label>Marque *</label><input name="brand" maxlength="60" required placeholder="Ex. TERRA"></div><div class="field"><label>Modèle *</label><input name="model" maxlength="100" required placeholder="Ex. Mobile 1517"></div></div><div class="twofields"><div class="field"><label>Catégorie</label><select name="cat"><option>PC portable</option><option>PC fixe</option><option>Écran</option><option>Accessoire</option><option>Autre</option></select></div><div class="field"><label>Référence interne *</label><input name="ref" maxlength="80" required placeholder="Ex. TE-MOB1517"></div></div><button class="btn primary" type="submit">Ajouter la référence</button></form><div class="basic-catalog">'+c.db.catalog.map(p=>'<div class="basic-catalog-row"><div><strong>'+escape(name(p))+'</strong><small>'+escape(p.ref)+(p.active?'':' · Désactivée')+'</small></div><button class="btn" type="button" data-action="editproduct" data-id="'+escape(p.id)+'">Modifier</button></div>').join('')+'</div></section>';
 const access='<section class="card settingscard"><h2>Accès employés</h2><p>Chaque opération est associée au compte qui l’a réalisée.</p><form id="user-form"><div class="field"><label>Identifiant</label><input name="username" maxlength="50" required placeholder="Ex. accueil1"></div><div class="field"><label>Mot de passe initial</label><input name="password" type="password" minlength="12" required></div><div class="field"><label>Rôle</label><select name="role"><option value="employee">Employé</option><option value="admin">Administrateur</option></select></div><button class="btn primary" type="submit">Créer un compte</button></form><div class="basic-management"><button class="btn" data-action="listusers">Gérer les utilisateurs</button><button class="btn" data-action="backup">Télécharger une sauvegarde</button></div><p>La base de données reste enregistrée dans le volume Docker du NAS.</p></section>';
 const cleanup='<section class="card settingscard basic-danger"><h2>Réinitialisation du stock</h2><p>Cette action efface l’inventaire, le catalogue et l’historique. Une sauvegarde est créée avant toute suppression. Ne l’utilisez pas pour simplement retirer un produit.</p><button type="button" class="btn negative" data-action="clearstock">Vider totalement le stock</button></section>';
 return c.heading('PARAMÈTRES','Configuration','Gérez les références, les utilisateurs et les accès au stock.')+'<div class="settings-board"><div class="settings-column">'+userCard+(c.me.role==='admin'?access:'')+'</div>'+(c.me.role==='admin'?'<div class="settings-column">'+catalog+cleanup+'</div>':'')+'</div>';
}
function exit(c){
 const i=c.scanResult&&c.itemById(c.scanResult.id),p=i&&c.product(i.pid);
 const card=i?'<div class="productpick"><div class="prodicon">'+c.ico(p?.kind||'package',25)+'</div><div><strong>'+escape(name(p))+'</strong><small>'+escape(i.id)+' · '+escape(p?.ref||'')+'</small></div></div><div class="basic-scanned"><div><span>Numéro de série</span><strong>'+escape(i.serial||'Non renseigné')+'</strong></div><div><span>État</span><strong>'+escape(i.condition||'Neuf')+'</strong></div></div><button class="btn negative full" data-action="confirmout" data-id="'+escape(i.id)+'">'+c.ico('out',18)+' Confirmer la sortie du stock</button>':'<div class="basic-scan-empty">'+c.ico('package',34)+'<p>Aucun article scanné pour le moment.</p></div>';
 return c.heading('SORTIE DU STOCK','Scanner une étiquette','Scannez le code-barres ou le QR code d’un article pour le retirer de l’inventaire.')+
 '<div class="flowgrid"><section class="card formcard"><h2>Scanner un article</h2><p class="intro">Utilisez une douchette USB/Bluetooth, votre caméra ou saisissez l’identifiant manuellement.</p><div class="scan-panel" id="scan-panel">'+c.ico('barcode',55)+'<strong>Prêt pour un scan</strong><p>Exemple : STK-000001</p></div><div class="basic-scan-buttons"><button class="btn" data-action="camera">'+c.ico('camera',17)+' Activer la caméra</button><button class="btn" data-action="sample">'+c.ico('check',17)+' Sélectionner le dernier article</button></div><label for="scan-code">Identifiant du produit</label><div class="scan-input"><input id="scan-code" placeholder="STK-000001" autocomplete="off"><button class="btn primary" data-action="lookup">Rechercher</button></div></section>'+
 '<section class="card formcard"><h2>Produit identifié</h2><p class="intro">Vérifiez le produit avant de confirmer la sortie.</p>'+card+'<div class="basic-manual-list"><h3>Derniers articles en stock</h3>'+c.db.items.slice(-7).reverse().map(i=>'<button type="button" data-action="selectscan" data-id="'+escape(i.id)+'"><span>'+escape(name(c.product(i.pid)))+'</span><strong>'+escape(i.id)+'</strong></button>').join('')+'</div></section></div>';
}
function detailModal(c){
 const i=c.itemById(c.modal?.id);if(!i)return '';
 const p=c.product(i.pid);
 return '<div class="overlay" data-action="backdrop"><div class="modal" role="dialog" aria-modal="true" aria-label="Détails produit"><div class="modal-head"><h2>Détail de l’article</h2><button class="closebtn" data-action="closemodal">×</button></div><div class="modal-body"><div class="productpick"><div class="prodicon">'+c.ico(p?.kind||'package',23)+'</div><div><strong>'+escape(name(p))+'</strong><small>'+escape(p?.ref||'')+'</small></div></div><div class="basic-scanned"><div><span>Identifiant</span><strong>'+escape(i.id)+'</strong></div><div><span>Numéro de série</span><strong>'+escape(i.serial||'Non renseigné')+'</strong></div><div><span>État</span><strong>'+escape(i.condition||'Neuf')+'</strong></div><div><span>Entrée</span><strong>'+stamp(i.inAt)+'</strong></div></div></div><div class="modal-foot"><button class="btn" data-action="print" data-id="'+escape(i.id)+'">Imprimer l’étiquette</button><button class="btn negative" data-action="outfrommodal" data-id="'+escape(i.id)+'">Sortir du stock</button><button class="btn" data-action="closemodal">Fermer</button></div></div></div>';
}
function editModal(c){
 const p=c.product(c.modal?.id);if(!p)return '';
 return '<div class="overlay" data-action="backdrop"><div class="modal" role="dialog" aria-modal="true"><div class="modal-head"><h2>Modifier une référence</h2><button class="closebtn" data-action="closemodal">×</button></div><form id="edit-product-form" data-id="'+escape(p.id)+'"><div class="modal-body"><div class="field"><label>Marque</label><input name="brand" required value="'+escape(p.brand)+'"></div><div class="field"><label>Modèle</label><input name="model" required value="'+escape(p.model)+'"></div><div class="field"><label>Catégorie</label><input name="cat" required value="'+escape(p.cat)+'"></div><div class="field"><label>Référence</label><input name="ref" required value="'+escape(p.ref)+'"></div><label><input type="checkbox" name="active" '+(p.active?'checked':'')+'> Référence active</label></div><div class="modal-foot"><button class="btn" type="button" data-action="closemodal">Annuler</button><button class="btn primary" type="submit">Enregistrer</button></div></form></div></div>';
}
window.SPBasic={dashboard,inventory,history,settings,exit,detailModal,editModal};
})();
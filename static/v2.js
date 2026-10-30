
/* StockPilot — Composants visuels v2 pour une réserve à couloir central */
(function(){
'use strict';
const escapeHTML = v => String(v == null ? '' : v).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const shelfKey = slot => String(slot || '').split('-').slice(0, 2).join('-');
const qty = (items, slot) => items.filter(item => shelfKey(item.slot) === slot).length;
const h = (tag, cls, contents) => '<'+tag+' class="'+cls+'">'+contents+'</'+tag+'>';
const badge = (text) => '<span class="room-badge">'+escapeHTML(text)+'</span>';
function room(c) {
  const renderRack = z => {
    const stockCount = c.db.items.filter(i => i.slot && i.slot[0] === z.id).length;
    const levels = [1,2,3,4].map(n => {
      const slot = z.id+'-'+n;
      const count = qty(c.db.items,slot);
      const selected = c.selectedSlot===slot ? ' selected' : '';
      const filled = count ? ' filled' : '';
      return '<button type="button" class="room-level'+filled+selected+'" data-slot="'+slot+'" aria-label="Étagère '+z.id+', niveau '+n+', '+count+' produits" title="Étagère '+z.id+' · Niveau '+n+' · '+count+' produits"><strong>'+n+'</strong><small>'+count+' art.</small></button>';
    }).join('');
    return '<div class="room-rack"><div class="room-rack-head"><span class="room-rack-letter">'+z.id+'</span><span class="room-rack-name">'+escapeHTML(z.label)+'</span><span class="room-rack-sub">'+stockCount+' art.</span></div><div class="room-levels">'+levels+'</div></div>';
  };
  const left = c.ZONES.slice(0,3).map(renderRack).join('');
  const right = c.ZONES.slice(3,6).map(renderRack).join('');
  return '<div class="room-layout"><div class="room-top-label">Mur du fond · Petite réserve</div><div class="room-plan"><div class="room-side">'+left+'</div><div class="room-aisle"><span>COULOIR</span></div><div class="room-side">'+right+'</div></div><div class="room-door">ENTRÉE DEPUIS LE MAGASIN</div></div>';
}
function dashboard(c){
  const count = c.db.items.length;
  const localized = c.db.items.filter(i => Boolean(i.slot)).length;
  const refs = new Set(c.db.items.map(i => i.pid)).size;
  const today = new Date().toDateString();
  const mov = c.db.events.filter(e => new Date(e.at).toDateString()===today).length;
  const mode = c.locationMode==='guided'?'Rangement guidé':'Suivi simplifié';
  const header = c.heading('ESPACE MAGASIN','Votre stock, en un coup d’œil','Un espace clair pour réceptionner, retrouver et sortir chaque matériel.',c.btn('Réceptionner un produit','newentry','plus'));
  const kpis = '<div class="kpis">'+c.stat('Produits en stock',count,'unités disponibles','package','blue')+c.stat('Modèles présents',refs,'références différentes','layers','purple')+c.stat('Produits localisés',localized,count-localized+' à ranger ou sans emplacement','pin','green')+c.stat('Mouvements du jour',mov,'opérations enregistrées','history','orange')+'</div>';
  const introduction = '<div class="guidebar">'+c.ico('check',18)+' <span><strong>'+mode+'</strong> · Le suivi fonctionne avec ou sans emplacement physique. '+(c.locationMode==='optional'?'Vous pourrez organiser les étagères au fur et à mesure.':'Une étagère est demandée à chaque nouvelle entrée.')+'</span></div>';
  const panels = '<div class="two-col"><section class="card mapcard"><div class="cardhead"><div><h2>Votre réserve, vue de dessus</h2><p>Un couloir central, deux rangées d’étagères</p></div><button class="more" data-nav="map">Explorer le plan →</button></div>'+c.renderMap('mini')+'<div class="room-legend"><span class="is-full"><i></i>Niveau utilisé</span><span class="is-selected"><i></i>Sélection</span><span><i></i>Sans article</span></div></section><section class="card"><div class="cardhead"><div><h2>Activité récente</h2><p>Les dernières opérations de l’équipe</p></div><button class="more" data-nav="history">Historique →</button></div><div style="margin-top:11px">'+c.eventsRows(6)+'</div></section></div>';
  const actions='<div class="quickactions"><button class="card quickaction" data-action="newentry"><div class="qico">'+c.ico('in',21)+'</div><span><strong>Nouvelle réception</strong><small>Enregistrer et étiqueter un produit</small></span><span class="arr">'+c.ico('chev')+'</span></button><button class="card quickaction" data-action="goexit"><div class="qico" style="background:#fff1f2;color:#dc5262">'+c.ico('barcode',21)+'</div><span><strong>Sortir un produit</strong><small>Scanner son étiquette</small></span><span class="arr">'+c.ico('chev')+'</span></button><button class="card quickaction" data-nav="products"><div class="qico" style="background:#ebfaf4;color:#099879">'+c.ico('search',21)+'</div><span><strong>Chercher un article</strong><small>Modèle, référence ou numéro de série</small></span><span class="arr">'+c.ico('chev')+'</span></button></div>';
  return header+introduction+kpis+panels+actions;
}
function entry(c){
  const p=c.product(c.selectedProduct)||c.db.catalog.find(x=>x.active);
  if(!p) return c.heading('RÉCEPTION','Aucune référence disponible','Ajoutez une référence dans Configuration.')+'<button class="btn primary" data-nav="settings">Configurer une référence</button>';
  const recommended=c.firstFree(p.zone);
  const slot = c.chosenSlot===null ? (c.locationMode==='guided'?recommended:'') : c.chosenSlot;
  if(c.lastAdded){
    const item=c.lastAdded, ip=c.product(item.pid);
    const text=item.slot ? 'Produit enregistré et localisé. Vous pouvez maintenant l’étiqueter.' : 'Produit enregistré. Vous pourrez lui affecter une étagère plus tard.';
    return c.heading('RÉCEPTION TERMINÉE','Produit ajouté au stock','Une nouvelle unité est maintenant disponible.',c.btn('Nouvelle entrée','newentry','plus',''))+
    '<section class="card formcard success-page"><div class="success-icon">'+c.ico('check',34)+'</div><h2>Réception enregistrée</h2><p>'+text+'</p><div class="reco"><div class="recohead">'+c.ico('pin',16)+' Localisation</div><h3>'+escapeHTML(c.pretty(item.slot))+'</h3><p>'+escapeHTML(c.displayName(ip))+' · '+escapeHTML(item.id)+'</p></div>'+c.renderLabel(item)+
    '<div style="display:flex;gap:9px;flex-wrap:wrap"><button class="btn primary" data-action="print" data-id="'+escapeHTML(item.id)+'">'+c.ico('printer',16)+' Imprimer l’étiquette</button><button class="btn" data-action="newentry">'+c.ico('plus',16)+' Ajouter un autre produit</button><button class="btn" data-nav="products">Ouvrir le stock</button></div></section>';
  }
  const selection = '<option value=""'+(slot===''?' selected':'')+(c.locationMode==='guided'?' disabled':'')+'>— Aucun emplacement pour le moment —</option>'+
    c.ALLSLOTS.map(s=>'<option value="'+s+'"'+(s===slot?' selected':'')+'>'+escapeHTML(c.pretty(s))+' · '+qty(c.db.items,s)+' article(s)'+(s[0]===p.zone?' · conseillé':'')+'</option>').join('');
  const modeHint=c.locationMode==='optional'?'La localisation est facultative. Vous pourrez renseigner l’étagère lorsque la réserve sera organisée.':'Le rangement guidé est activé : sélectionnez un niveau avant de valider.';
  const main='<section class="card formcard"><div class="eyebrow">NOUVELLE RÉCEPTION</div><h2>Informations du produit</h2><p class="intro">Sélectionnez la référence et enregistrez l’appareil. Le numéro de série reste facultatif.</p>'+
    '<div class="field"><label for="product-select">Marque et modèle *</label><select id="product-select">'+c.db.catalog.filter(x=>x.active).map(x=>'<option value="'+escapeHTML(x.id)+'"'+(x.id===p.id?' selected':'')+'>'+escapeHTML(c.displayName(x))+' · '+escapeHTML(x.cat)+'</option>').join('')+'</select><div class="productpick"><div class="prodicon">'+c.ico(p.kind,25)+'</div><div><strong>'+escapeHTML(c.displayName(p))+'</strong><small>Référence '+escapeHTML(p.ref)+'</small></div></div></div>'+
    '<div class="twofields"><div class="field"><label for="serial-in">Numéro de série</label><input id="serial-in" maxlength="100" placeholder="Ex. CND3412ABC" autocomplete="off" value="'+escapeHTML(c.formSerial)+'"></div><div class="field"><label for="condition-in">État</label><select id="condition-in">'+['Neuf','Reconditionné','Occasion','Retour SAV'].map(v=>'<option'+(v===c.formCondition?' selected':'')+'>'+v+'</option>').join('')+'</select></div></div>'+
    '<div class="field"><label for="slot-in">Emplacement'+(c.locationMode==='guided'?' *':' (facultatif)')+'</label><select id="slot-in">'+selection+'</select></div>'+
    '<div class="hint">'+c.ico('info',15)+' '+modeHint+'</div><div style="margin-top:22px">'+c.btn('Enregistrer et créer l’étiquette','saveentry','check','primary full')+'</div></section>';
  const helper='<section><div class="card formcard" style="margin-bottom:15px"><div class="eyebrow">PLAN DE LA RÉSERVE</div><h2>Repérage des étagères</h2><p class="intro">A, B et C à gauche · D, E et F à droite. Chaque étagère a 4 niveaux.</p><div class="reco"><div class="recohead">'+c.ico('pin',16)+' '+(slot?'Emplacement choisi':'Suggestion de rangement')+'</div><h3>'+escapeHTML(c.pretty(slot || recommended))+'</h3><p>'+(slot?'Vous pouvez sélectionner un autre niveau sur le plan.':'Optionnel pour cette réception. Zone conseillée : '+escapeHTML(p.zone))+'</p></div>'+c.renderMap('mini')+'<p class="room-note">Un niveau peut contenir plusieurs produits, sans limite artificielle.</p></div><div class="card formcard"><div style="display:flex;align-items:center;gap:12px"><div class="icbox blue">'+c.ico('printer')+'</div><div><strong>Étiquette avec QR code</strong><div style="font-size:11px;color:#8794a7;margin-top:4px">Prête à imprimer après validation.</div></div></div></div></section>';
  return c.heading('ENTRÉE EN STOCK','Réceptionner un produit','Un formulaire rapide, même si l’emplacement n’est pas encore connu.',c.btn('Voir la réserve','gomap','layers',''))+'<div class="flowgrid">'+main+helper+'</div>';
}
function mapPage(c){
  const rack=c.ZONES.find(z=>z.id===String(c.selectedSlot).slice(0,1))||c.ZONES[0];
  const selected = c.ALLSLOTS.includes(c.selectedSlot)?c.selectedSlot:rack.id+'-1';
  const products=c.db.items.filter(i=>shelfKey(i.slot)===selected);
  const unlocated=c.db.items.filter(i=>!i.slot).length;
  const front=c.heading('EMPLACEMENTS','La réserve','Une petite pièce avec un couloir central : cliquez sur un niveau pour consulter son contenu.',c.btn('Réceptionner','newentry','in'));
  const map='<section class="card mapcard"><div class="cardhead"><div><h2>Plan de dessus · Réserve magasin</h2><p>Étagères A–F · Niveaux 1 à 4</p></div>'+badge(c.ALLSLOTS.length+' niveaux repérés')+'</div>'+c.renderMap('full')+'<div class="room-legend"><span class="is-full"><i></i>Avec produits</span><span class="is-selected"><i></i>Sélectionné</span><span><i></i>Sans article</span></div><p class="room-note">Plan indicatif pour la démonstration : vous pourrez adapter les lettres et les étagères à la pièce réelle.</p></section>';
  const details='<section class="card mapdetail" style="padding:22px"><div class="eyebrow">DÉTAIL DE L’ÉTAGÈRE</div><h2 style="font-size:24px;margin:8px 0 7px">'+escapeHTML(c.pretty(selected))+'</h2><p class="intro">'+escapeHTML(rack.label)+' · '+products.length+' article(s) sur ce niveau</p><div class="zonechips">'+c.ZONES.map(z=>'<button class="zonechip'+(z.id===rack.id?' active':'')+'" data-action="zone" data-zone="'+z.id+'">Étagère '+z.id+'</button>').join('')+'</div>'+
    '<div class="shelfcard">'+[1,2,3,4].map(n=>{const sl=rack.id+'-'+n;return '<button class="shelf-cell'+(sl===selected?' chosen':'')+(qty(c.db.items,sl)?' full':'')+'" data-slot="'+sl+'" style="min-height:46px;flex:1">'+n+'<small style="display:block;font-size:9px">'+qty(c.db.items,sl)+'</small></button>'}).join('')+'</div>'+
    '<div class="slotdetail"><h3>'+products.length+' produit(s) présents</h3>'+(products.length?products.slice(0,8).map(i=>'<div class="room-list-item"><div><strong>'+escapeHTML(c.displayName(c.product(i.pid)))+'</strong><small>'+escapeHTML(i.id)+'</small></div><button class="btn" data-action="details" data-id="'+escapeHTML(i.id)+'">Voir</button></div>').join('')+(products.length>8?'<p>+ '+(products.length-8)+' autres articles, visibles dans l’inventaire.</p>':''):'<p>Aucun produit associé à ce niveau pour le moment.</p>')+
    '<button class="btn primary full" style="margin-top:17px" data-action="entryslot" data-slot="'+selected+'">'+c.ico('plus',15)+' Ajouter sur ce niveau</button></div><div class="location-status">'+c.ico('info',15)+' '+unlocated+' produit(s) sans emplacement renseigné</div></section>';
  return front+'<div class="bigmap">'+map+details+'</div>';
}
function settingsHeader(c){
 const mode=c.locationMode==='guided'?'guided':'optional';
 const owner=c.me.role==='admin';
 return '<section class="card settingscard" style="margin:0 0 18px"><div class="eyebrow">ORGANISATION DE LA PETITE RÉSERVE</div><h2 style="margin:8px 0 5px">Comment souhaitez-vous suivre le stock ?</h2><p>L’attribution d’une étagère est utile, mais elle n’est pas indispensable pour commencer. Aucun article existant n’est supprimé lors du changement de mode.</p>'+
 '<div class="mode-picker">'+
 '<button class="mode-option'+(mode==='optional'?' active':'')+'" data-action="setlocationmode" data-mode="optional"'+(!owner?' disabled':'')+'><strong>📋 Suivi uniquement</strong><span>Entrées, sorties, QR codes et inventaire. Emplacement facultatif.</span></button>'+
 '<button class="mode-option'+(mode==='guided'?' active':'')+'" data-action="setlocationmode" data-mode="guided"'+(!owner?' disabled':'')+'><strong>📍 Rangement guidé</strong><span>Étagère A–F et niveau 1–4 requis pour les nouvelles entrées.</span></button></div>'+
 '<p style="font-size:11px;color:#8491a4;margin:12px 0 0">'+(owner?'Modification réservée aux administrateurs.':'Demandez à un administrateur pour changer le mode.')+'</p></section>';
}
window.SPV2={room,dashboard,entry,mapPage,settingsHeader,shelfKey,qty};
})();

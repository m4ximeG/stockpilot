/* StockPilot — inventaire physique, aucun effet sur Henrri. */
(function(){
'use strict';
const esc=v=>String(v??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const stamp=ms=>ms?new Date(ms).toLocaleString('fr-FR',{dateStyle:'short',timeStyle:'short'}):'—';
function render(c){
 const data=c.stocktake||{},s=data.session,rows=data.expected||[],unknown=data.unknown||[],history=data.history||[];
 const active=s?.status==='open',admin=c.me?.role==='admin';
 const sample=rows.filter(x=>!x.scanned).slice(0,60),counted=rows.filter(x=>x.scanned).slice(-20).reverse();
 let content='';
 if(!s){
  content='<section class="card sp-count-card"><h2>Commencer un inventaire</h2><p>Le site photographie les articles actuellement en stock. Scannez chaque étiquette physique, puis comparez les écarts. Les quantités ne sont pas modifiées pendant le comptage.</p>'+
  (admin?'<button type="button" class="btn primary" data-action="stocktake-start">Démarrer un inventaire</button>':'<p>Seul un administrateur peut démarrer un inventaire.</p>')+'</section>';
 }else{
  const stat='<div class="sp-count-stats"><div><small>Attendus</small><strong>'+s.expectedCount+'</strong></div><div><small>Scannés</small><strong>'+s.scannedCount+'</strong></div><div><small>Non scannés</small><strong>'+s.missingCount+'</strong></div><div><small>Inconnus</small><strong>'+s.unknownCount+'</strong></div></div>';
  const list='<div class="sp-count-lists"><section class="card sp-count-card"><h3>Non scannés'+(s.status!=='open'?' lors du comptage':' (provisoire)')+'</h3><p>Ces unités sont attendues dans le stock mais n’ont pas encore été vues.</p><div class="sp-count-rows">'+(sample.length?sample.map(x=>'<div><code>'+esc(x.id)+'</code><span><strong>'+esc(x.name)+'</strong><small>'+esc(x.reference)+'</small></span></div>').join(''):'<p>Tout le stock attendu a été scanné.</p>')+(s.missingCount>60?'<small>Les 60 premiers écarts sont affichés.</small>':'')+'</div></section>'+
  '<section class="card sp-count-card"><h3>Codes inconnus</h3><p>Étiquettes qui ne figuraient pas dans le stock au démarrage. À vérifier séparément, sans ajout automatique.</p><div class="sp-count-rows">'+(unknown.length?unknown.map(x=>'<div><code>'+esc(x.code)+'</code><small>Par '+esc(x.scannedBy)+'</small></div>').join(''):'<p>Aucune étiquette inconnue.</p>')+'</div><h3>Dernières unités comptées</h3><div class="sp-count-rows">'+(counted.length?counted.map(x=>'<div><code>'+esc(x.id)+'</code><span>'+esc(x.name)+'</span></div>').join(''):'<p>Aucun article scanné pour l’instant.</p>')+'</div></section></div>';
  const closed=s.status!=='open';
  content='<section class="card sp-count-card"><div class="sp-count-heading"><div><h2>Inventaire #'+s.id+'</h2><p>Ouvert par '+esc(s.createdBy)+' · '+stamp(s.createdAt)+'</p></div><span class="sp-count-status">'+(closed?'Clôturé':'En cours')+'</span></div>'+stat+
   (active?'<p>Un seul comptage peut être ouvert. Les entrées et sorties pendant le comptage peuvent empêcher la correction automatique des écarts.</p><div class="scan-panel" id="scan-panel"><strong>Scanner les étiquettes STK</strong></div><div class="basic-scan-buttons"><button type="button" class="btn" data-action="camera">Activer la caméra</button></div><div class="scan-input"><input id="stocktake-code" aria-label="Code-barres de l’article" placeholder="STK-000001" autocomplete="off"><button type="button" class="btn primary" data-action="stocktake-scan">Compter</button></div>'+
   (s.stockChanged?'<p class="sp-count-warning">Attention : le stock a changé depuis le démarrage. Une correction automatique est bloquée ; clôturez sans correction et recommencez un comptage.</p>':'')+
   (admin?'<div class="sp-count-actions"><button type="button" class="btn primary" data-action="stocktake-confirm" data-mode="reconcile" '+(s.stockChanged?'disabled':'')+'>Valider les écarts ('+s.missingCount+')</button><button type="button" class="btn" data-action="stocktake-confirm" data-mode="close">Clôturer sans correction</button></div>':''):'<p>Inventaire clôturé · '+s.correctedCount+' article(s) régularisé(s). Aucune autre modification ne sera effectuée sur cette session.</p>'+
   (admin?'<button type="button" class="btn primary" data-action="stocktake-start">Démarrer un nouvel inventaire</button>':''))+
   '</section>'+list;
 }
 const journal=history.length?'<details class="sp-count-history"><summary>Historique des inventaires ('+history.length+')</summary>'+history.map(x=>'<div>Inventaire #'+x.id+' · '+esc(x.createdBy)+' · '+stamp(x.createdAt)+' · '+(x.status==='open'?'En cours':x.status==='reconciled'?'Corrigé':'Clôturé')+' · '+x.correctedCount+' correction(s)</div>').join('')+'</details>':'';
 return c.heading('FIABILITÉ DU STOCK','Inventaire physique','Comptez les étiquettes réelles et comparez-les aux articles enregistrés.')+'<div class="sp-stocktake-page">'+content+journal+'</div>';
}
window.SPStocktake={render};
})();
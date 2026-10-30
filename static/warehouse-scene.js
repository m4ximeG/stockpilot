/* StockPilot — scène photographique de la maquette approuvée. Pas de quantités fictives. */
(function(){
'use strict';
const escape=s=>String(s??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const positions=[{"id":"A","label":[75,63,33,36],"cells":[[69,146,44,40],[69,222,44,39],[69,303,43,40],[69,382,43,41]]},{"id":"B","label":[134,80,34,35],"cells":[[134,152,34,36],[133,219,35,35],[133,287,35,35],[133,359,35,36]]},{"id":"C","label":[183,99,33,31],"cells":[[183,163,32,31],[183,221,32,30],[183,275,32,35],[183,343,32,32]]},{"id":"D","label":[228,109,34,30],"cells":[[228,172,29,28],[228,222,29,28],[228,274,29,28],[228,326,29,28]]},{"id":"E","label":[387,119,34,30],"cells":[[389,186,30,28],[389,232,31,32],[389,280,31,34],[389,330,30,33]]},{"id":"F","label":[432,114,35,31],"cells":[[431,174,33,30],[432,228,32,29],[431,276,34,36],[432,338,32,31]]},{"id":"G","label":[480,109,34,32],"cells":[[480,166,39,41],[481,226,37,35],[482,282,36,39],[479,339,39,44]]},{"id":"H","label":[535,95,36,33],"cells":[[535,165,40,37],[535,228,40,40],[527,262,49,76],[535,344,40,41]]},{"id":"I","label":[592,83,35,33],"cells":[[592,157,39,37],[592,222,40,39],[592,294,40,38],[592,365,40,40]]},{"id":"J","label":[650,76,30,32],"cells":[[650,156,30,39],[650,223,30,44],[651,308,29,41],[651,380,29,48]]}];
let imageData='',pending=null;
function loadImage(){
 if(imageData||pending)return pending;
 pending=fetch('/static/mockup-photo.b64?v=hd-20261030',{credentials:'same-origin'}).then(r=>{
  if(!r.ok)throw new Error('Photo de référence indisponible');
  return r.text();
 }).then(base64=>{
  const src=base64.trim();
  if(src.length%4||!/^[A-Za-z0-9+/]+={0,2}$/.test(src))throw new Error('Photo de référence invalide');
  imageData='data:image/avif;base64,'+src;
  document.querySelectorAll('img.sp-reference-photo').forEach(img=>{img.src=imageData});
 }).catch(err=>{
  pending=null;
  document.querySelectorAll('.sp-photo-error').forEach(node=>{node.textContent='Image indisponible — rechargez la page'});
 });
 return pending;
}
function photoMarkup(uploaded=false){
 const src=uploaded?'/api/warehouse-photo':'/api/mockup-upscaled';
 return '<img class="sp-reference-photo" src="'+src+'" alt="Photographie de la réserve avec rayonnages métalliques et cartons" decoding="async" />';
}
function quantity(db,slot){
 return db.items.filter(item=>String(item.slot||'').split('-').slice(0,2).join('-')===slot).length;
}
function render(db,slot,uploaded=false){
 const selected=String(slot||'');
 const rack=selected[0]||'A';
 const config=db.shelves?.find(x=>x.slot===selected);
 const sizes={unknown:'À définir',small:'Petite',medium:'Moyenne',large:'Grande'};
 const pins=positions.map(r=>{
  const [x,y,w,h]=r.label;
  return '<button type="button" data-rx="rack" data-rack="'+r.id+'" class="sp-rack-hit'+(selected[0]===r.id?' active':'')+'" style="left:'+(x/680*100)+'%;top:'+(y/497*100)+'%;width:'+(w/680*100)+'%;height:'+(h/497*100)+'%" title="Rayonnage '+r.id+'" aria-label="Sélectionner le rayonnage '+r.id+'"></button>';
 }).join('');
 // Positionnement mesuré directement sur les cartes existantes du PNG original.
 // Chaque bouton RECOUVRE sa carte, il ne crée jamais une deuxième rangée.
 const overlay=positions.map(r=>r.cells.map(([x,y,w,h],i)=>{
   const code=r.id+'-'+(5-i),count=quantity(db,code),picked=selected===code;
   const fullSize=window.matchMedia&&window.matchMedia('(max-width:760px)').matches;
   return '<button type="button" data-rx="slot" data-slot="'+code+'" title="'+code+' · '+count+' article(s)" aria-label="Étagère '+r.id+', niveau '+(5-i)+', '+count+' article(s)" class="sp-real-slot'+(picked?' active':'')+'" style="left:'+(x/680*100)+'%;top:'+(y/497*100)+'%;width:'+(w/680*100)+'%;height:'+(h/497*100)+'%"><span class="sp-box-symbol" aria-hidden="true">⬡</span><strong>'+count+'</strong></button>';
 }).join('')).join('');
 const level1Buttons='';
 const details=selected?'<strong>'+escape(selected)+'</strong>':'<strong>—</strong>';
 const total=selected?quantity(db,selected):0;
 const suggestedLevel=selected?selected.split('-')[1]:'—';
 const size=config?(sizes[config.size]||'À définir'):'À définir';
 const notes=config?.note||'Aucune note';
 return '<div class="sp-warehouse">'+
  '<div class="sp-photo"><div class="sp-photo-error"></div>'+photoMarkup(uploaded)+pins+overlay+
  '</div>'+
  '<div class="sp-place-card"><div class="sp-place-visual"><span class="sp-mini-shelf">▤</span></div>'+
  '<div class="sp-place-location"><span>Emplacement sélectionné</span>'+details+'</div>'+
  '<div class="sp-place-data"><div><span>◈ &nbsp; Taille du niveau</span><b class="sp-size-badge">'+escape(size)+'</b></div>'+
  '<div><span>⬡ &nbsp; Articles déjà présents</span><b>'+total+'</b></div>'+
  '<div><span>▤ &nbsp; Note</span><b>'+escape(notes)+'</b></div></div></div>'+
  '<div class="sp-level-five"><span>Niveau du bas :</span>'+positions.map(r=>'<button type="button" data-rx="slot" data-slot="'+r.id+'-1" class="'+(selected===r.id+'-1'?'active':'')+'">'+r.id+'-1 <small>'+quantity(db,r.id+'-1')+'</small></button>').join('')+'</div>'+
 '</div>';
}
function sceneSVG(){return '';}
function preview(uploaded=false){return '<div class="sp-dashboard-photo">'+photoMarkup(uploaded)+'<span>Réserve · 10 rayonnages</span></div>';}
window.StockPilotWarehouse={render,sceneSVG,preview,quantity};
})();
/* StockPilot — scène photographique de la maquette approuvée. Pas de quantités fictives. */
(function(){
'use strict';
const escape=s=>String(s??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const positions=[{"id":"A","label":[13.35,16.5],"cells":[[12.35,33.2],[12.35,48.5],[12.5,63.8],[12.5,80.7]]},{"id":"B","label":[22.2,20.7],"cells":[[22.1,34.6],[22.1,47.9],[22.2,62.2],[22.2,76.5]]},{"id":"C","label":[29.1,23.5],"cells":[[29.3,35.8],[29.3,47.1],[29.3,59.2],[29.3,73.8]]},{"id":"D","label":[36,25.8],"cells":[[35.9,37.2],[35.9,48],[35.9,59.2],[35.9,69.2]]},{"id":"E","label":[59.6,27.6],"cells":[[59.6,39.6],[59.6,50.1],[59.6,60.4],[59.6,70.4]]},{"id":"F","label":[66.3,26.2],"cells":[[66,38.4],[66,49.3],[65.9,61],[66,71.2]]},{"id":"G","label":[73,25.5],"cells":[[73.2,36.8],[73.2,49],[73.2,61],[73.2,73.6]]},{"id":"H","label":[81.5,22.7],"cells":[[81.2,36.4],[81.2,48.5],[81.2,61.2],[81.2,73.4]]},{"id":"I","label":[89.7,20.3],"cells":[[89.4,34.4],[89.4,48.3],[89.4,61.4],[89.4,76.7]]},{"id":"J","label":[99.2,17.3],"cells":[[97.8,35.2],[97.8,48.4],[97.8,63.4],[97.8,78.9]]}];
let imageData='',pending=null;
function loadImage(){
 if(imageData||pending)return pending;
 pending=fetch('/static/mockup-photo.b64',{credentials:'same-origin'}).then(r=>{
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
 if(uploaded)return '<img class="sp-reference-photo" src="/api/warehouse-photo" alt="Photographie de la réserve" />';
 loadImage();
 return '<img class="sp-reference-photo" '+(imageData?'src="'+imageData+'"':'')+' alt="Vue photographique de la réserve avec rayonnages métalliques et cartons" />';
}
function quantity(db,slot){
 return db.items.filter(item=>String(item.slot||'').split('-').slice(0,2).join('-')===slot).length;
}
function render(db,slot,uploaded=false){
 const selected=String(slot||'');
 const rack=selected[0]||'A';
 const config=db.shelves?.find(x=>x.slot===selected);
 const sizes={unknown:'À définir',small:'Petite',medium:'Moyenne',large:'Grande'};
 const pins=positions.map(r=>'<button type="button" class="sp-rack-marker'+(rack===r.id&&selected?' active':'')+'" data-rx="rack" data-rack="'+r.id+'" style="left:'+r.label[0]+'%;top:'+r.label[1]+'%" title="Rayonnage '+r.id+'" aria-label="Rayonnage '+r.id+'"><span class="sr-only">'+r.id+'</span></button>').join('');
 // La maquette contient des badges de démonstration dans la photo. Les badges visibles
 // sont recouverts par des contrôles dynamiques dont les chiffres viennent de SQLite.
 const overlay=positions.map(r=>r.cells.map((xy,i)=>{
  const level=5-i,code=r.id+'-'+level,count=quantity(db,code),picked=selected===code;
  return '<button type="button" data-rx="slot" data-slot="'+code+'" title="'+code+' · '+count+' article(s)" class="sp-cube-count'+(picked?' active':'')+'" style="left:'+xy[0]+'%;top:'+xy[1]+'%" aria-label="Rayonnage '+r.id+', niveau '+level+', '+count+' articles"><span class="sp-count-icon">⬡</span><strong>'+count+'</strong></button>';
 }).join('')).join('');
 const level1Buttons='';
 const details=selected?'<strong>'+escape(selected)+'</strong>':'<strong>—</strong>';
 const total=selected?quantity(db,selected):0;
 const suggestedLevel=selected?selected.split('-')[1]:'—';
 const size=config?(sizes[config.size]||'À définir'):'À définir';
 const notes=config?.note||'Aucune note';
 return '<div class="sp-warehouse">'+
  '<div class="sp-photo"><div class="sp-photo-error"></div>'+photoMarkup(uploaded)+pins+overlay+
  '<div class="sp-level-side"><span>5</span><span>4</span><span>3</span><span>2</span><span>1</span></div>'+level1Buttons+'</div>'+
  '<div class="sp-place-card"><div class="sp-place-visual"><span class="sp-mini-shelf">▤</span></div>'+
  '<div class="sp-place-location"><span>Emplacement sélectionné</span>'+details+'</div>'+
  '<div class="sp-place-data"><div><span>◈ &nbsp; Taille du niveau</span><b class="sp-size-badge">'+escape(size)+'</b></div>'+
  '<div><span>⬡ &nbsp; Articles déjà présents</span><b>'+total+'</b></div>'+
  '<div><span>▤ &nbsp; Note</span><b>'+escape(notes)+'</b></div></div></div>'+
  '<div class="sp-level-five"><span>Niveau du bas</span><button type="button" data-rx="slot" data-slot="'+rack+'-1" class="'+(selected===rack+'-1'?'active':'')+'">'+rack+'-1 <small>'+quantity(db,rack+'-1')+' en stock</small></button></div>'+
 '</div>';
}
function sceneSVG(){return '';}
function preview(uploaded=false){return '<div class="sp-dashboard-photo">'+photoMarkup(uploaded)+'<span>Réserve · 10 rayonnages</span></div>';}
window.StockPilotWarehouse={render,sceneSVG,preview,quantity};
})();
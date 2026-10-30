/* StockPilot — scène photographique de la maquette approuvée. Pas de quantités fictives. */
(function(){
'use strict';
const escape=s=>String(s??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const positions=[
 {id:'A',label:[8.9,14.4],cells:[[12.8,32],[12.8,47.5],[12.8,63.5],[12.8,79.5]]},
 {id:'B',label:[18,17.1],cells:[[22.4,33.7],[22.4,47],[22.4,63.5],[22.4,78.5]]},
 {id:'C',label:[27,20.1],cells:[[29.5,36],[29.5,48],[29.5,59],[29.5,76]]},
 {id:'D',label:[35.4,22.5],cells:[[35.3,38],[35.3,48],[35.3,60],[35.3,72.5]]},
 {id:'E',label:[59.5,25.4],cells:[[59.5,40],[59.5,50.5],[59.5,61.5],[59.5,72.8]]},
 {id:'F',label:[66.1,23.8],cells:[[66.1,38.9],[66.1,50],[66.1,62],[66.1,74]]},
 {id:'G',label:[73,21.9],cells:[[73,38.5],[73,49.6],[73,61.8],[73,75.5]]},
 {id:'H',label:[81.2,20.6],cells:[[81.2,38.5],[81.2,50],[81.2,63],[81.2,77]]},
 {id:'I',label:[89.7,18.9],cells:[[89.5,36.8],[89.5,49.5],[89.5,63.5],[89.5,77.6]]},
 {id:'J',label:[98.1,17.1],cells:[[98,38],[98,51],[98,63.5],[98,77]]}
];
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
function photoMarkup(){
 loadImage();
 return '<img class="sp-reference-photo" '+(imageData?'src="'+imageData+'"':'')+' alt="Vue photographique de la réserve avec rayonnages métalliques et cartons" />';
}
function quantity(db,slot){
 return db.items.filter(item=>String(item.slot||'').split('-').slice(0,2).join('-')===slot).length;
}
function render(db,slot){
 const selected=String(slot||'');
 const rack=selected[0]||'A';
 const config=db.shelves?.find(x=>x.slot===selected);
 const sizes={unknown:'À définir',small:'Petite',medium:'Moyenne',large:'Grande'};
 const pins=positions.map(r=>'<button type="button" class="sp-rack-marker'+(rack===r.id&&selected?' active':'')+'" data-rx="rack" data-rack="'+r.id+'" style="left:'+r.label[0]+'%;top:'+r.label[1]+'%" aria-label="Rayonnage '+r.id+'"><b>'+r.id+'</b></button>').join('');
 // La maquette contient des badges de démonstration dans la photo. Les badges visibles
 // sont recouverts par des contrôles dynamiques dont les chiffres viennent de SQLite.
 const overlay=positions.map(r=>r.cells.map((xy,i)=>{
  const level=5-i,code=r.id+'-'+level,count=quantity(db,code),picked=selected===code;
  return '<button type="button" data-rx="slot" data-slot="'+code+'" title="'+code+' · '+count+' article(s)" class="sp-cube-count'+(picked?' active':'')+'" style="left:'+xy[0]+'%;top:'+xy[1]+'%" aria-label="Rayonnage '+r.id+', niveau '+level+', '+count+' articles"><span class="sp-count-icon">⬡</span><strong>'+count+'</strong></button>';
 }).join('')).join('');
 const details=selected?'<strong>'+escape(selected)+'</strong>':'<strong>—</strong>';
 const total=selected?quantity(db,selected):0;
 const suggestedLevel=selected?selected.split('-')[1]:'—';
 const size=config?(sizes[config.size]||'À définir'):'À définir';
 const notes=config?.note||'Aucune note';
 return '<div class="sp-warehouse">'+
  '<div class="sp-photo"><div class="sp-photo-error"></div>'+photoMarkup()+pins+overlay+
  '<div class="sp-level-side"><span>5</span><span>4</span><span>3</span><span>2</span><span>1</span></div></div>'+
  '<div class="sp-place-card"><div class="sp-place-visual"><span class="sp-mini-shelf">▤</span></div>'+
  '<div class="sp-place-location"><span>Emplacement sélectionné</span>'+details+'</div>'+
  '<div class="sp-place-data"><div><span>◈ &nbsp; Taille du niveau</span><b class="sp-size-badge">'+escape(size)+'</b></div>'+
  '<div><span>⬡ &nbsp; Articles déjà présents</span><b>'+total+'</b></div>'+
  '<div><span>▤ &nbsp; Note</span><b>'+escape(notes)+'</b></div></div></div>'+
  '<div class="sp-level-five"><span>Niveau 1 (bas) :</span>'+positions.map(r=>'<button type="button" data-rx="slot" data-slot="'+r.id+'-1" class="'+(selected===r.id+'-1'?'active':'')+'">'+r.id+'-1 <small>'+quantity(db,r.id+'-1')+'</small></button>').join('')+'</div>'+
 '</div>';
}
function sceneSVG(){return '';}
function preview(){return '<div class="sp-dashboard-photo">'+photoMarkup()+'<span>Réserve · 10 rayonnages</span></div>';}
window.StockPilotWarehouse={render,sceneSVG,preview,quantity};
})();
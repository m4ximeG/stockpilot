/* StockPilot — scène interactive de réserve, version visuelle */
(function(){
'use strict';
const esc = s => String(s??'').replace(/[&<>"']/g,x=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]));
let defaultPhotoData = '';
let defaultPhotoRequest = null;
function ensureDefaultPhoto(){
 if(defaultPhotoData || defaultPhotoRequest)return;
 defaultPhotoRequest=fetch('/static/reserve-photo.b64',{credentials:'same-origin'}).then(r=>{if(!r.ok)throw new Error('Photo non disponible');return r.text()}).then(raw=>{
   const payload=raw.trim();
   if(!/^[A-Za-z0-9+/]+=*$/.test(payload))throw new Error('Image invalide');
   defaultPhotoData='data:image/avif;base64,'+payload;
   document.querySelectorAll('.wv-default-photo').forEach(el=>{el.src=defaultPhotoData});
 }).catch(()=>{defaultPhotoRequest=null});
}
function photoMarkup(hasPrivatePhoto){
 if(hasPrivatePhoto)return '<img class="wv-real-photo" src="/api/warehouse-photo" alt="Photo de la réserve" />';
 ensureDefaultPhoto();
 return '<img class="wv-real-photo wv-default-photo" '+(defaultPhotoData?'src="'+defaultPhotoData+'"':'')+' alt="Photographie de la réserve" />';
}
const racks=[
 {id:'A',side:'G',x:7,y:17,w:23,h:71,cx:10,cy:12},
 {id:'B',side:'G',x:27,y:25,w:12,h:52,cx:29,cy:22},
 {id:'C',side:'G',x:38,y:33,w:9,h:34,cx:40,cy:28},
 {id:'D',side:'G',x:47,y:39,w:5,h:19,cx:47,cy:35},
 {id:'E',side:'D',x:79,y:17,w:18,h:72,cx:91,cy:12},
 {id:'F',side:'D',x:69,y:25,w:12,h:55,cx:79,cy:22},
 {id:'G',side:'D',x:63,y:30,w:8,h:40,cx:69,cy:28},
 {id:'H',side:'D',x:58,y:35,w:6,h:30,cx:61,cy:33},
 {id:'I',side:'D',x:55,y:40,w:4,h:22,cx:56,cy:37},
 {id:'J',side:'D',x:52,y:42,w:3,h:16,cx:52,cy:40}
];
function sceneSVG(){
 const defs='<defs>'+
 '<linearGradient id="ws-wall" x2="0" y2="1"><stop stop-color="#b8bec2"/><stop offset="1" stop-color="#777b81"/></linearGradient>'+
 '<linearGradient id="ws-floor" x2="0" y2="1"><stop stop-color="#9ba4aa"/><stop offset="1" stop-color="#d7d9da"/></linearGradient>'+
 '<linearGradient id="ws-ceiling" x2="0" y2="1"><stop stop-color="#e0e2e4"/><stop offset="1" stop-color="#69757c"/></linearGradient>'+
 '<linearGradient id="ws-metal" x2="0" y2="1"><stop stop-color="#aab4b8"/><stop offset=".5" stop-color="#566770"/><stop offset="1" stop-color="#263d47"/></linearGradient>'+
 '<linearGradient id="ws-box" x2="0" y2="1"><stop stop-color="#cdb48f"/><stop offset="1" stop-color="#a58861"/></linearGradient>'+
 '<radialGradient id="ws-light"><stop stop-color="#ffffff" stop-opacity=".6"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>'+
 '</defs>';
 const parts=['<rect width="1200" height="690" fill="#7f8a91"/>',
 '<path d="M0 0H1200L650 285H555Z" fill="url(#ws-ceiling)"/>',
 '<path d="M0 690L540 288H664L1200 690Z" fill="url(#ws-floor)"/>',
 '<path d="M0 0L556 285L535 490L0 690Z" fill="url(#ws-wall)"/>',
 '<path d="M1200 0L648 285L668 490L1200 690Z" fill="url(#ws-wall)"/>',
 '<rect x="557" y="285" width="92" height="150" rx="4" fill="#4e5960" opacity=".65"/>'];
 for(let i=0;i<10;i++){
   const f=(i+1)/11;
   const y=285-(i+1)*26;
   const xl=556-(i+1)*56, xr=648+(i+1)*56;
   parts.push('<path d="M'+Math.max(0,xl)+' '+Math.max(0,y)+' L'+Math.min(1200,xr)+' '+Math.max(0,y)+'" stroke="#eef2f1" stroke-opacity=".35" stroke-width="'+(i<3?2:5)+'"/>');
 }
 for(let i=0;i<12;i++){
   let t=i/12;
   const x=599+(t-.5)*900;
   parts.push('<path d="M'+x+' 690L599 285" stroke="#ffffff" stroke-width="2" stroke-opacity=".1"/>');
 }
 // Racks: perspectival quadrilaterals / horizontal shelves
 const draw=(side)=>{
   const arr=(side==='L'?[
     [0,280,200,560,45,675],[280,405,240,480,180,550],[405,475,270,415,235,445],[475,530,284,368,270,380]
   ]:[
     [920,1200,200,560,45,675],[800,920,240,490,180,560],[725,800,260,430,215,500],
     [670,725,278,395,250,450],[630,670,289,365,269,390],[608,630,292,345,280,360]
   ]);
   let rendered='';
   // iterate far -> near
   for(let index=arr.length-1;index>=0;index--){
     const [x1,x2,yt2,yb2,yt1,yb1]=arr[index];
     const xNear=side==='L'?x1:x2,xFar=side==='L'?x2:x1;
     const topNear=yt1,botNear=yb2,topFar=yt2,botFar=yb1;
     const q=(a,b,f)=>a+(b-a)*f;
     const points=[xNear+','+topNear,xFar+','+topFar,xFar+','+botFar,xNear+','+botNear].join(' ');
     rendered+='<polygon points="'+points+'" fill="#1c323b" fill-opacity=".18" stroke="#ced7d9" stroke-opacity=".5" stroke-width="2"/>';
     for(let level=1;level<=5;level++){
       const f=level/5;
       const yN=q(botNear,topNear,f),yF=q(botFar,topFar,f);
       rendered+='<path d="M'+xNear+' '+yN+' L'+xFar+' '+yF+'" stroke="#1f3c49" stroke-width="'+(2.3+Math.abs(xFar-xNear)/70)+'"/>';
       rendered+='<path d="M'+xNear+' '+(yN-3)+' L'+xFar+' '+(yF-2)+'" stroke="#bbc6c7" stroke-width="2" opacity=".8"/>';
     }
     for(const [x,t,b] of [[xNear,topNear,botNear],[xFar,topFar,botFar]]){
       rendered+='<path d="M'+x+' '+t+'L'+x+' '+b+'" stroke="url(#ws-metal)" stroke-width="'+(Math.abs(xNear-xFar)>200?11:6)+'"/>';
     }
     // Cardboard shapes as an atmospheric illustration (not inventory quantities).
     for(let level=1;level<=4;level++){
       if((index+level)%3===1)continue;
       const width=Math.max(9,Math.abs(xNear-xFar)*.23),height=Math.max(8,Math.abs(botNear-topNear)/10);
       const x=q(xNear,xFar,.38+(level%2)*.16)-width/2;
       const y=q(botNear,topNear,level/5)-height*.96;
       rendered+='<rect x="'+x+'" y="'+y+'" width="'+width+'" height="'+height+'" rx="1" fill="url(#ws-box)" opacity=".62" stroke="#736550" stroke-opacity=".18"/>';
     }
   }
   return rendered;
 };
 parts.push(draw('L'),draw('R'));
 parts.push('<ellipse cx="602" cy="295" rx="130" ry="155" fill="url(#ws-light)" opacity=".7"/>',
 '<path d="M0 689H1200" stroke="#929ca1" stroke-width="2"/>',
 '<rect width="1200" height="690" fill="#0d2532" fill-opacity=".14"/>');
 return '<svg class="wv-warehouse-art" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 690" preserveAspectRatio="xMidYMid slice" aria-hidden="true">'+defs+parts.join('')+'</svg>';
}
function countSlot(db,slot){return db.items.filter(i=>String(i.slot||'').split('-').slice(0,2).join('-')===slot).length}
function render(db,slot,photo,admin){
 const rack=(slot||'A-1').split('-')[0];
 const level=Number((slot||'A-1').split('-')[1])||1;
 const info=db.shelves?.find(x=>x.slot===slot)||null;
 const quantity=slot?countSlot(db,slot):0;
 const sizeLabel={small:'Petit',medium:'Moyen',large:'Grand',unknown:'À définir'};
 const shelfImageLevels=[5,4,3,2,1].map(n=>{
   const code=rack+'-'+n,qty=countSlot(db,code);
   return '<button type="button" data-rx="slot" data-slot="'+code+'" class="wv-image-level'+(slot===code?' selected':'')+'" title="'+code+' · '+qty+' article(s)"><span>N'+n+'</span><strong>'+qty+'</strong></button>';
 }).join('');
 const controls=racks.map(r=>{
  const active=rack===r.id;
  const total=[1,2,3,4,5].reduce((n,k)=>n+countSlot(db,r.id+'-'+k),0);
  return '<button type="button" class="wv-rack-pin'+(active?' active':'')+'" data-rx="rack" data-rack="'+r.id+'" style="left:'+r.cx+'%;top:'+r.cy+'%" aria-label="Rayonnage '+r.id+' : '+total+' articles"><b>'+r.id+'</b></button>';
 }).join('');
 const chosen=racks.find(r=>r.id===rack)||racks[0];
 const levels=[5,4,3,2,1].map(n=>{
  const s=rack+'-'+n,q=countSlot(db,s),sel=slot===s,cf=db.shelves?.find(x=>x.slot===s);
  return '<button type="button" data-rx="slot" data-slot="'+s+'" class="wv-level'+(sel?' selected':'')+'" title="'+s+' · '+q+' article(s)"><strong>N'+n+'</strong><span>'+q+'</span></button>';
 }).join('');
 return '<div class="wv-shell">'+
 '<div class="wv-topline"><div><strong>Votre réserve</strong><span>10 rayonnages · 50 niveaux</span></div><div class="wv-photo-control">'+(admin?'<button type="button" data-rx="upload-photo" class="wv-camera">'+(photo?'Changer la photo':'Ajouter une photo')+'</button>':'')+'</div></div>'+
 '<div class="wv-scene">'+photoMarkup(photo)+
 '<div class="wv-fade"></div><div class="wv-pin-layer">'+controls+'</div><div class="wv-photo-levels" style="--wlevel-x:'+chosen.cx+'%;--wlevel-y:'+Math.min(60,chosen.cy+29)+'%">'+shelfImageLevels+'</div>'+
 '<div class="wv-aisle-mark">ALLÉE CENTRALE</div><div class="wv-scene-footer"><span>ENTRÉE MAGASIN</span><span>Vue indicative · sélection interactive</span></div></div>'+
 '<div class="wv-shelf-pick"><div class="wv-pick-title"><span>RAYONNAGE '+rack+'</span><strong>Choisir le niveau</strong></div><div class="wv-level-list">'+levels+'</div></div>'+
 '<div class="wv-detail"><div class="wv-location-mark"><span>Emplacement sélectionné</span><strong>'+esc(slot||'Aucun')+'</strong></div><div class="wv-location-data"><span>Taille du niveau</span><strong>'+esc(info?sizeLabel[info.size]||'À définir':'—')+'</strong></div><div class="wv-location-data"><span>Articles présents</span><strong>'+quantity+'</strong></div><div class="wv-location-data"><span>Note</span><strong>'+esc(info?.note||'Aucune')+'</strong></div></div>'+
 '<p class="wv-foot">Sélectionnez la lettre du rayonnage puis le niveau. Les quantités proviennent du stock enregistré, pas de la photo.</p></div>';
}
window.StockPilotWarehouse={render,sceneSVG,preview:photoMarkup};
})();
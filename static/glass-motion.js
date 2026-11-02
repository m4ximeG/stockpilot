/* StockPilot Facet edition: decorative motion only.
   Delegated events keep working when pages are re-rendered.
   No WebGL, network calls, data mutations or camera permissions. */
(function(){
 'use strict';
 if(typeof window==='undefined'||typeof document==='undefined')return;
 const reduce=window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;
 const fine=window.matchMedia&&window.matchMedia('(pointer:fine)').matches;
 if(reduce||!fine)return;
 let hero=null,raf=0,x=.5,y=.5;
 const findHero=el=>el&&el.closest?el.closest('[data-glass-hero]'):null;
 const commit=()=>{
   raf=0;
   if(!hero||!hero.isConnected)return;
   hero.style.setProperty('--mx',(x*100).toFixed(2)+'%');
   hero.style.setProperty('--my',(y*100).toFixed(2)+'%');
   const art=hero.querySelector('.facet-hero-art');
   if(art){
    art.style.setProperty('--tilt-x',((.5-y)*4.3).toFixed(2)+'deg');
    art.style.setProperty('--tilt-y',((x-.5)*6.3).toFixed(2)+'deg');
   }
 };
 document.addEventListener('pointermove',event=>{
   const hit=findHero(event.target);
   if(hit){
      hero=hit;
      const b=hit.getBoundingClientRect();
      if(b.width&&b.height){x=Math.min(1,Math.max(0,(event.clientX-b.left)/b.width));y=Math.min(1,Math.max(0,(event.clientY-b.top)/b.height));}
      if(!raf)raf=window.requestAnimationFrame(commit);
   }else if(hero){
     const old=hero;hero=null;
     old.style.setProperty('--mx','50%');old.style.setProperty('--my','50%');
     const art=old.querySelector('.facet-hero-art');
     if(art){art.style.setProperty('--tilt-x','0deg');art.style.setProperty('--tilt-y','0deg');}
   }
   const card=event.target.closest&&event.target.closest('.basic-kpi,.basic-action,.basic-entry-form,.basic-entry-help,.basic-recent,.basic-table-card,.settingscard,.formcard');
   if(card){const b=card.getBoundingClientRect();if(b.width&&b.height){card.style.setProperty('--spot-x',((event.clientX-b.left)/b.width*100).toFixed(1)+'%');card.style.setProperty('--spot-y',((event.clientY-b.top)/b.height*100).toFixed(1)+'%');}}
 },{passive:true});
 document.addEventListener('visibilitychange',()=>{
  if(document.hidden&&hero){const art=hero.querySelector('.facet-hero-art');if(art){art.style.setProperty('--tilt-x','0deg');art.style.setProperty('--tilt-y','0deg');}}
 });
})();
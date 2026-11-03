/* StockPilot mobile : jamais de mise en cache de l'API, du stock, des identifiants
   ni des pages authentifiées. Les icônes publiques seules sont conservées. */
const CACHE='stockpilot-public-v1';
const PUBLIC=['/app-icon-192.png','/app-icon-512.png','/apple-touch-icon.png'];
self.addEventListener('install',event=>{
 event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(PUBLIC)).then(()=>self.skipWaiting()));
});
self.addEventListener('activate',event=>{
 event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('stockpilot-public-')&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim()));
});
self.addEventListener('fetch',event=>{
 if(event.request.method!=='GET')return;
 const url=new URL(event.request.url);
 if(url.origin!==self.location.origin)return;
 if(PUBLIC.includes(url.pathname)){
  event.respondWith(caches.match(event.request).then(cached=>cached||fetch(event.request)));
  return;
 }
 if(event.request.mode==='navigate'){
  event.respondWith(fetch(event.request).catch(()=>new Response(
   '<!doctype html><html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="theme-color" content="#071b22"><title>StockPilot — Hors ligne</title><body style="margin:0;background:#071b22;color:#edf6fa;font:16px system-ui;padding:15vh 8vw;text-align:center"><h1>Connexion indisponible</h1><p>StockPilot a besoin du réseau pour accéder au stock partagé. Vérifiez votre connexion puis rechargez la page.</p><button onclick="location.reload()" style="padding:13px 24px;background:#e9f3f8;border:0;border-radius:12px;font-weight:bold">Réessayer</button></body></html>',
   {headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}}
  )));
 }
});

/* Apple iOS 16.4+ PWA: a push event must display a visible notification. */
self.addEventListener('push',event=>{
 let payload={};
 try{payload=event.data?event.data.json():{}}catch(e){payload={}}
 const title=typeof payload.title==='string'?payload.title:'StockPilot · Alerte de stock';
 const body=typeof payload.body==='string'?payload.body:'Un produit nécessite votre attention.';
 const tag=typeof payload.tag==='string'?payload.tag:'stockpilot-stock';
 const safeUrl=typeof payload.url==='string'&&payload.url.startsWith('/')&&!payload.url.startsWith('//')?
  payload.url:'/?page=products';
 event.waitUntil(self.registration.showNotification(title,{
  body,tag,icon:'/app-icon-192.png',badge:'/app-icon-192.png',
  data:{url:safeUrl},renotify:false
 }));
});
self.addEventListener('notificationclick',event=>{
 event.notification.close();
 const dest=new URL(event.notification.data?.url||'/?page=products',self.location.origin);
 if(dest.origin!==self.location.origin)return;
 event.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(async clients=>{
  const existing=clients.find(client=>new URL(client.url).origin===self.location.origin);
  if(existing){
   if('navigate' in existing)await existing.navigate(dest.href);
   return existing.focus();
  }
  return self.clients.openWindow(dest.href);
 }));
});

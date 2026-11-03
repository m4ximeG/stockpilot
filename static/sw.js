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

// Service Worker gegen veraltete Dateien nach einem Update: GitHub Pages erlaubt dem Browser, jede Datei zehn
// Minuten ungefragt aus dem Zwischenspeicher zu nehmen. Für Anfragen an die eigene Seite fragt der Browser deshalb
// jedes Mal beim Server nach (meist nur „304 unverändert“, also ohne erneuten Download). Supabase und andere
// Adressen laufen unverändert am Service Worker vorbei; es wird nichts gespeichert.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (ereignis) => ereignis.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (ereignis) => {
  const anfrage = ereignis.request;
  if (anfrage.method !== 'GET' || new URL(anfrage.url).origin !== self.location.origin) return;
  ereignis.respondWith(fetch(anfrage, { cache: 'no-cache' }));
});

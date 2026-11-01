// Shows a pushed reminder and opens its page on tap. No caching: BashaBook needs the network for every page anyway.
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('push', e => {
  let m = { title: 'BashaBook', body: '', url: '/' };
  try { m = e.data ? e.data.json() : m; } catch { /* not ours: show the plain title */ }
  e.waitUntil((async () => {
    // the same tag replaces the shown notification: quietly for a quick correction, with a buzz when the one it replaces is
    // over 5 minutes old (someone may have passed that count on already)
    const old = m.tag ? (await self.registration.getNotifications({ tag: m.tag }))[0] : undefined;
    const renotify = !!old && Date.now() - old.timestamp > 5 * 60 * 1000;
    await self.registration.showNotification(m.title, { body: m.body, icon: '/icon-192.png', badge: '/icon-192.png', tag: m.tag || '', renotify, data: { url: m.url } });
  })());
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || '/', self.location.origin).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    const open = list.find(c => c.url.startsWith(self.location.origin));
    // navigate() refuses a tab this worker doesn't control yet; then a new tab is fine
    return open ? open.focus().then(c => c.navigate(url)).catch(() => self.clients.openWindow(url)) : self.clients.openWindow(url);
  }));
});

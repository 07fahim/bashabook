// Shows a pushed reminder and opens its page on tap. No caching: BashaBook needs the network for every page anyway.
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('push', e => {
  let m = { title: 'BashaBook', body: '', url: '/' };
  try { m = e.data ? e.data.json() : m; } catch { /* not ours: show the plain title */ }
  e.waitUntil(self.registration.showNotification(m.title, { body: m.body, icon: '/icon-192.png', badge: '/icon-192.png', tag: m.tag || '', data: { url: m.url } }));
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

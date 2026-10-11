// Shows a pushed reminder and opens its page on tap. No caching: BashaBook needs the network for every page anyway.
self.addEventListener('push', e => {
  const m = e.data ? e.data.json() : { title: 'BashaBook', body: '', url: '/' };
  e.waitUntil(self.registration.showNotification(m.title, { body: m.body, icon: '/icon-192.png', badge: '/icon-192.png', data: { url: m.url } }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || '/', self.location.origin).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    const open = list.find(c => c.url.startsWith(self.location.origin));
    return open ? open.focus().then(c => (c.navigate ? c.navigate(url) : c)) : self.clients.openWindow(url);
  }));
});

// Push notification event listener - imported by the service worker
self.addEventListener('push', function(event) {
  if (!event.data) return;

  try {
    const data = event.data.json();
    // A single-task payload carries taskId → we can offer "Open" and "Snooze"
    // action buttons that deep-link back into the app. A multi-task payload
    // just opens the home view.
    const taskId = data.taskId || null;
    const actions = taskId ? [
      { action: 'open', title: 'Abrir' },
      { action: 'snooze60', title: 'Retrasar 1 h' },
    ] : [];
    const options = {
      body: data.body || '',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: data.type || 'notification',
      renotify: true,
      actions,
      data: { taskId, url: data.url || '/' },
    };

    event.waitUntil(
      self.registration.showNotification(data.title || 'SecondBrain', options)
    );
  } catch (e) {
    console.error('[SW] Push parse error:', e);
  }
});

self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  const { taskId, url } = event.notification.data || {};
  // Route by action button; the notification body itself resolves to "open".
  let target = url || '/';
  if (event.action === 'snooze60' && taskId) {
    target = `/?snoozeTask=${encodeURIComponent(taskId)}&minutes=60`;
  } else if ((event.action === 'open' || !event.action) && taskId) {
    target = `/?task=${encodeURIComponent(taskId)}`;
  }
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clientList) {
      // Reuse an already-open tab if there is one; navigate it to the target
      // so it can pick up ?task or ?snoozeTask on the same mount.
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          if ('navigate' in client) return client.navigate(target).then(() => client.focus());
          return client.focus();
        }
      }
      return clients.openWindow(target);
    })
  );
});

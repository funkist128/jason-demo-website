/*
 * Web Push service worker — drop this file at the ROOT of your website
 * (e.g. https://example.com/service-worker.js) so its scope covers the whole site.
 *
 * It handles two events:
 *   - "push":              renders the notification sent by the push-service API
 *   - "notificationclick": focuses an existing tab or opens the payload `url`
 *
 * The API sends a JSON payload shaped as: { title, body, url? }
 */

self.addEventListener('install', (event) => {
  // Activate this worker immediately instead of waiting for old tabs to close.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  // Take control of all open clients as soon as the worker activates.
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  // Parse the payload defensively — fall back to sensible defaults.
  let payload = {};
  if (event.data) {
    try {
      payload = event.data.json();
    } catch (_err) {
      payload = { title: 'Notification', body: event.data.text() };
    }
  }

  const title = payload.title || 'Notification';
  const options = {
    body: payload.body || '',
    icon: payload.icon || '/icon-192.png',
    badge: payload.badge || '/badge-72.png',
    // Stash the click-through URL so notificationclick can read it.
    data: { url: payload.url || '/' },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const targetUrl = (event.notification.data && event.notification.data.url) || '/';

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        // If a tab is already open on the target URL, focus it.
        for (const client of clientList) {
          if (client.url === targetUrl && 'focus' in client) {
            return client.focus();
          }
        }
        // Otherwise open a new tab.
        if (self.clients.openWindow) {
          return self.clients.openWindow(targetUrl);
        }
        return undefined;
      }),
  );
});

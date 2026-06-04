/*
 * Browser-side helper to register the service worker and subscribe a user
 * to the push-service API. Import it as an ES module:
 *
 *   import { subscribeToPush, unsubscribeFromPush } from './push-client.js';
 *
 *   await subscribeToPush({
 *     apiBaseUrl: 'https://your-domain.example.com/push', // service base (note the /push prefix)
 *     vapidPublicKey: 'BIdBl...',                 // NEXT_PUBLIC_VAPID_PUBLIC_KEY
 *     userId: 'user-42',
 *     email: 'alice@example.com',
 *   });
 *
 * Requirements: a secure context (HTTPS, or http://localhost for dev) and a
 * `service-worker.js` served from your site root.
 */

/** Convert a base64url VAPID public key into the Uint8Array the API expects. */
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

/** True when this browser can do Web Push at all. */
export function isPushSupported() {
  return (
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

/**
 * Register the service worker, request permission, create (or reuse) a push
 * subscription, and POST it to the push-service `/subscribe` endpoint
 * (e.g. apiBaseUrl `https://your-domain.example.com/push` → `…/push/subscribe`).
 *
 * @returns {Promise<PushSubscription>} the active subscription.
 */
export async function subscribeToPush({
  apiBaseUrl = '',
  vapidPublicKey,
  userId,
  email,
  serviceWorkerUrl = '/service-worker.js',
} = {}) {
  if (!isPushSupported()) {
    throw new Error('Web Push is not supported in this browser.');
  }
  if (!vapidPublicKey) throw new Error('vapidPublicKey is required.');
  if (!userId) throw new Error('userId is required.');
  if (!email) throw new Error('email is required.');

  // 1. Register the service worker and wait until it is active.
  const registration = await navigator.serviceWorker.register(serviceWorkerUrl);
  await navigator.serviceWorker.ready;

  // 2. Ask for notification permission.
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error(`Notification permission was not granted (got "${permission}").`);
  }

  // 3. Reuse an existing subscription or create a new one.
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
    });
  }

  // 4. Send it to the backend (upsert by endpoint).
  const res = await fetch(`${apiBaseUrl}/subscribe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      user_id: userId,
      email,
      // PushSubscription.toJSON() => { endpoint, keys: { p256dh, auth } }
      subscription: subscription.toJSON(),
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Failed to register subscription (HTTP ${res.status}): ${detail}`);
  }

  return subscription;
}

/**
 * Cancel the local push subscription. Note: this only unsubscribes the browser;
 * the backend row is pruned automatically on the next 410/404 from the gateway.
 */
export async function unsubscribeFromPush({ serviceWorkerUrl = '/service-worker.js' } = {}) {
  if (!isPushSupported()) return false;
  const registration = await navigator.serviceWorker.getRegistration(serviceWorkerUrl);
  if (!registration) return false;
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return false;
  return subscription.unsubscribe();
}

/**
 * Clear the app-icon badge locally (call when the app is opened / read).
 * This only updates THIS device's icon — to stop future pushes from re-setting
 * the old count, your backend must also reset the server count via
 * POST /push/badge/{user_id} { "op": "clear" }.
 */
export async function clearLocalAppBadge() {
  if ('clearAppBadge' in navigator) {
    try {
      await navigator.clearAppBadge();
    } catch (_err) {
      // Badging API unavailable / not permitted — safe to ignore.
    }
  }
}

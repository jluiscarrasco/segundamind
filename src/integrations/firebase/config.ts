import { initializeApp } from 'firebase/app';
import { getAuth, connectAuthEmulator } from 'firebase/auth';
import { initializeFirestore, connectFirestoreEmulator, persistentLocalCache, persistentMultipleTabManager } from 'firebase/firestore';
import { getStorage, connectStorageEmulator } from 'firebase/storage';
import { initializeAppCheck, ReCaptchaV3Provider, getToken as getAppCheckToken } from 'firebase/app-check';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
// experimentalAutoDetectLongPolling works around "WebChannelConnection RPC
// 'Listen' stream transport errored" / 400 Bad Request on networks (common
// on mobile carriers, VPNs, corporate proxies, some ad blockers) that don't
// support Firestore's default fetch-streaming transport.
// persistentLocalCache: without it, every page load / listener reconnect
// (e.g. after an hourly token refresh with expired resume tokens) re-reads
// EVERY document of every listened collection from the server — the source
// of the 34K-read spikes. With IndexedDB persistence, reconnects serve from
// cache and only sync deltas.
export const db = initializeFirestore(app, {
  experimentalAutoDetectLongPolling: true,
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});
export const storage = getStorage(app);

// App Check only runs in production builds: in local dev the reCAPTCHA
// exchange 403s (and the SDK then throttles itself for 24h), and dev AI
// calls go to the local Express server which doesn't enforce App Check.
const recaptchaSiteKey = import.meta.env.VITE_RECAPTCHA_SITE_KEY;
const appCheck = recaptchaSiteKey && !import.meta.env.DEV
  ? initializeAppCheck(app, {
      provider: new ReCaptchaV3Provider(recaptchaSiteKey),
      isTokenAutoRefreshEnabled: true,
    })
  : null;

// Returns a fresh App Check token to attach to outgoing API calls, or null
// if App Check isn't active (local dev, or missing site key).
export async function getAppCheckHeader(): Promise<string | null> {
  if (!appCheck) {
    if (!import.meta.env.DEV) console.warn('[AppCheck] Not initialized (missing VITE_RECAPTCHA_SITE_KEY)');
    return null;
  }
  try {
    const { token } = await getAppCheckToken(appCheck);
    return token;
  } catch (e) {
    console.error('[AppCheck] getToken failed:', e);
    return null;
  }
}

// TODO: Enable emulator if needed for local testing
// if (import.meta.env.DEV) {
//   try {
//     connectAuthEmulator(auth, 'http://localhost:9099', { disableWarnings: true });
//     connectFirestoreEmulator(db, 'localhost', 8080);
//     connectStorageEmulator(storage, 'localhost', 9199);
//   } catch (e) {
//     // Emulator already connected
//   }
// }

export default app;

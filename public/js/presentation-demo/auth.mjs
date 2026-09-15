const localParams = new URLSearchParams(window.location.search);

function localUid() {
  if (!['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname)) return '';
  return localParams.get('localUid') || sessionStorage.getItem('bel.presentation.localUid') || '';
}

export async function bootAuth() {
  const uid = localUid();
  if (uid) {
    sessionStorage.setItem('bel.presentation.localUid', uid);
    return { uid, email: `${uid}@local.invalid`, accountStatus: 'active', isAdmin: uid === 'admin', local: true };
  }
  if (!window.firebase?.auth) return null;
  try {
    const configResponse = await fetch('/api/config', { cache: 'no-store' });
    const config = await configResponse.json();
    if (config?.config?.apiKey && !window.firebase.apps?.length) window.firebase.initializeApp(config.config);
    const auth = window.firebase.auth();
    if (config?.authEmulatorUrl && !['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname)) throw Error('Emulator configuration is not allowed on this origin.');
    if (config?.authEmulatorUrl && !auth.__belEmulatorConnected) {
      auth.useEmulator(config.authEmulatorUrl);
      auth.__belEmulatorConnected = true;
    }
    return new Promise(resolve => {
      const unsubscribe = auth.onAuthStateChanged(async user => {
        unsubscribe();
        if (!user) return resolve(null);
        const identity = { uid: user.uid, email: user.email || null, accountStatus: 'active', isAdmin: false, user, local: false };
        try {
          const token = await user.getIdToken();
          const capabilityResponse = await fetch('/api/presentation-demo/capabilities', { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
          const capability = await capabilityResponse.json();
          if (!capabilityResponse.ok || capability.success === false) return resolve(null);
          Object.assign(identity, capability.data || {});
        } catch (_) { return resolve(null); }
        resolve(identity);
      });
    });
  } catch (_) {
    return null;
  }
}

export async function authHeaders(identity) {
  if (identity?.local) return { 'X-Demo-User': identity.uid };
  if (identity?.user?.getIdToken) return { Authorization: `Bearer ${await identity.user.getIdToken()}` };
  return {};
}

export async function authToken(identity) {
  if (identity?.local) return `dev:${identity.uid}`;
  return identity?.user?.getIdToken ? identity.user.getIdToken() : null;
}

export function signInUrl() {
  return `/index.html?next=${encodeURIComponent(window.location.pathname + window.location.search)}`;
}

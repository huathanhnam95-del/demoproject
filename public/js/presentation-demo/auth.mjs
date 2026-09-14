const localParams = new URLSearchParams(window.location.search);

function localUid() {
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
    return new Promise(resolve => {
      const unsubscribe = auth.onAuthStateChanged(user => {
        unsubscribe();
        resolve(user ? { uid: user.uid, email: user.email || null, accountStatus: 'active', isAdmin: false, user, local: false } : null);
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

export function signInUrl() {
  return `/index.html?next=${encodeURIComponent(window.location.pathname + window.location.search)}`;
}

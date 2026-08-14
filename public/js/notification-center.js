import { collection, doc, limit, onSnapshot, orderBy, query, updateDoc, where } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';

(function () {
  const toggle = document.getElementById('notification-center-toggle');
  const panel = document.getElementById('notification-center-panel');
  const list = document.getElementById('notification-center-list');
  const badge = document.getElementById('notification-center-badge');
  const markRead = document.getElementById('notification-center-mark-read');
  if (!toggle || !panel || !list) return;
  let unsubscribe = null;
  let authUnsubscribe = null;
  let retryTimer = null;
  let retryDeadline = null;
  let currentNotifications = [];

  toggle.addEventListener('click', () => {
    const open = panel.hidden;
    panel.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
  });

  function render() {
    const unread = currentNotifications.filter((item) => item.isRead !== true).length;
    badge.hidden = unread === 0;
    badge.textContent = unread > 99 ? '99+' : String(unread);
    if (!currentNotifications.length) {
      renderMessage('No notifications yet.');
      return;
    }
    const items = currentNotifications.map((item) => {
      const article = document.createElement('article');
      article.className = `notification-center-item${item.isRead ? '' : ' is-unread'}`;
      article.dataset.notificationId = String(item.id || '');
      const title = document.createElement('div');
      title.className = 'notification-center-item__title';
      title.textContent = item.title || 'Essay AI update';
      const body = document.createElement('div');
      body.className = 'notification-center-item__body';
      body.textContent = item.body || item.message || '';
      article.append(title, body);
      return article;
    });
    list.replaceChildren(...items);
  }

  function renderMessage(message) {
    const paragraph = document.createElement('p');
    paragraph.className = 'site-header__muted';
    paragraph.textContent = message;
    list.replaceChildren(paragraph);
  }

  function attach(user) {
    if (unsubscribe) unsubscribe();
    unsubscribe = null;
    currentNotifications = [];
    render();
    if (!user || !window.__FIREBASE_INTERNAL__?.db) return;
    const notificationsQuery = query(collection(window.__FIREBASE_INTERNAL__.db, 'user_notifications'), where('uid', '==', user.uid), orderBy('createdAt', 'desc'), limit(30));
    unsubscribe = onSnapshot(notificationsQuery, (snapshot) => {
      currentNotifications = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
      render();
    }, (error) => {
      console.warn('[NotificationCenter] Indexed query failed, trying unindexed fallback:', error);
      const fallbackQuery = query(collection(window.__FIREBASE_INTERNAL__.db, 'user_notifications'), where('uid', '==', user.uid), limit(50));
      unsubscribe = onSnapshot(fallbackQuery, (snapshot) => {
        currentNotifications = snapshot.docs
          .map((item) => ({ id: item.id, ...item.data() }))
          .sort((a, b) => {
            const timeA = a.createdAt?.toDate ? a.createdAt.toDate().getTime() : new Date(a.createdAt || 0).getTime();
            const timeB = b.createdAt?.toDate ? b.createdAt.toDate().getTime() : new Date(b.createdAt || 0).getTime();
            return timeB - timeA;
          })
          .slice(0, 30);
        render();
      }, () => {
        renderMessage('Notifications are temporarily unavailable.');
      });
    });
  }

  markRead?.addEventListener('click', async () => {
    await Promise.all(currentNotifications.filter((item) => item.isRead !== true).map((item) => updateDoc(doc(window.__FIREBASE_INTERNAL__.db, 'user_notifications', item.id), { isRead: true })));
  });

  function observeAuth(auth) {
    authUnsubscribe?.();
    authUnsubscribe = onAuthStateChanged(auth, attach);
  }

  const auth = window.__FIREBASE_INTERNAL__?.auth;
  if (auth) observeAuth(auth);
  else {
    render();
    retryTimer = window.setInterval(() => {
      const readyAuth = window.__FIREBASE_INTERNAL__?.auth;
      if (!readyAuth) return;
      window.clearInterval(retryTimer);
      retryTimer = null;
      observeAuth(readyAuth);
    }, 250);
    retryDeadline = window.setTimeout(() => {
      if (retryTimer) window.clearInterval(retryTimer);
      retryTimer = null;
    }, 10000);
  }

  window.addEventListener('pagehide', () => {
    unsubscribe?.();
    authUnsubscribe?.();
    if (retryTimer) window.clearInterval(retryTimer);
    if (retryDeadline) window.clearTimeout(retryDeadline);
  }, { once: true });
})();

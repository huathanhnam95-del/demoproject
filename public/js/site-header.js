(function () {
  const body = document.body;
  if (!body || body.querySelector('[data-site-header]')) {
    return;
  }

  const locale = body.dataset.siteLocale === 'vi' ? 'vi' : 'en';
  const section = body.dataset.siteSection || 'practice';
  const homeHref = locale === 'vi' ? '/landing/vi/' : '/landing/en/';

  const links = [
    { id: 'practice', label: 'Practice', href: '/index.html' }
  ];

  const header = document.createElement('header');
  header.className = 'site-header';
  header.setAttribute('data-site-header', 'true');

  const inner = document.createElement('div');
  inner.className = 'site-header__inner';

  const brand = document.createElement('a');
  brand.className = 'site-header__brand';
  brand.href = '/index.html';
  brand.innerHTML = `
    <span class="site-header__brand-mark" aria-hidden="true">BEL</span>
    <span class="site-header__brand-copy">
      <span class="site-header__brand-title">Better English Learning</span>
      <span class="site-header__brand-subtitle">Adaptive English practice for active learners</span>
    </span>
  `;

  const nav = document.createElement('nav');
  nav.className = 'site-header__links';
  nav.setAttribute('aria-label', 'Primary');

  links.forEach((link) => {
    const anchor = document.createElement('a');
    anchor.className = 'site-header__link';
    anchor.href = link.href;
    anchor.textContent = link.label;
    if (link.id === section) {
      anchor.setAttribute('aria-current', 'page');
    }
    nav.appendChild(anchor);
  });
  const accountBtn = document.getElementById('account-panel-toggle') || document.createElement('button');
  accountBtn.id = 'account-panel-toggle';
  accountBtn.className = 'site-header__account-btn';
  accountBtn.type = 'button';
  accountBtn.title = 'Account';
  accountBtn.setAttribute('aria-label', 'Account');

  let accountIcon = accountBtn.querySelector('.toggle-icon');
  if (!accountIcon) {
    accountIcon = document.createElement('span');
    accountIcon.className = 'toggle-icon';
    accountBtn.replaceChildren(accountIcon);
  }
  accountIcon.setAttribute('aria-hidden', 'true');
  if (!accountIcon.textContent.trim() || accountIcon.textContent.trim() === '??') {
    accountIcon.textContent = '\uD83D\uDC64';
  }
  nav.appendChild(accountBtn);

  const notificationBtn = document.createElement('button');
  notificationBtn.id = 'notification-center-toggle';
  notificationBtn.className = 'site-header__notification-btn';
  notificationBtn.type = 'button';
  notificationBtn.setAttribute('aria-label', 'Notifications');
  notificationBtn.setAttribute('aria-expanded', 'false');
  notificationBtn.innerHTML = '<span aria-hidden="true">🔔</span><span id="notification-center-badge" class="site-header__notification-badge" hidden>0</span>';
  nav.appendChild(notificationBtn);

  const notificationPanel = document.createElement('div');
  notificationPanel.id = 'notification-center-panel';
  notificationPanel.className = 'notification-center-panel';
  notificationPanel.hidden = true;
  notificationPanel.innerHTML = '<div class="notification-center-panel__header"><strong>Notifications</strong><button type="button" id="notification-center-mark-read">Mark all read</button></div><div id="notification-center-list" class="notification-center-panel__list"><p class="site-header__muted">Sign in to view notifications.</p></div>';
  header.appendChild(notificationPanel);

  inner.appendChild(brand);
  inner.appendChild(nav);
  header.appendChild(inner);

  body.insertAdjacentElement('afterbegin', header);
  body.classList.add('has-site-header');
})();

(function () {
  const body = document.body;
  if (!body || body.querySelector('[data-site-header]')) {
    return;
  }

  const locale = body.dataset.siteLocale === 'vi' ? 'vi' : 'en';
  const section = body.dataset.siteSection || 'practice';
  const homeHref = locale === 'vi' ? '/landing/vi/' : '/landing/en/';

  const links = [
    { id: 'home', label: 'Home', href: homeHref },
    { id: 'practice', label: 'Practice', href: '/index.html' },
    { id: 'about', label: 'About Us', href: '/about/' }
  ];

  const header = document.createElement('header');
  header.className = 'site-header';
  header.setAttribute('data-site-header', 'true');

  const inner = document.createElement('div');
  inner.className = 'site-header__inner';

  const brand = document.createElement('a');
  brand.className = 'site-header__brand';
  brand.href = homeHref;
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

  inner.appendChild(brand);
  inner.appendChild(nav);
  header.appendChild(inner);

  body.insertAdjacentElement('afterbegin', header);
  body.classList.add('has-site-header');
})();

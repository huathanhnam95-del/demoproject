/**
 * Landing Page JavaScript
 * Better English Learning (BEL)
 */

(function () {
    'use strict';

    // ============================================
    // Scroll Animations
    // ============================================

    function initScrollAnimations() {
        const animatedElements = document.querySelectorAll(
            '.feature-card, .step, .demo-content, .comparison-table, .screenshot-card, .faq-item, .section-header'
        );

        if (!animatedElements.length) return;

        // Add fade-in class
        animatedElements.forEach(el => {
            el.classList.add('fade-in');
        });

        // Create Intersection Observer
        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    entry.target.classList.add('visible');
                    observer.unobserve(entry.target);
                }
            });
        }, {
            threshold: 0.1,
            rootMargin: '0px 0px -50px 0px'
        });

        // Observe elements
        animatedElements.forEach(el => observer.observe(el));
    }

    // ============================================
    // Smooth Scroll
    // ============================================

    function initSmoothScroll() {
        function getStickyOffset() {
            const siteHeaderHeight = document.querySelector('.site-header')?.offsetHeight || 0;
            const sectionNavHeight = document.getElementById('nav')?.offsetHeight || 0;
            return siteHeaderHeight + sectionNavHeight;
        }

        document.querySelectorAll('a[href^="#"]').forEach(anchor => {
            anchor.addEventListener('click', function (e) {
                const targetId = this.getAttribute('href');
                if (targetId === '#') return;

                const targetElement = document.querySelector(targetId);
                if (targetElement) {
                    e.preventDefault();
                    const stickyOffset = getStickyOffset();
                    const targetPosition = targetElement.getBoundingClientRect().top + window.pageYOffset - stickyOffset - 20;

                    window.scrollTo({
                        top: targetPosition,
                        behavior: 'smooth'
                    });
                }
            });
        });
    }

    function initMobileNav() {
        const nav = document.getElementById('nav');
        const navLinks = document.getElementById('nav-links');
        const menuButton = document.querySelector('.nav-menu-toggle');

        if (!nav || !navLinks || !menuButton) return;

        function setMenuState(isOpen) {
            nav.classList.toggle('nav--menu-open', isOpen);
            menuButton.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
        }

        menuButton.addEventListener('click', () => {
            const isOpen = menuButton.getAttribute('aria-expanded') !== 'true';
            setMenuState(isOpen);
        });

        navLinks.querySelectorAll('a').forEach((link) => {
            link.addEventListener('click', () => {
                setMenuState(false);
            });
        });

        window.addEventListener('resize', () => {
            if (window.innerWidth > 768) {
                setMenuState(false);
            }
        }, { passive: true });
    }

    // ============================================
    // Navigation Scroll Effect
    // ============================================

    function initNavScroll() {
        const nav = document.getElementById('nav');
        if (!nav) return;

        window.addEventListener('scroll', () => {
            const currentScrollY = window.scrollY;

            if (currentScrollY > 10) {
                nav.style.boxShadow = '0 2px 10px rgba(0, 0, 0, 0.1)';
            } else {
                nav.style.boxShadow = 'none';
            }
        }, { passive: true });
    }

    // ============================================
    // Placeholder Image Handler
    // ============================================

    function handleMissingImages() {
        const images = document.querySelectorAll('img');

        images.forEach(img => {
            img.addEventListener('error', function () {
                const placeholder = document.createElement('div');
                placeholder.className = 'image-placeholder';
                placeholder.style.cssText = `
          display: flex;
          align-items: center;
          justify-content: center;
          background: linear-gradient(135deg, #e8f0fe 0%, #d2e3fc 100%);
          color: #5f6368;
          font-size: 1rem;
          font-weight: 500;
          aspect-ratio: 16/9;
          width: 100%;
          border-radius: 8px;
        `;
                placeholder.textContent = 'Preview Coming Soon';

                if (this.parentNode) {
                    this.parentNode.replaceChild(placeholder, this);
                }
            });
        });
    }

    // ============================================
    // Your Journey: Roadmap Interactivity
    // ============================================

    function initJourneyAnimations() {
        const roadWrapper = document.getElementById('roadMapWrapper');
        if (!roadWrapper) return;

        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    entry.target.classList.add('visible');
                    observer.unobserve(entry.target);

                    // Auto-open Day 0 after a short delay for better UX
                    setTimeout(() => {
                        openMilestone('1');
                    }, 1200);
                }
            });
        }, { threshold: 0.2 });

        observer.observe(roadWrapper);
    }

    function openMilestone(pinNum) {
        const pins = document.querySelectorAll('.road-pin');
        const details = document.querySelectorAll('.roadmap-detail');
        const panel = document.getElementById('roadmapDetailPanel');

        // Deactivate all
        pins.forEach(p => p.classList.remove('active'));
        details.forEach(d => d.classList.remove('active'));

        // Activate selected
        const targetPin = document.querySelector(`.road-pin[data-pin="${pinNum}"]`);
        const targetDetail = document.querySelector(`.roadmap-detail[data-for-pin="${pinNum}"]`);

        if (targetPin) targetPin.classList.add('active');
        if (targetDetail) {
            targetDetail.classList.add('active');

            // Smooth scroll to details if needed
            if (window.innerWidth < 768) {
                targetDetail.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }
        }
    }

    function initRoadmapInteractions() {
        const pins = document.querySelectorAll('.road-pin');
        let hoverTimeout;

        pins.forEach(pin => {
            pin.addEventListener('mouseenter', () => {
                const pinNum = pin.getAttribute('data-pin');

                // Add a tiny delay to prevent jitter when quickly sweeping across pins
                clearTimeout(hoverTimeout);
                hoverTimeout = setTimeout(() => {
                    openMilestone(pinNum);
                }, 50);
            });

            // Allow click as a fallback/mobile support too
            pin.addEventListener('click', () => {
                const pinNum = pin.getAttribute('data-pin');
                openMilestone(pinNum);
            });
        });
    }

    // ============================================
    // Initialize
    // ============================================

    function init() {
        initMobileNav();
        initScrollAnimations();
        initSmoothScroll();
        initNavScroll();
        handleMissingImages();
        initJourneyAnimations();
        initRoadmapInteractions();
    }

    // Run when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();


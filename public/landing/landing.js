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
        document.querySelectorAll('a[href^="#"]').forEach(anchor => {
            anchor.addEventListener('click', function (e) {
                const targetId = this.getAttribute('href');
                if (targetId === '#') return;

                const targetElement = document.querySelector(targetId);
                if (targetElement) {
                    e.preventDefault();
                    const navHeight = document.querySelector('.nav')?.offsetHeight || 0;
                    const targetPosition = targetElement.getBoundingClientRect().top + window.pageYOffset - navHeight - 20;

                    window.scrollTo({
                        top: targetPosition,
                        behavior: 'smooth'
                    });
                }
            });
        });
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
    // Initialize
    // ============================================

    function init() {
        initScrollAnimations();
        initSmoothScroll();
        initNavScroll();
        handleMissingImages();

        console.log('🚀 BEL Landing page initialized');
    }

    // Run when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();

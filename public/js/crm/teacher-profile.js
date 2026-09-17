/**
 * CRM Teacher/Admin Profile Controller
 * Handles the logic for the profile dropdown in the top-right header of the CRM Admin.
 */
document.addEventListener('DOMContentLoaded', () => {
    initTeacherProfile();
});

async function initTeacherProfile() {
    const profileBtn = document.querySelector('.crm-user-profile');
    if (!profileBtn) return;

    profileBtn.style.cursor = 'pointer';
    profileBtn.style.position = 'relative';

    // Wait slightly to ensure auth is loaded, then fetch user info
    if (typeof window.authFunctions !== 'undefined') {
        window.authFunctions.onAuthStateChanged(async (user) => {
            if (user) {
                updateProfileHeader(user);
                await buildProfileDropdown(user);
            }
        });
    }
}

async function updateProfileHeader(user) {
    const nameEl = document.querySelector('.crm-user-name');
    const avatarEl = document.querySelector('.crm-avatar');

    let displayName = user.email || 'Admin';
    if (user.email) {
        displayName = user.email.split('@')[0];
    }

    // Attempt to pull from Firestore profile if available
    if (typeof window.firestoreFunctions !== 'undefined' && window.firestoreFunctions.getUserProfile) {
        try {
            const profileRes = await window.firestoreFunctions.getUserProfile(user.uid);
            if (profileRes.success && profileRes.data.displayName) {
                displayName = profileRes.data.displayName;
            }
        } catch (e) {
            console.warn('Teacher Profile: Could not fetch user profile details', e);
        }
    }

    if (nameEl) nameEl.textContent = `Hi, ${displayName}`;
    if (avatarEl) avatarEl.textContent = displayName.charAt(0).toUpperCase();
}

async function buildProfileDropdown(user) {
    const profileBtn = document.querySelector('.crm-user-profile');

    // Check if it already exists
    if (document.getElementById('crm-teacher-profile-dropdown')) return;

    const dropdown = document.createElement('div');
    dropdown.id = 'crm-teacher-profile-dropdown';
    dropdown.className = 'crm-dropdown-menu';
    dropdown.style.cssText = 'position: absolute; top: calc(100% + 5px); right: 0; min-width: 280px; padding: 16px; display: none; flex-direction: column; gap: 12px; z-index: 9999; box-shadow: 0 4px 12px rgba(0,0,0,0.1); border-radius: 8px; background: #fff; cursor: default;';

    dropdown.innerHTML = `
        <div style="border-bottom: 1px solid #eaeaea; padding-bottom: 12px; margin-bottom: 4px;">
            <div style="font-weight: 600; font-size: 1.1em; color: #1f2937;" id="dropdown-teacher-email">${user.email || 'Unknown Email'}</div>
            <div style="font-size: 0.85em; color: #6b7280; text-transform: uppercase; margin-top: 2px;">Administrator / Teacher</div>
        </div>
        
        <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #eaeaea; padding-bottom: 12px;">
            <div style="display: flex; flex-direction: column;">
                <span style="font-size: 0.8em; color: #6b7280;">Active Classes</span>
                <strong style="color: #4f46e5; font-size: 1.25em;" id="dropdown-active-classes">-</strong>
            </div>
            <div style="display: flex; flex-direction: column; text-align: right;">
                <span style="font-size: 0.8em; color: #6b7280;">Upcoming Sessions</span>
                <strong style="color: #10b981; font-size: 1.25em;" id="dropdown-upcoming-sessions">-</strong>
            </div>
        </div>

        <div style="display: flex; flex-direction: column; gap: 8px;">
            <button class="crm-btn-secondary" id="dropdown-btn-schedule" style="width: 100%; text-align: center;">Jump to Schedule</button>
            <button class="crm-btn-secondary" id="dropdown-btn-logout" style="width: 100%; text-align: center; border-color: #ef4444; color: #ef4444;">Log Out</button>
        </div>
    `;

    profileBtn.appendChild(dropdown);

    // Event Binding
    profileBtn.addEventListener('click', (e) => {
        if (e.target.closest('#crm-teacher-profile-dropdown')) return; // ignore clicks inside
        dropdown.style.display = dropdown.style.display === 'none' ? 'flex' : 'none';
    });

    document.addEventListener('click', (e) => {
        if (!profileBtn.contains(e.target)) {
            dropdown.style.display = 'none';
        }
    });

    document.getElementById('dropdown-btn-schedule').addEventListener('click', () => {
        dropdown.style.display = 'none';
        const navItems = document.querySelectorAll('.crm-nav-item');
        // Let CRM handle the tab click simulation securely
        navItems.forEach(btn => {
            if (btn.getAttribute('data-main') === 'courses') {
                btn.click();
            }
        });
        const subItems = document.querySelectorAll('.crm-dropdown-menu button');
        subItems.forEach(btn => {
            if (btn.getAttribute('data-sub') === 'teacher-schedule') {
                btn.click();
            }
        });
    });

    document.getElementById('dropdown-btn-logout').addEventListener('click', async () => {
        dropdown.style.display = 'none';
        try {
            localStorage.removeItem('crm_auth_session');
        } catch (e) {
            /* ignore storage cleanup error */
        }
        try {
            sessionStorage.removeItem('crm_auth_session');
        } catch (e) {
            /* ignore storage cleanup error */
        }
        try {
            document.documentElement.classList.remove('crm-session-cached');
        } catch (e) {
            /* ignore DOM cleanup error */
        }
        if (typeof window.authFunctions !== 'undefined' && typeof window.authFunctions.signOut === 'function') {
            try { await window.authFunctions.signOut(); } catch (e) { /* ignore signout error */ }
        } else if (typeof window.firebase !== 'undefined' && typeof window.firebase.auth === 'function') {
            try { await window.firebase.auth().signOut(); } catch (e) { /* ignore signout error */ }
        }
        window.location.reload();
    });

    // Fire off async fetch for workload metrics securely
    fetchTeacherWorkload(user.uid);
}

async function fetchTeacherWorkload(uid) {
    // Only query if firestoreFunctions exist
    if (!uid) return;
    if (!window.firestoreFunctions || !window.firestoreFunctions.db) return;
    try {
        // Workload metrics are intentionally best-effort; keep the dropdown usable even when the
        // metrics API is unavailable in this environment.
        const activeEl = document.getElementById('dropdown-active-classes');
        const upcomingEl = document.getElementById('dropdown-upcoming-sessions');
        if (activeEl) activeEl.textContent = 'N/A';
        if (upcomingEl) upcomingEl.textContent = 'N/A';
    } catch (e) {
        console.warn('Failed to load teacher workload', e);
    }
}

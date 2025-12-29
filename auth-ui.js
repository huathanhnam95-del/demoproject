/**
 * Authentication UI Controller
 * 
 * Handles all UI interactions for authentication:
 * - Login/signup form handling
 * - Right-side account panel (collapsible)
 * - Entry choice modal (first visit)
 * - Guest mode state management
 * - Session tracking (login, logout, tab close, visibility change)
 * - Profile data display
 */

// Wait for Firebase to be initialized
let authFunctions, firestoreFunctions;
let currentSessionId = null;
let currentUserId = null;

// Guest mode state: true if user chose to view as guest
// This is stored in sessionStorage to persist during the session
let isGuestMode = false;

// ============================================
// Auth State Change Callbacks
// ============================================
// These callbacks are called when auth state changes (login/logout)
// Used to trigger UI updates in other modules (e.g., progress reload)
let authStateCallbacks = [];

// Initialize when Firebase is ready
function initializeAuthUI() {
  // Wait for Firebase functions to be available
  if (!window.firebaseAuthFunctions || !window.firebaseFirestoreFunctions) {
    setTimeout(initializeAuthUI, 100);
    return;
  }

  authFunctions = window.firebaseAuthFunctions;
  firestoreFunctions = window.firebaseFirestoreFunctions;

  setupEventListeners();
  setupAuthStateListener();
  setupSessionTracking();
}

/**
 * Setup all event listeners for auth UI
 */
function setupEventListeners() {
  // ============================================
  // Entry Modal (First Visit)
  // ============================================
  const guestModeBtn = document.getElementById('guest-mode-btn');
  if (guestModeBtn) {
    guestModeBtn.addEventListener('click', handleGuestModeChoice);
  }

  const loginChoiceBtn = document.getElementById('login-choice-btn');
  if (loginChoiceBtn) {
    loginChoiceBtn.addEventListener('click', handleLoginChoice);
  }

  // Close entry modal when clicking outside
  const entryModal = document.getElementById('entry-modal');
  if (entryModal) {
    entryModal.addEventListener('click', (e) => {
      if (e.target === entryModal) {
        // Don't allow closing by clicking outside - user must choose
        // This ensures they make a conscious choice
      }
    });
  }

  // ============================================
  // Guest Toast Notification
  // ============================================
  const toastClose = document.getElementById('toast-close');
  if (toastClose) {
    toastClose.addEventListener('click', hideGuestToast);
  }

  // ============================================
  // Right-Side Account Panel
  // ============================================
  const panelToggle = document.getElementById('account-panel-toggle');
  if (panelToggle) {
    panelToggle.addEventListener('click', toggleAccountPanel);
  }

  const panelCloseBtn = document.getElementById('panel-close-btn');
  if (panelCloseBtn) {
    panelCloseBtn.addEventListener('click', closeAccountPanel);
  }

  // Panel buttons (logged out state)
  const panelLoginBtn = document.getElementById('panel-login-btn');
  if (panelLoginBtn) {
    panelLoginBtn.addEventListener('click', showLoginForm);
  }

  const panelRegisterBtn = document.getElementById('panel-register-btn');
  if (panelRegisterBtn) {
    panelRegisterBtn.addEventListener('click', showSignupForm);
  }

  // Panel buttons (logged in state)
  const panelLogoutBtn = document.getElementById('panel-logout-btn');
  if (panelLogoutBtn) {
    panelLogoutBtn.addEventListener('click', handleLogout);
  }

  const panelChangePasswordBtn = document.getElementById('panel-change-password-btn');
  if (panelChangePasswordBtn) {
    panelChangePasswordBtn.addEventListener('click', handleChangePassword);
  }

  // Panel button (guest mode state)
  const panelGuestLoginBtn = document.getElementById('panel-guest-login-btn');
  if (panelGuestLoginBtn) {
    panelGuestLoginBtn.addEventListener('click', showLoginForm);
  }

  // Shopping Placeholder
  const shoppingCard = document.getElementById('panel-shopping-card');
  if (shoppingCard) {
    shoppingCard.addEventListener('click', () => {
      showShoppingModal();
    });
  }

  // ============================================
  // Account Details Modal (Full Details)
  // ============================================
  const closeDetailsBtn = document.getElementById('close-details-btn');
  if (closeDetailsBtn) {
    closeDetailsBtn.addEventListener('click', hideAccountDetailsModal);
  }

  // Form switches
  const switchToSignup = document.getElementById('switch-to-signup');
  if (switchToSignup) {
    switchToSignup.addEventListener('click', (e) => {
      e.preventDefault();
      showSignupForm();
    });
  }

  const switchToLogin = document.getElementById('switch-to-login');
  if (switchToLogin) {
    switchToLogin.addEventListener('click', (e) => {
      e.preventDefault();
      showLoginForm();
    });
  }

  // Login form submission
  const loginForm = document.getElementById('login-form-element');
  if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      await handleLogin();
    });
  }

  // Signup form submission
  const signupForm = document.getElementById('signup-form-element');
  if (signupForm) {
    signupForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      await handleSignup();
    });
  }
}

/**
 * ============================================
 * Entry Modal Functions (First Visit)
 * ============================================
 */

/**
 * Show entry modal (first visit when no auth session)
 */
function showEntryModal() {
  const entryModal = document.getElementById('entry-modal');
  if (entryModal) {
    entryModal.style.display = 'flex';
  }
}

/**
 * Hide entry modal
 */
function hideEntryModal() {
  const entryModal = document.getElementById('entry-modal');
  if (entryModal) {
    entryModal.style.display = 'none';
  }
}

/**
 * Handle guest mode choice
 * Sets guest mode and hides entry modal
 */
function handleGuestModeChoice() {
  isGuestMode = true;
  sessionStorage.setItem('guestMode', 'true');
  hideEntryModal();
  showGuestToast();
  updateAccountPanelState();
}

/**
 * Handle login choice from entry modal
 * Hides entry modal and shows login form
 */
function handleLoginChoice() {
  hideEntryModal();
  showLoginForm();
}

/**
 * ============================================
 * Guest Toast Notification
 * ============================================
 */

/**
 * Show guest mode toast notification
 */
function showGuestToast() {
  const toast = document.getElementById('guest-toast');
  if (toast) {
    toast.style.display = 'flex';
    // Auto-hide after 5 seconds
    setTimeout(() => {
      hideGuestToast();
    }, 5000);
  }
}

/**
 * Hide guest mode toast notification
 */
function hideGuestToast() {
  const toast = document.getElementById('guest-toast');
  if (toast) {
    toast.style.display = 'none';
  }
}

/**
 * ============================================
 * Right-Side Account Panel Functions
 * ============================================
 */

/**
 * Toggle account panel (expand/collapse)
 */
function toggleAccountPanel() {
  const panelSide = document.getElementById('account-panel-side');
  if (panelSide) {
    panelSide.classList.toggle('expanded');
  }
}

/**
 * Close account panel
 */
function closeAccountPanel() {
  const panelSide = document.getElementById('account-panel-side');
  if (panelSide) {
    panelSide.classList.remove('expanded');
  }
}

/**
 * Update account panel content based on current auth state
 * Shows appropriate section: logged out, logged in, or guest mode
 */
function updateAccountPanelState() {
  const panelLoggedOut = document.getElementById('panel-logged-out');
  const panelLoggedIn = document.getElementById('panel-logged-in');
  const panelGuestMode = document.getElementById('panel-guest-mode');
  const panelEmail = document.getElementById('panel-email');

  const user = authFunctions ? authFunctions.getCurrentUser() : null;

  if (user) {
    // Logged in state
    if (panelLoggedOut) panelLoggedOut.style.display = 'none';
    if (panelGuestMode) panelGuestMode.style.display = 'none';
    if (panelLoggedIn) panelLoggedIn.style.display = 'block';
    if (panelEmail) panelEmail.textContent = user.email || '-';
    isGuestMode = false; // Clear guest mode when logged in
    sessionStorage.removeItem('guestMode');

    // Load and display Practice Points
    loadPracticePoints(user.uid);
  } else if (isGuestMode) {
    // Guest mode state
    if (panelLoggedOut) panelLoggedOut.style.display = 'none';
    if (panelLoggedIn) panelLoggedIn.style.display = 'none';
    if (panelGuestMode) panelGuestMode.style.display = 'block';
  } else {
    // Logged out state
    if (panelLoggedIn) panelLoggedIn.style.display = 'none';
    if (panelGuestMode) panelGuestMode.style.display = 'none';
    if (panelLoggedOut) panelLoggedOut.style.display = 'block';
  }
}

/**
 * Load and display Practice Points for logged-in user
 * @param {string} userId - User ID
 */
async function loadPracticePoints(userId) {
  const pointsCountEl = document.getElementById('panel-points-count');
  if (!pointsCountEl) return;

  try {
    const result = await firestoreFunctions.getTotalPoints(userId);
    if (result.success) {
      pointsCountEl.textContent = result.totalPoints.toLocaleString();
    } else {
      pointsCountEl.textContent = '0';
    }

    // Load history as well
    loadPointsHistory(userId);
  } catch (error) {
    console.error('Error loading practice points:', error);
    pointsCountEl.textContent = '0';
  }
}

/**
 * Update the Practice Points display with a new value
 * Called when points change (e.g., after completing a task)
 * @param {number} points - New total points value
 */
function updatePracticePointsDisplay(points) {
  const pointsCountEl = document.getElementById('panel-points-count');
  if (pointsCountEl) {
    pointsCountEl.textContent = points.toLocaleString();
  }
}

/**
 * ============================================
 * Login/Signup Form Functions
 * ============================================
 */

/**
 * Show login form
 */
function showLoginForm() {
  const authOverlay = document.getElementById('auth-overlay');
  const loginForm = document.getElementById('login-form');
  const signupForm = document.getElementById('signup-form');
  const loginError = document.getElementById('login-error');
  const signupError = document.getElementById('signup-error');
  const signupSuccess = document.getElementById('signup-success');

  // Close account panel when opening login form
  closeAccountPanel();

  authOverlay.style.display = 'flex';
  loginForm.style.display = 'block';
  signupForm.style.display = 'none';
  loginError.style.display = 'none';
  signupError.style.display = 'none';
  signupSuccess.style.display = 'none';
}

/**
 * Show signup form
 */
function showSignupForm() {
  const authOverlay = document.getElementById('auth-overlay');
  const loginForm = document.getElementById('login-form');
  const signupForm = document.getElementById('signup-form');
  const loginError = document.getElementById('login-error');
  const signupError = document.getElementById('signup-error');
  const signupSuccess = document.getElementById('signup-success');

  authOverlay.style.display = 'flex';
  loginForm.style.display = 'none';
  signupForm.style.display = 'block';
  loginError.style.display = 'none';
  signupError.style.display = 'none';
  signupSuccess.style.display = 'none';
}

/**
 * Hide auth overlay
 */
function hideAuthOverlay() {
  const authOverlay = document.getElementById('auth-overlay');
  authOverlay.style.display = 'none';
}

/**
 * Handle login
 */
async function handleLogin() {
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  const errorDiv = document.getElementById('login-error');

  if (!email || !password) {
    errorDiv.textContent = 'Please fill in all fields';
    errorDiv.style.display = 'block';
    return;
  }

  errorDiv.style.display = 'none';

  const result = await authFunctions.signIn(email, password);

  if (result.success) {
    hideAuthOverlay();
    // Clear form
    document.getElementById('login-email').value = '';
    document.getElementById('login-password').value = '';
  } else {
    errorDiv.textContent = result.error || 'Login failed';
    errorDiv.style.display = 'block';
  }
}

/**
 * Handle signup
 */
async function handleSignup() {
  const email = document.getElementById('signup-email').value.trim();
  const password = document.getElementById('signup-password').value;
  const passwordConfirm = document.getElementById('signup-password-confirm').value;
  const errorDiv = document.getElementById('signup-error');
  const successDiv = document.getElementById('signup-success');

  if (!email || !password || !passwordConfirm) {
    errorDiv.textContent = 'Please fill in all fields';
    errorDiv.style.display = 'block';
    return;
  }

  if (password !== passwordConfirm) {
    errorDiv.textContent = 'Passwords do not match';
    errorDiv.style.display = 'block';
    return;
  }

  if (password.length < 6) {
    errorDiv.textContent = 'Password must be at least 6 characters';
    errorDiv.style.display = 'block';
    return;
  }

  errorDiv.style.display = 'none';

  const result = await authFunctions.signUp(email, password);

  if (result.success) {
    successDiv.textContent = result.message || 'Account created! Please check your email to verify.';
    successDiv.style.display = 'block';
    // Clear form
    document.getElementById('signup-email').value = '';
    document.getElementById('signup-password').value = '';
    document.getElementById('signup-password-confirm').value = '';
  } else {
    errorDiv.textContent = result.error || 'Signup failed';
    errorDiv.style.display = 'block';
  }
}

/**
 * Handle logout
 */
async function handleLogout() {
  // End session before logging out
  if (currentSessionId && currentUserId) {
    await firestoreFunctions.recordSessionEnd(currentSessionId, currentUserId);
    currentSessionId = null;
  }

  const result = await authFunctions.signOut();

  if (result.success) {
    hideAccountDetailsModal();
    closeAccountPanel();
    currentUserId = null;
    // After logout, user can choose guest mode or login again
    // Don't automatically show entry modal, let them use the panel
  } else {
    alert('Logout failed: ' + result.error);
  }
}

/**
 * Handle change password
 */
async function handleChangePassword() {
  const user = authFunctions.getCurrentUser();

  if (!user || !user.email) {
    alert('User not found');
    return;
  }

  const result = await authFunctions.sendPasswordReset(user.email);

  if (result.success) {
    alert(result.message || 'Password reset email sent! Check your inbox.');
  } else {
    alert('Failed to send password reset email: ' + result.error);
  }
}

/**
 * ============================================
 * Account Details Modal (Full Details)
 * ============================================
 */

/**
 * Show account details modal (full profile info)
 */
async function showAccountDetailsModal() {
  const accountDetailsModal = document.getElementById('account-details-modal');
  if (accountDetailsModal) {
    accountDetailsModal.style.display = 'flex';
    await loadUserProfile();
  }
}

/**
 * Hide account details modal
 */
function hideAccountDetailsModal() {
  const accountDetailsModal = document.getElementById('account-details-modal');
  if (accountDetailsModal) {
    accountDetailsModal.style.display = 'none';
  }
}

/**
 * Load and display user profile data
 */
async function loadUserProfile() {
  const user = authFunctions.getCurrentUser();

  if (!user) {
    return;
  }

  const profileResult = await firestoreFunctions.getUserProfile(user.uid);

  if (profileResult.success) {
    const data = profileResult.data;

    // Display email
    document.getElementById('account-email').textContent = data.email || user.email || '-';

    // Display account created time
    if (data.createdAt) {
      const createdDate = data.createdAt.toDate ? data.createdAt.toDate() : new Date(data.createdAt);
      document.getElementById('account-created').textContent = createdDate.toLocaleString();
    } else {
      document.getElementById('account-created').textContent = '-';
    }

    // Display last login time
    if (data.lastLoginAt) {
      const lastLoginDate = data.lastLoginAt.toDate ? data.lastLoginAt.toDate() : new Date(data.lastLoginAt);
      document.getElementById('account-last-login').textContent = lastLoginDate.toLocaleString();
    } else {
      document.getElementById('account-last-login').textContent = '-';
    }

    // Display total active time
    const totalSeconds = data.totalActiveSeconds || 0;
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    document.getElementById('account-total-time').textContent =
      `${hours}h ${minutes}m ${seconds}s`;
  }
}

/**
 * Setup auth state listener
 * This is where Firebase auth hooks into the UI
 * Updates panel state and handles session tracking
 * 
 * IMPORTANT: When a user logs in, this triggers:
 * 1. Account panel update
 * 2. Session tracking start
 * 3. Auth state callbacks (for progress UI reload)
 */
function setupAuthStateListener() {
  authFunctions.onAuthStateChanged(async (user) => {
    const authOverlay = document.getElementById('auth-overlay');
    const wasGuestMode = isGuestMode;
    const previousUserId = currentUserId;

    if (user) {
      // User is signed in
      // Clear guest mode when user logs in
      isGuestMode = false;
      sessionStorage.removeItem('guestMode');
      hideGuestToast();

      if (authOverlay) {
        authOverlay.style.display = 'none';
      }

      currentUserId = user.uid;

      // Create or update user profile
      const isNewUser = !user.metadata.lastSignInTime ||
        (new Date(user.metadata.creationTime) > new Date(user.metadata.lastSignInTime));
      await firestoreFunctions.createOrUpdateUserProfile(user.uid, user.email, isNewUser);

      // Start session tracking
      await startSession();

      // Update panel to show logged in state
      updateAccountPanelState();

      // ============================================
      // PROGRESS UI RELOAD AFTER LOGIN
      // ============================================
      // When user transitions from guest → logged-in, or logs in fresh,
      // trigger all registered callbacks to reload progress data.
      // This ensures progress bar, question status, filter dropdown,
      // and progress side panel are updated immediately without
      // requiring the user to change questions or reload the page.
      const isNewLogin = wasGuestMode || !previousUserId;
      if (isNewLogin) {
        console.log('✓ Auth state change detected: User logged in. Triggering progress UI reload...');
        triggerAuthStateCallbacks('login', user.uid);
      }
    } else {
      // User is signed out
      // End session if it exists
      if (currentSessionId && currentUserId) {
        await firestoreFunctions.recordSessionEnd(currentSessionId, currentUserId);
        currentSessionId = null;
      }

      const hadUser = currentUserId !== null;
      currentUserId = null;

      // Update panel to show logged out or guest state
      updateAccountPanelState();

      // ============================================
      // PROGRESS UI CLEAR AFTER LOGOUT
      // ============================================
      // When user logs out, trigger callbacks to clear/hide progress UI
      if (hadUser) {
        console.log('✓ Auth state change detected: User logged out. Triggering progress UI clear...');
        triggerAuthStateCallbacks('logout', null);
      }
    }
  });
}

/**
 * Register a callback to be called when auth state changes
 * 
 * Callbacks receive: (eventType: 'login' | 'logout', userId: string | null)
 * 
 * Used by script.js to reload progress data when user logs in
 * 
 * @param {Function} callback - Function to call on auth state change
 */
function onAuthStateChange(callback) {
  if (typeof callback === 'function') {
    authStateCallbacks.push(callback);
    console.log('✓ Auth state callback registered');
  }
}

/**
 * Trigger all registered auth state callbacks
 * 
 * @param {string} eventType - 'login' or 'logout'
 * @param {string|null} userId - User ID (null on logout)
 */
function triggerAuthStateCallbacks(eventType, userId) {
  authStateCallbacks.forEach(callback => {
    try {
      callback(eventType, userId);
    } catch (error) {
      console.error('Error in auth state callback:', error);
    }
  });
}

/**
 * Start session tracking
 * Guest mode: No session tracking (returns early)
 * Authenticated mode: Records session start in Firestore
 */
async function startSession() {
  // Guest mode: Do NOT track sessions
  if (isGuestMode) {
    return;
  }

  if (!currentUserId) return;

  try {
    // Check if there's an active session
    const activeSessionId = await firestoreFunctions.getActiveSessionId(currentUserId);

    if (!activeSessionId) {
      // Start new session
      currentSessionId = await firestoreFunctions.recordSessionStart(currentUserId);
    } else {
      currentSessionId = activeSessionId;
    }
  } catch (error) {
    console.error('Error starting session:', error);
  }
}

/**
 * Setup session tracking for tab close and visibility changes
 * Guest mode: No session tracking (all handlers return early)
 * Authenticated mode: Tracks visibility changes and page unload
 */
function setupSessionTracking() {
  // Track visibility changes (tab switch, minimize, etc.)
  document.addEventListener('visibilitychange', async () => {
    // Guest mode: Do NOT track sessions
    if (isGuestMode) {
      return;
    }

    if (document.hidden) {
      // Tab is hidden - end session
      if (currentSessionId && currentUserId) {
        await firestoreFunctions.recordSessionEnd(currentSessionId, currentUserId);
        currentSessionId = null;
      }
    } else {
      // Tab is visible - start new session
      if (currentUserId) {
        await startSession();
      }
    }
  });

  // Track page unload (tab close, refresh, navigation)
  window.addEventListener('beforeunload', async () => {
    // Guest mode: Do NOT track sessions
    if (isGuestMode) {
      return;
    }

    if (currentSessionId && currentUserId) {
      // Use sendBeacon for reliable delivery on page unload
      const sessionId = currentSessionId;
      const userId = currentUserId;

      // Note: sendBeacon doesn't work with async, so we'll handle this in the visibility change handler
      // This is a fallback
      navigator.sendBeacon('/api/session-end', JSON.stringify({ sessionId, userId }));
    }
  });
}

/**
 * Check if this is first visit (no auth session and no guest mode chosen)
 * Shows entry modal if needed
 */
function checkFirstVisit() {
  // Check if guest mode was already chosen in this session
  const guestModeStored = sessionStorage.getItem('guestMode');
  if (guestModeStored === 'true') {
    isGuestMode = true;
    updateAccountPanelState();
    return; // Don't show entry modal if guest mode already chosen
  }

  // Check if user is already logged in (Firebase will handle this via auth state listener)
  // If not logged in and not guest mode, show entry modal
  const user = authFunctions ? authFunctions.getCurrentUser() : null;
  if (!user && !isGuestMode) {
    // Small delay to ensure Firebase is initialized
    setTimeout(() => {
      const userAfterDelay = authFunctions ? authFunctions.getCurrentUser() : null;
      if (!userAfterDelay && !isGuestMode) {
        showEntryModal();
      }
    }, 500);
  }
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    initializeAuthUI();
    // Check for first visit after a short delay to allow Firebase to initialize
    setTimeout(checkFirstVisit, 1000);
  });
} else {
  initializeAuthUI();
  setTimeout(checkFirstVisit, 1000);
}

// Export for use in practice tracking and progress UI reload
window.authUI = {
  getCurrentUserId: () => currentUserId,
  isGuestMode: () => isGuestMode,
  // Register callback to be notified when auth state changes
  // Used by script.js to reload progress data on login
  onAuthStateChange: onAuthStateChange,
  // Practice Points functions
  loadPracticePoints: loadPracticePoints,
  updatePracticePointsDisplay: updatePracticePointsDisplay
};


/**
 * ============================================
 * Points UI Functions (Toast & History)
 * ============================================
 */

/**
 * Show a toast notification for points awarded
 * @param {string} title - Rule title
 * @param {number} points - Points awarded
 */
function showPointsToast(title, points) {
  const container = document.getElementById('points-toast-container');
  if (!container) return;

  // Create toast element
  const toast = document.createElement('div');
  toast.className = 'points-toast';
  toast.innerHTML = `
    <div class="toast-content">
      <span class="toast-title">${title}</span>
      <span class="toast-points">+${points} Points!</span>
    </div>
    <span class="toast-icon">🪙</span>
  `;

  // Append to container (CSS handles stacking from bottom)
  container.appendChild(toast);

  // Play sound if available (optional)
  // const audio = new Audio('assets/point-award.mp3'); audio.play().catch(e => {});

  // Remove after animation (keep visible longer for readability if multiple)
  setTimeout(() => {
    toast.classList.add('hiding');
    setTimeout(() => {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, 300); // 300ms fadeOutRight duration
  }, 4000);
}

/**
 * Load and display points history
 * @param {string} userId - User ID
 */
async function loadPointsHistory(userId) {
  const listEl = document.getElementById('points-history-list');
  if (!listEl) return;

  listEl.innerHTML = '<div class="history-empty">Loading history...</div>';

  try {
    const result = await firestoreFunctions.getPointsHistory(userId, 5); // Limit 5
    const history = result.success ? result.history : [];

    if (!history || history.length === 0) {
      listEl.innerHTML = '<div class="history-empty">No points earned yet</div>';
      return;
    }

    listEl.innerHTML = '';
    history.forEach(item => {
      const el = document.createElement('div');
      el.className = 'history-item';

      // Format date
      // Format date
      const timestamp = item.createdAt || item.timestamp;
      const date = timestamp ? new Date(timestamp.seconds * 1000) : new Date();
      const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const dateStr = date.toLocaleDateString([], { month: 'short', day: 'numeric' });
      const isToday = (d) => {
        const t = new Date();
        return d.getDate() === t.getDate() && d.getMonth() === t.getMonth() && d.getFullYear() === t.getFullYear();
      };
      const displayDate = isToday(date) ? `Today, ${timeStr}` : `${dateStr}, ${timeStr}`;

      el.innerHTML = `
        <div class="history-info">
          <span class="history-title">${item.title}</span>
          <span class="history-time">${displayDate}</span>
        </div>
        <span class="history-points">+${item.points}</span>
      `;

      // Click to show explanation
      el.addEventListener('click', () => {
        showExplanationPopup(item.title, item.points);
      });

      listEl.appendChild(el);
    });
  } catch (error) {
    console.error('Error loading history:', error);
    // Show specific error to help debugging
    listEl.innerHTML = `<div class="history-empty">Error: ${error.message}</div>`;
  }
}

/**
 * Show explanation popup for a rule
 * @param {string} ruleTitle 
 * @param {number} points 
 */
async function showExplanationPopup(ruleTitle, points) {
  const modal = document.getElementById('explanation-modal');
  const titleEl = document.getElementById('explanation-title');
  const pointsEl = document.getElementById('explanation-points');
  const textEl = document.getElementById('explanation-text');
  const closeBtn = document.getElementById('explanation-close-btn');

  if (!modal) return;

  // Show loading state
  modal.style.display = 'flex';
  titleEl.textContent = ruleTitle;
  pointsEl.textContent = points;
  textEl.textContent = "Loading details...";

  // Close handler
  const closeModal = () => { modal.style.display = 'none'; };
  closeBtn.onclick = closeModal;
  modal.onclick = (e) => { if (e.target === modal) closeModal(); };

  try {
    // Fetch rule explanation from Firestore
    const result = await firestoreFunctions.getPointsRuleByTitle(ruleTitle);

    if (result.success && result.rule) {
      if (result.rule.explanation) {
        textEl.textContent = result.rule.explanation;
      } else if (result.rule.description) {
        textEl.textContent = result.rule.description;
      } else {
        textEl.textContent = "No detailed explanation available for this reward.";
      }
    } else {
      textEl.textContent = "Could not find details for this reward.";
    }
  } catch (e) {
    console.error("Error fetching rule explanation:", e);
    textEl.textContent = "Could not load explanation.";
  }
}

/**
 * Show the Shopping "Coming Soon" modal
 */
function showShoppingModal() {
  const modal = document.getElementById('shopping-modal');
  const okBtn = document.getElementById('shopping-ok-btn');
  const closeBtn = document.getElementById('shopping-close-btn');

  if (!modal) return;

  modal.style.display = 'flex';

  const closeModal = () => {
    modal.style.display = 'none';
  };

  if (okBtn) okBtn.onclick = closeModal;
  if (closeBtn) closeBtn.onclick = closeModal;
  modal.onclick = (e) => {
    if (e.target === modal) closeModal();
  };
}

// Export functions to window
window.authUI = window.authUI || {};
window.authUI.showPointsToast = showPointsToast;
window.authUI.loadPointsHistory = loadPointsHistory;

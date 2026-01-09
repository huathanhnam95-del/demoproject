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


  // ============================================
  // Auth UI Listeners Initialization
  // ============================================

  function initAuthListeners() {
    console.log('Initializing Auth UI listeners...');

    // --- Account Panel Toggles ---
    const panelToggle = document.getElementById('account-panel-toggle');
    if (panelToggle) {
      panelToggle.addEventListener('click', toggleAccountPanel);
    }

    const panelCloseBtn = document.getElementById('panel-close-btn');
    if (panelCloseBtn) {
      panelCloseBtn.addEventListener('click', closeAccountPanel);
    }

    // --- Panel Buttons (Logged Out) ---
    const panelLoginBtn = document.getElementById('panel-login-btn');
    if (panelLoginBtn) {
      panelLoginBtn.addEventListener('click', showLoginForm);
    }

    const panelRegisterBtn = document.getElementById('panel-register-btn');
    if (panelRegisterBtn) {
      panelRegisterBtn.addEventListener('click', showSignupForm);
    }

    // --- Panel Buttons (Logged In) ---
    const panelLogoutBtn = document.getElementById('panel-logout-btn');
    if (panelLogoutBtn) {
      panelLogoutBtn.removeEventListener('click', handleLogout); // Safety
      panelLogoutBtn.addEventListener('click', handleLogout);
    }

    const panelChangePasswordBtn = document.getElementById('panel-change-password-btn');
    if (panelChangePasswordBtn) {
      panelChangePasswordBtn.removeEventListener('click', handleChangePassword);
      panelChangePasswordBtn.addEventListener('click', handleChangePassword);
    }

    // --- Panel Button (Guest Mode) ---
    const panelGuestLoginBtn = document.getElementById('panel-guest-login-btn');
    if (panelGuestLoginBtn) {
      panelGuestLoginBtn.addEventListener('click', showLoginForm);
    }

    // --- Shopping Card ---
    const shoppingCard = document.getElementById('panel-shopping-card');
    if (shoppingCard) {
      shoppingCard.addEventListener('click', () => {
        showShoppingModal();
      });
    }

    // --- Account Details Modal ---
    const closeDetailsBtn = document.getElementById('close-details-btn');
    if (closeDetailsBtn) {
      closeDetailsBtn.addEventListener('click', hideAccountDetailsModal);
    }

    // --- Form Switches ---
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

    // --- Form Submissions ---
    // Note: IDs might be login-form-element vs login-form (container)
    // Checking index.html or previous context would confirm, but let's assume variables used before were correct.
    // Previous code used 'login-form-element'.
    const loginFormEl = document.getElementById('login-form-element');
    if (loginFormEl) {
      loginFormEl.addEventListener('submit', async (e) => {
        e.preventDefault();
        await handleLogin();
      });
    }

    const signupFormEl = document.getElementById('signup-form-element');
    if (signupFormEl) {
      signupFormEl.addEventListener('submit', async (e) => {
        e.preventDefault();
        await handleSignup();
      });
    }
  }

  // Initialize listeners immediately if DOM is ready, otherwise wait
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAuthListeners);
  } else {
    initAuthListeners();
  }

  // Expose for debugging/manual re-init
  window.initAuthListeners = initAuthListeners;
}


/**
 * ============================================
 * Level Selection Functions (First Login)
 * ============================================
 */

/**
 * Check if user needs to select English level
 */
async function checkLevelSelection(userId) {
  if (!userId || !firestoreFunctions) return;

  try {
    const profileResult = await firestoreFunctions.getUserProfile(userId);
    if (profileResult.success) {
      const data = profileResult.data;

      // If no englishLevel set, show modal
      if (!data.englishLevel) {
        const modal = document.getElementById('level-selection-modal');
        if (modal) modal.style.display = 'flex';

        // Setup listeners if not already done (idempotent check)
        setupLevelSelectionListeners();
      }
    }
  } catch (e) {
    console.error('Error checking level selection:', e);
  }
}

/**
 * Setup listeners for level selection buttons
 */
function setupLevelSelectionListeners() {
  const levelBtns = document.querySelectorAll('.level-btn');
  levelBtns.forEach(btn => {
    // Remove old listeners to avoid duplicates (cloning)
    const newBtn = btn.cloneNode(true);
    btn.parentNode.replaceChild(newBtn, btn);

    newBtn.addEventListener('click', (e) => {
      const level = e.currentTarget.dataset.level;
      handleLevelSelection(level);
    });
  });
}

/**
 * Handle level selection
 */
async function handleLevelSelection(level) {
  if (!currentUserId) return;

  const modal = document.getElementById('level-selection-modal');

  try {
    // Update Profile
    await firestoreFunctions.updateUserProfile(currentUserId, {
      englishLevel: level,
      levelSelectedAt: new Date()
    });

    // Handle Unlocking based on level
    let shouldUnlock = false;
    if (level === 'beginner' || level === 'intermediate') {
      shouldUnlock = true;
    }

    if (shouldUnlock) {
      await firestoreFunctions.updateUserProfile(currentUserId, {
        sentenceLengthFilterUnlocked: true
      });
      // Local update for immediate feedback if needed
      localStorage.setItem('unlocked_filter_length_type', 'true');
    }

    // Hide Modal
    if (modal) modal.style.display = 'none';

    // Reload page to apply new filter settings (simplest way to ensure script.js re-runs logic)
    window.location.reload();

  } catch (e) {
    console.error('Error handling level selection:', e);
    alert('Failed to save selection. Please try again.');
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

    // Show admin link for admin users
    const adminLink = document.getElementById('panel-admin-link');
    if (adminLink) {
      const isAdmin = user.email === 'huathanhnam95@gmail.com';
      adminLink.style.display = isAdmin ? 'block' : 'none';
    }

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

  // Close account panel first for better UX
  closeAccountPanel();

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

    try {
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

        console.log('Attempting to create/update user profile for:', user.uid);
        const profileResult = await firestoreFunctions.createOrUpdateUserProfile(user.uid, user.email, isNewUser);

        if (!profileResult.success) {
          console.error('Profile update failed:', profileResult.error);
          alert('Warning: Could not update user profile. Some features may not work.\nError: ' + profileResult.error);
        }

        // Start session tracking
        await startSession();

        // Update panel to show logged in state
        updateAccountPanelState();

        // Check for Level Selection (First Login Feature)
        await checkLevelSelection(user.uid);

        // Initialize Vocabulary Book with user
        if (window.VocabularyBook) {
          // window.VocabularyBook is now a module that handles its own DB connection
          // Explicitly pass the DB instance to ensure it's available
          window.VocabularyBook.setUser(user.uid, window.firebaseDb);

          // Check if unlocked and show toggle
          try {
            const unlocked = await window.VocabularyBook.isUnlocked();
            console.log('VocabularyBook unlock status:', unlocked);
            if (unlocked) {
              window.VocabularyBook.showToggle();

              // Initialize SRS Review module with user (part of Vocabulary Book)
              if (window.SRSReview) {
                window.SRSReview.setUser(user.uid, window.firebaseDb);
                // Update due badge after data loads
                setTimeout(() => {
                  if (window.VocabularyBook.updateSRSDueBadge) {
                    window.VocabularyBook.updateSRSDueBadge();
                  }
                }, 1000);
              }
            }
          } catch (vocabError) {
            console.warn('Error checking vocab unlock:', vocabError);
          }
        } else {
          console.warn('VocabularyBook module not loaded yet');
          // Add listener or retry logic if needed
        }

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
    } catch (err) {
      console.error('Error in onAuthStateChanged handler:', err);
      alert('An error occurred during login/logout processing:\n' + err.message);
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
  updatePracticePointsDisplay: updatePracticePointsDisplay,
  // Account panel toggle (for mobile toolbar)
  toggleAccountPanel: toggleAccountPanel
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
  // Close account panel first to avoid stacking issues
  closeAccountPanel();

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
 * Show the Shopping modal with Points Exchange table
 */
function showShoppingModal() {
  // Close account panel first for better UX and to avoid stacking issues
  closeAccountPanel();

  const modal = document.getElementById('shopping-modal');
  const closeBtn = document.getElementById('shopping-close-btn');
  const pointsDisplay = document.getElementById('shopping-current-points');
  const tableBody = document.getElementById('shopping-table-body');
  const feedbackEl = document.getElementById('shopping-feedback');

  if (!modal) return;

  // Shopping Items Data
  const shoppingItems = [
    {
      id: 'sentence_length_filter_type',
      title: 'Filter mode: Length (Type mode)',
      description: 'Filter Type questions by sentence length. Recommended for beginners',
      cost: 50,
      unlockFlag: 'sentenceLengthFilterUnlocked',
      unlockTimestampField: 'sentenceLengthFilterUnlockedAt',
      extraUnlockFields: { sentenceLengthFilterFullUnlock: true },
      hasTutorial: true,
      tutorialFunction: () => {
        if (window.LengthFilterTutorial) {
          window.LengthFilterTutorial.reset('type');
          window.LengthFilterTutorial.start('type');
        }
      },
      onUnlock: () => {
        if (window.onFilterUnlocked) window.onFilterUnlocked('type');
      }
    },
    {
      id: 'sentence_length_filter_speak',
      title: 'Filter mode: Length (Speak mode)',
      description: 'Filter Speak questions by sentence length. Recommended for beginners',
      cost: 50,
      unlockFlag: 'speakLengthFilterUnlocked',
      unlockTimestampField: 'speakLengthFilterUnlockedAt',
      extraUnlockFields: { speakLengthFilterFullUnlock: true },
      hasTutorial: true,
      tutorialFunction: () => {
        // Switch to Speak mode first so the UI matches the tutorial
        const speakTab = document.getElementById('tab-speak');
        if (speakTab) speakTab.click();

        if (window.LengthFilterTutorial) {
          window.LengthFilterTutorial.reset('speak');
          window.LengthFilterTutorial.start('speak');
        }
      },
      onUnlock: () => {
        if (window.onFilterUnlocked) window.onFilterUnlocked('speak');
      }
    },
    {
      id: 'vocabulary_book',
      title: 'Vocabulary Book',
      description: 'Track missed words and build your personal vocabulary list',
      cost: 10,
      unlockFlag: 'vocabularyBookUnlocked',
      unlockTimestampField: 'vocabularyBookUnlockedAt',
      hasTutorial: false,
      onUnlock: () => {
        // Show the vocabulary book toggle button
        const vocabToggle = document.getElementById('vocab-panel-toggle');
        if (vocabToggle) vocabToggle.style.display = 'flex';
      }
    }
  ];

  // Helper to show feedback
  const showFeedback = (message, type) => {
    if (!feedbackEl) return;
    feedbackEl.textContent = message;
    feedbackEl.className = `shopping-feedback ${type}`;
    feedbackEl.style.display = 'block';

    // Auto-hide after 5s for success
    if (type === 'success') {
      setTimeout(() => { feedbackEl.style.display = 'none'; }, 5000);
    }
  };

  const hideFeedback = () => {
    if (feedbackEl) feedbackEl.style.display = 'none';
  };

  // Render the table
  const renderTable = async () => {
    if (!tableBody) return;
    tableBody.innerHTML = '<tr><td colspan="3" style="text-align:center; padding: 20px; color: #6b7280;">Loading...</td></tr>';

    let currentPoints = 0;
    let userProfile = null;

    // Fetch user data
    if (firestoreFunctions && currentUserId) {
      const result = await firestoreFunctions.getUserProfile(currentUserId);
      if (result && result.success) {
        userProfile = result.data;
        currentPoints = userProfile.totalPoints || 0; // FIX: Use totalPoints instead of points
      }
    }

    // Update points display
    if (pointsDisplay) {
      pointsDisplay.textContent = currentPoints.toLocaleString();
    }

    // Clear and render rows
    tableBody.innerHTML = '';

    shoppingItems.forEach(item => {
      const isUnlocked = userProfile && userProfile[item.unlockFlag];
      const unlockTimestamp = userProfile && userProfile[item.unlockTimestampField];

      const row = document.createElement('tr');

      // Reward column
      const rewardCell = document.createElement('td');
      rewardCell.innerHTML = `
        <div class="reward-info">
          <span class="reward-title">${item.title}</span>
          <span class="reward-description">${item.description}</span>
        </div>
      `;

      // Cost column
      const costCell = document.createElement('td');
      costCell.innerHTML = `<span class="reward-cost"><span class="cost-icon">🪙</span>${item.cost}</span>`;

      // Action column
      const actionCell = document.createElement('td');
      actionCell.style.textAlign = 'center';

      const btn = document.createElement('button');
      btn.className = 'shopping-unlock-btn';

      if (isUnlocked) {
        // Already unlocked - show timestamp
        btn.className += ' unlocked';
        btn.disabled = true;

        let timestampStr = '';
        if (unlockTimestamp) {
          const date = unlockTimestamp.toDate ? unlockTimestamp.toDate() : new Date(unlockTimestamp);
          timestampStr = date.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
        }

        btn.innerHTML = `✓ UNLOCKED<span class="unlocked-timestamp">${timestampStr}</span>`;
      } else if (currentPoints < item.cost) {
        // Not enough points
        btn.className += ' insufficient';
        btn.textContent = `Need ${item.cost - currentPoints} more`;
        btn.onclick = () => {
          showFeedback(`You need ${item.cost - currentPoints} more points to unlock this reward.`, 'error');
        };
      } else {
        // Available to unlock
        btn.className += ' available';
        btn.textContent = 'Unlock';
        btn.onclick = async () => {
          hideFeedback();
          btn.className = 'shopping-unlock-btn processing';
          btn.textContent = 'Processing...';
          btn.disabled = true;

          try {
            // 1. Deduct points
            await firestoreFunctions.addPoints(currentUserId, -item.cost, `Unlock: ${item.title}`);

            // 2. Set unlock flag with timestamp
            const updateData = {};
            updateData[item.unlockFlag] = true;
            updateData[item.unlockTimestampField] = new Date();

            // Add extra fields if any
            if (item.extraUnlockFields) {
              Object.assign(updateData, item.extraUnlockFields);
            }

            await firestoreFunctions.updateUserProfile(currentUserId, updateData);

            // 3. Trigger filter unlock callback (item-specific)
            if (item.onUnlock) item.onUnlock();

            // 4. Show success and re-render
            showFeedback(`🎉 Successfully unlocked "${item.title}"!`, 'success');
            renderTable(); // Re-render to show updated state

            // 5. Update points in account panel
            if (window.authUI && window.authUI.loadPracticePoints) {
              window.authUI.loadPracticePoints(currentUserId);
            }
          } catch (err) {
            console.error('Purchase failed:', err);
            showFeedback('Purchase failed. Please try again.', 'error');
            btn.className = 'shopping-unlock-btn available';
            btn.textContent = 'Unlock';
            btn.disabled = false;
          }
        };
      }

      actionCell.appendChild(btn);

      // Tutorial column
      const tutorialCell = document.createElement('td');
      tutorialCell.style.textAlign = 'center';

      if (item.hasTutorial && isUnlocked) {
        const tutorialBtn = document.createElement('button');
        tutorialBtn.className = 'shopping-tutorial-btn';
        tutorialBtn.innerHTML = '<span class="btn-icon">▶</span> Play';
        tutorialBtn.onclick = () => {
          // Close the modal first
          modal.style.display = 'none';
          // Then start the tutorial
          if (item.tutorialFunction) item.tutorialFunction();
        };
        tutorialCell.appendChild(tutorialBtn);
      } else if (item.hasTutorial && !isUnlocked) {
        tutorialCell.innerHTML = '<span style="color: #9ca3af; font-size: 0.85rem;">Unlock first</span>';
      } else {
        tutorialCell.innerHTML = '<span style="color: #d1d5db;">—</span>';
      }

      row.appendChild(rewardCell);
      row.appendChild(costCell);
      row.appendChild(actionCell);
      row.appendChild(tutorialCell);
      tableBody.appendChild(row);
    });
  };

  // Show modal
  modal.style.display = 'flex';
  hideFeedback();
  renderTable();

  // Close handlers
  const closeModal = () => {
    modal.style.display = 'none';
  };
  if (closeBtn) closeBtn.onclick = closeModal;

  // Bottom close button
  const closeBottomBtn = document.getElementById('shopping-close-bottom-btn');
  if (closeBottomBtn) closeBottomBtn.onclick = closeModal;

  modal.onclick = (e) => {
    if (e.target === modal) closeModal();
  };
}

// Export functions to window
window.authUI = window.authUI || {};
window.authUI.showPointsToast = showPointsToast;
window.authUI.loadPointsHistory = loadPointsHistory;

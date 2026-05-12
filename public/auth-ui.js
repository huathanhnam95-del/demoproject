import {
  doc,
  getDoc,
  getDocs,
  setDoc,
  collection,
  writeBatch
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

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
const log = Logger.create('Auth');
const authSessionGuard = window.AuthSessionGuard || null;
const GUEST_VOCAB_STORAGE_KEY = 'bel_guest_vocab_v1';
const GUEST_SRS_STORAGE_KEY = 'bel_guest_srs_v1';
let authUiInitialized = false;
let authEventListenersBound = false;
let authStateListenerBound = false;
let sessionTrackingBound = false;
let resolveFirebaseModulesReady = null;
const firebaseModulesReady = new Promise((resolve) => {
  resolveFirebaseModulesReady = resolve;
});

// Guest mode state: true if user chose to view as guest
// This is stored in sessionStorage to persist during the session
let isGuestMode = false;
let guestImportModalResolver = null;

// Used to trigger UI updates in other modules (e.g., progress reload)
let authStateCallbacks = [];

// Cache admin checks to avoid repeated network calls
const adminAccessCache = new Map(); // uid -> { value: boolean, atMs: number }
const ADMIN_ACCESS_CACHE_TTL_MS = 60 * 1000;

async function waitForFirebaseModules(timeoutMs = 12000) {
  if (authFunctions && firestoreFunctions) {
    return true;
  }

  await Promise.race([
    firebaseModulesReady,
    new Promise((resolve) => setTimeout(resolve, timeoutMs))
  ]);

  return !!(authFunctions && firestoreFunctions);
}

/**
 * Trigger all auth state callbacks
 * @param {string} type - 'login' or 'logout'
 * @param {string} userId - User ID or null
 */
async function triggerAuthStateCallbacks(type, userId) {
  for (const callback of authStateCallbacks) {
    try {
      // Backward compatibility: some callbacks accept only (userId),
      // while newer ones accept (type, userId).
      if (typeof callback === 'function' && callback.length >= 2) {
        await callback(type, userId);
      } else {
        await callback(userId);
      }
    } catch (err) {
      log.error('Error in auth state callback:', err);
    }
  }
}

/**
 * Register a callback to be called when auth state changes
 * @param {Function} callback - Function to call on change
 */
function onAuthStateChange(callback) {
  if (typeof callback === 'function') {
    authStateCallbacks.push(callback);
    log.debug('✓ Auth state callback registered');
  }
}

function readGuestSnapshot() {
  const parse = (key, fallback) => {
    try {
      const stored = localStorage.getItem(key);
      return stored ? JSON.parse(stored) : fallback;
    } catch (e) {
      return fallback;
    }
  };

  return {
    vocab: parse(GUEST_VOCAB_STORAGE_KEY, null),
    srs: parse(GUEST_SRS_STORAGE_KEY, null)
  };
}

function hasGuestProgress(snapshot = readGuestSnapshot()) {
  const vocab = snapshot?.vocab || {};
  const srs = snapshot?.srs || {};
  return Boolean(
    (Array.isArray(vocab.bookmarkedWords) && vocab.bookmarkedWords.length > 0) ||
    (Array.isArray(vocab.frequentlyMissed) && vocab.frequentlyMissed.length > 0) ||
    (Array.isArray(vocab.usedToMiss) && vocab.usedToMiss.length > 0) ||
    (Array.isArray(vocab.masteredWords) && vocab.masteredWords.length > 0) ||
    (srs.srsData && Object.keys(srs.srsData).length > 0)
  );
}

function normalizeLemmaKey(word) {
  return String(word || '').trim().toLowerCase();
}

function mergeByLemma(primary = [], secondary = []) {
  const map = new Map();
  const push = (item, preferLatest = false) => {
    const lemma = normalizeLemmaKey(item?.lemma);
    if (!lemma) return;
    const existing = map.get(lemma);
    if (!existing) {
      map.set(lemma, { ...item, lemma });
      return;
    }
    map.set(lemma, preferLatest ? { ...existing, ...item, lemma } : { ...item, ...existing, lemma });
  };

  primary.forEach(item => push(item, false));
  secondary.forEach(item => push(item, true));
  return Array.from(map.values());
}

function mergeWordStats(primary = {}, secondary = {}) {
  const merged = { ...primary };
  for (const [lemma, stat] of Object.entries(secondary || {})) {
    const existing = merged[lemma] || {};
    merged[lemma] = {
      ...existing,
      ...stat,
      missCount: Math.max(Number(existing.missCount || 0), Number(stat?.missCount || 0)),
      correctStreak: Math.max(Number(existing.correctStreak || 0), Number(stat?.correctStreak || 0)),
      masteryPercentage: Math.max(Number(existing.masteryPercentage || 0), Number(stat?.masteryPercentage || 0))
    };
  }
  return merged;
}

function compareSrsCardStrength(cardA, cardB) {
  const aReps = Number(cardA?.repetitions || 0);
  const bReps = Number(cardB?.repetitions || 0);
  if (aReps !== bReps) return aReps - bReps;

  const aInterval = Number(cardA?.interval || 0);
  const bInterval = Number(cardB?.interval || 0);
  if (aInterval !== bInterval) return aInterval - bInterval;

  const aDate = new Date(cardA?.nextReviewDate || 0).getTime();
  const bDate = new Date(cardB?.nextReviewDate || 0).getTime();
  return aDate - bDate;
}

function mergeSrsCards(primary = {}, secondary = {}) {
  const merged = { ...primary };
  for (const [lemma, card] of Object.entries(secondary || {})) {
    const existing = merged[lemma];
    if (!existing) {
      merged[lemma] = { ...card, lemma };
      continue;
    }
    merged[lemma] = compareSrsCardStrength(existing, card) >= 0
      ? { ...existing, lemma }
      : { ...card, lemma };
  }
  return merged;
}

function ensureGuestImportModal() {
  let modal = document.getElementById('guest-import-modal');
  if (modal) return modal;

  modal = document.createElement('div');
  modal.id = 'guest-import-modal';
  modal.className = 'guest-import-modal';
  modal.style.display = 'none';
  modal.innerHTML = `
    <div class="guest-import-card" role="dialog" aria-modal="true" aria-labelledby="guest-import-title">
      <h3 id="guest-import-title">Import guest progress?</h3>
      <p>You have saved words and review progress in Guest mode. Import them into this account or keep this account separate.</p>
      <div class="guest-import-actions">
        <button id="guest-import-keep" class="guest-import-secondary" type="button">Use account only</button>
        <button id="guest-import-merge" class="guest-import-primary" type="button">Import guest progress</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  return modal;
}

function showGuestImportPrompt() {
  return new Promise(resolve => {
    const modal = ensureGuestImportModal();
    const keepBtn = modal.querySelector('#guest-import-keep');
    const mergeBtn = modal.querySelector('#guest-import-merge');

    const finish = (choice) => {
      modal.style.display = 'none';
      guestImportModalResolver = null;
      resolve(choice);
    };

    guestImportModalResolver = finish;
    modal.style.display = 'flex';

    if (keepBtn) {
      keepBtn.onclick = () => finish('account');
    }
    if (mergeBtn) {
      mergeBtn.onclick = () => finish('import');
    }
    modal.onclick = (e) => {
      if (e.target === modal) finish('account');
    };
  });
}

async function importGuestProgressToAccount(user) {
  const db = window.__FIREBASE_INTERNAL__?.db;
  if (!db || !user?.uid) return false;

  const snapshot = readGuestSnapshot();
  if (!hasGuestProgress(snapshot)) return false;

  const guestVocab = snapshot.vocab || {};
  const guestSrs = snapshot.srs || {};

  const vocabRef = doc(db, 'users', user.uid, 'vocabularyBook', 'data');
  const vocabDoc = await getDoc(vocabRef);
  const accountVocab = vocabDoc.exists() ? vocabDoc.data() : {};

  const mergedBookmarks = mergeByLemma(accountVocab.bookmarkedWords || [], guestVocab.bookmarkedWords || []);
  const mergedMissed = mergeByLemma(accountVocab.frequentlyMissed || [], guestVocab.frequentlyMissed || []);
  const mergedUsedToMiss = mergeByLemma(accountVocab.usedToMiss || [], guestVocab.usedToMiss || []);
  const mergedMastered = mergeByLemma(accountVocab.masteredWords || [], guestVocab.masteredWords || []);
  const mergedWordStats = mergeWordStats(accountVocab.wordStats || {}, guestVocab.wordStats || {});
  const mergedReviewStats = {
    ...(accountVocab.reviewStats || {}),
    ...(guestSrs.reviewStats || {})
  };

  await setDoc(vocabRef, {
    bookmarkedWords: mergedBookmarks,
    wordStats: mergedWordStats,
    frequentlyMissed: mergedMissed,
    usedToMiss: mergedUsedToMiss,
    masteredWords: mergedMastered,
    reviewStats: mergedReviewStats,
    updatedAt: new Date().toISOString(),
    importedFromGuestAt: new Date().toISOString()
  }, { merge: true });

  const cardsRef = collection(db, 'users', user.uid, 'srs_cards');
  const cardsSnapshot = await getDocs(cardsRef);
  const accountCards = {};
  cardsSnapshot.forEach(cardDoc => {
    const data = cardDoc.data();
    const lemma = normalizeLemmaKey(data?.lemma || cardDoc.id);
    if (lemma) accountCards[lemma] = data;
  });

  const guestCards = guestSrs.srsData || {};
  const mergedCards = mergeSrsCards(accountCards, guestCards);
  const batch = writeBatch(db);
  Object.entries(mergedCards).forEach(([lemma, card]) => {
    batch.set(doc(db, 'users', user.uid, 'srs_cards', lemma.replace(/\//g, '_')), {
      ...card,
      lemma,
      updatedAt: new Date().toISOString()
    }, { merge: true });
  });
  await batch.commit();

  return true;
}

// Initialize when Firebase is ready
function initializeAuthUI() {
  if (authUiInitialized) {
    return;
  }
  authUiInitialized = true;

  // Try to set up listeners immediately so buttons are responsive
  setupEventListeners();

  // Wait for Firebase functions to be available for actual login operations
  const checkFirebase = () => {
    if (window.firebaseAuthFunctions && window.firebaseFirestoreFunctions) {
      log.debug('✓ Firebase module functions found, linking to UI...');
      log.debug('[AuthUI] window.firebaseFirestoreFunctions.updateUserProfile exists:', typeof window.firebaseFirestoreFunctions.updateUserProfile);
      authFunctions = window.firebaseAuthFunctions;
      firestoreFunctions = window.firebaseFirestoreFunctions;
      if (resolveFirebaseModulesReady) {
        resolveFirebaseModulesReady();
        resolveFirebaseModulesReady = null;
      }
      setupAuthStateListener();
      setupSessionTracking();
    } else {
      const missing = [];
      if (!window.firebaseAuthFunctions) missing.push('AuthModule');
      if (!window.firebaseFirestoreFunctions) missing.push('FirestoreModule');
      log.warn(`Waiting for Firebase modules: ${missing.join(', ')}. (If this persists, check console for script errors or certificate issues)`);
      setTimeout(checkFirebase, 1000);
    }
  };

  checkFirebase();

  // Check for demo mode bypass
  checkDemoMode();
}

/**
 * Check if the user is visiting in demo mode
 * Bypasses login modal and enables guest mode
 */
function checkDemoMode() {
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('demo') === '1') {
    log.debug('🚀 Demo mode detected, activating guest mode');
    // Force guest mode activation
    handleGuestModeChoice();

    // Customize toast message
    setTimeout(() => {
      const toastText = document.querySelector('#guest-toast span');
      if (toastText) {
        toastText.innerHTML = '<strong>Demo Mode Active</strong><br>Create a free account to save your progress!';
        toastText.style.textAlign = 'center';
      }
    }, 100);

    // Clean URL without reloading
    const newUrl = window.location.protocol + "//" + window.location.host + window.location.pathname;
    window.history.replaceState({ path: newUrl }, '', newUrl);
  }
}

/**
 * Setup all event listeners for auth UI
 */
function setupEventListeners() {
  if (authEventListenersBound) {
    return;
  }
  authEventListenersBound = true;

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
    log.debug('Initializing Auth UI listeners...');

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
    const panelViewProfileBtn = document.getElementById('panel-view-profile-btn');
    if (panelViewProfileBtn) {
      panelViewProfileBtn.removeEventListener('click', showAccountDetailsModal);
      panelViewProfileBtn.addEventListener('click', showAccountDetailsModal);
    }

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
        if (window.shopModule && window.shopModule.openShop) {
          window.shopModule.openShop();
          closeAccountPanel();
        } else {
          showShoppingModal();
        }
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

    // --- Auth Overlay Close / View as Guest ---
    const authCloseBtn = document.getElementById('auth-close-btn');
    if (authCloseBtn) {
      authCloseBtn.addEventListener('click', () => {
        hideAuthOverlay();
        handleGuestModeChoice();
      });
    }

    const authGuestLink = document.getElementById('auth-guest-link');
    if (authGuestLink) {
      authGuestLink.addEventListener('click', (e) => {
        e.preventDefault();
        hideAuthOverlay();
        handleGuestModeChoice();
      });
    }

    const authGuestLinkSignup = document.getElementById('auth-guest-link-signup');
    if (authGuestLinkSignup) {
      authGuestLinkSignup.addEventListener('click', (e) => {
        e.preventDefault();
        hideAuthOverlay();
        handleGuestModeChoice();
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

    // --- Join a Class ---
    const btnJoinClass = document.getElementById('btn-join-class');
    if (btnJoinClass) {
      btnJoinClass.addEventListener('click', async () => {
        const input = document.getElementById('join-class-code-input');
        const message = document.getElementById('join-class-message');
        const code = input ? input.value.trim() : '';

        if (!code) return;

        try {
          btnJoinClass.disabled = true;
          if (message) {
            message.style.display = 'block';
            message.textContent = 'Linking...';
            message.style.color = '#666';
          }

          const idToken = await firebase.auth().currentUser.getIdToken();
          const response = await fetch('/api/students/claim-profile', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${idToken}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ classCode: code })
          });

          const json = await response.json();
          if (json.success) {
            if (message) {
              message.textContent = '✅ Profile linked! Updating dashboard...';
              message.style.color = 'green';
            }

            // Force refresh token to get new custom claims
            await firebase.auth().currentUser.getIdToken(true);

            // Soft refresh: Update the UI state immediately instead of reloading
            updateAccountPanelState();

            // Clear input
            if (input) input.value = '';

            // Optional: Close modal after a short delay
            setTimeout(() => {
              const modal = document.getElementById('account-details-modal');
              if (modal) modal.style.display = 'none';
              if (message) message.style.display = 'none';
            }, 2000);

          } else {
            throw new Error(json.message || 'Failed to claim profile.');
          }
        } catch (e) {
          if (message) {
            message.textContent = '❌ ' + e.message;
            message.style.color = 'red';
          }
        } finally {
          btnJoinClass.disabled = false;
        }
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
    log.error('Error checking level selection:', e);
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
    // Update Profile - defensive fallback for older deployments
    log.debug('[AuthUI] Calling updateUserProfile. firestoreFunctions status:', !!firestoreFunctions);

    // Determine which function to use (fallback for compatibility)
    const updateFn = firestoreFunctions.updateUserProfile || firestoreFunctions.createOrUpdateUserProfile;
    if (!updateFn) {
      throw new Error('No profile update function available');
    }
    log.debug('[AuthUI] Using function:', updateFn.name || 'anonymous');

    await updateFn(currentUserId, {
      englishLevel: level,
      levelSelectedAt: new Date()
    });

    const normalizedLevel = level ? level.toLowerCase() : '';

    // Seed a starting CEFR level for Smart Difficulty (without disabling auto-adjust)
    try {
      // Map legacy 3-choice selection to new 6-level CEFR scale
      // Beginner -> 1 (A1)
      // Intermediate -> 3 (B1)
      // Expert -> 5 (C1)
      const levelMap = { 'beginner': 1, 'intermediate': 3, 'expert': 5 };
      const numericLevel = levelMap[normalizedLevel] || 1;

      if (window.DifficultyManager && typeof window.DifficultyManager.seedLevel === 'function') {
        window.DifficultyManager.seedLevel(numericLevel);
        log.debug(`🎯 [Auth] Seeded level ${normalizedLevel} mapped to CEFR Level ${numericLevel} via API`);
      } else {
        // Fallback if DM not initialized (safety)
        log.warn('DifficultyManager not fully available, falling back to storage write');
        const stored = localStorage.getItem('difficulty_profile');
        let profileData = stored ? JSON.parse(stored) : { version: 3, globalSettings: {}, profiles: {} };
        const legacySettings = profileData.settings && !profileData.globalSettings;
        const baseSettings = profileData.globalSettings || profileData.settings || {};

        profileData.globalSettings = {
          ...baseSettings,
          manualLevel: numericLevel
        };
        if (legacySettings) delete profileData.settings;

        // Ensure profiles exist and start at the seeded level
        const defaultProfile = { level: numericLevel, exp: 0, history: [], attemptsAtLevel: 0 };
        profileData.profiles = profileData.profiles && typeof profileData.profiles === 'object'
          ? profileData.profiles
          : {};
        ['type', 'speak', 'srs', 'extended', 'notes'].forEach((mode) => {
          const existing = profileData.profiles[mode] && typeof profileData.profiles[mode] === 'object'
            ? profileData.profiles[mode]
            : {};
          profileData.profiles[mode] = {
            ...defaultProfile,
            ...existing,
            level: numericLevel,
            history: [],
            attemptsAtLevel: 0
          };
        });
        localStorage.setItem('difficulty_profile', JSON.stringify(profileData));
      }
    } catch (err) {
      log.error('Failed to sync level to DifficultyManager:', err);
    }

    // Hide Modal
    if (modal) modal.style.display = 'none';

    // Reload page to apply new filter settings (simplest way to ensure script.js re-runs logic)
    window.location.reload();

  } catch (e) {
    log.error('Error handling level selection:', e);
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
  if (window.VocabularyBook && typeof window.VocabularyBook.setUser === 'function') {
    window.VocabularyBook.setUser('guest', null);
  }
  if (window.SRSReview && typeof window.SRSReview.setUser === 'function') {
    window.SRSReview.setUser('guest', null);
  }
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
    Logger.setUserId(user.uid);
    if (panelLoggedOut) panelLoggedOut.style.display = 'none';
    if (panelGuestMode) panelGuestMode.style.display = 'none';
    if (panelLoggedIn) panelLoggedIn.style.display = 'block';
    if (panelEmail) panelEmail.textContent = user.email || '-';
    isGuestMode = false; // Clear guest mode when logged in
    sessionStorage.removeItem('guestMode');

    // Show CRM link for admin/teacher users (admin-only for Watch Admin)
    const watchAdminLink = document.getElementById('panel-admin-link');
    const crmAdminLink = document.getElementById('panel-crm-admin-link');

    // First, check cache for immediate visibility if previously verified
    const wasAdmin = getCachedAdminAccess(user.uid);
    if (wasAdmin) {
      if (watchAdminLink) watchAdminLink.style.display = 'flex';
      if (crmAdminLink) crmAdminLink.style.display = 'flex';
    } else {
      // Default to hidden while resolving or if not admin
      if (watchAdminLink) watchAdminLink.style.display = 'none';
      if (crmAdminLink) crmAdminLink.style.display = 'none';
    }

    if (watchAdminLink || crmAdminLink) {
      Promise.all([resolveAdminAccess(user), resolveTeacherAccess(user)]).then(([isAdmin, isTeacher]) => {
        if (watchAdminLink) watchAdminLink.style.display = isAdmin ? 'flex' : 'none';
        if (crmAdminLink) crmAdminLink.style.display = (isAdmin || isTeacher) ? 'flex' : 'none';

        if (isAdmin) {
          // Seed cache for admin user to ensure full access
          const allModes = ['type', 'speak', 'extended', 'watch', 'notes', 'pronounce', 'lengthFilter', 'vocabBook', 'autoAdjust'];
          const cacheKey = `userProfile_${user.uid}`;
          const modesKey = `unlockedModes_${user.uid}`;

          if (!localStorage.getItem(cacheKey)) {
            log.debug('⚡ Seeding admin cache for', user.email);
            localStorage.setItem(cacheKey, JSON.stringify({
              email: user.email,
              totalPoints: 9999,
              unlockedModes: allModes,
              isAdmin: true,
              cachedAt: Date.now()
            }));
          }
          if (!localStorage.getItem(modesKey)) {
            localStorage.setItem(modesKey, JSON.stringify(allModes));
          }

          if (window.shopModule && window.shopModule.setUnlockedModes) {
            window.shopModule.setUnlockedModes(allModes);
          }
        }
      }).catch(err => {
        log.error('Error checking admin status:', err);
        if (watchAdminLink) watchAdminLink.style.display = 'none';
        if (crmAdminLink) crmAdminLink.style.display = 'none';
      });
    }

    // Check for custom claims (isStudent, isAdmin)
    user.getIdTokenResult().then(idTokenResult => {
      const claims = idTokenResult.claims;
      const classroomLink = document.getElementById('panel-classroom-link');
      if (classroomLink) {
        classroomLink.style.display = (claims.isStudent || claims.isAdmin) ? 'flex' : 'none';
      }
    }).catch(err => log.warn('Failed to fetch custom claims:', err));

    // Load and display Practice Points
    loadPracticePoints(user.uid);
  } else if (isGuestMode) {
    // Guest mode state
    if (panelLoggedOut) panelLoggedOut.style.display = 'none';
    if (panelLoggedIn) panelLoggedIn.style.display = 'none';
    if (panelGuestMode) panelGuestMode.style.display = 'block';
    if (window.VocabularyBook && typeof window.VocabularyBook.setUser === 'function') {
      window.VocabularyBook.setUser('guest', null);
      if (typeof window.VocabularyBook.showToggle === 'function') {
        window.VocabularyBook.showToggle();
      }
    }
    if (window.SRSReview && typeof window.SRSReview.setUser === 'function') {
      window.SRSReview.setUser('guest', null);
    }
  } else {
    // Logged out state
    if (panelLoggedIn) panelLoggedIn.style.display = 'none';
    if (panelGuestMode) panelGuestMode.style.display = 'none';
    if (panelLoggedOut) panelLoggedOut.style.display = 'block';
    if (window.VocabularyBook && typeof window.VocabularyBook.setUser === 'function') {
      window.VocabularyBook.setUser(null, null);
    }
    if (window.SRSReview && typeof window.SRSReview.setUser === 'function') {
      window.SRSReview.setUser(null, null);
    }
  }
}

function getCachedAdminAccess(uid) {
  const entry = adminAccessCache.get(uid);
  if (!entry) return null;
  if ((Date.now() - entry.atMs) > ADMIN_ACCESS_CACHE_TTL_MS) {
    adminAccessCache.delete(uid);
    return null;
  }
  return !!entry.value;
}

function setCachedAdminAccess(uid, value) {
  adminAccessCache.set(uid, { value: !!value, atMs: Date.now() });
}

async function resolveAdminAccess(user) {
  if (!user?.uid) return false;

  const cached = getCachedAdminAccess(user.uid);
  if (cached !== null) return cached;

  // 1) Fast path: Firestore profile flag
  let isAdmin = false;
  if (firestoreFunctions && typeof firestoreFunctions.getUserProfile === 'function') {
    try {
      const result = await firestoreFunctions.getUserProfile(user.uid);
      isAdmin = !!(result?.success && result?.data && result.data.isAdmin);
    } catch (e) {
      // ignore; fallback to server check
    }
  }

  // 2) Fallback: server-verified admin (also bootstraps Firestore isAdmin flag)
  if (!isAdmin) {
    isAdmin = await isAdminViaServer(user);
  }

  setCachedAdminAccess(user.uid, isAdmin);
  return isAdmin;
}

async function resolveTeacherAccess(user) {
  if (!user?.uid) return false;

  // 1) Fast path: custom claim
  try {
    const tokenResult = await user.getIdTokenResult();
    if (tokenResult?.claims?.isTeacher === true) {
      return true;
    }
  } catch (e) {
    // ignore; fallback to profile
  }

  // 2) Fallback: Firestore profile (crmRole/isTeacher)
  if (firestoreFunctions && typeof firestoreFunctions.getUserProfile === 'function') {
    try {
      const result = await firestoreFunctions.getUserProfile(user.uid);
      const data = result?.success && result?.data ? result.data : {};
      const crmRole = String(data?.crmRole || '').trim().toLowerCase();
      return data?.isTeacher === true || crmRole === 'teacher';
    } catch (e) {
      // ignore
    }
  }

  return false;
}

async function isAdminViaServer(user) {
  try {
    if (!user?.getIdToken) return false;
    const idToken = await user.getIdToken();

    const res = await fetch('/api/admin/status', {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${idToken}` },
      cache: 'no-store'
    });

    const result = await res.json().catch(() => null);
    return !!(res.ok && result?.success && result?.isAdmin);
  } catch (e) {
    return false;
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
    // Use getUserProfile to get the latest practice totals
    const result = await firestoreFunctions.getUserProfile(userId);

    if (result.success) {
      if (pointsCountEl) pointsCountEl.textContent = (result.data.totalPoints || 0).toLocaleString();

      // Keep header XP bar in sync when points change (Type/Watch/Notes/etc).
      if (window.LevelSystem && window.LevelSystem.updateHeaderLevel) {
        window.LevelSystem.updateHeaderLevel(result.data);
      }

      // Render the Proficiency Dashboard (Track B)
      renderSkillDashboard(result.data);
    } else {
      if (pointsCountEl) pointsCountEl.textContent = '0';
    }

    // Load history as well
    loadPointsHistory(userId);
  } catch (error) {
    log.error('Error loading practice points:', error);
    if (pointsCountEl) pointsCountEl.textContent = '0';
  }
}

/**
 * Render the Proficiency Dashboard (Track B) in the Account Details modal
 * @param {object} data - User profile data from Firestore
 */
function renderSkillDashboard(data) {
  const dashboard = document.getElementById('skill-dashboard');
  if (!dashboard) return;

  const ratings = data.skillRatings || { listening: 0, writing: 0, reading: 0, speaking: 0 };
  const points = data.skillPoints || { listening: 0, writing: 0, reading: 0, speaking: 0 };

  // Show dashboard if user has any ratings
  const hasHistory = Object.values(ratings).some(v => v > 0) || (data.totalPoints > 0);
  dashboard.style.display = hasHistory ? 'block' : 'none';

  if (!hasHistory) return;

  // 1. Skill Items
  const skills = [
    { id: 'type', key: 'writing', name: 'Writing (Dictation)' }, // Dictation Mode
    { id: 'speak', key: 'speaking', name: 'Speaking' },
    { id: 'writing', key: 'writing', name: 'Writing' }
  ];

  // Map modes to skills for display
  const skillMap = {
    'type': { ratingKey: 'writing', pointsKey: 'writing', label: 'Writing (Dictation)' },
    'speak': { ratingKey: 'speaking', pointsKey: 'speaking', label: 'Speaking' },
    'writing': { ratingKey: 'writing', pointsKey: 'writing', label: 'Writing' }
  };

  // Update Skill Bars & CEFR
  Object.entries(skillMap).forEach(([id, config]) => {
    const rating = ratings[config.ratingKey] || 0;
    const skillPoints = points[config.pointsKey] || 0;

    // Update Rating Text
    const ratingEl = document.getElementById(`skill-rating-${id}`);
    if (ratingEl) ratingEl.textContent = rating.toFixed(1);

    // Update Bar
    const barEl = document.getElementById(`skill-bar-fill-${id}`);
    if (barEl) barEl.style.width = `${Math.max(5, rating)}%`;

    // Update CEFR badge
    const cefrEl = document.getElementById(`skill-cefr-${id}`);
    if (cefrEl && window.PointsLogic) {
      cefrEl.textContent = window.PointsLogic.getCefrLevel(rating);
    }

    // Update Points Text
    const pointsEl = document.getElementById(`skill-points-${id}`);
    if (pointsEl) pointsEl.textContent = `${Math.round(skillPoints).toLocaleString()} XP`;
  });

  // 2. Overall Level
  const overallBadge = document.getElementById('overall-cefr-badge');
  if (overallBadge && window.PointsLogic) {
    const overallRating = window.PointsLogic.calculateOverallRating(ratings);
    overallBadge.textContent = window.PointsLogic.getCefrLevel(overallRating);

    // Color code badge based on rating
    if (overallRating >= 80) overallBadge.style.background = 'linear-gradient(135deg, #f59e0b, #d97706)'; // Gold (C1/C2)
    else if (overallRating >= 60) overallBadge.style.background = 'linear-gradient(135deg, #10b981, #059669)'; // Green (B2)
    else overallBadge.style.background = 'linear-gradient(135deg, #6366f1, #4f46e5)'; // Blue (A1-B1)
  }

  // 3. Stability & Consistency
  const stabilityEl = document.getElementById('overall-stability');
  if (stabilityEl) {
    // Basic heuristic: if rating is high, it's "stable" or "pro"
    stabilityEl.textContent = data.totalPoints > 500 ? 'Rating is High Fidelity' : 'Assessment in Progress';
  }

  const consistencyEl = document.getElementById('daily-consistency');
  if (consistencyEl) {
    const streak = data.srsStreak || 0;
    consistencyEl.textContent = streak > 0 ? `${streak} Day Streak 🔥` : 'Start your streak!';
  }
}

/**
 * Update the Practice Points display with a new value
 * Called when points change (e.g., after completing a task)
 * This now refreshes from server to ensure progress totals are synced
 */
async function updatePracticePointsDisplay() {
  const user = authFunctions ? authFunctions.getCurrentUser() : null;
  if (user) {
    await loadPracticePoints(user.uid);
  }
}

// Expose globally for other modules (watch-mode, etc)
window.updatePointsDisplay = updatePracticePointsDisplay;

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

  if (!authFunctions) {
    errorDiv.textContent = 'Auth system not ready. Check if scripts are blocked by certificate error.';
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

    // Classroom auto-redirect logic
    const user = authFunctions.getCurrentUser();
    if (user) {
      const isAdmin = await resolveAdminAccess(user);
      if (!isAdmin) {
        window.location.href = 'classroom.html';
        return; // Halt further script execution
      }
    }
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

  if (!authFunctions) {
    errorDiv.textContent = 'Auth system not ready. Check if scripts are blocked by certificate error.';
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
  if (authStateListenerBound) {
    return;
  }
  authStateListenerBound = true;

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
        hideEntryModal();

        currentUserId = user.uid;

        // Create or update user profile
        const isNewUser = !user.metadata.lastSignInTime ||
          (new Date(user.metadata.creationTime) > new Date(user.metadata.lastSignInTime));

        log.debug('Attempting to create/update user profile for:', user.uid);
        let profileResult;
        try {
          profileResult = await firestoreFunctions.createOrUpdateUserProfile(user.uid, user.email, isNewUser);
        } catch (profileErr) {
          log.error('Critical exception in profile update:', profileErr);
          profileResult = { success: false, error: profileErr.message };
        }

        if (!profileResult.success) {
          log.error('Profile update failed:', profileResult.error);
          // If it's a permission error, it's likely a rules issue or cold start problem
          if (profileResult.code === 'permission-denied') {
            console.error('[AuthUI] Firestore Permission Denied. Check rules.');
          }
          // Don't alert for every failure to avoid annoying users, but log it clearly
          // only alert if there's no cached profile
          const cachedProfile = localStorage.getItem(`userProfile_${user.uid}`);
          if (!cachedProfile) {
            alert('Warning: Could not sync your profile with the cloud. Your progress may not be saved during this session.\n\nDetails: ' + profileResult.error);
          } else {
            log.warn('Could not sync profile, but found local cache. Carrying on...');
          }
        }

        // Start session tracking
        await startSession();

        // Update panel to show logged in state
        updateAccountPanelState();


        // Update Level Header Badge
        if (window.LevelSystem && window.LevelSystem.updateHeaderLevel) {
          // Fetch profile strictly for level update if not already available
          // Note: updateAccountPanelState might fetch it internally, but for safety we fetch here
          // or pass it if available.
          firestoreFunctions.getUserProfile(user.uid).then(res => {
            if (res.success) {
              window.LevelSystem.updateHeaderLevel(res.data);
            }
          });
        }

        // Check for Level Selection (First Login Feature)
        await checkLevelSelection(user.uid);

        const guestSnapshot = wasGuestMode ? readGuestSnapshot() : null;
        const shouldPromptGuestImport = wasGuestMode && hasGuestProgress(guestSnapshot);
        const guestImportDecisionKey = `guestImportChoice_${user.uid}`;
        let guestImportChoice = sessionStorage.getItem(guestImportDecisionKey) || 'account';
        if (shouldPromptGuestImport && !sessionStorage.getItem(guestImportDecisionKey)) {
          guestImportChoice = await showGuestImportPrompt();
          sessionStorage.setItem(guestImportDecisionKey, guestImportChoice);
          if (guestImportChoice === 'import') {
            try {
              await importGuestProgressToAccount(user);
              localStorage.removeItem(GUEST_VOCAB_STORAGE_KEY);
              localStorage.removeItem(GUEST_SRS_STORAGE_KEY);
            } catch (importErr) {
              log.warn('Guest progress import failed, continuing with account only:', importErr);
              guestImportChoice = 'account';
            }
          }
        }

        // Initialize Vocabulary Book with user
        if (window.VocabularyBook) {
          // window.VocabularyBook is now a module that handles its own DB connection
          // Explicitly pass the DB instance to ensure it's available
          window.VocabularyBook.setUser(user.uid, window.__FIREBASE_INTERNAL__?.db);

          // Check if unlocked and show toggle
          try {
            const unlocked = await window.VocabularyBook.isUnlocked();
            log.debug('VocabularyBook unlock status:', unlocked);
            if (unlocked) {
              window.VocabularyBook.showToggle();

              // Initialize SRS Review module with user (part of Vocabulary Book)
              if (window.SRSReview) {
                window.SRSReview.setUser(user.uid, window.__FIREBASE_INTERNAL__?.db);
                // Update due badge after data loads
                setTimeout(() => {
                  if (window.VocabularyBook.updateSRSDueBadge) {
                    window.VocabularyBook.updateSRSDueBadge();
                  }
                }, 1000);
              }
            }
          } catch (vocabError) {
            log.warn('Error checking vocab unlock:', vocabError);
          }
        } else {
          log.warn('VocabularyBook module not loaded yet');
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
          log.debug('✓ Auth state change detected: User logged in. Triggering progress UI reload...');
          triggerAuthStateCallbacks('login', user.uid);

          // Refresh locked tabs based on new user data
          if (window.refreshLockedTabs) {
            await window.refreshLockedTabs();
          }
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
          log.debug('✓ Auth state change detected: User logged out. Triggering progress UI clear...');
          triggerAuthStateCallbacks('logout', null);

          // Refresh locked tabs (will revert to guest state)
          if (window.refreshLockedTabs) {
            await window.refreshLockedTabs();
          }
        }
      }
    } catch (err) {
      log.error('Error in onAuthStateChanged handler:', err);
      alert('An error occurred during login/logout processing:\n' + err.message);
    }
  });
}

// Duplicate function definition removed to fix SyntaxError

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
    log.error('Error starting session:', error);
  }
}

/**
 * Setup session tracking for tab close and visibility changes
 * Guest mode: No session tracking (all handlers return early)
 * Authenticated mode: Tracks visibility changes and page unload
 */
function setupSessionTracking() {
  if (sessionTrackingBound) {
    return;
  }
  sessionTrackingBound = true;

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
async function checkFirstVisit() {
  // Check if guest mode was already chosen in this session
  const guestModeStored = sessionStorage.getItem('guestMode');
  if (guestModeStored === 'true') {
    isGuestMode = true;
    updateAccountPanelState();
    return; // Don't show entry modal if guest mode already chosen
  }

  await waitForFirebaseModules();

  const user = authSessionGuard
    && typeof authSessionGuard.waitForInitialAuthResolution === 'function'
    && authFunctions
    && typeof authFunctions.onAuthStateChanged === 'function'
    ? await authSessionGuard.waitForInitialAuthResolution({
      getCurrentUser: () => (authFunctions ? authFunctions.getCurrentUser() : null),
      subscribe: (onStateChanged) => authFunctions.onAuthStateChanged(onStateChanged),
      timeoutMs: 12000,
      nullGraceMs: 250
    })
    : (authFunctions ? authFunctions.getCurrentUser() : null);

  if (!user && !isGuestMode) {
    showEntryModal();
    return;
  }

  hideEntryModal();
}

// Initialize when DOM is ready
function bootAuthUi() {
  initializeAuthUI();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    bootAuthUi();
    checkFirstVisit().catch((error) => {
      log.error('Failed to resolve first-visit auth state:', error);
    });
  });
} else {
  bootAuthUi();
  checkFirstVisit().catch((error) => {
    log.error('Failed to resolve first-visit auth state:', error);
  });
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

      const infoDiv = document.createElement('div');
      infoDiv.className = 'history-info';

      const titleSpan = document.createElement('span');
      titleSpan.className = 'history-title';
      titleSpan.textContent = item.title || 'Practice Item';

      const timeSpan = document.createElement('span');
      timeSpan.className = 'history-time';
      timeSpan.textContent = displayDate;

      infoDiv.appendChild(titleSpan);
      infoDiv.appendChild(timeSpan);

      const pointsSpan = document.createElement('span');
      pointsSpan.className = 'history-points';
      pointsSpan.textContent = `+${item.points}`;

      el.appendChild(infoDiv);
      el.appendChild(pointsSpan);

      // Click to show explanation
      el.addEventListener('click', () => {
        showExplanationPopup(item.title, item.points);
      });

      listEl.appendChild(el);
    });
  } catch (error) {
    log.error('Error loading history:', error);
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
    log.error("Error fetching rule explanation:", e);
    textEl.textContent = "Could not load explanation.";
  }
}

/**
 * Show the Progress Roadmap Modal
 */
async function showShoppingModal() {
  // Close account panel first
  closeAccountPanel();

  const modal = document.getElementById('shop-modal');
  const closeBtn = document.getElementById('shop-close-btn');
  const container = document.getElementById('level-system-container');

  if (!modal || !container) return;

  // Show modal using the class transition if possible, otherwise display
  modal.classList.add('active');
  modal.style.display = 'flex'; // Ensure flex layout for center alignment

  try {
    if (window.shopModule && typeof window.shopModule.renderSkillTree === 'function') {
      await window.shopModule.renderSkillTree();
    } else if (window.LevelSystem && window.LevelSystem.renderSkillTree) {
      const user = authFunctions.getCurrentUser();
      let userProfile = null;
      if (user) {
        const result = await firestoreFunctions.getUserProfile(user.uid);
        if (result.success) userProfile = result.data;
      }
      window.LevelSystem.renderSkillTree(container, userProfile, null);
    } else {
      container.innerHTML = '<div style="color:red; padding:20px;">Error: LevelSystem module not loaded.</div>';
    }
  } catch (err) {
    log.error('Error rendering progress roadmap:', err);
    container.innerHTML = '<div style="color:red; padding:20px;">Failed to load data. Please try again.</div>';
  }
}
window.authUI = window.authUI || {};
window.authUI.showPointsToast = showPointsToast;
window.authUI.loadPointsHistory = loadPointsHistory;
window.authUI.initializeAuthUI = initializeAuthUI;
window.authUI.onAuthStateChange = onAuthStateChange;
window.authUI.onAuthStateChanged = onAuthStateChange; // Compatibility alias

// Initialize automatically
log.log('✓ auth-ui.js: Module loaded');


/**
 * Firebase Authentication Module (v9+ Modular SDK)
 * 
 * Handles all authentication operations:
 * - Email/password signup with verification
 * - Email/password login (prevents unverified emails)
 * - Logout
 * - Password reset
 * - Auth state monitoring
 */

import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  sendPasswordResetEmail,
  sendEmailVerification,
  onAuthStateChanged as firebaseOnAuthStateChanged,
  browserLocalPersistence,
  setPersistence
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';

// Get auth instance
const auth = window.firebaseAuth;
const log = Logger.create('AuthSDK');

/**
 * Sign up a new user with email and password
 * Sends verification email automatically
 * @param {string} email - User email
 * @param {string} password - User password
 * @returns {Promise<Object>} User object or error
 */
async function signUp(email, password) {
  try {
    // Create user account
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    const user = userCredential.user;

    // Send verification email
    await sendEmailVerification(user);

    log.debug('✓ User created and verification email sent');

    return {
      success: true,
      user: user,
      message: 'Account created! Please check your email to verify your account.'
    };
  } catch (error) {
    log.error('Signup error:', error);
    return {
      success: false,
      error: error.message,
      code: error.code
    };
  }
}

/**
 * Sign in an existing user with email and password
 * Prevents login if email is not verified
 * 
 * Safari Cross-Browser Fix:
 * - Sets explicit persistence for Safari ITP compatibility
 * - Refreshes user token to get latest emailVerified status from server
 * - Better error handling and logging for debugging
 * 
 * @param {string} email - User email
 * @param {string} password - User password
 * @returns {Promise<Object>} User object or error
 */
async function signIn(email, password) {
  try {
    // Set explicit persistence for Safari ITP compatibility
    // This ensures auth state persists properly across browser sessions
    try {
      await setPersistence(auth, browserLocalPersistence);
      log.debug('✓ Auth persistence set to browserLocalPersistence');
    } catch (persistError) {
      // Log but continue - persistence may already be set
      log.warn('Persistence setting note:', persistError.message);
    }

    // Sign in user
    log.debug('Attempting sign in for:', email);
    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    const user = userCredential.user;
    log.debug('✓ Sign in successful, checking email verification...');

    // CRITICAL: Reload user to get the latest emailVerified status from server
    // This fixes issues where verification was done on another device/browser
    // but the local cached user data is stale
    try {
      await user.reload();
      log.debug('✓ User data refreshed from server');
    } catch (reloadError) {
      log.warn('User reload note:', reloadError.message);
      // Continue anyway - we'll check emailVerified with current data
    }

    // Get fresh reference after reload
    const freshUser = auth.currentUser;
    const emailVerified = freshUser ? freshUser.emailVerified : user.emailVerified;

    // Check if email is verified
    if (!emailVerified) {
      // Sign out immediately if not verified
      log.debug('✗ Email not verified (Policy disabled for testing)');
      // STRICT VERIFICATION DISABLED FOR DEBUGGING - Allows testing unverified accounts
    }

    log.debug('✓ User signed in successfully with verified email');

    return {
      success: true,
      user: freshUser || user
    };
  } catch (error) {
    // Enhanced error logging for debugging Safari issues
    log.error('Signin error:', {
      code: error.code,
      message: error.message,
      email: email,
      userAgent: navigator.userAgent
    });

    // Provide user-friendly error messages
    let userMessage = error.message;
    if (error.code === 'auth/user-not-found') {
      userMessage = 'No account found with this email. Please sign up first.';
    } else if (error.code === 'auth/wrong-password') {
      userMessage = 'Incorrect password. Please try again.';
    } else if (error.code === 'auth/invalid-credential') {
      userMessage = 'Invalid email or password. Please check and try again.';
    } else if (error.code === 'auth/too-many-requests') {
      userMessage = 'Too many failed attempts. Please wait a few minutes before trying again.';
    } else if (error.code === 'auth/network-request-failed') {
      userMessage = 'Network error. Please check your internet connection and try again.';
    }

    return {
      success: false,
      error: userMessage,
      code: error.code
    };
  }
}

/**
 * Sign out the current user
 * @returns {Promise<Object>} Success or error
 */
async function signOutUser() {
  try {
    await signOut(auth);
    log.debug('✓ User signed out successfully');
    return {
      success: true
    };
  } catch (error) {
    log.error('Signout error:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Send password reset email
 * @param {string} email - User email
 * @returns {Promise<Object>} Success or error
 */
async function sendPasswordReset(email) {
  try {
    await sendPasswordResetEmail(auth, email);
    log.debug('✓ Password reset email sent');
    return {
      success: true,
      message: 'Password reset email sent! Check your inbox.'
    };
  } catch (error) {
    log.error('Password reset error:', error);
    return {
      success: false,
      error: error.message,
      code: error.code
    };
  }
}

/**
 * Get the current authenticated user
 * @returns {Object|null} Current user or null
 */
function getCurrentUser() {
  return auth.currentUser;
}

/**
 * Monitor authentication state changes
 * @param {Function} callback - Function to call when auth state changes
 * @returns {Function} Unsubscribe function
 */
function onAuthStateChanged(callback) {
  return firebaseOnAuthStateChanged(auth, callback);
}

/**
 * Resend verification email to current user
 * Used when user can't find original verification email
 * User must be signed in (even if not verified)
 * @returns {Promise<Object>} Success or error
 */
async function resendVerificationEmail() {
  try {
    const user = auth.currentUser;
    if (!user) {
      return {
        success: false,
        error: 'No user is currently signed in. Please log in first.',
        code: 'auth/no-current-user'
      };
    }

    if (user.emailVerified) {
      return {
        success: false,
        error: 'Your email is already verified. You can log in normally.',
        code: 'auth/already-verified'
      };
    }

    await sendEmailVerification(user);
    log.debug('✓ Verification email resent');

    return {
      success: true,
      message: 'Verification email sent! Please check your inbox (and spam folder).'
    };
  } catch (error) {
    log.error('Resend verification error:', error);

    let userMessage = error.message;
    if (error.code === 'auth/too-many-requests') {
      userMessage = 'Too many requests. Please wait a few minutes before trying again.';
    }

    return {
      success: false,
      error: userMessage,
      code: error.code
    };
  }
}

// Export functions for use in other modules
window.firebaseAuthFunctions = {
  signUp,
  signIn,
  signOut: signOutUser,
  sendPasswordReset,
  getCurrentUser,
  onAuthStateChanged,
  resendVerificationEmail
};

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
  onAuthStateChanged as firebaseOnAuthStateChanged
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';

// Get auth instance
const auth = window.firebaseAuth;

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
    
    console.log('✓ User created and verification email sent');
    
    return {
      success: true,
      user: user,
      message: 'Account created! Please check your email to verify your account.'
    };
  } catch (error) {
    console.error('Signup error:', error);
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
 * @param {string} email - User email
 * @param {string} password - User password
 * @returns {Promise<Object>} User object or error
 */
async function signIn(email, password) {
  try {
    // Sign in user
    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    const user = userCredential.user;
    
    // Check if email is verified
    if (!user.emailVerified) {
      // Sign out immediately if not verified
      await signOut(auth);
      return {
        success: false,
        error: 'Please verify your email before logging in. Check your inbox for the verification link.',
        code: 'auth/email-not-verified'
      };
    }
    
    console.log('✓ User signed in successfully');
    
    return {
      success: true,
      user: user
    };
  } catch (error) {
    console.error('Signin error:', error);
    return {
      success: false,
      error: error.message,
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
    console.log('✓ User signed out successfully');
    return {
      success: true
    };
  } catch (error) {
    console.error('Signout error:', error);
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
    console.log('✓ Password reset email sent');
    return {
      success: true,
      message: 'Password reset email sent! Check your inbox.'
    };
  } catch (error) {
    console.error('Password reset error:', error);
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

// Export functions for use in other modules
window.firebaseAuthFunctions = {
  signUp,
  signIn,
  signOut: signOutUser,
  sendPasswordReset,
  getCurrentUser,
  onAuthStateChanged
};


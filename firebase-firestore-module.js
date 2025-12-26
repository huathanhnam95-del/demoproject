/**
 * Firestore Database Module (v9+ Modular SDK)
 * 
 * Handles all Firestore operations:
 * - User profile data (email, creation time, last login)
 * - Session tracking (login time, logout time, duration, totalActiveSeconds)
 * - Practice tracking (user ID, question ID/text, timestamp, correct/incorrect)
 */

import { 
  collection, 
  doc, 
  setDoc, 
  getDoc, 
  updateDoc, 
  addDoc, 
  query, 
  where, 
  limit, 
  getDocs,
  serverTimestamp,
  increment,
  Timestamp
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

// Get Firestore instance
const db = window.firebaseDb;

/**
 * User Profile Operations
 */

/**
 * Create or update user profile in Firestore
 * Called on signup and login
 * @param {string} userId - User ID
 * @param {string} email - User email
 * @param {boolean} isNewUser - Whether this is a new user (for setting creation time)
 * @returns {Promise<Object>} Success or error
 */
async function createOrUpdateUserProfile(userId, email, isNewUser = false) {
  try {
    const userRef = doc(db, 'users', userId);
    const userDoc = await getDoc(userRef);
    
    if (!userDoc.exists() || isNewUser) {
      // Create new user profile
      await setDoc(userRef, {
        email: email,
        createdAt: serverTimestamp(),
        lastLoginAt: serverTimestamp(),
        totalActiveSeconds: 0
      });
      console.log('✓ User profile created');
    } else {
      // Update existing user profile (update last login time)
      await updateDoc(userRef, {
        lastLoginAt: serverTimestamp()
      });
      console.log('✓ User profile updated (last login)');
    }
    
    return {
      success: true
    };
  } catch (error) {
    console.error('Error creating/updating user profile:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Get user profile data
 * @param {string} userId - User ID
 * @returns {Promise<Object>} User profile data or error
 */
async function getUserProfile(userId) {
  try {
    const userDoc = await getDoc(doc(db, 'users', userId));
    
    if (!userDoc.exists()) {
      return {
        success: false,
        error: 'User profile not found'
      };
    }
    
    return {
      success: true,
      data: userDoc.data()
    };
  } catch (error) {
    console.error('Error getting user profile:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Session Tracking Operations
 */

/**
 * Record session start (login time)
 * @param {string} userId - User ID
 * @returns {Promise<string>} Session ID
 */
async function recordSessionStart(userId) {
  try {
    const sessionRef = await addDoc(collection(db, 'sessions'), {
      userId: userId,
      loginTime: serverTimestamp(),
      logoutTime: null,
      duration: null,
      isActive: true
    });
    
    console.log('✓ Session started:', sessionRef.id);
    return sessionRef.id;
  } catch (error) {
    console.error('Error recording session start:', error);
    throw error;
  }
}

/**
 * Record session end (logout, tab close, or visibility change)
 * Updates session duration and totalActiveSeconds
 * @param {string} sessionId - Session ID
 * @param {string} userId - User ID
 * @returns {Promise<Object>} Success or error
 */
async function recordSessionEnd(sessionId, userId) {
  try {
    const sessionRef = doc(db, 'sessions', sessionId);
    const sessionDoc = await getDoc(sessionRef);
    
    if (!sessionDoc.exists()) {
      return {
        success: false,
        error: 'Session not found'
      };
    }
    
    const sessionData = sessionDoc.data();
    const loginTime = sessionData.loginTime?.toDate();
    
    if (!loginTime) {
      return {
        success: false,
        error: 'Login time not found'
      };
    }
    
    const logoutTime = new Date();
    const duration = Math.floor((logoutTime - loginTime) / 1000); // Duration in seconds
    
    // Update session document
    await updateDoc(sessionRef, {
      logoutTime: Timestamp.fromDate(logoutTime),
      duration: duration,
      isActive: false
    });
    
    // Update user's totalActiveSeconds
    const userRef = doc(db, 'users', userId);
    await updateDoc(userRef, {
      totalActiveSeconds: increment(duration)
    });
    
    console.log('✓ Session ended:', sessionId, 'Duration:', duration, 'seconds');
    
    return {
      success: true,
      duration: duration
    };
  } catch (error) {
    console.error('Error recording session end:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Get active session ID for a user
 * @param {string} userId - User ID
 * @returns {Promise<string|null>} Active session ID or null
 */
async function getActiveSessionId(userId) {
  try {
    const sessionsQuery = query(
      collection(db, 'sessions'),
      where('userId', '==', userId),
      where('isActive', '==', true),
      limit(1)
    );
    
    const sessionsSnapshot = await getDocs(sessionsQuery);
    
    if (sessionsSnapshot.empty) {
      return null;
    }
    
    return sessionsSnapshot.docs[0].id;
  } catch (error) {
    console.error('Error getting active session:', error);
    return null;
  }
}

/**
 * Practice Tracking Operations
 */

/**
 * Record a practice attempt (question answer)
 * @param {string} userId - User ID
 * @param {string|number} questionId - Question ID or text
 * @param {boolean} isCorrect - Whether the answer was correct
 * @param {string} mode - Practice mode ('type', 'speak', 'extended', 'phrases')
 * @returns {Promise<Object>} Success or error
 */
async function recordPracticeAttempt(userId, questionId, isCorrect, mode = 'type') {
  try {
    await addDoc(collection(db, 'practiceAttempts'), {
      userId: userId,
      questionId: questionId,
      mode: mode,
      isCorrect: isCorrect,
      timestamp: serverTimestamp()
    });
    
    console.log('✓ Practice attempt recorded:', { userId, questionId, isCorrect, mode });
    
    return {
      success: true
    };
  } catch (error) {
    console.error('Error recording practice attempt:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Get practice statistics for a user
 * @param {string} userId - User ID
 * @returns {Promise<Object>} Practice statistics
 */
async function getPracticeStats(userId) {
  try {
    const attemptsQuery = query(
      collection(db, 'practiceAttempts'),
      where('userId', '==', userId)
    );
    
    const attemptsSnapshot = await getDocs(attemptsQuery);
    const attempts = attemptsSnapshot.docs.map(doc => doc.data());
    const total = attempts.length;
    const correct = attempts.filter(a => a.isCorrect).length;
    const incorrect = total - correct;
    
    return {
      success: true,
      stats: {
        total: total,
        correct: correct,
        incorrect: incorrect,
        accuracy: total > 0 ? (correct / total * 100).toFixed(1) : 0
      }
    };
  } catch (error) {
    console.error('Error getting practice stats:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * ============================================
 * Mastery Status Operations
 * ============================================
 * 
 * Mastery is tracked per user, per mode, per question.
 * Type mode and Speak mode are INDEPENDENT - mastery in one mode
 * does NOT affect mastery in the other mode.
 * 
 * A question is "Mastered" when the user achieves 100% correctness
 * in the CURRENT mode only (Type OR Speak, not both).
 * 
 * Data Model:
 *   users/{uid}/mastery/{mode}_{questionId}
 *   {
 *     mode: "type" | "speak",
 *     questionId: number | string,
 *     mastered: boolean,
 *     masteredAt: timestamp  // when mastery was achieved
 *   }
 * 
 * Note: This feature is for logged-in users only.
 * Guests do NOT store mastery status.
 */

/**
 * Get mastery status for a specific question in a specific mode
 * Type and Speak modes are independent - each has its own mastery status
 * 
 * @param {string} userId - User ID (must be logged in)
 * @param {string|number} questionId - Question ID
 * @param {string} mode - Practice mode ('type' or 'speak')
 * @returns {Promise<Object>} Mastery status or null if not mastered
 */
async function getMasteryStatus(userId, questionId, mode) {
  try {
    if (!userId) {
      return { success: true, mastery: null }; // Guest mode - no mastery
    }
    
    if (!mode || (mode !== 'type' && mode !== 'speak')) {
      return { success: false, error: 'Invalid mode. Must be "type" or "speak"' };
    }
    
    // Document ID format: {mode}_{questionId}
    const docId = `${mode}_${questionId}`;
    const masteryRef = doc(db, 'users', userId, 'mastery', docId);
    const masteryDoc = await getDoc(masteryRef);
    
    if (masteryDoc.exists()) {
      return {
        success: true,
        mastery: masteryDoc.data()
      };
    }
    
    return { success: true, mastery: null };
  } catch (error) {
    console.error('Error getting mastery status:', error);
    return {
      success: false,
      error: error.message,
      mastery: null
    };
  }
}

/**
 * Update mastery status for a question in a specific mode
 * Called automatically when user achieves 100% correctness in Type or Speak mode
 * Type and Speak modes are independent - updating one does NOT affect the other
 * 
 * @param {string} userId - User ID (must be logged in)
 * @param {string|number} questionId - Question ID
 * @param {string} mode - Practice mode ('type' or 'speak')
 * @param {boolean} isMastered - Whether the question is mastered (100% correct) in this mode
 * @returns {Promise<Object>} Success or error
 */
async function updateMasteryStatus(userId, questionId, mode, isMastered) {
  try {
    // Guest mode: Do NOT store mastery status
    if (!userId) {
      return { success: true, message: 'Guest mode - mastery not stored' };
    }
    
    if (!mode || (mode !== 'type' && mode !== 'speak')) {
      return { success: false, error: 'Invalid mode. Must be "type" or "speak"' };
    }
    
    // Document ID format: {mode}_{questionId}
    const docId = `${mode}_${questionId}`;
    const masteryRef = doc(db, 'users', userId, 'mastery', docId);
    
    if (isMastered) {
      // Mark as mastered - set mastered = true and save timestamp
      await setDoc(masteryRef, {
        mode: mode,
        questionId: String(questionId),
        mastered: true,
        masteredAt: serverTimestamp()
      }, { merge: true });
      
      console.log('✓ Mastery status updated (mastered):', { userId, questionId, mode });
    } else {
      // Not mastered - ensure mastered is false
      await setDoc(masteryRef, {
        mode: mode,
        questionId: String(questionId),
        mastered: false,
        masteredAt: null
      }, { merge: true });
      
      console.log('✓ Mastery status updated (not mastered):', { userId, questionId, mode });
    }
    
    return {
      success: true,
      mastery: {
        mode: mode,
        questionId: String(questionId),
        mastered: isMastered
      }
    };
  } catch (error) {
    console.error('Error updating mastery status:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Remove mastered status for a question in a specific mode
 * Called when user clicks "Remove Mastered Status" button
 * Only removes mastery for the current mode - does NOT affect the other mode
 * 
 * @param {string} userId - User ID (must be logged in)
 * @param {string|number} questionId - Question ID
 * @param {string} mode - Practice mode ('type' or 'speak')
 * @returns {Promise<Object>} Success or error
 */
async function removeMasteryStatus(userId, questionId, mode) {
  try {
    // Guest mode: Cannot remove mastery (doesn't exist)
    if (!userId) {
      return { success: false, error: 'Must be logged in to remove mastery' };
    }
    
    if (!mode || (mode !== 'type' && mode !== 'speak')) {
      return { success: false, error: 'Invalid mode. Must be "type" or "speak"' };
    }
    
    // Document ID format: {mode}_{questionId}
    const docId = `${mode}_${questionId}`;
    const masteryRef = doc(db, 'users', userId, 'mastery', docId);
    
    // Reset mastery fields to false for this mode only
    await setDoc(masteryRef, {
      mode: mode,
      questionId: String(questionId),
      mastered: false,
      masteredAt: null
    }, { merge: true });
    
    console.log('✓ Mastery status removed:', { userId, questionId, mode });
    
    return {
      success: true
    };
  } catch (error) {
    console.error('Error removing mastery status:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

// Export functions for use in other modules
window.firebaseFirestoreFunctions = {
  createOrUpdateUserProfile,
  getUserProfile,
  recordSessionStart,
  recordSessionEnd,
  getActiveSessionId,
  recordPracticeAttempt,
  getPracticeStats,
  getMasteryStatus,
  updateMasteryStatus,
  removeMasteryStatus
};


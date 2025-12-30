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
  Timestamp,
  orderBy
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
        totalActiveSeconds: 0,
        totalPoints: 0
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
 * Update user profile fields
 * @param {string} userId
 * @param {Object} data - Fields to update
 * @returns {Promise<Object>} Success or error
 */
async function updateUserProfile(userId, data) {
  try {
    const userRef = doc(db, 'users', userId);
    await updateDoc(userRef, data);
    return { success: true };
  } catch (error) {
    console.error('Error updating user profile:', error);
    return { success: false, error: error.message };
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
 * Tiered Progress Operations
 * ============================================
 * 
 * Progress is tracked per user, per mode, per question.
 * Type mode and Speak mode are INDEPENDENT - progress in one mode
 * does NOT affect progress in the other mode.
 * 
 * Tier Calculation:
 *   - Completed: 1 perfect completion (100% correct)
 *   - Consolidated: 2 perfect completions
 *   - Mastered: 3+ perfect completions
 * 
 * Data Model:
 *   users/{uid}/progress/{mode}_{questionId}
 *   {
 *     mode: "type" | "speak",
 *     questionId: number | string,
 *     perfectCount: number,           // Number of 100% correct attempts
 *     tier: "none" | "completed" | "consolidated" | "mastered",
 *     lastCompletedAt: timestamp      // When last perfect completion happened
 *   }
 * 
 * Note: This feature is for logged-in users only.
 * Guests do NOT store progress status.
 */

/**
 * Calculate state based on attempt status and perfect completion count
 * 
 * State definitions:
 *   - 'not-started': User has never pressed Check (no attempts)
 *   - 'in-progress': User has attempted but perfectCount < 3
 *   - 'completed': perfectCount 3-5
 *   - 'consolidated': perfectCount 6-8
 *   - 'mastered': perfectCount >= 9
 * 
 * @param {boolean} hasAttempted - Whether user has attempted at least once
 * @param {number} perfectCount - Number of perfect completions
 * @returns {string} State name
 */
function calculateState(hasAttempted, perfectCount) {
  if (perfectCount >= 9) return 'mastered';
  if (perfectCount >= 6) return 'consolidated';
  if (perfectCount >= 3) return 'completed';
  if (hasAttempted) return 'in-progress';
  return 'not-started';
}

/**
 * Calculate tier based on perfect completion count (legacy compatibility)
 * 
 * Tier thresholds (3 perfect completions per tier):
 *   - 0-2 completions → 'none' (not completed) or 'in-progress' if attempted
 *   - 3-5 completions → 'completed'
 *   - 6-8 completions → 'consolidated'
 *   - 9+ completions → 'mastered'
 * 
 * @param {number} perfectCount - Number of perfect completions
 * @returns {string} Tier name
 */
function calculateTier(perfectCount) {
  if (perfectCount >= 9) return 'mastered';
  if (perfectCount >= 6) return 'consolidated';
  if (perfectCount >= 3) return 'completed';
  return 'none';
}

/**
 * Get progress status for a specific question in a specific mode
 * Type and Speak modes are independent - each has its own progress status
 * 
 * @param {string} userId - User ID (must be logged in)
 * @param {string|number} questionId - Question ID
 * @param {string} mode - Practice mode ('type' or 'speak')
 * @returns {Promise<Object>} Progress status or null if no progress
 */
async function getProgressStatus(userId, questionId, mode) {
  try {
    if (!userId) {
      return { success: true, progress: null }; // Guest mode - no progress
    }

    if (!mode || (mode !== 'type' && mode !== 'speak')) {
      return { success: false, error: 'Invalid mode. Must be "type" or "speak"' };
    }

    // Document ID format: {mode}_{questionId}
    const docId = `${mode}_${questionId}`;
    const progressRef = doc(db, 'users', userId, 'progress', docId);
    const progressDoc = await getDoc(progressRef);

    if (progressDoc.exists()) {
      const data = progressDoc.data();
      // Ensure state is calculated correctly
      const hasAttempted = data.hasAttempted || false;
      const perfectCount = data.perfectCount || 0;
      const state = calculateState(hasAttempted, perfectCount);

      return {
        success: true,
        progress: {
          ...data,
          hasAttempted: hasAttempted,
          state: state
        }
      };
    }

    // Return default progress for questions with no progress (not started)
    return {
      success: true,
      progress: {
        mode: mode,
        questionId: String(questionId),
        perfectCount: 0,
        hasAttempted: false,
        attemptCount: 0,
        tier: 'none',
        state: 'not-started',
        lastCompletedAt: null
      }
    };
  } catch (error) {
    console.error('Error getting progress status:', error);
    return {
      success: false,
      error: error.message,
      progress: null
    };
  }
}

/**
 * Increment perfect count and update tier for a question
 * Called automatically when user achieves 100% correctness in Type or Speak mode
 * Type and Speak modes are independent - updating one does NOT affect the other
 * 
 * @param {string} userId - User ID (must be logged in)
 * @param {string|number} questionId - Question ID
 * @param {string} mode - Practice mode ('type' or 'speak')
 * @returns {Promise<Object>} Updated progress or error
 */
/**
 * Record an attempt (user pressed Check button)
 * Called regardless of correctness - marks the question as attempted
 * 
 * @param {string} userId - User ID (must be logged in)
 * @param {string|number} questionId - Question ID
 * @param {string} mode - Practice mode ('type' or 'speak')
 * @returns {Promise<Object>} Updated progress or error
 */
async function recordAttempt(userId, questionId, mode) {
  try {
    // Guest mode: Do NOT store progress
    if (!userId) {
      return { success: true, message: 'Guest mode - attempt not stored' };
    }

    if (!mode || (mode !== 'type' && mode !== 'speak')) {
      return { success: false, error: 'Invalid mode. Must be "type" or "speak"' };
    }

    // Document ID format: {mode}_{questionId}
    const docId = `${mode}_${questionId}`;
    const progressRef = doc(db, 'users', userId, 'progress', docId);

    // Get current progress
    const progressDoc = await getDoc(progressRef);
    let currentData = {
      mode: mode,
      questionId: String(questionId),
      perfectCount: 0,
      hasAttempted: false,
      attemptCount: 0
    };

    if (progressDoc.exists()) {
      currentData = { ...currentData, ...progressDoc.data() };
    }

    // Increment attempt count and mark as attempted
    const newAttemptCount = (currentData.attemptCount || 0) + 1;
    const state = calculateState(true, currentData.perfectCount || 0);

    // Update progress document
    await setDoc(progressRef, {
      mode: mode,
      questionId: String(questionId),
      hasAttempted: true,
      attemptCount: newAttemptCount,
      state: state,
      lastAttemptAt: serverTimestamp()
    }, { merge: true });

    console.log('✓ Attempt recorded:', { userId, questionId, mode, attemptCount: newAttemptCount });

    return {
      success: true,
      progress: {
        mode: mode,
        questionId: String(questionId),
        perfectCount: currentData.perfectCount || 0,
        hasAttempted: true,
        attemptCount: newAttemptCount,
        state: state
      }
    };
  } catch (error) {
    console.error('Error recording attempt:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Increment perfect count and update tier for a question
 * Called automatically when user achieves 100% correctness in Type or Speak mode
 * Also marks the question as attempted
 * 
 * @param {string} userId - User ID (must be logged in)
 * @param {string|number} questionId - Question ID
 * @param {string} mode - Practice mode ('type' or 'speak')
 * @returns {Promise<Object>} Updated progress or error
 */
async function incrementProgress(userId, questionId, mode) {
  try {
    // Guest mode: Do NOT store progress
    if (!userId) {
      return { success: true, message: 'Guest mode - progress not stored' };
    }

    if (!mode || (mode !== 'type' && mode !== 'speak')) {
      return { success: false, error: 'Invalid mode. Must be "type" or "speak"' };
    }

    // Document ID format: {mode}_{questionId}
    const docId = `${mode}_${questionId}`;
    const progressRef = doc(db, 'users', userId, 'progress', docId);

    // Get current progress
    const progressDoc = await getDoc(progressRef);
    let currentCount = 0;
    let attemptCount = 0;

    if (progressDoc.exists()) {
      currentCount = progressDoc.data().perfectCount || 0;
      attemptCount = progressDoc.data().attemptCount || 0;
    }

    // Increment count and calculate new state
    const newCount = currentCount + 1;
    const newState = calculateState(true, newCount);
    const newTier = calculateTier(newCount); // For backward compatibility

    // Update progress document
    await setDoc(progressRef, {
      mode: mode,
      questionId: String(questionId),
      perfectCount: newCount,
      hasAttempted: true,
      attemptCount: attemptCount,
      tier: newTier,
      state: newState,
      lastCompletedAt: serverTimestamp()
    }, { merge: true });

    console.log('✓ Progress incremented:', { userId, questionId, mode, newCount, newState });

    return {
      success: true,
      progress: {
        mode: mode,
        questionId: String(questionId),
        perfectCount: newCount,
        hasAttempted: true,
        attemptCount: attemptCount,
        tier: newTier,
        state: newState
      }
    };
  } catch (error) {
    console.error('Error incrementing progress:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Reset progress for a question in a specific mode
 * Called when user wants to reset their progress
 * 
 * @param {string} userId - User ID (must be logged in)
 * @param {string|number} questionId - Question ID
 * @param {string} mode - Practice mode ('type' or 'speak')
 * @returns {Promise<Object>} Success or error
 */
async function resetProgress(userId, questionId, mode) {
  try {
    if (!userId) {
      return { success: false, error: 'Must be logged in to reset progress' };
    }

    if (!mode || (mode !== 'type' && mode !== 'speak')) {
      return { success: false, error: 'Invalid mode. Must be "type" or "speak"' };
    }

    // Document ID format: {mode}_{questionId}
    const docId = `${mode}_${questionId}`;
    const progressRef = doc(db, 'users', userId, 'progress', docId);

    // Reset to zero
    await setDoc(progressRef, {
      mode: mode,
      questionId: String(questionId),
      perfectCount: 0,
      tier: 'none',
      lastCompletedAt: null
    }, { merge: true });

    console.log('✓ Progress reset:', { userId, questionId, mode });

    return {
      success: true
    };
  } catch (error) {
    console.error('Error resetting progress:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Get all progress data for a mode (for caching)
 * Returns progress for all questions the user has attempted
 * 
 * @param {string} userId - User ID (must be logged in)
 * @param {string} mode - Practice mode ('type' or 'speak')
 * @returns {Promise<Object>} Map of questionId -> progress data
 */
async function getAllProgressForMode(userId, mode) {
  try {
    if (!userId) {
      return { success: true, progressMap: {} }; // Guest mode
    }

    if (!mode || (mode !== 'type' && mode !== 'speak')) {
      return { success: false, error: 'Invalid mode. Must be "type" or "speak"' };
    }

    // Query all progress documents for this mode
    const progressQuery = query(
      collection(db, 'users', userId, 'progress'),
      where('mode', '==', mode)
    );

    const progressSnapshot = await getDocs(progressQuery);
    const progressMap = {};

    progressSnapshot.forEach(doc => {
      const data = doc.data();
      progressMap[data.questionId] = data;
    });

    console.log(`✓ Loaded ${Object.keys(progressMap).length} progress entries for ${mode} mode`);

    return {
      success: true,
      progressMap: progressMap
    };
  } catch (error) {
    console.error('Error getting all progress for mode:', error);
    return {
      success: false,
      error: error.message,
      progressMap: {}
    };
  }
}

/**
 * Get recently progressed questions for a mode
 * Returns last N questions where tier increased
 * 
 * @param {string} userId - User ID (must be logged in)
 * @param {string} mode - Practice mode ('type' or 'speak')
 * @param {number} limit - Maximum number of results (default 5)
 * @returns {Promise<Object>} Array of recent progress entries
 */
async function getRecentProgress(userId, mode, limitCount = 5) {
  try {
    if (!userId) {
      return { success: true, recentProgress: [] };
    }

    if (!mode || (mode !== 'type' && mode !== 'speak')) {
      return { success: false, error: 'Invalid mode. Must be "type" or "speak"' };
    }

    // Query recent progress documents for this mode, ordered by lastCompletedAt
    const progressQuery = query(
      collection(db, 'users', userId, 'progress'),
      where('mode', '==', mode),
      where('tier', '!=', 'none'),
      limit(limitCount * 3) // Get more than needed since we filter client-side
    );

    const progressSnapshot = await getDocs(progressQuery);
    const recentProgress = [];

    progressSnapshot.forEach(doc => {
      const data = doc.data();
      if (data.lastCompletedAt && data.tier !== 'none') {
        recentProgress.push({
          questionId: data.questionId,
          tier: data.tier,
          perfectCount: data.perfectCount,
          lastCompletedAt: data.lastCompletedAt
        });
      }
    });

    // Sort by lastCompletedAt descending and take top N
    recentProgress.sort((a, b) => {
      const timeA = a.lastCompletedAt?.toMillis?.() || 0;
      const timeB = b.lastCompletedAt?.toMillis?.() || 0;
      return timeB - timeA;
    });

    return {
      success: true,
      recentProgress: recentProgress.slice(0, limitCount)
    };
  } catch (error) {
    console.error('Error getting recent progress:', error);
    return {
      success: false,
      error: error.message,
      recentProgress: []
    };
  }
}

// Legacy mastery functions (redirected to progress functions)
async function getMasteryStatus(userId, questionId, mode) {
  const result = await getProgressStatus(userId, questionId, mode);
  if (result.success && result.progress) {
    return {
      success: true,
      mastery: {
        ...result.progress,
        mastered: result.progress.tier === 'mastered'
      }
    };
  }
  return { success: result.success, mastery: null, error: result.error };
}

async function updateMasteryStatus(userId, questionId, mode, isMastered) {
  if (isMastered) {
    return await incrementProgress(userId, questionId, mode);
  }
  return { success: true, message: 'No action taken for non-mastered status' };
}

async function removeMasteryStatus(userId, questionId, mode) {
  return await resetProgress(userId, questionId, mode);
}

/**
 * ============================================
 * Points System Operations
 * ============================================
 * 
 * Points are tracked per user with a history log.
 * 
 * Data Model:
 *   users/{uid}
 *   {
 *     totalPoints: number           // Total accumulated points
 *   }
 *   
 *   users/{uid}/pointsHistory/{autoId}
 *   {
 *     title: string,                // Short title for the points action
 *     description: string,          // Detailed description
 *     points: number,               // Points added (can be negative)
 *     createdAt: timestamp          // When the points were added
 *   }
 * 
 * Note: This feature is for logged-in users only.
 */

/**
 * Add points to a user's total and log the action in history
 * 
 * SAFETY CHECKS:
 * 1. User must be logged in
 * 2. Points cannot go below 0 (floor at 0)
 * 3. In-flight request tracking to prevent double-awarding
 * 
 * @param {string} userId - User ID (must be logged in)
 * @param {number} points - Points to add (can be negative for deductions)
 * @param {string} title - Short title describing the points action
 * @param {string} description - Detailed description of why points were awarded
 * @returns {Promise<Object>} Updated total points and history entry ID
 */

// Track in-flight requests to prevent double-awarding
const inFlightRequests = new Set();

async function addPoints(userId, points, title, description = '') {
  try {
    // ═══════════════════════════════════════
    // SAFETY CHECK 1: User must be logged in
    // ═══════════════════════════════════════
    if (!userId) {
      console.warn('⚠ Points not added: User not logged in');
      return { success: false, error: 'Must be logged in to add points' };
    }

    if (typeof points !== 'number' || isNaN(points)) {
      return { success: false, error: 'Points must be a valid number' };
    }

    if (!title || typeof title !== 'string') {
      return { success: false, error: 'Title is required' };
    }

    // ═══════════════════════════════════════
    // SAFETY CHECK 3: Prevent double-awarding
    // ═══════════════════════════════════════
    // Create unique request key to track in-flight requests
    const requestKey = `${userId}_${title}_${Date.now()}`;
    const dedupKey = `${userId}_${title}`;

    // Check if same request is already in flight (within 2 seconds)
    for (const key of inFlightRequests) {
      if (key.startsWith(dedupKey)) {
        console.log('⏭ Points skipped: Request already in flight');
        return {
          success: true,
          skipped: true,
          reason: 'Request already in progress'
        };
      }
    }

    // Mark request as in-flight
    inFlightRequests.add(requestKey);

    // Auto-cleanup after 5 seconds
    setTimeout(() => {
      inFlightRequests.delete(requestKey);
    }, 5000);

    const userRef = doc(db, 'users', userId);

    // Get current total points
    const userDoc = await getDoc(userRef);
    let currentTotal = 0;

    if (userDoc.exists()) {
      currentTotal = userDoc.data().totalPoints || 0;
    }

    // Calculate new total
    let newTotal = currentTotal + points;

    // ═══════════════════════════════════════
    // SAFETY CHECK 2: Points cannot go below 0
    // ═══════════════════════════════════════
    if (newTotal < 0) {
      console.log(`⚠ Points floor applied: ${newTotal} → 0`);
      newTotal = 0;
    }

    // Update user's totalPoints
    await updateDoc(userRef, {
      totalPoints: newTotal
    });

    // Add entry to pointsHistory subcollection
    const historyRef = await addDoc(collection(db, 'users', userId, 'pointsHistory'), {
      title: title,
      description: description,
      points: points,
      previousTotal: currentTotal,
      newTotal: newTotal,
      createdAt: serverTimestamp()
    });

    // Remove from in-flight tracking
    inFlightRequests.delete(requestKey);

    console.log('✓ Points awarded:', { userId, points, title, newTotal, historyId: historyRef.id });

    return {
      success: true,
      totalPoints: newTotal,
      previousTotal: currentTotal,
      pointsAwarded: points,
      historyId: historyRef.id
    };
  } catch (error) {
    console.error('Error adding points:', error);
    return {
      success: false,
      error: error.message
    };
  }
}


/**
 * Get total points for a user
 * 
 * @param {string} userId - User ID (must be logged in)
 * @returns {Promise<Object>} Total points
 */
async function getTotalPoints(userId) {
  try {
    if (!userId) {
      return { success: false, error: 'Must be logged in to get points' };
    }

    const userDoc = await getDoc(doc(db, 'users', userId));

    if (!userDoc.exists()) {
      return {
        success: false,
        error: 'User profile not found'
      };
    }

    const totalPoints = userDoc.data().totalPoints || 0;

    return {
      success: true,
      totalPoints: totalPoints
    };
  } catch (error) {
    console.error('Error getting total points:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Get points history for a user
 * 
 * @param {string} userId - User ID (must be logged in)
 * @param {number} limitCount - Maximum number of entries to return (default 10)
 * @returns {Promise<Object>} Array of points history entries
 */
async function getPointsHistory(userId, limitCount = 10) {
  try {
    if (!userId) {
      return { success: false, error: 'Must be logged in to get points history' };
    }

    // Query pointsHistory subcollection, ordered by createdAt descending
    const historyQuery = query(
      collection(db, 'users', userId, 'pointsHistory'),
      orderBy('createdAt', 'desc'),
      limit(limitCount)
    );

    const historySnapshot = await getDocs(historyQuery);
    const history = [];

    historySnapshot.forEach(doc => {
      const data = doc.data();
      history.push({
        id: doc.id,
        title: data.title,
        description: data.description,
        points: data.points,
        createdAt: data.createdAt
      });
    });

    // Sort by createdAt descending (client-side since we can't orderBy without index)
    history.sort((a, b) => {
      const timeA = a.createdAt?.toMillis?.() || 0;
      const timeB = b.createdAt?.toMillis?.() || 0;
      return timeB - timeA;
    });

    console.log(`✓ Loaded ${history.length} points history entries for user ${userId}`);

    return {
      success: true,
      history: history.slice(0, limitCount)
    };
  } catch (error) {
    console.error('Error getting points history:', error);
    return {
      success: false,
      error: error.message,
      history: []
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
  // Legacy mastery functions (now redirect to progress)
  getMasteryStatus,
  updateMasteryStatus,
  removeMasteryStatus,
  // New tiered progress functions
  calculateTier,
  calculateState,
  getProgressStatus,
  recordAttempt,
  incrementProgress,
  resetProgress,
  getAllProgressForMode,
  getRecentProgress,
  // Points system functions
  addPoints,
  getTotalPoints,
  getPointsHistory
};

/**
 * ============================================
 * Points Rules Operations
 * ============================================
 * 
 * These functions allow reading the points rules
 * that are synced from the admin CSV/Excel file.
 */

/**
 * Get all active points rules
 * Used to display what actions earn points
 * 
 * @returns {Promise<Object>} Array of active rules
 */
async function getPointsRules() {
  try {
    const rulesQuery = query(
      collection(db, 'pointsRules'),
      where('active', '==', true)
    );

    const snapshot = await getDocs(rulesQuery);
    const rules = [];

    snapshot.forEach(doc => {
      rules.push({
        id: doc.id,
        ...doc.data()
      });
    });

    // Sort by points descending
    rules.sort((a, b) => (b.points || 0) - (a.points || 0));

    console.log(`✓ Loaded ${rules.length} active points rules`);

    return {
      success: true,
      rules: rules
    };
  } catch (error) {
    console.error('Error getting points rules:', error);
    return {
      success: false,
      error: error.message,
      rules: []
    };
  }
}

/**
 * Get a points rule by title
 * Used when awarding points to find the matching rule
 * 
 * @param {string} title - Rule title (case-insensitive match)
 * @returns {Promise<Object>} Rule data or null
 */
async function getPointsRuleByTitle(title) {
  try {
    if (!title) {
      return { success: false, error: 'Title is required', rule: null };
    }

    // Query all active rules and find by title (case-insensitive)
    const rulesQuery = query(
      collection(db, 'pointsRules'),
      where('active', '==', true)
    );

    const snapshot = await getDocs(rulesQuery);
    const searchTitle = title.toLowerCase().trim();

    let foundRule = null;
    snapshot.forEach(doc => {
      const data = doc.data();
      if ((data.title || '').toLowerCase().trim() === searchTitle) {
        foundRule = {
          id: doc.id,
          ...data
        };
      }
    });

    if (foundRule) {
      return {
        success: true,
        rule: foundRule
      };
    }

    return {
      success: true,
      rule: null
    };
  } catch (error) {
    console.error('Error getting points rule by title:', error);
    return {
      success: false,
      error: error.message,
      rule: null
    };
  }
}

/**
 * Award points based on a rule title
 * 
 * @param {string} userId - User ID
 * @param {string} ruleTitle - Title of the rule to apply
 * @param {Object} options - Optional settings
 * @param {string} options.customDescription - Override the rule description
 * @param {string} options.preventDuplicate - Duplicate prevention mode:
 *   - 'none': No prevention (default) - can award multiple times
 *   - 'daily': Once per day per rule
 *   - 'session': Once per browser session per rule
 *   - 'once': Only once ever per rule
 * @param {string} options.context - Additional context (e.g., questionId) for more specific dedup
 * @returns {Promise<Object>} Result of addPoints or error/skip status
 */
async function awardPointsByRule(userId, ruleTitle, options = {}) {
  try {
    if (!userId) {
      return { success: false, error: 'Must be logged in to award points' };
    }

    const {
      customDescription = null,
      preventDuplicate = 'none',
      context = ''
    } = options;

    // Check duplicate prevention
    if (preventDuplicate !== 'none') {
      const isDuplicate = await checkDuplicateAward(userId, ruleTitle, preventDuplicate, context);
      if (isDuplicate) {
        console.log(`⏭ Points skipped (duplicate): "${ruleTitle}"`, preventDuplicate);
        return {
          success: true,
          skipped: true,
          reason: `Already awarded (${preventDuplicate})`
        };
      }
    }

    // Find the rule
    const ruleResult = await getPointsRuleByTitle(ruleTitle);

    if (!ruleResult.success) {
      return ruleResult;
    }

    if (!ruleResult.rule) {
      console.warn(`⚠ Points rule not found: "${ruleTitle}"`);
      return {
        success: false,
        error: `Points rule not found: "${ruleTitle}"`
      };
    }

    const rule = ruleResult.rule;
    const description = customDescription || rule.description;

    // Add points using the existing addPoints function
    const result = await addPoints(userId, rule.points, rule.title, description);

    // Record award for duplicate prevention
    if (result.success && preventDuplicate !== 'none') {
      recordAwardForDedup(userId, ruleTitle, preventDuplicate, context);
    }

    // Update the Practice Points display if available
    if (result.success && window.authUI?.updatePracticePointsDisplay) {
      window.authUI.updatePracticePointsDisplay(result.totalPoints);
    }

    return {
      ...result,
      ruleTitle: rule.title
    };
  } catch (error) {
    console.error('Error awarding points by rule:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Simple wrapper to award points - auto-detects current user
 * 
 * Usage:
 *   await awardPoints('Perfect Type');
 *   await awardPoints('Daily Practice', { preventDuplicate: 'daily' });
 *   await awardPoints('Perfect Type', { preventDuplicate: 'session', context: 'question_123' });
 * 
 * @param {string} ruleTitle - Title of the rule to apply
 * @param {Object} options - Optional settings (see awardPointsByRule)
 * @returns {Promise<Object>} Result of addPoints or error/skip status
 */
async function awardPoints(ruleTitle, options = {}) {
  // Auto-detect current user from authUI
  const userId = window.authUI?.getCurrentUserId?.();

  if (!userId) {
    console.log('⏭ Points not awarded: User not logged in');
    return { success: false, error: 'User not logged in' };
  }

  return await awardPointsByRule(userId, ruleTitle, options);
}

/**
 * Check if points were already awarded (for duplicate prevention)
 * 
 * @param {string} userId - User ID
 * @param {string} ruleTitle - Rule title
 * @param {string} mode - 'daily', 'session', or 'once'
 * @param {string} context - Additional context
 * @returns {Promise<boolean>} True if duplicate
 */
async function checkDuplicateAward(userId, ruleTitle, mode, context) {
  const key = `points_awarded_${ruleTitle}_${context}`.toLowerCase().replace(/\s+/g, '_');

  if (mode === 'session') {
    // Check sessionStorage
    return sessionStorage.getItem(key) === 'true';
  }

  if (mode === 'daily') {
    // Check localStorage with date
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    const storedDate = localStorage.getItem(key);
    return storedDate === today;
  }

  if (mode === 'once') {
    // Check localStorage (permanent)
    return localStorage.getItem(key) === 'awarded';
  }

  return false;
}

/**
 * Record award for duplicate prevention
 * 
 * @param {string} userId - User ID
 * @param {string} ruleTitle - Rule title
 * @param {string} mode - 'daily', 'session', or 'once'
 * @param {string} context - Additional context
 */
function recordAwardForDedup(userId, ruleTitle, mode, context) {
  const key = `points_awarded_${ruleTitle}_${context}`.toLowerCase().replace(/\s+/g, '_');

  if (mode === 'session') {
    sessionStorage.setItem(key, 'true');
  } else if (mode === 'daily') {
    const today = new Date().toISOString().split('T')[0];
    localStorage.setItem(key, today);
  } else if (mode === 'once') {
    localStorage.setItem(key, 'awarded');
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
  // Legacy mastery functions (now redirect to progress)
  getMasteryStatus,
  updateMasteryStatus,
  removeMasteryStatus,
  // New tiered progress functions
  calculateTier,
  calculateState,
  getProgressStatus,
  recordAttempt,
  incrementProgress,
  resetProgress,
  getAllProgressForMode,
  getRecentProgress,
  // Points system functions
  addPoints,
  getTotalPoints,
  getPointsHistory,
  // Points rules functions
  getPointsRules,
  getPointsRuleByTitle,
  awardPointsByRule,
  awardPoints,
  updateUserProfile
};

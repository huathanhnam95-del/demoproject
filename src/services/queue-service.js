const { db } = require('../utils/firebase');
const crypto = require('crypto');

const QUEUE_UNAVAILABLE_ERROR = 'Firestore is not configured for the background job queue';

function normalizeError(error) {
  if (!error) return 'Unknown queue error';
  if (typeof error === 'string') return error;
  return error.message || error.toString();
}

/**
 * Queue Service backed by Firestore for durability.
 * This allows jobs to survive server restarts and supports horizontal scaling
 * if multiple server instances are running.
 */
class QueueService {
  constructor() {
    this.db = db;
    this.collection = this.db ? this.db.collection('jobs') : null;
  }

  isAvailable() {
    return Boolean(this.db && this.collection);
  }

  assertAvailable() {
    if (!this.isAvailable()) {
      throw new Error(QUEUE_UNAVAILABLE_ERROR);
    }
  }

  /**
   * Enqueues a new background job.
   * @param {string} type - The job type (e.g., 'generate_story', 'audit_story').
   * @param {object} payload - The job data.
   * @returns {string} jobId
   */
  async enqueue(type, payload) {
    this.assertAvailable();

    const jobId = crypto.randomUUID();
    await this.collection.doc(jobId).set({
      id: jobId,
      type,
      payload,
      status: 'pending',
      result: null,
      error: null,
      progress: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    return jobId;
  }

  /**
   * Retrieves the current status of a job.
   * @param {string} jobId
   * @returns {object|null}
   */
  async getJobStatus(jobId) {
    if (!this.isAvailable()) return null;

    const doc = await this.collection.doc(jobId).get();
    if (!doc.exists) return null;
    return doc.data();
  }

  /**
   * Claims a pending job for processing.
   * Uses Firestore transactions to ensure only one worker claims a job.
   * @param {string[]} types - Array of job types to claim.
   * @returns {object|null} The claimed job, or null if none are pending.
   */
  async claimNextJob(types = []) {
    if (!this.isAvailable()) return null;

    let query = this.collection.where('status', '==', 'pending');
    if (types.length > 0) {
      query = query.where('type', 'in', types);
    }
    
    // Attempt to get the oldest pending job
    const snapshot = await query.orderBy('createdAt', 'asc').limit(1).get();
    if (snapshot.empty) return null;

    const doc = snapshot.docs[0];
    const jobRef = doc.ref;
    
    // Use transaction to atomically claim
    return this.db.runTransaction(async (transaction) => {
      const freshDoc = await transaction.get(jobRef);
      if (freshDoc.data().status !== 'pending') {
        return null; // Someone else grabbed it
      }
      
      transaction.update(jobRef, {
        status: 'processing',
        updatedAt: new Date().toISOString()
      });
      
      return freshDoc.data();
    });
  }

  /**
   * Marks a job as completed.
   * @param {string} jobId
   * @param {object} result
   */
  async completeJob(jobId, result) {
    this.assertAvailable();

    await this.collection.doc(jobId).update({
      status: 'completed',
      result,
      progress: 100,
      updatedAt: new Date().toISOString()
    });
  }

  /**
   * Marks a job as failed.
   * @param {string} jobId
   * @param {string} error
   */
  async failJob(jobId, error) {
    this.assertAvailable();

    await this.collection.doc(jobId).update({
      status: 'failed',
      error: normalizeError(error),
      updatedAt: new Date().toISOString()
    });
  }
}

module.exports = new QueueService();

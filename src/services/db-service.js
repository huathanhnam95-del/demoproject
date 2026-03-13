const { db } = require('../utils/firebase');
const logger = require('../utils/logger');
const { withRetry } = require('../utils/retry');

const DB_UNAVAILABLE = 'Firestore is not configured for DbService';

/**
 * Database Service Abstraction Layer
 * Wraps raw Firestore calls to allow easier swapping of the underlying database
 * and adds standard logging/retry logic.
 */
class DbService {
  constructor() {
    this.db = db;
  }

  isAvailable() {
    return Boolean(this.db && typeof this.db.collection === 'function');
  }

  _assertAvailable() {
    if (!this.isAvailable()) {
      throw new Error(DB_UNAVAILABLE);
    }
  }

  async getDocument(collection, id) {
    this._assertAvailable();
    try {
      const doc = await withRetry(() => this.db.collection(collection).doc(id).get());
      if (!doc.exists) return null;
      return { id: doc.id, ...doc.data() };
    } catch (error) {
      logger.error(`DbService.getDocument error [${collection}/${id}]`, { error: error.message });
      throw error;
    }
  }

  async saveDocument(collection, id, data) {
    this._assertAvailable();
    try {
      if (id) {
        await this.db.collection(collection).doc(id).set(data, { merge: true });
        return id;
      } else {
        const ref = await this.db.collection(collection).add(data);
        return ref.id;
      }
    } catch (error) {
      logger.error(`DbService.saveDocument error [${collection}]`, { error: error.message });
      throw error;
    }
  }

  async updateDocument(collection, id, data) {
    this._assertAvailable();
    try {
      await this.db.collection(collection).doc(id).update(data);
      return id;
    } catch (error) {
      logger.error(`DbService.updateDocument error [${collection}/${id}]`, { error: error.message });
      throw error;
    }
  }

  async queryDocuments(collection, conditions = [], limit = null) {
    this._assertAvailable();
    try {
      let query = this.db.collection(collection);
      
      conditions.forEach(cond => {
        if (cond.length === 3) {
          query = query.where(cond[0], cond[1], cond[2]);
        }
      });

      if (limit) {
        query = query.limit(limit);
      }

      const snapshot = await withRetry(() => query.get());
      const results = [];
      snapshot.forEach(doc => {
        results.push({ id: doc.id, ...doc.data() });
      });
      return results;
    } catch (error) {
      logger.error(`DbService.queryDocuments error [${collection}]`, { error: error.message });
      throw error;
    }
  }
}

module.exports = new DbService();


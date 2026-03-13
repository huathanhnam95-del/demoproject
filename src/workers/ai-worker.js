const queueService = require('../services/queue-service');
const logger = require('../utils/logger');

class AIWorker {
  constructor() {
    this.isRunning = false;
    this.pollIntervalMs = 5000; // Poll every 5s
    this.timer = null;
    this.handlers = new Map();
  }

  registerHandler(type, handler) {
    if (typeof type !== 'string' || type.trim().length === 0) {
      throw new Error('Worker handler type must be a non-empty string');
    }
    if (typeof handler !== 'function') {
      throw new Error(`Worker handler for ${type} must be a function`);
    }

    this.handlers.set(type, handler);
  }

  getSupportedTypes() {
    return Array.from(this.handlers.keys());
  }

  start() {
    if (this.isRunning) return;

    if (!queueService.isAvailable()) {
      logger.warn('AI Background Worker not started because Firestore queue is unavailable.');
      return;
    }

    if (this.getSupportedTypes().length === 0) {
      logger.warn('AI Background Worker not started because no job handlers are registered.');
      return;
    }

    this.isRunning = true;
    logger.info('AI Background Worker started. Polling for jobs...');
    void this.poll();
  }

  stop() {
    this.isRunning = false;
    if (this.timer) clearTimeout(this.timer);
    logger.info('AI Background Worker stopped.');
  }

  async poll() {
    while (this.isRunning) {
      try {
        const job = await queueService.claimNextJob(this.getSupportedTypes());

        if (!job) {
          this.timer = setTimeout(() => {
            this.timer = null;
            void this.poll();
          }, this.pollIntervalMs);
          return;
        }

        logger.info(`Worker claimed job ${job.id} [${job.type}]`);
        await this.processJob(job);
      } catch (error) {
        logger.error('Worker polling error', { error: error.message, stack: error.stack });
        this.timer = setTimeout(() => {
          this.timer = null;
          void this.poll();
        }, this.pollIntervalMs);
        return;
      }
    }
  }

  async processJob(job) {
    try {
      const handler = this.handlers.get(job.type);
      if (!handler) {
        throw new Error(`No worker handler registered for job type: ${job.type}`);
      }

      const result = await handler(job.payload, job);
      await queueService.completeJob(job.id, result);
      logger.info(`Job ${job.id} completed successfully.`);
    } catch (error) {
      logger.error(`Job ${job.id} failed`, { error: error.message });
      try {
        if (queueService.isAvailable()) {
          await queueService.failJob(job.id, error);
        }
      } catch (queueError) {
        logger.error(`Failed to mark job ${job.id} as failed`, {
          error: queueError.message
        });
      }
    }
  }
}

// Export singleton instance
module.exports = new AIWorker();

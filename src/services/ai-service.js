const axios = require('axios');
const logger = require('../utils/logger');
const { withRetry } = require('../utils/retry');
const { createBreaker } = require('../middleware/circuit-breaker');

// Future: unify with the existing Gemini service at ./reading-journey/gemini.js

const aiServiceBreaker = createBreaker('phase3-ai-service', {
  timeout: 10000,
  errorThresholdPercentage: 50,
  resetTimeout: 30000,
  volumeThreshold: 5
});

function extractFirstJsonObject(text) {
  if (typeof text !== 'string' || text.length === 0) {
    throw new Error('AI response did not contain text');
  }

  let start = text.indexOf('{');
  while (start !== -1) {
    let depth = 0;
    let inString = false;
    let escapeNext = false;

    for (let index = start; index < text.length; index += 1) {
      const char = text[index];

      if (escapeNext) {
        escapeNext = false;
        continue;
      }

      if (char === '\\') {
        escapeNext = true;
        continue;
      }

      if (char === '"') {
        inString = !inString;
        continue;
      }

      if (inString) continue;

      if (char === '{') {
        depth += 1;
      } else if (char === '}') {
        depth -= 1;

        if (depth === 0) {
          const candidate = text.slice(start, index + 1);
          try {
            return JSON.parse(candidate);
          } catch {
            break;
          }
        }
      }
    }

    start = text.indexOf('{', start + 1);
  }

  throw new Error('AI response did not contain valid JSON');
}

/**
 * Unified AI Service Abstraction Layer
 * Exposes methods to call underlying AI providers (HuggingFace, Vertex AI)
 * and abstracts the provider logic from the frontend and express routes.
 */
class AiService {
  constructor() {
    this.huggingFaceToken = process.env.HUGGINGFACE_API_KEY;
  }

  /**
   * Generates text via an underlying provider.
   * Currently wraps Hugging Face as an example.
   * @param {string} model 
   * @param {string} prompt 
   * @param {object} options 
   * @returns {string} Generated text
   */
  async generateText(model, prompt, options = {}) {
    logger.debug(`AiService.generateText called for model ${model}`);
    
    // In a real scenario, this would choose between Vertex / HF based on the model string
    return aiServiceBreaker.fire(() => withRetry(async () => {
      const response = await axios.post(
        `https://api-inference.huggingface.co/models/${model}`,
        { inputs: prompt, ...options },
        { 
          headers: { 
            'Authorization': `Bearer ${this.huggingFaceToken}`,
            'Content-Type': 'application/json' 
          },
          timeout: 10000 // 10 seconds timeout
        }
      );
      
      return response.data;
    }));
  }

  /**
   * Simple method exposed for extracting structured output from AI.
   */
  async generateStructuredResponse(model, prompt, schema) {
    // Wait for native structured outputs in the provider, or append JSON inst.
    const jsonPrompt = `${prompt}\n\nPlease strictly return valid JSON matching this schema: ${JSON.stringify(schema)}`;
    const result = await this.generateText(model, jsonPrompt);
    
    try {
      const text = Array.isArray(result) ? result[0]?.generated_text : result?.generated_text;
      return extractFirstJsonObject(text);
    } catch (e) {
      logger.error('Failed to parse structured AI response', { error: e.message });
      throw new Error('AI Response parsing failed');
    }
  }
}

module.exports = new AiService();

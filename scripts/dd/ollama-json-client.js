const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.LOCAL_GEMMA_MODEL || process.env.OLLAMA_MODEL || 'gemma4:12b';

async function callOllamaChatJson(messages, temperature = 0.3, retries = 2) {
  const url = `${OLLAMA_BASE_URL}/api/chat`;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 300000); // 5 minute timeout for batched prompts

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: OLLAMA_MODEL,
          messages,
          stream: false,
          think: false,
          format: 'json',
          options: {
            temperature,
            num_predict: 4096,
            num_ctx: 8192
          }
        }),
        signal: controller.signal
      });

      clearTimeout(timeout);

      if (!res.ok) {
        throw new Error(`Ollama HTTP error ${res.status}: ${await res.text()}`);
      }

      const data = await res.json();
      const rawText = data.message?.content || '';
      return rawText;
    } catch (err) {
      if (attempt < retries) {
        console.warn(`  ⚠ Ollama attempt ${attempt + 1} failed: ${err.message}. Retrying in 3s...`);
        await new Promise(resolve => setTimeout(resolve, 3000));
        continue;
      }
      throw err;
    }
  }
}

module.exports = {
  callOllamaChatJson,
  OLLAMA_MODEL
};

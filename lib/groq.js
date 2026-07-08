const OpenAI = require('openai');

// Groq is OpenAI-API-compatible, so we use the OpenAI SDK pointed at Groq.
const BASE_URL = 'https://api.groq.com/openai/v1';

// Primary model for analysis/chat, plus a lighter model we fall back to when
// the primary hits its free-tier daily token cap (HTTP 429). The fallback has
// the largest free allowance, so the app degrades gracefully instead of erroring.
const LLM_MODEL = process.env.GROQ_MODEL || 'meta-llama/llama-4-scout-17b-16e-instruct';
const FALLBACK_MODEL = process.env.GROQ_FALLBACK_MODEL || 'llama-3.1-8b-instant';

// Whisper model used for transcription. Override with GROQ_WHISPER_MODEL.
const WHISPER_MODEL = process.env.GROQ_WHISPER_MODEL || 'whisper-large-v3-turbo';

let client;
function getClient() {
  if (!process.env.GROQ_API_KEY) {
    throw new Error('GROQ_API_KEY is not set. Add it to your .env file.');
  }
  if (!client) {
    client = new OpenAI({ apiKey: process.env.GROQ_API_KEY, baseURL: BASE_URL });
  }
  return client;
}

/**
 * Run a chat completion on the primary model, automatically retrying on the
 * fallback model if the primary is rate-limited (429). `params` should NOT
 * include `model` — this sets it.
 */
async function createChatCompletion(params) {
  const c = getClient();
  const models = [...new Set([LLM_MODEL, FALLBACK_MODEL])].filter(Boolean);

  let lastErr;
  for (let i = 0; i < models.length; i++) {
    try {
      return await c.chat.completions.create({ ...params, model: models[i] });
    } catch (err) {
      const isLast = i === models.length - 1;
      if (err && err.status === 429 && !isLast) {
        console.warn(`Model ${models[i]} rate-limited; falling back to ${models[i + 1]}.`);
        lastErr = err;
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

module.exports = { getClient, createChatCompletion, LLM_MODEL, FALLBACK_MODEL, WHISPER_MODEL };

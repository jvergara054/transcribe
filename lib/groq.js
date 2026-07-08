const OpenAI = require('openai');

// Groq is OpenAI-API-compatible, so we use the OpenAI SDK pointed at Groq.
const BASE_URL = 'https://api.groq.com/openai/v1';

// Model used for summary / insights / next-steps / chat. Override with GROQ_MODEL.
const LLM_MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';

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

module.exports = { getClient, LLM_MODEL, WHISPER_MODEL };

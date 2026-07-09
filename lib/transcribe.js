const fs = require('fs');
const { getClient, WHISPER_MODEL } = require('./groq');

/**
 * Transcribe an audio file at `filePath` using Groq's hosted Whisper.
 * Returns { text, duration } (duration in seconds, may be undefined).
 */
async function transcribeAudio(filePath) {
  const client = getClient();
  const resp = await client.audio.transcriptions.create({
    file: fs.createReadStream(filePath),
    model: WHISPER_MODEL,
    response_format: 'verbose_json',
  });
  const segments = Array.isArray(resp.segments)
    ? resp.segments.map((s) => ({ start: s.start, end: s.end, text: (s.text || '').trim() }))
    : [];
  return {
    text: resp.text,
    duration: typeof resp.duration === 'number' ? resp.duration : undefined,
    segments,
  };
}

module.exports = { transcribeAudio };

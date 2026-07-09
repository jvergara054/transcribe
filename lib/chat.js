const { createChatCompletion } = require('./groq');

// Only the most recent messages are re-sent to the model each turn — the full
// history still lives in the DB and is shown in the UI, but replaying all of it
// on every question wastes tokens. The transcripts (below) carry the grounding,
// so recent turns are enough for follow-up context.
const MAX_HISTORY_MESSAGES = 10; // ~5 back-and-forth exchanges

// Upper bound on transcript characters sent as grounding, to cap cost and avoid
// oversized requests on large multi-clip projects (~4 chars ≈ 1 token).
const MAX_TRANSCRIPT_CHARS = 48000;

function buildTranscripts(clips) {
  let out = '';
  let truncated = false;
  for (let i = 0; i < clips.length; i++) {
    const block = `--- Clip ${i + 1}: ${clips[i].title} ---\n${clips[i].transcript || ''}`;
    if (out.length + block.length > MAX_TRANSCRIPT_CHARS) {
      out += `\n\n[Remaining ${clips.length - i} clip(s) omitted to stay within size limits.]`;
      truncated = true;
      break;
    }
    out += (i === 0 ? '' : '\n\n') + block;
  }
  return { text: out, truncated };
}

/**
 * Answer a question about a whole project, grounded in every clip's transcript.
 * Returns the answer plus the supporting transcript excerpts (citations).
 *
 * @param {object} project  - the project row (name, summary)
 * @param {Array}  clips    - [{ title, transcript }] for the project's clips
 * @param {Array}  history  - prior messages [{ role, content }]
 * @param {string} question - the new user question
 * @returns {Promise<{answer: string, sources: Array<{clip: string, quote: string}>}>}
 */
async function chatAboutProject(project, clips, history, question) {
  const { text: transcripts } = buildTranscripts(clips);

  const system =
    'You answer questions about a collection of related audio recordings ' +
    '("clips") in one project, using only the transcripts and summary provided. ' +
    'Respond ONLY with a JSON object of this exact shape:\n' +
    '{\n' +
    '  "answer": "a helpful, direct answer in prose",\n' +
    '  "sources": [{ "clip": "the exact clip title the excerpt is from", "quote": "the exact verbatim passage from that transcript that supports the answer" }]\n' +
    '}\n' +
    'Each quote MUST be a single continuous passage copied word-for-word from ONE place in a transcript (so it can be located exactly), kept short — the relevant sentence or two. ' +
    'If your answer draws on multiple separate places, add a SEPARATE source entry for each — never combine different passages into one quote. ' +
    'If the answer is not in the recordings, say so in "answer" and return an empty "sources" array. ' +
    'Do not include any text outside the JSON object.\n\n' +
    `Project: ${project.name}\n\n` +
    `Combined summary:\n${project.summary || '(none yet)'}\n\n` +
    `<transcripts>\n${transcripts}\n</transcripts>`;

  // Re-send only the last N messages for follow-up context.
  const recentHistory = history.slice(-MAX_HISTORY_MESSAGES);

  const messages = [
    { role: 'system', content: system },
    ...recentHistory.map((m) => ({ role: m.role, content: m.content })),
    { role: 'user', content: question },
  ];

  const resp = await createChatCompletion({
    temperature: 0.4,
    response_format: { type: 'json_object' },
    messages,
  });

  const raw = resp.choices[0]?.message?.content || '{}';
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Fall back to treating the raw text as the answer with no sources.
    return { answer: raw.trim() || '(no response)', sources: [] };
  }

  const answer = typeof parsed.answer === 'string' ? parsed.answer.trim() : '';
  const sources = Array.isArray(parsed.sources)
    ? parsed.sources
        .filter((s) => s && typeof s.quote === 'string' && s.quote.trim())
        .map((s) => ({ clip: String(s.clip || '').trim(), quote: s.quote.trim() }))
    : [];

  return { answer: answer || '(no response)', sources };
}

module.exports = { chatAboutProject };

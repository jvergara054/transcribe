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
 *
 * @param {object} project  - the project row (name, summary)
 * @param {Array}  clips    - [{ title, transcript }] for the project's clips
 * @param {Array}  history  - prior messages [{ role, content }]
 * @param {string} question - the new user question
 * @returns {Promise<string>} the answer text
 */
async function chatAboutProject(project, clips, history, question) {
  const { text: transcripts } = buildTranscripts(clips);

  const system =
    'You are a helpful assistant answering questions about a collection of ' +
    'related audio recordings ("clips") that belong to one project. Base your ' +
    'answers only on the transcripts and summary provided. When useful, note ' +
    'which clip something came from. If the answer is not in the recordings, ' +
    'say so plainly rather than guessing.\n\n' +
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
    messages,
  });

  return (resp.choices[0]?.message?.content || '').trim() || '(no response)';
}

module.exports = { chatAboutProject };

const { createChatCompletion } = require('./groq');

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
  const transcripts = clips
    .map((c, i) => `--- Clip ${i + 1}: ${c.title} ---\n${c.transcript || ''}`)
    .join('\n\n');

  const system =
    'You are a helpful assistant answering questions about a collection of ' +
    'related audio recordings ("clips") that belong to one project. Base your ' +
    'answers only on the transcripts and summary provided. When useful, note ' +
    'which clip something came from. If the answer is not in the recordings, ' +
    'say so plainly rather than guessing.\n\n' +
    `Project: ${project.name}\n\n` +
    `Combined summary:\n${project.summary || '(none yet)'}\n\n` +
    `<transcripts>\n${transcripts}\n</transcripts>`;

  const messages = [
    { role: 'system', content: system },
    ...history.map((m) => ({ role: m.role, content: m.content })),
    { role: 'user', content: question },
  ];

  const resp = await createChatCompletion({
    temperature: 0.4,
    messages,
  });

  return (resp.choices[0]?.message?.content || '').trim() || '(no response)';
}

module.exports = { chatAboutProject };

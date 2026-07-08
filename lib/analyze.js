const { getClient, LLM_MODEL } = require('./groq');

// NOTE on field names: `insights` holds Key Takeaways and `next_steps` holds
// Tasks (kept as column names for backward compatibility); `dates` holds
// dates/appointments. The prompts below describe them in those user-facing terms.

const CLIP_SYSTEM = `You analyze a single recording transcript. Respond ONLY with a JSON object of this exact shape:
{
  "summary": "a concise prose summary of the recording (a few sentences to a short paragraph)",
  "takeaways": ["an important point or highlight worth remembering", "..."],
  "dates": ["any specific date, deadline, or appointment mentioned, each as a short string like 'Nov 15 — engineering deadline' or 'Mon 9am — follow-up call'", "..."],
  "tasks": ["a concrete task or action item someone needs to do", "..."]
}
Use empty arrays where there is nothing to report. Only include real dates/appointments in "dates". Do not include any text outside the JSON object.`;

const PROJECT_SYSTEM = `You analyze a COLLECTION of related recording transcripts as a whole. Respond ONLY with a JSON object of this exact shape:
{
  "summary": "a concise prose summary synthesizing across ALL the clips (a short paragraph)",
  "takeaways": ["an important cross-cutting highlight worth remembering", "..."],
  "dates": ["any specific date, deadline, or appointment mentioned across the clips, each as a short string like 'Nov 15 — engineering deadline'", "..."],
  "tasks": ["a concrete task or action item drawn from the whole collection", "..."]
}
Treat the clips as parts of one body of material: combine, connect, and deduplicate across them. Use empty arrays where there is nothing to report. Only include real dates/appointments in "dates". Do not include any text outside the JSON object.`;

function parseAnalysis(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw || '{}');
  } catch {
    throw new Error('Model did not return valid JSON analysis.');
  }
  const arr = (v) => (Array.isArray(v) ? v.map(String) : []);
  return {
    summary: typeof parsed.summary === 'string' ? parsed.summary : '',
    insights: arr(parsed.takeaways),   // Key Takeaways
    next_steps: arr(parsed.tasks),     // Tasks
    dates: arr(parsed.dates),          // Dates & Appointments
  };
}

/**
 * Analyze a single transcript.
 * @returns {Promise<{summary, insights[], next_steps[], dates[]}>}
 */
async function analyzeTranscript(transcript) {
  const client = getClient();
  const resp = await client.chat.completions.create({
    model: LLM_MODEL,
    temperature: 0.3,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: CLIP_SYSTEM },
      { role: 'user', content: `Analyze this transcript and return JSON:\n\n<transcript>\n${transcript}\n</transcript>` },
    ],
  });
  return parseAnalysis(resp.choices[0]?.message?.content);
}

/**
 * Analyze a collection of clips together.
 * @param {Array<{title: string, transcript: string}>} clips
 * @returns {Promise<{summary, insights[], next_steps[], dates[]}>}
 */
async function analyzeProject(clips) {
  const client = getClient();
  const body = clips
    .map((c, i) => `--- Clip ${i + 1}: ${c.title} ---\n${c.transcript || ''}`)
    .join('\n\n');

  const resp = await client.chat.completions.create({
    model: LLM_MODEL,
    temperature: 0.3,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: PROJECT_SYSTEM },
      { role: 'user', content: `Analyze these ${clips.length} clip(s) together and return JSON:\n\n${body}` },
    ],
  });
  return parseAnalysis(resp.choices[0]?.message?.content);
}

module.exports = { analyzeTranscript, analyzeProject };

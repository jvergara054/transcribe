const { getClient, LLM_MODEL } = require('./groq');

const SYSTEM = `You analyze meeting/voice recording transcripts. Respond ONLY with a JSON object of this exact shape:
{
  "summary": "a concise prose summary of the recording (a few sentences to a short paragraph)",
  "insights": ["key insight or takeaway", "..."],
  "next_steps": ["concrete action item or follow-up", "..."]
}
Use empty arrays if there are no insights or next steps. Do not include any text outside the JSON object.`;

/**
 * Analyze a transcript and return { summary, insights[], next_steps[] }.
 */
async function analyzeTranscript(transcript) {
  const client = getClient();
  const resp = await client.chat.completions.create({
    model: LLM_MODEL,
    temperature: 0.3,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: `Analyze this transcript and return JSON:\n\n<transcript>\n${transcript}\n</transcript>` },
    ],
  });

  const raw = resp.choices[0]?.message?.content || '{}';
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Model did not return valid JSON analysis.');
  }

  return {
    summary: typeof parsed.summary === 'string' ? parsed.summary : '',
    insights: Array.isArray(parsed.insights) ? parsed.insights.map(String) : [],
    next_steps: Array.isArray(parsed.next_steps) ? parsed.next_steps.map(String) : [],
  };
}

const PROJECT_SYSTEM = `You analyze a COLLECTION of related recording transcripts as a whole. Respond ONLY with a JSON object of this exact shape:
{
  "summary": "a concise prose summary that synthesizes across ALL the clips (a short paragraph)",
  "insights": ["key cross-cutting insight or takeaway spanning the clips", "..."],
  "next_steps": ["concrete action item or follow-up drawn from the whole collection", "..."]
}
Treat the clips as parts of one body of material: combine, connect, and deduplicate across them rather than summarizing each separately. Use empty arrays if there are none. Do not include any text outside the JSON object.`;

/**
 * Analyze a collection of clips together.
 * @param {Array<{title: string, transcript: string}>} clips
 * @returns {Promise<{summary, insights[], next_steps[]}>}
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

  const raw = resp.choices[0]?.message?.content || '{}';
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Model did not return valid JSON analysis.');
  }

  return {
    summary: typeof parsed.summary === 'string' ? parsed.summary : '',
    insights: Array.isArray(parsed.insights) ? parsed.insights.map(String) : [],
    next_steps: Array.isArray(parsed.next_steps) ? parsed.next_steps.map(String) : [],
  };
}

module.exports = { analyzeTranscript, analyzeProject };

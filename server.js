require('dotenv').config();

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');

const db = require('./lib/db');
const auth = require('./lib/auth');
const { transcribeAudio } = require('./lib/transcribe');
const { analyzeTranscript, analyzeProject } = require('./lib/analyze');
const { chatAboutProject } = require('./lib/chat');

const PORT = process.env.PORT || 3000;
// Store uploads under DATA_DIR so a hosted persistent disk keeps them.
const DATA_DIR = process.env.DATA_DIR || __dirname;
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const MAX_FILE_BYTES = 25 * 1024 * 1024; // Whisper API limit

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const app = express();
app.set('trust proxy', 1); // honor x-forwarded-proto behind a host's TLS proxy
app.use(express.json());

// --- Auth (public routes, then a gate) -------------------------------------

const PUBLIC_DIR = path.join(__dirname, 'public');

app.get('/login', (req, res) => {
  if (auth.isAuthenticated(req)) return res.redirect('/');
  res.sendFile(path.join(PUBLIC_DIR, 'login.html'));
});

app.get('/api/auth/status', (req, res) => {
  res.json({ required: auth.authEnabled(), authenticated: auth.isAuthenticated(req) });
});

app.post('/api/login', (req, res) => {
  if (!auth.authEnabled()) return res.json({ ok: true }); // nothing to log into
  if (!auth.checkPassword(req.body.password)) {
    return res.status(401).json({ error: 'Incorrect password.' });
  }
  auth.setSessionCookie(req, res);
  res.json({ ok: true });
});

app.post('/api/logout', (req, res) => {
  auth.clearSessionCookie(res);
  res.json({ ok: true });
});

// --- Public shared project (no auth) ---------------------------------------

// A read-only, sanitized view of a project reachable only via its share token.
app.get('/shared/:token', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'shared.html'));
});

app.get('/api/shared/:token', (req, res) => {
  const project = db.getProjectByShareToken(req.params.token);
  if (!project) return res.status(404).json({ error: 'This shared link is invalid or was revoked.' });
  const clips = db.listRecordingsByProject(project.id).filter((c) => c.status === 'done');
  res.json({
    name: project.name,
    summary: project.summary,
    insights: project.insights,
    next_steps: project.next_steps,
    dates: project.dates,
    analysis_status: project.analysis_status,
    clips: clips.map((c) => ({
      title: c.title,
      summary: c.summary,
      insights: c.insights,
      next_steps: c.next_steps,
      dates: c.dates,
      transcript: c.transcript,
    })),
  });
});

// Everything below requires auth (when enabled).
app.use(auth.requireAuth);
app.use(express.static(PUBLIC_DIR));

// --- Uploads ---------------------------------------------------------------

const ALLOWED_EXT = new Set([
  '.mp3', '.mp4', '.mpeg', '.mpga', '.m4a', '.wav', '.webm', '.ogg', '.flac',
]);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_BYTES },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ALLOWED_EXT.has(ext)) return cb(null, true);
    cb(new Error(`Unsupported file type "${ext}". Allowed: ${[...ALLOWED_EXT].join(', ')}`));
  },
});

// --- Background work -------------------------------------------------------

async function processRecording(id, filePath, projectId) {
  try {
    const { text, duration } = await transcribeAudio(filePath);
    const analysis = await analyzeTranscript(text);
    db.setRecordingResult(id, {
      transcript: text,
      duration,
      summary: analysis.summary,
      insights: analysis.insights,
      next_steps: analysis.next_steps,
      dates: analysis.dates,
    });
  } catch (err) {
    console.error(`Processing failed for recording ${id}:`, err.message);
    db.setRecordingError(id, err.message);
  }
  // Whether the clip succeeded or failed, refresh the project's combined view.
  await reanalyzeProject(projectId);
}

// Regenerate a project's combined summary/insights/next-steps from its
// successfully-transcribed clips. Serialized per project to avoid overlap.
const reanalyzeQueue = new Map(); // projectId -> Promise

function reanalyzeProject(projectId) {
  const prev = reanalyzeQueue.get(projectId) || Promise.resolve();
  const next = prev.then(() => doReanalyze(projectId)).catch(() => {});
  reanalyzeQueue.set(projectId, next);
  return next;
}

async function doReanalyze(projectId) {
  const project = db.getProject(projectId);
  if (!project) return;
  const clips = db.listRecordingsByProject(projectId).filter((c) => c.status === 'done');

  if (clips.length === 0) {
    db.setProjectAnalysisStatus(projectId, 'empty');
    return;
  }

  db.setProjectAnalysisStatus(projectId, 'processing');
  try {
    const analysis = await analyzeProject(
      clips.map((c) => ({ title: c.title, transcript: c.transcript }))
    );
    db.setProjectAnalysis(projectId, analysis);
  } catch (err) {
    console.error(`Combined analysis failed for project ${projectId}:`, err.message);
    db.setProjectAnalysisStatus(projectId, 'error', err.message);
  }
}

// --- Project routes --------------------------------------------------------

app.get('/api/projects', (req, res) => {
  const archived = req.query.archived === 'true' || req.query.archived === '1';
  res.json(db.listProjects(archived ? 1 : 0));
});

app.post('/api/projects/:id/archive', (req, res) => {
  const project = db.getProject(Number(req.params.id));
  if (!project) return res.status(404).json({ error: 'Not found' });
  const archived = req.body.archived !== false; // default to archiving
  res.json(db.setProjectArchived(project.id, archived));
});

app.post('/api/projects', (req, res) => {
  const name = (req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Project name is required.' });
  res.status(201).json(db.createProject(name));
});

app.get('/api/projects/:id', (req, res) => {
  const project = db.getProject(Number(req.params.id));
  if (!project) return res.status(404).json({ error: 'Not found' });
  project.recordings = db.listRecordingsByProject(project.id);
  project.messages = db.listProjectMessages(project.id);
  res.json(project);
});

app.delete('/api/projects/:id', (req, res) => {
  const project = db.getProject(Number(req.params.id));
  if (!project) return res.status(404).json({ error: 'Not found' });
  const clips = db.listRecordingsByProject(project.id);
  db.deleteProject(project.id); // cascades to recordings + messages
  for (const c of clips) {
    fs.rm(path.join(UPLOAD_DIR, c.filename), { force: true }, () => {});
  }
  res.json({ ok: true });
});

// Enable (or return existing) public share link for a project.
app.post('/api/projects/:id/share', (req, res) => {
  const project = db.getProject(Number(req.params.id));
  if (!project) return res.status(404).json({ error: 'Not found' });
  let token = project.share_token;
  if (!token) {
    token = crypto.randomBytes(16).toString('hex');
    db.setProjectShareToken(project.id, token);
  }
  res.json({ token, url: `/shared/${token}` });
});

// Revoke the public share link.
app.delete('/api/projects/:id/share', (req, res) => {
  const project = db.getProject(Number(req.params.id));
  if (!project) return res.status(404).json({ error: 'Not found' });
  db.setProjectShareToken(project.id, null);
  res.json({ ok: true });
});

app.post('/api/projects/:id/reanalyze', (req, res) => {
  const project = db.getProject(Number(req.params.id));
  if (!project) return res.status(404).json({ error: 'Not found' });
  reanalyzeProject(project.id);
  res.json(db.setProjectAnalysisStatus(project.id, 'processing'));
});

app.post('/api/projects/:id/chat', async (req, res) => {
  const project = db.getProject(Number(req.params.id));
  if (!project) return res.status(404).json({ error: 'Not found' });

  const clips = db.listRecordingsByProject(project.id).filter((c) => c.status === 'done');
  if (clips.length === 0) {
    return res.status(409).json({ error: 'Add and process at least one clip before chatting.' });
  }
  const question = (req.body.question || '').trim();
  if (!question) return res.status(400).json({ error: 'Question is required.' });

  try {
    const history = db.listProjectMessages(project.id);
    db.addProjectMessage(project.id, 'user', question);
    const { answer, sources } = await chatAboutProject(project, clips, history, question);
    db.addProjectMessage(project.id, 'assistant', answer, sources);
    res.json({ answer, sources });
  } catch (err) {
    console.error(`Chat failed for project ${project.id}:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

// Upload one or more clips into a project.
app.post('/api/projects/:id/recordings', upload.array('audio', 20), (req, res) => {
  const project = db.getProject(Number(req.params.id));
  if (!project) return res.status(404).json({ error: 'Not found' });
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: 'No audio file provided.' });
  }

  const created = req.files.map((file) => {
    const title = (file.originalname || 'Untitled').trim();
    const recording = db.createRecording({ project_id: project.id, title, filename: file.filename });
    processRecording(recording.id, path.join(UPLOAD_DIR, file.filename), project.id);
    return recording;
  });
  res.status(201).json({ created: created.length, recordings: created });
});

// --- Individual clip routes ------------------------------------------------

app.post('/api/recordings/:id/retry', (req, res) => {
  const recording = db.getRecording(Number(req.params.id));
  if (!recording) return res.status(404).json({ error: 'Not found' });
  db.setRecordingProcessing(recording.id);
  processRecording(recording.id, path.join(UPLOAD_DIR, recording.filename), recording.project_id);
  res.json(db.getRecording(recording.id));
});

app.delete('/api/recordings/:id', (req, res) => {
  const recording = db.getRecording(Number(req.params.id));
  if (!recording) return res.status(404).json({ error: 'Not found' });
  const projectId = recording.project_id;
  db.deleteRecording(recording.id);
  fs.rm(path.join(UPLOAD_DIR, recording.filename), { force: true }, () => {});
  reanalyzeProject(projectId);
  res.json({ ok: true });
});

// --- Error handling --------------------------------------------------------

app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'File too large. The Whisper API limit is 25 MB.' });
  }
  if (err) return res.status(400).json({ error: err.message });
  next();
});

// --- Startup ---------------------------------------------------------------

app.listen(PORT, () => {
  if (!process.env.GROQ_API_KEY) {
    console.warn(`\n⚠  Missing env var: GROQ_API_KEY — set it in .env before uploading. Get a free key at https://console.groq.com/keys\n`);
  }
  if (!auth.authEnabled()) {
    console.warn('⚠  APP_PASSWORD is not set — the app is running WITHOUT login. Set it before hosting publicly.');
  } else {
    console.log('🔒 Password login is enabled.');
  }
  // Regenerate combined analysis for any project migrated/left in a stale state.
  for (const id of db.listStaleProjectIds()) reanalyzeProject(id);
  console.log(`Transcribe tool running at http://localhost:${PORT}`);
});

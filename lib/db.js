const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

// DATA_DIR lets a host point storage at a mounted persistent disk (e.g. /data
// on Render). Defaults to the project root for local use.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..');
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'data.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS projects (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    name             TEXT    NOT NULL,
    created_at       TEXT    NOT NULL,
    summary          TEXT,
    insights         TEXT,
    next_steps       TEXT,
    analysis_status  TEXT    NOT NULL DEFAULT 'empty',
    analysis_error   TEXT,
    archived         INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS recordings (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id  INTEGER REFERENCES projects(id) ON DELETE CASCADE,
    title       TEXT    NOT NULL,
    filename    TEXT    NOT NULL,
    created_at  TEXT    NOT NULL,
    duration    REAL,
    transcript  TEXT,
    summary     TEXT,
    insights    TEXT,
    next_steps  TEXT,
    status      TEXT    NOT NULL DEFAULT 'processing',
    error       TEXT
  );

  CREATE TABLE IF NOT EXISTS project_messages (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id    INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    role          TEXT    NOT NULL,
    content       TEXT    NOT NULL,
    created_at    TEXT    NOT NULL
  );
`);

// --- Migration: add project_id to an older recordings table if missing ------

const recordingCols = db.prepare('PRAGMA table_info(recordings)').all().map((c) => c.name);
if (!recordingCols.includes('project_id')) {
  db.exec('ALTER TABLE recordings ADD COLUMN project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE');
}

const projectCols = db.prepare('PRAGMA table_info(projects)').all().map((c) => c.name);
if (!projectCols.includes('archived')) {
  db.exec('ALTER TABLE projects ADD COLUMN archived INTEGER NOT NULL DEFAULT 0');
}

// --- Row serialization helpers ---------------------------------------------

function parseJson(value, fallback) {
  if (value == null) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function hydrateRecording(row) {
  if (!row) return null;
  return {
    ...row,
    insights: parseJson(row.insights, []),
    next_steps: parseJson(row.next_steps, []),
  };
}

function hydrateProject(row) {
  if (!row) return null;
  return {
    ...row,
    insights: parseJson(row.insights, []),
    next_steps: parseJson(row.next_steps, []),
  };
}

// --- Projects --------------------------------------------------------------

const createProjectStmt = db.prepare(`
  INSERT INTO projects (name, created_at, analysis_status)
  VALUES (@name, @created_at, 'empty')
`);

function createProject(name) {
  const info = createProjectStmt.run({ name, created_at: new Date().toISOString() });
  return getProject(info.lastInsertRowid);
}

const getProjectStmt = db.prepare('SELECT * FROM projects WHERE id = ?');

function getProject(id) {
  return hydrateProject(getProjectStmt.get(id));
}

const listProjectsStmt = db.prepare(`
  SELECT p.id, p.name, p.created_at, p.analysis_status, p.archived,
         (SELECT COUNT(*) FROM recordings r WHERE r.project_id = p.id) AS clip_count
  FROM projects p
  WHERE p.archived = ?
  ORDER BY p.created_at DESC
`);

function listProjects(archived = 0) {
  return listProjectsStmt.all(archived ? 1 : 0);
}

const setArchivedStmt = db.prepare('UPDATE projects SET archived = ? WHERE id = ?');

function setProjectArchived(id, archived) {
  setArchivedStmt.run(archived ? 1 : 0, id);
  return getProject(id);
}

const setProjectAnalysisStmt = db.prepare(`
  UPDATE projects
  SET summary = @summary,
      insights = @insights,
      next_steps = @next_steps,
      analysis_status = 'done',
      analysis_error = NULL
  WHERE id = @id
`);

function setProjectAnalysis(id, { summary, insights, next_steps }) {
  setProjectAnalysisStmt.run({
    id,
    summary,
    insights: JSON.stringify(insights || []),
    next_steps: JSON.stringify(next_steps || []),
  });
  return getProject(id);
}

const setProjectStatusStmt = db.prepare(
  'UPDATE projects SET analysis_status = ?, analysis_error = ? WHERE id = ?'
);

function setProjectAnalysisStatus(id, status, error = null) {
  setProjectStatusStmt.run(status, error ? String(error).slice(0, 2000) : null, id);
  return getProject(id);
}

const deleteProjectStmt = db.prepare('DELETE FROM projects WHERE id = ?');

function deleteProject(id) {
  deleteProjectStmt.run(id);
}

const listStaleProjectsStmt = db.prepare(
  `SELECT id FROM projects WHERE analysis_status = 'stale'`
);

function listStaleProjectIds() {
  return listStaleProjectsStmt.all().map((r) => r.id);
}

// --- Recordings ------------------------------------------------------------

const createRecordingStmt = db.prepare(`
  INSERT INTO recordings (project_id, title, filename, created_at, status)
  VALUES (@project_id, @title, @filename, @created_at, 'processing')
`);

function createRecording({ project_id, title, filename }) {
  const info = createRecordingStmt.run({
    project_id,
    title,
    filename,
    created_at: new Date().toISOString(),
  });
  return getRecording(info.lastInsertRowid);
}

const getRecordingStmt = db.prepare('SELECT * FROM recordings WHERE id = ?');

function getRecording(id) {
  return hydrateRecording(getRecordingStmt.get(id));
}

const listRecordingsByProjectStmt = db.prepare(`
  SELECT * FROM recordings WHERE project_id = ? ORDER BY created_at ASC
`);

function listRecordingsByProject(projectId) {
  return listRecordingsByProjectStmt.all(projectId).map(hydrateRecording);
}

const setResultStmt = db.prepare(`
  UPDATE recordings
  SET transcript = @transcript,
      summary    = @summary,
      insights   = @insights,
      next_steps = @next_steps,
      duration   = @duration,
      status     = 'done',
      error      = NULL
  WHERE id = @id
`);

function setRecordingResult(id, { transcript, summary, insights, next_steps, duration }) {
  setResultStmt.run({
    id,
    transcript,
    summary,
    insights: JSON.stringify(insights || []),
    next_steps: JSON.stringify(next_steps || []),
    duration: duration ?? null,
  });
  return getRecording(id);
}

const setErrorStmt = db.prepare(
  `UPDATE recordings SET status = 'error', error = ? WHERE id = ?`
);

function setRecordingError(id, message) {
  setErrorStmt.run(String(message).slice(0, 2000), id);
  return getRecording(id);
}

const setProcessingStmt = db.prepare(
  `UPDATE recordings SET status = 'processing', error = NULL WHERE id = ?`
);

function setRecordingProcessing(id) {
  setProcessingStmt.run(id);
  return getRecording(id);
}

const deleteRecordingStmt = db.prepare('DELETE FROM recordings WHERE id = ?');

function deleteRecording(id) {
  deleteRecordingStmt.run(id);
}

// --- Project chat messages -------------------------------------------------

const addMessageStmt = db.prepare(`
  INSERT INTO project_messages (project_id, role, content, created_at)
  VALUES (@project_id, @role, @content, @created_at)
`);

function addProjectMessage(projectId, role, content) {
  const info = addMessageStmt.run({
    project_id: projectId,
    role,
    content,
    created_at: new Date().toISOString(),
  });
  return { id: info.lastInsertRowid, role, content };
}

const listMessagesStmt = db.prepare(`
  SELECT id, role, content, created_at
  FROM project_messages
  WHERE project_id = ?
  ORDER BY id ASC
`);

function listProjectMessages(projectId) {
  return listMessagesStmt.all(projectId);
}

// --- One-time migration: move orphan recordings into a default project ------

const orphanCount = db.prepare(
  'SELECT COUNT(*) AS n FROM recordings WHERE project_id IS NULL'
).get().n;

if (orphanCount > 0) {
  const existing = db.prepare('SELECT id FROM projects WHERE name = ?').get('My Recordings');
  const defId = existing ? existing.id : createProject('My Recordings').id;
  db.prepare('UPDATE recordings SET project_id = ? WHERE project_id IS NULL').run(defId);
  // Combined analysis needs to be generated for the newly-populated project.
  db.prepare(`UPDATE projects SET analysis_status = 'stale' WHERE id = ?`).run(defId);
}

module.exports = {
  db,
  // projects
  createProject,
  getProject,
  listProjects,
  setProjectAnalysis,
  setProjectAnalysisStatus,
  setProjectArchived,
  deleteProject,
  listStaleProjectIds,
  // recordings
  createRecording,
  getRecording,
  listRecordingsByProject,
  setRecordingResult,
  setRecordingError,
  setRecordingProcessing,
  deleteRecording,
  // messages
  addProjectMessage,
  listProjectMessages,
};

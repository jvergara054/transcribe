const projectList = document.getElementById('project-list');
const detail = document.getElementById('detail');
const emptyState = document.getElementById('empty-state');
const newProjectBtn = document.getElementById('new-project-btn');

let selectedId = null;
let openClips = new Set();
let pollTimer = null;
let showArchived = false;

// --- Helpers ---------------------------------------------------------------

async function api(url, opts) {
  const res = await fetch(url, opts);
  if (res.status === 401) {
    window.location.href = '/login';
    throw new Error('Session expired');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function toast(msg) {
  let el = document.querySelector('.toast');
  if (!el) {
    el = document.createElement('div');
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 3500);
}

function fmtDate(iso) {
  return new Date(iso).toLocaleString([], {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function listItems(arr) {
  if (!arr || !arr.length) return '<li class="muted">None</li>';
  return arr.map((i) => `<li>${escapeHtml(i)}</li>`).join('');
}

// Dates & Appointments rendered as highlighted chips.
function datesHtml(arr) {
  if (!arr || !arr.length) return '<p class="muted">None</p>';
  return `<div class="date-chips">${arr
    .map((d) => `<span class="date-chip">📅 ${escapeHtml(d)}</span>`)
    .join('')}</div>`;
}

// The four analysis sections, shared by the combined view, each clip, and the
// public shared page. `obj` has { summary, insights, dates, next_steps }.
function analysisSectionsHtml(obj, headingTag = 'h4') {
  const h = headingTag;
  const dates = (obj.dates && obj.dates.length)
    ? `<${h}>Dates & Appointments</${h}>${datesHtml(obj.dates)}`
    : '';
  return `
    <${h}>Summary</${h}><p>${escapeHtml(obj.summary || '')}</p>
    <${h}>Key Takeaways</${h}><ul>${listItems(obj.insights)}</ul>
    ${dates}
    <${h}>Tasks</${h}><ul>${listItems(obj.next_steps)}</ul>`;
}

// --- Sidebar: project list -------------------------------------------------

async function loadProjects() {
  const active = await api('/api/projects');
  projectList.innerHTML = '';
  active.forEach((p) => projectList.appendChild(projectItem(p, false)));

  if (showArchived) {
    const archived = await api('/api/projects?archived=true');
    if (archived.length) {
      const divider = document.createElement('div');
      divider.className = 'archived-divider';
      divider.textContent = 'Archived';
      projectList.appendChild(divider);
      archived.forEach((p) => projectList.appendChild(projectItem(p, true)));
    }
  }
}

function projectItem(p, isArchived) {
  const item = document.createElement('div');
  item.className = 'rec-item' + (p.id === selectedId ? ' active' : '') + (isArchived ? ' archived' : '');
  const clips = `${p.clip_count} clip${p.clip_count === 1 ? '' : 's'}`;
  item.innerHTML = `
    <div class="rec-title">${escapeHtml(p.name)}</div>
    <div class="rec-meta">
      <span class="rec-sub">${clips}</span>
      <span class="badge ${p.analysis_status}">${analysisLabel(p.analysis_status)}</span>
    </div>`;
  item.addEventListener('click', () => selectProject(p.id));
  item.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    showContextMenu(e.clientX, e.clientY, p, isArchived);
  });
  return item;
}

// --- Context menu (right-click a project) ----------------------------------

let contextMenuEl = null;

function closeContextMenu() {
  if (contextMenuEl) { contextMenuEl.remove(); contextMenuEl = null; }
}
document.addEventListener('click', closeContextMenu);
document.addEventListener('scroll', closeContextMenu, true);
window.addEventListener('blur', closeContextMenu);

function showContextMenu(x, y, project, isArchived) {
  closeContextMenu();
  const menu = document.createElement('div');
  menu.className = 'context-menu';
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;

  const items = isArchived
    ? [{ label: 'Unarchive', fn: () => setArchived(project.id, false) }]
    : [{ label: 'Archive', fn: () => setArchived(project.id, true) }];
  items.push({ label: 'Delete', danger: true, fn: () => deleteProject(project) });

  for (const it of items) {
    const el = document.createElement('div');
    el.className = 'context-item' + (it.danger ? ' danger' : '');
    el.textContent = it.label;
    el.addEventListener('click', (e) => { e.stopPropagation(); closeContextMenu(); it.fn(); });
    menu.appendChild(el);
  }

  document.body.appendChild(menu);
  contextMenuEl = menu;
  // Nudge back on-screen if it overflows.
  const rect = menu.getBoundingClientRect();
  if (rect.right > window.innerWidth) menu.style.left = `${x - rect.width}px`;
  if (rect.bottom > window.innerHeight) menu.style.top = `${y - rect.height}px`;
}

async function setArchived(id, archived) {
  try {
    await api(`/api/projects/${id}/archive`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ archived }),
    });
    if (archived && selectedId === id) {
      selectedId = null;
      detail.innerHTML = '<div class="empty"><p class="muted">Project archived.</p></div>';
    }
    loadProjects();
  } catch (e) { toast(e.message); }
}

async function deleteProject(project) {
  if (!confirm(`Delete project "${project.name}" and all its clips?`)) return;
  try {
    await api(`/api/projects/${project.id}`, { method: 'DELETE' });
    if (selectedId === project.id) {
      selectedId = null;
      detail.innerHTML = '<div class="empty"><p>Project deleted.</p></div>';
    }
    loadProjects();
  } catch (e) { toast(e.message); }
}

function analysisLabel(status) {
  return { empty: 'empty', stale: 'pending', processing: 'analyzing', done: 'ready', error: 'error' }[status] || status;
}

// --- Detail: project view --------------------------------------------------

async function selectProject(id) {
  selectedId = id;
  const project = await api(`/api/projects/${id}`);
  await loadProjects();
  renderProject(project);
}

function renderProject(project) {
  emptyState?.remove();

  const clips = project.recordings || [];
  const anyProcessing = clips.some((c) => c.status === 'processing');
  const doneCount = clips.filter((c) => c.status === 'done').length;

  detail.innerHTML = `
    <div class="detail-header">
      <div><h2>${escapeHtml(project.name)}</h2><span class="muted">${fmtDate(project.created_at)}</span></div>
      <div class="header-actions">
        <button class="icon-btn ${project.share_token ? 'shared' : ''}" id="share-btn">${project.share_token ? '🔗 Shared' : 'Share'}</button>
        <button class="icon-btn" id="delete-project-btn">Delete project</button>
      </div>
    </div>

    <label class="detail-drop" id="detail-drop">
      <input type="file" id="file-input" accept="audio/*,.m4a,.mp3,.wav,.webm,.ogg,.flac" multiple hidden />
      <span class="dropzone-title">Drop clips here or click to add</span>
      <span class="dropzone-hint">one or many — mp3, m4a, wav, webm… up to 25 MB each</span>
    </label>

    ${combinedAnalysisHtml(project, doneCount)}

    <div class="card">
      <h3>Clips <span class="count">(${clips.length})</span></h3>
      <div id="clips">${clips.length ? clips.map(clipHtml).join('') : '<p class="muted">No clips yet — add one above.</p>'}</div>
    </div>

    <div class="card">
      <h3>Chat <span class="count">— across all clips</span></h3>
      ${doneCount === 0
        ? '<p class="muted">Add and process at least one clip to start chatting.</p>'
        : `<div class="chat-log" id="chat-log"></div>
           <form class="chat-input-row" id="chat-form">
             <input type="text" id="chat-input" placeholder="Ask about these recordings…" autocomplete="off" />
             <button class="btn" type="submit" id="chat-send">Send</button>
           </form>`}
    </div>`;

  bindProjectControls(project);
  if (doneCount > 0) {
    renderChat(project.messages || []);
    document.getElementById('chat-form').addEventListener('submit', (e) => {
      e.preventDefault();
      sendChat(project.id);
    });
  }

  if (anyProcessing || project.analysis_status === 'processing') scheduleRefresh();
}

function combinedAnalysisHtml(project, doneCount) {
  const status = project.analysis_status;
  let inner;
  if (status === 'processing') {
    inner = `<div class="analysis-updating"><span class="spinner"></span> Generating combined analysis…</div>`;
  } else if (status === 'error') {
    inner = `<p class="error-box">⚠ ${escapeHtml(project.analysis_error || 'Analysis failed.')}</p>
             <br /><button class="btn" id="reanalyze-btn">Retry analysis</button>`;
  } else if (status === 'done') {
    inner = analysisSectionsHtml(project);
  } else {
    // empty or stale
    inner = doneCount === 0
      ? '<p class="muted">Combined analysis appears once a clip has been processed.</p>'
      : '<p class="muted">Not generated yet.</p><br /><button class="btn" id="reanalyze-btn">Generate combined analysis</button>';
  }
  return `<div class="card" id="analysis-card"><h3>Combined Analysis</h3>${inner}</div>`;
}

function clipHtml(c) {
  const open = openClips.has(c.id) ? ' open' : '';
  let body;
  if (c.status === 'processing') {
    body = `<div class="analysis-updating"><span class="spinner"></span> Transcribing & analyzing…</div>`;
  } else if (c.status === 'error') {
    body = `<p class="error-box">⚠ ${escapeHtml(c.error || 'Failed.')}</p>
            <br /><button class="btn secondary retry-clip" data-id="${c.id}">Retry</button>`;
  } else {
    body = `
      ${analysisSectionsHtml(c)}
      <h4>Transcript</h4><pre>${escapeHtml(c.transcript || '')}</pre>`;
  }
  return `
    <div class="clip${open}" data-id="${c.id}">
      <div class="clip-head">
        <span class="clip-caret">▶</span>
        <span class="clip-title">${escapeHtml(c.title)}</span>
        <span class="badge ${c.status}">${c.status}</span>
        <button class="clip-delete" data-del="${c.id}" title="Delete clip">✕</button>
      </div>
      <div class="clip-body">${body}</div>
    </div>`;
}

function bindProjectControls(project) {
  document.getElementById('delete-project-btn').addEventListener('click', () => deleteProject(project));

  document.getElementById('reanalyze-btn')?.addEventListener('click', async () => {
    try {
      await api(`/api/projects/${project.id}/reanalyze`, { method: 'POST' });
      selectProject(project.id);
    } catch (e) { toast(e.message); }
  });

  // Share
  document.getElementById('share-btn').addEventListener('click', () => openShareDialog(project));

  // Upload (one or many)
  const input = document.getElementById('file-input');
  const drop = document.getElementById('detail-drop');
  input.addEventListener('change', (e) => { uploadClips(project.id, e.target.files); input.value = ''; });
  ['dragenter', 'dragover'].forEach((ev) =>
    drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach((ev) =>
    drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('drag'); }));
  drop.addEventListener('drop', (e) => uploadClips(project.id, e.dataTransfer.files));

  // Clip accordion toggles
  detail.querySelectorAll('.clip-head').forEach((head) => {
    head.addEventListener('click', (e) => {
      if (e.target.closest('.clip-delete')) return;
      const clip = head.closest('.clip');
      const id = Number(clip.dataset.id);
      if (openClips.has(id)) openClips.delete(id); else openClips.add(id);
      clip.classList.toggle('open');
    });
  });

  // Clip delete
  detail.querySelectorAll('.clip-delete').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = Number(btn.dataset.del);
      if (!confirm('Delete this clip?')) return;
      try {
        await api(`/api/recordings/${id}`, { method: 'DELETE' });
        openClips.delete(id);
        selectProject(project.id);
      } catch (e) { toast(e.message); }
    });
  });

  // Clip retry
  detail.querySelectorAll('.retry-clip').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        await api(`/api/recordings/${btn.dataset.id}/retry`, { method: 'POST' });
        selectProject(project.id);
      } catch (e) { toast(e.message); }
    });
  });
}

// --- Polling ---------------------------------------------------------------

function scheduleRefresh() {
  clearTimeout(pollTimer);
  pollTimer = setTimeout(async () => {
    if (!selectedId) return;
    try {
      const project = await api(`/api/projects/${selectedId}`);
      renderProject(project);
      loadProjects();
    } catch { /* ignore transient */ }
  }, 2500);
}

// --- Chat ------------------------------------------------------------------

function renderChat(messages) {
  const log = document.getElementById('chat-log');
  if (!log) return;
  log.innerHTML = messages
    .map((m) => `<div class="chat-msg ${m.role}">${escapeHtml(m.content)}</div>`)
    .join('');
  log.scrollTop = log.scrollHeight;
}

async function sendChat(projectId) {
  const input = document.getElementById('chat-input');
  const sendBtn = document.getElementById('chat-send');
  const log = document.getElementById('chat-log');
  const question = input.value.trim();
  if (!question) return;

  input.value = '';
  input.disabled = true;
  sendBtn.disabled = true;
  log.insertAdjacentHTML('beforeend', `<div class="chat-msg user">${escapeHtml(question)}</div>`);
  log.insertAdjacentHTML('beforeend', `<div class="chat-msg assistant thinking" id="pending"><span class="dots"><span></span><span></span><span></span></span> Thinking…</div>`);
  log.scrollTop = log.scrollHeight;

  try {
    const { answer } = await api(`/api/projects/${projectId}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question }),
    });
    document.getElementById('pending').outerHTML = `<div class="chat-msg assistant">${escapeHtml(answer)}</div>`;
  } catch (e) {
    document.getElementById('pending')?.remove();
    toast(e.message);
  } finally {
    input.disabled = false;
    sendBtn.disabled = false;
    input.focus();
    log.scrollTop = log.scrollHeight;
  }
}

// --- Upload ----------------------------------------------------------------

async function uploadClips(projectId, fileList) {
  const files = [...(fileList || [])];
  if (!files.length) return;
  const form = new FormData();
  for (const f of files) form.append('audio', f);
  try {
    const { created } = await api(`/api/projects/${projectId}/recordings`, { method: 'POST', body: form });
    if (files.length > 1) toast(`Added ${created} clips — transcribing…`);
    await selectProject(projectId);
  } catch (e) {
    toast(e.message);
  }
}

// --- New project -----------------------------------------------------------

newProjectBtn.addEventListener('click', async () => {
  const name = prompt('Project name:');
  if (!name || !name.trim()) return;
  try {
    const project = await api('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name.trim() }),
    });
    await selectProject(project.id);
  } catch (e) { toast(e.message); }
});

// --- Show/hide archived ----------------------------------------------------

const toggleArchivedBtn = document.getElementById('toggle-archived');
toggleArchivedBtn.addEventListener('click', () => {
  showArchived = !showArchived;
  toggleArchivedBtn.textContent = showArchived ? 'Hide archived' : 'Show archived';
  toggleArchivedBtn.classList.toggle('active', showArchived);
  loadProjects();
});

// --- Share dialog ----------------------------------------------------------

async function openShareDialog(project) {
  let token = project.share_token;
  try {
    if (!token) {
      const r = await api(`/api/projects/${project.id}/share`, { method: 'POST' });
      token = r.token;
      project.share_token = token;
    }
  } catch (e) { toast(e.message); return; }

  const url = `${window.location.origin}/shared/${token}`;
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <h3>Share “${escapeHtml(project.name)}”</h3>
      <p class="muted">Anyone with this link can view a read-only version of this
        project — summary, takeaways, dates, tasks, and transcripts. No login required.</p>
      <div class="share-row">
        <input type="text" id="share-url" readonly value="${escapeHtml(url)}" />
        <button class="btn" id="copy-url">Copy</button>
      </div>
      <div class="modal-actions">
        <button class="btn secondary" id="revoke-share">Revoke link</button>
        <button class="btn" id="close-share">Done</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const close = () => overlay.remove();
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  overlay.querySelector('#close-share').addEventListener('click', close);
  overlay.querySelector('#copy-url').addEventListener('click', async () => {
    overlay.querySelector('#share-url').select();
    try { await navigator.clipboard.writeText(url); } catch { document.execCommand('copy'); }
    const b = overlay.querySelector('#copy-url');
    b.textContent = 'Copied!';
    setTimeout(() => { if (b.isConnected) b.textContent = 'Copy'; }, 1500);
  });
  overlay.querySelector('#revoke-share').addEventListener('click', async () => {
    try {
      await api(`/api/projects/${project.id}/share`, { method: 'DELETE' });
      close();
      toast('Share link revoked.');
      selectProject(project.id);
    } catch (e) { toast(e.message); }
  });
}

// --- Auth: show logout when a login is in effect ---------------------------

async function initAuth() {
  try {
    const { required } = await api('/api/auth/status');
    if (!required) return;
    const btn = document.getElementById('logout-btn');
    btn.style.display = '';
    btn.addEventListener('click', async () => {
      try {
        await api('/api/logout', { method: 'POST' });
      } catch { /* ignore */ }
      window.location.href = '/login';
    });
  } catch { /* ignore */ }
}

// --- Init ------------------------------------------------------------------

initAuth();
loadProjects();

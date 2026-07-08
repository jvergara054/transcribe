# 🎙️ Transcribe

A local web app: upload an audio recording and get an AI-generated **summary**,
**key insights**, and **next steps** — then **chat** with the recording to dig
into what was said. Every recording is saved to a local library.

Powered by **Groq** (free tier), which hosts both:
- **Transcription:** Whisper (`whisper-large-v3-turbo`)
- **Summary / insights / next steps / chat:** Llama (`llama-3.3-70b-versatile`)

Storage is a local SQLite file + local audio files.

## Setup

1. Get a **free** Groq API key at https://console.groq.com/keys
2. Install dependencies:
   ```bash
   npm install
   ```
3. Add your key:
   ```bash
   cp .env.example .env
   # then edit .env and paste your key into GROQ_API_KEY
   ```
4. Start the app:
   ```bash
   npm start
   ```
5. Open http://localhost:3000

## Usage

Recordings are organized into **projects**. A project holds one or more clips and
gives you a combined view across all of them.

- Click **+ New Project** and name it (e.g. "Patient Smith", "Q3 Planning").
- Drop audio clips (mp3, m4a, wav, webm, ogg, flac…) into the project. Each clip
  transcribes and gets its own summary/insights/next-steps.
- The project's **Combined Analysis** (summary, insights, next steps across all
  clips) regenerates automatically whenever you add or remove a clip.
- Use the project **Chat** to ask questions spanning every clip in the project.
- Expand any clip to see its individual transcript and analysis.

## Notes

- Audio files must be **≤ 25 MB**.
- Model overrides (in `.env`): `GROQ_MODEL` for the LLM, `GROQ_WHISPER_MODEL`
  for transcription.
- Data lives in `data.db` and `uploads/` — both git-ignored. Set `DATA_DIR` to
  relocate both (used for hosting on a persistent disk).

## Deploying (Render / Railway)

This is a stateful Node server that stores a SQLite database and audio files on
disk, so it needs a host that runs a **persistent process with an attached
disk** — not a static/serverless host like Netlify. Render and Railway both work.

Set `DATA_DIR` to a mounted volume path and add your `GROQ_API_KEY` env var; the
`PORT` env var is provided by the host automatically.

**Render** — push this folder to a git repo, then in Render: **New → Blueprint**
and point it at the repo. [`render.yaml`](render.yaml) provisions a web service
with a 1 GB disk mounted at `/data`. Add `GROQ_API_KEY` in the dashboard.
(The persistent disk requires a paid instance; on the free plan data resets on
each restart.)

**Railway** — create a service from the repo, add a **Volume** mounted at e.g.
`/data`, and set env vars `DATA_DIR=/data` and `GROQ_API_KEY=...`.

### Password login

The app has a built-in single-password login. Set **`APP_PASSWORD`** and the app
requires that password (stored in a signed, HttpOnly session cookie) before
anything is accessible. **Set `APP_PASSWORD` before hosting publicly** — without
it, anyone with the URL can use the app and your Groq key.

Locally, leave `APP_PASSWORD` blank and the app runs open (no login prompt).

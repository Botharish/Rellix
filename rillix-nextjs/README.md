# 🎬 Rillix — Universal Video Downloader (Next.js)

A Next.js 14 (App Router + TypeScript) port of Rillix. Download videos from
YouTube, TikTok, Instagram, X/Twitter, Pinterest, Reddit, Vimeo, Facebook, and
1000+ other platforms.

The original project was a **FastAPI (Python) backend + a single static HTML
file**. This version folds both halves into one Next.js app:

| Original | This project |
|----------|--------------|
| `backend/main.py` (FastAPI + `yt_dlp` library) | `app/api/*` route handlers driving the `yt-dlp` **CLI** via `child_process` |
| `frontend/index.html` (vanilla JS) | `app/page.tsx` + `components/*` (React) |
| Global Python dicts for progress | `lib/progress.ts` in-memory store |
| Server-Sent Events via FastAPI `StreamingResponse` | SSE via a Web `ReadableStream` route |

## Prerequisites

This app shells out to the **`yt-dlp`** binary, which also needs **`ffmpeg`**
for merging/transcoding. Install both and make sure they're on your `PATH`:

- yt-dlp: <https://github.com/yt-dlp/yt-dlp#installation>
- ffmpeg: <https://ffmpeg.org/download.html>

Verify: `yt-dlp --version` and `ffmpeg -version`.

> On Windows you can also point the app directly at the binaries with the
> `YTDLP_PATH` and `FFMPEG_LOCATION` env vars (see `.env.example`).

## Run locally

```bash
cd rillix-nextjs
npm install
npm run dev          # http://localhost:3000
```

Production:

```bash
npm run build
npm run start
```

## Run with Docker

The included `Dockerfile` installs Node, Python, ffmpeg and the latest yt-dlp:

```bash
docker build -t rillix-next .
docker run -p 3000:3000 rillix-next
```

## Configuration

See `.env.example`. All variables are optional:

| Variable | Default | Description |
|----------|---------|-------------|
| `YTDLP_PATH` | `yt-dlp` | Path to the yt-dlp binary |
| `FFMPEG_LOCATION` | _(PATH)_ | Directory or full path of ffmpeg |
| `DOWNLOAD_DIR` | `downloads` | Temp dir for files before they're streamed |
| `PORT` | `3000` | Port for `next start` |
| `NEXT_PUBLIC_API_BASE` | _(same origin)_ | Engine origin, when the UI is hosted separately (e.g. on Vercel) |
| `ALLOWED_ORIGIN` | `*` | CORS origin allowed to call the engine's API |

## API routes

| Route | Method | Description |
|-------|--------|-------------|
| `GET /api/info?url=...` | GET | Video/playlist metadata |
| `GET /api/download?url=...&client_id=...&quality=...&index=...` | GET | Download video, streams the file |
| `GET /api/download-audio?url=...&client_id=...&index=...` | GET | Download as MP3 |
| `GET /api/progress/{clientId}` | GET (SSE) | Live progress stream |
| `POST /api/cancel/{clientId}` | POST | Cancel an in-flight download |
| `GET /api/health` | GET | Health check + yt-dlp version |

## 🚀 Deployment

### ⚠ Why the engine can't run on Vercel

The API routes spawn the `yt-dlp` and `ffmpeg` **system binaries**, run
**long downloads** (minutes), **stream large media files**, and share an
**in-memory progress store** between the `/download`, `/progress`, and `/cancel`
calls. Vercel's serverless functions provide none of that: no bundled binaries,
short execution limits, response-size limits, and every request hits a separate
stateless isolate (so `/progress` and `/cancel` can't see the download). The
original FastAPI version had the same statefulness limitation.

**→ The download engine must run on a long-running Node server**
(Railway, Render, Fly.io, or any VPS). The included `Dockerfile` does exactly
this.

### Option A — Everything on one host (recommended)

Deploy the whole app (UI + engine) to Railway / Render / Fly.io with the
`Dockerfile`. No extra config needed; it just works end-to-end.

### Option B — UI on Vercel + engine on Railway/Render

If you want the page itself on Vercel:

1. Deploy this repo to **Railway/Render** as the engine (using the `Dockerfile`).
   Note its URL, e.g. `https://rillix-engine.up.railway.app`.
   - Optionally set `ALLOWED_ORIGIN=https://your-ui.vercel.app` on the engine.
2. Deploy the **same repo** to **Vercel** and set an env var:
   ```
   NEXT_PUBLIC_API_BASE=https://rillix-engine.up.railway.app
   ```
   The Vercel page will render, and all `/api/*` calls go to the engine on the
   other host. Only the static UI runs on Vercel — no downloads happen there.

Both modes build from this one codebase: with `NEXT_PUBLIC_API_BASE` unset the
app is same-origin (Option A); set it and the UI talks to a remote engine
(Option B).

## Authentication (optional)

For age-restricted or private content, drop a `cookies.txt` file in the project
root. Export it with the “Get cookies.txt LOCALLY” browser extension.

## Bugs fixed vs. the original

See `CHANGES.md` for the full list of bugs found in the Python/HTML version and
how they were addressed in this port.

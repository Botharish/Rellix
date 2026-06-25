# 🎬 Rillix — Universal Video Downloader

Download videos from YouTube, TikTok, Instagram, X/Twitter, Pinterest, Reddit, LinkedIn, Vimeo, Facebook, and 1000+ other platforms.

## ✨ Features

- **Universal** — powered by yt-dlp, supports 1000+ platforms
- **Quality picker** — choose from all available resolutions, or grab the best automatically
- **Live progress** — real-time download progress with speed & ETA via Server-Sent Events
- **Video preview** — shows thumbnail, title, duration, uploader before downloading
- **Modern UI** — glassmorphism dark design, fully responsive

---

## 🚀 Deploy in 5 Minutes

### Option 1: Railway (Recommended — Free tier available)

1. **Create a free account** at [railway.app](https://railway.app)
2. Click **New Project → Deploy from GitHub repo**
3. Push this folder to a GitHub repo, then connect it
4. Railway auto-detects the `Dockerfile` and deploys
5. Copy your Railway URL (e.g. `https://rillix-production.up.railway.app`)
6. Edit `frontend/index.html` line 1:
   ```js
   const BACKEND_URL = "https://your-railway-url.up.railway.app";
   ```
7. Open `frontend/index.html` in any browser — done!

### Option 2: Render (Free tier available)

1. Create account at [render.com](https://render.com)
2. New → Web Service → Connect your GitHub repo
3. Runtime: **Docker**
4. Render uses `render.yaml` automatically
5. Update `BACKEND_URL` in the frontend as above

### Option 3: Fly.io

```bash
# Install flyctl, then:
fly launch
fly deploy
```

### Option 4: Local (original behavior)

```bash
cd backend
pip install -r requirements.txt
# Install ffmpeg: https://ffmpeg.org/download.html
uvicorn main:app --reload
# Open frontend/index.html in browser
```

### Option 5: Docker locally

```bash
docker build -t rillix .
docker run -p 8000:8000 rillix
# Open frontend/index.html
```

---

## 🌐 Host the Frontend Free

The frontend is a **single HTML file** — host it anywhere:

| Service | How |
|---------|-----|
| **GitHub Pages** | Push `frontend/` to a repo, enable Pages |
| **Netlify Drop** | Drag `frontend/` folder to [app.netlify.com/drop](https://app.netlify.com/drop) |
| **Vercel** | `npx vercel frontend/` |
| **Cloudflare Pages** | Connect GitHub repo, set root to `frontend/` |

Just make sure `BACKEND_URL` in the HTML points to your deployed backend.

---

## ⚙️ Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DOWNLOAD_DIR` | `downloads` | Where to save temp video files |
| `PORT` | `8000` | Server port (auto-set by Railway/Render) |
| `COOKIES_FILE` | unset | Path to a Netscape `cookies.txt` file |
| `YOUTUBE_COOKIES` | unset | Full `cookies.txt` contents for hosts where secret files are awkward |
| `YOUTUBE_COOKIES_B64` | unset | Base64 encoded `cookies.txt` contents |

---

## 🔧 Platform Authentication (Optional)

For age-restricted, private, or bot-check-blocked YouTube content on Render/Railway, provide YouTube cookies. Export cookies in Netscape `cookies.txt` format from your browser, then configure one of:

- Render Secret File mounted at `/etc/secrets/cookies.txt`
- `COOKIES_FILE=/etc/secrets/cookies.txt`
- `YOUTUBE_COOKIES=<full cookies.txt contents>`
- `YOUTUBE_COOKIES_B64=<base64 cookies.txt contents>`

After redeploying, check `/health`; `"cookies": true` means the backend can read them.

---

## 📡 API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `GET /info?url=...` | GET | Fetch video metadata (title, thumbnail, available qualities) |
| `GET /download?url=...&quality=...&client_id=...` | GET | Download video, streams file |
| `GET /progress/{client_id}` | GET (SSE) | Real-time download progress stream |
| `GET /health` | GET | Health check |

---

## 📝 Notes

- Videos are saved temporarily on the server and served to your browser. Files are not stored permanently.
- For production use, consider adding a cleanup task to remove old files from the `downloads/` directory.
- Some platforms (e.g. Instagram private accounts, YouTube age-restricted) require cookies.
- This tool uses [yt-dlp](https://github.com/yt-dlp/yt-dlp) under the hood — keep it updated with `pip install -U yt-dlp`.

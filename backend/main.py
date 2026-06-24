# main.py — Rillix v6 — Proxy-based YouTube bypass
from fastapi import FastAPI, Query, Request, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
import yt_dlp, uuid, os, json, asyncio, glob, threading, subprocess, sys, time, re

app = FastAPI(title="Rillix", version="6.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

DOWNLOAD_DIR = os.environ.get("DOWNLOAD_DIR", "downloads")
os.makedirs(DOWNLOAD_DIR, exist_ok=True)
cur_dir = os.path.dirname(os.path.abspath(__file__))

# ── Auto-update yt-dlp on startup ─────────────────────────────────────────────
def auto_update_ytdlp():
    try:
        result = subprocess.run(
            [sys.executable, "-m", "pip", "install", "--upgrade", "yt-dlp", "--quiet"],
            capture_output=True, text=True, timeout=120
        )
        if "Successfully installed" in result.stdout:
            print("[Rillix] yt-dlp updated!")
    except Exception as e:
        print(f"[Rillix] Update check failed: {e}")

threading.Thread(target=auto_update_ytdlp, daemon=True).start()

# ── Cleanup old downloads every hour ──────────────────────────────────────────
def cleanup_loop():
    while True:
        time.sleep(3600)
        try:
            now = time.time()
            for f in glob.glob(os.path.join(DOWNLOAD_DIR, "*")):
                if os.path.isfile(f) and (now - os.path.getmtime(f)) > 3600:
                    os.remove(f)
        except: pass

threading.Thread(target=cleanup_loop, daemon=True).start()

# ── ffmpeg ────────────────────────────────────────────────────────────────────
def find_ffmpeg():
    for c in [os.path.join(cur_dir,"ffmpeg"), os.path.join(cur_dir,"ffmpeg.exe"),
              "/usr/bin/ffmpeg", "/usr/local/bin/ffmpeg"]:
        if os.path.exists(c): return os.path.dirname(c)
    return None

ffmpeg_dir   = find_ffmpeg()
cookies_path = os.path.join(cur_dir, "cookies.txt")

active_downloads: dict = {}
cancel_flags:     dict = {}

# ── Invidious instances (public YouTube proxies — no login needed) ─────────────
# These are community-run servers that proxy YouTube without bot detection
INVIDIOUS_INSTANCES = [
    "https://inv.nadeko.net",
    "https://invidious.privacydev.net",
    "https://yt.cdaut.de",
    "https://invidious.nerdvpn.de",
    "https://iv.datura.network",
]

def is_youtube(url: str) -> bool:
    return bool(re.search(r'(youtube\.com|youtu\.be)', url, re.I))

def extract_youtube_id(url: str) -> str | None:
    patterns = [
        r'(?:v=|youtu\.be/|embed/|shorts/)([A-Za-z0-9_-]{11})',
    ]
    for p in patterns:
        m = re.search(p, url)
        if m: return m.group(1)
    return None

def get_invidious_url(video_id: str) -> str | None:
    """Try each Invidious instance until one works."""
    import urllib.request
    for instance in INVIDIOUS_INSTANCES:
        try:
            test_url = f"{instance}/api/v1/videos/{video_id}"
            req = urllib.request.Request(test_url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=5) as r:
                if r.status == 200:
                    return f"{instance}/watch?v={video_id}"
        except:
            continue
    return None

def fmt_bytes(size):
    for u in ["B","KB","MB","GB","TB"]:
        if size < 1024: return f"{size:.1f} {u}"
        size /= 1024
    return f"{size:.1f} PB"

def progress_hook(d, client_id):
    if cancel_flags.get(client_id, threading.Event()).is_set():
        raise Exception("Cancelled")
    if d["status"] == "downloading":
        try:
            total = d.get("total_bytes") or d.get("total_bytes_estimate", 0)
            dl    = d.get("downloaded_bytes", 0)
            pct   = round((dl/total)*100,1) if total else 0
            active_downloads[client_id] = {
                "status":"downloading","percent":pct,
                "total_size": fmt_bytes(total) if total else "Unknown",
                "downloaded": fmt_bytes(dl),
                "speed": d.get("_speed_str","—"),
                "eta":   d.get("_eta_str","—"),
            }
        except Exception as e:
            if "Cancelled" in str(e): raise
    elif d["status"] == "finished":
        active_downloads[client_id] = {
            "status":"processing","percent":100,
            "total_size":"Merging…","downloaded":"","speed":"","eta":"",
        }

def make_opts(fmt, out_path, client_id, extra={}):
    opts = {
        "format": fmt,
        "outtmpl": out_path,
        "merge_output_format": "mp4",
        "quiet": True,
        "no_warnings": True,
        "geo_bypass": True,
        "retries": 10,
        "fragment_retries": 10,
        "nocheckcertificate": True,
        "progress_hooks": [lambda d: progress_hook(d, client_id)],
        "http_headers": {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
        },
    }
    if ffmpeg_dir: opts["ffmpeg_location"] = ffmpeg_dir
    if os.path.exists(cookies_path): opts["cookiefile"] = cookies_path
    opts.update(extra)
    return opts

def download_url(url, fmt, out_path, client_id, extra_opts={}):
    """
    Smart download:
    - YouTube → try Invidious proxy first, then direct fallbacks
    - Other platforms → direct download
    """
    if is_youtube(url):
        vid_id = extract_youtube_id(url)

        # Strategy 1: Invidious proxy (bypasses YouTube bot detection entirely)
        if vid_id:
            inv_url = get_invidious_url(vid_id)
            if inv_url:
                try:
                    opts = make_opts(fmt, out_path, client_id, {
                        "http_headers": {
                            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
                        }
                    })
                    opts.update(extra_opts)
                    with yt_dlp.YoutubeDL(opts) as ydl:
                        ydl.download([inv_url])
                    return
                except Exception as e:
                    if "Cancelled" in str(e): raise
                    print(f"[Rillix] Invidious failed: {str(e)[:60]}, trying direct…")

        # Strategy 2: Android client (often bypasses bot check)
        try:
            opts = make_opts(fmt, out_path, client_id, {
                "extractor_args": {"youtube": {"player_client": ["android"]}},
                "http_headers": {
                    "User-Agent": "com.google.android.youtube/19.09.37 (Linux; U; Android 11) gzip"
                },
            })
            opts.update(extra_opts)
            with yt_dlp.YoutubeDL(opts) as ydl:
                ydl.download([url])
            return
        except Exception as e:
            if "Cancelled" in str(e): raise
            print(f"[Rillix] Android client failed: {str(e)[:60]}, trying TV…")

        # Strategy 3: TV embedded client
        try:
            opts = make_opts(fmt, out_path, client_id, {
                "extractor_args": {"youtube": {"player_client": ["tv_embedded"]}},
                "http_headers": {
                    "User-Agent": "Mozilla/5.0 (SMART-TV; Linux; Tizen 5.0)"
                },
            })
            opts.update(extra_opts)
            with yt_dlp.YoutubeDL(opts) as ydl:
                ydl.download([url])
            return
        except Exception as e:
            if "Cancelled" in str(e): raise
            raise Exception(
                "YouTube is blocking this server's IP. "
                "Please upload a cookies.txt file to the backend folder. "
                "See README for instructions."
            )
    else:
        # Non-YouTube — direct download
        opts = make_opts(fmt, out_path, client_id)
        opts.update(extra_opts)
        with yt_dlp.YoutubeDL(opts) as ydl:
            ydl.download([url])

# ── SSE progress ──────────────────────────────────────────────────────────────
@app.get("/progress/{client_id}")
async def stream_progress(request: Request, client_id: str):
    async def gen():
        for _ in range(1500):
            if await request.is_disconnected(): break
            data = active_downloads.get(client_id)
            if data:
                yield f"data: {json.dumps(data)}\n\n"
                if data.get("status") in ("complete","error","cancelled"): break
            await asyncio.sleep(0.4)
    return StreamingResponse(gen(), media_type="text/event-stream")

@app.post("/cancel/{client_id}")
def cancel_dl(client_id: str):
    ev = cancel_flags.get(client_id)
    if ev: ev.set()
    active_downloads[client_id] = {
        "status":"cancelled","percent":0,
        "total_size":"Cancelled","downloaded":"","speed":"","eta":"",
    }
    return {"ok": True}

# ── Info ──────────────────────────────────────────────────────────────────────
@app.get("/info")
def get_info(url: str = Query(...)):
    fetch_url = url

    # For YouTube, try Invidious first
    if is_youtube(url):
        vid_id = extract_youtube_id(url)
        if vid_id:
            inv_url = get_invidious_url(vid_id)
            if inv_url:
                fetch_url = inv_url

    opts = {
        "quiet": True, "no_warnings": True,
        "skip_download": True, "geo_bypass": True,
        "nocheckcertificate": True,
        "extractor_args": {"youtube": {"player_client": ["android"]}},
        "http_headers": {
            "User-Agent": "com.google.android.youtube/19.09.37 (Linux; U; Android 11) gzip"
        },
    }
    if os.path.exists(cookies_path): opts["cookiefile"] = cookies_path
    if ffmpeg_dir: opts["ffmpeg_location"] = ffmpeg_dir

    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(fetch_url, download=False)

        entries = info.get("entries")
        if entries:
            items = []
            for i, e in enumerate(entries or []):
                if not e: continue
                thumb = e.get("thumbnail","") or (e.get("thumbnails") or [{}])[-1].get("url","")
                fmts  = e.get("formats",[])
                is_v  = any(f.get("vcodec","none") not in ("none","") for f in fmts)
                dur   = e.get("duration",0) or 0
                m,s   = divmod(int(dur),60)
                items.append({
                    "index":i,"id":e.get("id",""),
                    "title":e.get("title") or f"Item {i+1}",
                    "thumbnail":thumb,
                    "type":"video" if is_v else "image",
                    "duration":f"{m}:{s:02d}" if dur else "",
                })
            return {
                "type":"playlist","title":info.get("title","Collection"),
                "platform":info.get("extractor_key",""),
                "count":len(items),"items":items,
            }

        fmts    = info.get("formats",[])
        heights = sorted(set(
            f["height"] for f in fmts
            if f.get("height") and f.get("vcodec","none") not in ("none","")
        ), reverse=True)
        dur = info.get("duration",0) or 0
        m,s = divmod(int(dur),60); h,m = divmod(m,60)
        thumb = info.get("thumbnail","") or (info.get("thumbnails") or [{}])[-1].get("url","")
        return {
            "type":"single","title":info.get("title","Unknown"),
            "thumbnail":thumb,
            "duration":f"{h}:{m:02d}:{s:02d}" if h else f"{m}:{s:02d}",
            "uploader":info.get("uploader") or info.get("channel",""),
            "platform":info.get("extractor_key",""),
            "available_heights":heights[:6],
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

# ── Download video ────────────────────────────────────────────────────────────
@app.get("/download")
def download_video(
    url: str = Query(...), client_id: str = Query(...),
    quality: str = Query("best"), index: str = Query(None),
):
    uid      = uuid.uuid4().hex
    out_path = os.path.join(DOWNLOAD_DIR, f"{uid}.%(ext)s")
    cancel_flags[client_id] = threading.Event()
    active_downloads[client_id] = {
        "status":"starting","percent":0,
        "total_size":"Calculating…","downloaded":"0 B","speed":"","eta":"",
    }
    try:
        fmt = ("bestvideo+bestaudio/best" if quality == "best"
               else f"bestvideo[height<={quality}]+bestaudio/best[height<={quality}]/best")
        extra = {}
        if index is not None:
            extra["playlist_items"] = str(int(index)+1)
        download_url(url, fmt, out_path, client_id, extra)

        matches = glob.glob(os.path.join(DOWNLOAD_DIR, f"{uid}.*"))
        if not matches: raise FileNotFoundError("File not found after download")
        final = matches[0]
        ext   = os.path.splitext(final)[1]
        label = f"video_{quality}p{ext}" if quality != "best" else f"video_best{ext}"
        active_downloads[client_id] = {
            "status":"complete","percent":100,
            "total_size":"Done","downloaded":"","speed":"","eta":"",
        }
        return FileResponse(final, filename=label, media_type="video/mp4")
    except Exception as e:
        msg = str(e)
        active_downloads[client_id] = {
            "status":"cancelled" if "Cancelled" in msg else "error",
            "percent":0,"total_size":msg,"downloaded":"","speed":"","eta":"",
        }
        raise HTTPException(status_code=500, detail=msg)
    finally:
        cancel_flags.pop(client_id, None)

# ── Download audio ────────────────────────────────────────────────────────────
@app.get("/download-audio")
def download_audio(
    url: str = Query(...), client_id: str = Query(...),
    index: str = Query(None),
):
    uid      = uuid.uuid4().hex
    out_path = os.path.join(DOWNLOAD_DIR, f"{uid}.%(ext)s")
    cancel_flags[client_id] = threading.Event()
    active_downloads[client_id] = {
        "status":"starting","percent":0,
        "total_size":"Calculating…","downloaded":"0 B","speed":"","eta":"",
    }
    try:
        extra = {
            "postprocessors": [{
                "key": "FFmpegExtractAudio",
                "preferredcodec": "mp3",
                "preferredquality": "192",
            }]
        }
        if index is not None:
            extra["playlist_items"] = str(int(index)+1)
        download_url(url, "bestaudio/best", out_path, client_id, extra)

        matches = glob.glob(os.path.join(DOWNLOAD_DIR, f"{uid}.*"))
        if not matches: raise FileNotFoundError("File not found")
        final = matches[0]
        active_downloads[client_id] = {
            "status":"complete","percent":100,
            "total_size":"Done","downloaded":"","speed":"","eta":"",
        }
        return FileResponse(final, filename="audio.mp3", media_type="audio/mpeg")
    except Exception as e:
        msg = str(e)
        active_downloads[client_id] = {
            "status":"cancelled" if "Cancelled" in msg else "error",
            "percent":0,"total_size":msg,"downloaded":"","speed":"","eta":"",
        }
        raise HTTPException(status_code=500, detail=msg)
    finally:
        cancel_flags.pop(client_id, None)

@app.get("/health")
def health():
    return {"status":"ok","ffmpeg": ffmpeg_dir is not None}

@app.get("/")
def root():
    return {"status":"Rillix is running"}

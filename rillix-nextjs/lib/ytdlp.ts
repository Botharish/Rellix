// yt-dlp driver — spawns the `yt-dlp` binary and parses its output.
//
// This is the Node/Next.js equivalent of the Python backend's yt_dlp.YoutubeDL
// usage. We shell out to the yt-dlp CLI (configurable via YTDLP_PATH) instead of
// importing a Python library.

import { spawn } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { setProgress, registerCancel, clearCancel } from "./progress";

export const YTDLP_PATH = process.env.YTDLP_PATH || "yt-dlp";
// Directory OR full path of the ffmpeg binary. Optional — yt-dlp falls back to
// PATH if unset.
export const FFMPEG_LOCATION = process.env.FFMPEG_LOCATION || "";
export const DOWNLOAD_DIR = process.env.DOWNLOAD_DIR || "downloads";

const DESKTOP_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";
const ANDROID_UA =
  "com.google.android.youtube/19.09.37 (Linux; U; Android 11) gzip";
const TIZEN_UA = "Mozilla/5.0 (SMART-TV; Linux; Tizen 5.0)";
let envCookieFile: string | null = null;

// Sentinel used in --progress-template so we can distinguish our progress lines
// from any other text yt-dlp writes to stdout.
const SENTINEL = "RX@@";
const PROGRESS_TEMPLATE =
  `download:${SENTINEL}` +
  "%(progress._percent_str)s@@" +
  "%(progress._total_bytes_str)s@@" +
  "%(progress._downloaded_bytes_str)s@@" +
  "%(progress._speed_str)s@@" +
  "%(progress._eta_str)s";

export class CancelError extends Error {
  constructor() {
    super("Cancelled");
    this.name = "CancelError";
  }
}

export function isYouTube(url: string): boolean {
  return /(youtube\.com|youtu\.be)/i.test(url);
}

export function cookiesFile(): string | null {
  // Cookies enable age-restricted / private content and, crucially, get past
  // YouTube's "confirm you're not a bot" check from datacenter IPs.
  // Resolution order:
  //   1. YOUTUBE_COOKIES / COOKIES_TXT env var content
  //   2. YOUTUBE_COOKIES_B64 / COOKIES_TXT_B64 base64 content
  //   3. COOKIES_FILE env var (e.g. Render Secret File at /etc/secrets/cookies.txt)
  //   4. cookies.txt in the project root (local dev)
  if (envCookieFile && fs.existsSync(envCookieFile)) return envCookieFile;

  let raw = process.env.YOUTUBE_COOKIES || process.env.COOKIES_TXT || "";
  const rawB64 = process.env.YOUTUBE_COOKIES_B64 || process.env.COOKIES_TXT_B64;
  if (rawB64) {
    try {
      raw = Buffer.from(rawB64, "base64").toString("utf8");
    } catch {
      raw = "";
    }
  }
  if (raw) {
    if (raw.includes("\\n") && !raw.includes("\n")) raw = raw.replace(/\\n/g, "\n");
    const dir = path.resolve(DOWNLOAD_DIR);
    fs.mkdirSync(dir, { recursive: true });
    envCookieFile = path.join(dir, "youtube-cookies.txt");
    fs.writeFileSync(envCookieFile, `${raw.trim()}\n`, "utf8");
    return envCookieFile;
  }

  const candidates = [
    process.env.COOKIES_FILE, // explicit override
    "/etc/secrets/cookies.txt", // Render Secret File (auto-detected)
    path.join(process.cwd(), "cookies.txt"), // local dev / project root
  ];
  for (const c of candidates) {
    if (c && fs.existsSync(c)) return c;
  }
  return null;
}

function baseArgs(): string[] {
  const args = [
    "--no-warnings",
    "--no-check-certificate",
    "--geo-bypass",
    "--ignore-config",
  ];
  if (FFMPEG_LOCATION) args.push("--ffmpeg-location", FFMPEG_LOCATION);
  const ck = cookiesFile();
  if (ck) args.push("--cookies", ck);
  return args;
}

async function ensureDownloadDir(): Promise<string> {
  const dir = path.resolve(DOWNLOAD_DIR);
  await fsp.mkdir(dir, { recursive: true });
  return dir;
}

// ── Info ──────────────────────────────────────────────────────────────────────

interface YtFormat {
  height?: number | null;
  vcodec?: string;
}
interface YtEntry {
  id?: string;
  title?: string;
  thumbnail?: string;
  thumbnails?: { url?: string }[];
  formats?: YtFormat[];
  duration?: number;
}
interface YtInfo extends YtEntry {
  entries?: (YtEntry | null)[];
  extractor_key?: string;
  uploader?: string;
  channel?: string;
}

function runJson(url: string, extra: string[]): Promise<YtInfo> {
  return new Promise((resolve, reject) => {
    const args = [
      ...baseArgs(),
      "--dump-single-json",
      "--no-progress",
      ...extra,
      url,
    ];
    const child = spawn(YTDLP_PATH, args, { windowsHide: true });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d.toString()));
    child.stderr.on("data", (d) => (err += d.toString()));
    child.on("error", (e) =>
      reject(
        new Error(
          e.message.includes("ENOENT")
            ? `yt-dlp not found. Install it and/or set YTDLP_PATH. (${e.message})`
            : e.message
        )
      )
    );
    child.on("close", (code) => {
      if (code === 0) {
        try {
          resolve(JSON.parse(out) as YtInfo);
        } catch {
          reject(new Error("Failed to parse yt-dlp output"));
        }
      } else {
        reject(new Error(cleanErr(err) || `yt-dlp exited with code ${code}`));
      }
    });
  });
}

function bestThumb(e: YtEntry): string {
  return e.thumbnail || e.thumbnails?.[e.thumbnails.length - 1]?.url || "";
}

export interface InfoResult {
  type: "single" | "playlist";
  title: string;
  platform: string;
  thumbnail?: string;
  duration?: string;
  uploader?: string;
  available_heights?: number[];
  count?: number;
  items?: {
    index: number;
    id: string;
    title: string;
    thumbnail: string;
    type: "video" | "image";
    duration: string;
  }[];
}

export function extractYouTubeId(url: string): string | null {
  const m = url.match(
    /(?:v=|youtu\.be\/|embed\/|shorts\/|live\/)([A-Za-z0-9_-]{11})/
  );
  return m ? m[1] : null;
}

function iso8601ToClock(iso: string): string {
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return "";
  const h = parseInt(m[1] || "0", 10);
  const min = parseInt(m[2] || "0", 10);
  const s = parseInt(m[3] || "0", 10);
  const pad = (n: number) => String(n).padStart(2, "0");
  return h ? `${h}:${pad(min)}:${pad(s)}` : `${min}:${pad(s)}`;
}

// Build the preview straight from the YouTube Data API. Reliable even when
// yt-dlp is blocked by the bot check, because the Data API is an official
// Google endpoint. Returns null if no key / not a single video / API error,
// so the caller can fall back to yt-dlp.
async function infoFromYouTubeApi(url: string): Promise<InfoResult | null> {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) return null;
  const id = extractYouTubeId(url);
  if (!id) return null;
  try {
    const api =
      `https://www.googleapis.com/youtube/v3/videos` +
      `?part=snippet,contentDetails&id=${id}&key=${key}`;
    const res = await fetch(api);
    if (!res.ok) return null;
    const data = await res.json();
    const item = data?.items?.[0];
    if (!item) return null;
    const sn = item.snippet || {};
    const th = sn.thumbnails || {};
    const thumb =
      th.maxres?.url || th.high?.url || th.medium?.url || th.default?.url || "";
    return {
      type: "single",
      title: sn.title || "Unknown",
      thumbnail: thumb,
      duration: iso8601ToClock(item.contentDetails?.duration || ""),
      uploader: sn.channelTitle || "",
      platform: "YouTube",
      // The Data API doesn't expose stream resolutions; offer common picks.
      // yt-dlp clamps to the best available <= the chosen height at download.
      available_heights: [1080, 720, 480, 360],
    };
  } catch {
    return null;
  }
}

async function infoFromYouTubePublic(url: string): Promise<InfoResult | null> {
  const id = extractYouTubeId(url);
  if (!id) return null;

  let title = "YouTube video";
  let uploader = "";
  let thumbnail = `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;

  try {
    const oembed =
      `https://www.youtube.com/oembed?format=json&url=` +
      encodeURIComponent(url);
    const res = await fetch(oembed, {
      headers: { "User-Agent": DESKTOP_UA },
    });
    if (res.ok) {
      const data = await res.json();
      title = data?.title || title;
      uploader = data?.author_name || uploader;
      thumbnail = data?.thumbnail_url || thumbnail;
    }
  } catch {
    // Thumbnail + generic metadata are still enough to show the preview controls.
  }

  return {
    type: "single",
    title,
    thumbnail,
    duration: "",
    uploader,
    platform: "YouTube",
    available_heights: [1080, 720, 480, 360],
  };
}

export async function getInfo(url: string): Promise<InfoResult> {
  // Prefer the official Data API for YouTube previews when a key is configured.
  if (isYouTube(url)) {
    const apiInfo = await infoFromYouTubeApi(url);
    if (apiInfo) return apiInfo;
    const publicInfo = await infoFromYouTubePublic(url);
    if (publicInfo) return publicInfo;
  }

  const extra = isYouTube(url)
    ? ["--extractor-args", "youtube:player_client=android", "--user-agent", ANDROID_UA]
    : [];

  let info: YtInfo;
  try {
    info = await runJson(url, extra);
  } catch (e) {
    // Retry without the youtube-specific client hint as a fallback.
    if (isYouTube(url)) info = await runJson(url, []);
    else throw e;
  }

  if (info.entries) {
    const items = (info.entries || [])
      .filter((e): e is YtEntry => !!e)
      .map((e, i) => {
        const fmts = e.formats || [];
        const isV = fmts.some(
          (f) => f.vcodec && f.vcodec !== "none" && f.vcodec !== ""
        );
        const dur = Math.floor(e.duration || 0);
        const m = Math.floor(dur / 60);
        const s = dur % 60;
        return {
          index: i,
          id: e.id || "",
          title: e.title || `Item ${i + 1}`,
          thumbnail: bestThumb(e),
          type: (isV ? "video" : "image") as "video" | "image",
          duration: dur ? `${m}:${String(s).padStart(2, "0")}` : "",
        };
      });
    return {
      type: "playlist",
      title: info.title || "Collection",
      platform: info.extractor_key || "",
      count: items.length,
      items,
    };
  }

  const fmts = info.formats || [];
  const heights = Array.from(
    new Set(
      fmts
        .filter(
          (f) =>
            f.height && f.vcodec && f.vcodec !== "none" && f.vcodec !== ""
        )
        .map((f) => f.height as number)
    )
  ).sort((a, b) => b - a);

  const dur = Math.floor(info.duration || 0);
  const totalM = Math.floor(dur / 60);
  const s = dur % 60;
  const h = Math.floor(totalM / 60);
  const m = totalM % 60;
  const pad = (n: number) => String(n).padStart(2, "0");

  return {
    type: "single",
    title: info.title || "Unknown",
    thumbnail: bestThumb(info),
    duration: dur
      ? h
        ? `${h}:${pad(m)}:${pad(s)}`
        : `${m}:${pad(s)}`
      : "",
    uploader: info.uploader || info.channel || "",
    platform: info.extractor_key || "",
    available_heights: heights.slice(0, 6),
  };
}

// ── Download ────────────────────────────────────────────────────────────────

export interface DownloadOpts {
  url: string;
  clientId: string;
  audio?: boolean;
  quality?: string; // "best" or a height like "720"
  playlistIndex?: number; // 0-based
}

export interface DownloadResult {
  file: string; // absolute path to the produced file
  ext: string; // including leading dot
}

function formatSelector(quality: string): string {
  return quality === "best"
    ? "bestvideo+bestaudio/best"
    : `bestvideo[height<=${quality}]+bestaudio/best[height<=${quality}]/best`;
}

// Per-strategy extra args for the YouTube bot-detection fallback chain.
function youtubeStrategies(): { extra: string[]; ua: string }[] {
  return [
    { extra: [], ua: DESKTOP_UA },
    { extra: ["--extractor-args", "youtube:player_client=tv_embedded"], ua: TIZEN_UA },
    { extra: ["--extractor-args", "youtube:player_client=android"], ua: ANDROID_UA },
  ];
}

function cleanErr(s: string): string {
  // Grab the most relevant ERROR line from yt-dlp's stderr.
  const line = s
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .reverse()
    .find((l) => l.startsWith("ERROR:"));
  return (line || s.trim()).slice(0, 400);
}

function youtubeCookieError(): string {
  return (
    "YouTube is asking this server to confirm it is not a bot. " +
    "Add YouTube cookies on Render using COOKIES_FILE, YOUTUBE_COOKIES, " +
    "or YOUTUBE_COOKIES_B64, then redeploy."
  );
}

function isYoutubeCookieError(e: unknown): boolean {
  const msg = String(e instanceof Error ? e.message : e).toLowerCase();
  return (
    msg.includes("confirm you") ||
    msg.includes("not a bot") ||
    (msg.includes("sign in") && msg.includes("cookies"))
  );
}

function runOnce(
  args: string[],
  clientId: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(YTDLP_PATH, args, { windowsHide: true });
    let cancelled = false;
    let err = "";

    registerCancel(clientId, () => {
      cancelled = true;
      child.kill("SIGKILL");
    });

    const handleLine = (raw: string) => {
      const line = raw.trim();
      if (!line) return;
      if (line.startsWith(SENTINEL)) {
        const parts = line.slice(SENTINEL.length).split("@@");
        const [pctStr, total, downloaded, speed, eta] = parts.map((p) =>
          p.trim()
        );
        const pct = parseFloat(pctStr.replace("%", ""));
        setProgress(clientId, {
          status: "downloading",
          percent: Number.isFinite(pct) ? Math.round(pct * 10) / 10 : 0,
          total_size: total && total !== "NA" ? total : "Unknown",
          downloaded: downloaded && downloaded !== "NA" ? downloaded : "",
          speed: speed && speed !== "NA" ? speed : "—",
          eta: eta && eta !== "NA" ? eta : "—",
        });
      } else if (
        /\[Merger\]|Merging formats|\[ExtractAudio\]|\[VideoConvertor\]/.test(
          line
        )
      ) {
        setProgress(clientId, {
          status: "processing",
          percent: 100,
          total_size: "Merging…",
          downloaded: "",
          speed: "",
          eta: "",
        });
      }
    };

    let stdoutBuf = "";
    child.stdout.on("data", (d) => {
      stdoutBuf += d.toString();
      const lines = stdoutBuf.split(/\r|\n/);
      stdoutBuf = lines.pop() || "";
      lines.forEach(handleLine);
    });
    child.stderr.on("data", (d) => {
      const text = d.toString();
      err += text;
      text.split(/\r|\n/).forEach(handleLine);
    });

    child.on("error", (e) => {
      if (cancelled) return reject(new CancelError());
      reject(
        new Error(
          e.message.includes("ENOENT")
            ? `yt-dlp not found. Install it and/or set YTDLP_PATH.`
            : e.message
        )
      );
    });
    child.on("close", (code) => {
      if (cancelled) return reject(new CancelError());
      if (code === 0) resolve();
      else reject(new Error(cleanErr(err) || `yt-dlp exited with code ${code}`));
    });
  });
}

export async function download(opts: DownloadOpts): Promise<DownloadResult> {
  const dir = await ensureDownloadDir();
  const uid = cryptoRandom();
  const outTemplate = path.join(dir, `${uid}.%(ext)s`);

  const commonArgs: string[] = [
    ...baseArgs(),
    "-o",
    outTemplate,
    "--retries",
    "10",
    "--fragment-retries",
    "10",
    "--newline",
    "--progress-template",
    PROGRESS_TEMPLATE,
  ];

  if (opts.audio) {
    commonArgs.push(
      "-f",
      "bestaudio/best",
      "-x",
      "--audio-format",
      "mp3",
      "--audio-quality",
      "192K"
    );
  } else {
    commonArgs.push("-f", formatSelector(opts.quality || "best"), "--merge-output-format", "mp4");
  }

  if (opts.playlistIndex !== undefined) {
    commonArgs.push("--playlist-items", String(opts.playlistIndex + 1));
  }

  setProgress(opts.clientId, {
    status: "starting",
    percent: 0,
    total_size: "Calculating…",
    downloaded: "0 B",
    speed: "",
    eta: "",
  });

  try {
    if (isYouTube(opts.url)) {
      let lastErr: Error | null = null;
      for (const strat of youtubeStrategies()) {
        try {
          await runOnce(
            [...commonArgs, ...strat.extra, "--user-agent", strat.ua, opts.url],
            opts.clientId
          );
          lastErr = null;
          break;
        } catch (e) {
          if (e instanceof CancelError) throw e;
          lastErr = e as Error;
          // try next strategy
        }
      }
      if (lastErr) {
        throw new Error(
          isYoutubeCookieError(lastErr)
            ? youtubeCookieError()
            : lastErr.message
        );
      }
    } else {
      await runOnce(
        [...commonArgs, "--user-agent", DESKTOP_UA, opts.url],
        opts.clientId
      );
    }
  } finally {
    clearCancel(opts.clientId);
  }

  const matches = await findFiles(dir, uid + ".");
  if (matches.length === 0) {
    throw new Error("File not found after download");
  }
  const file = matches[0];
  return { file, ext: path.extname(file) };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function findFiles(dir: string, prefix: string): Promise<string[]> {
  const names = await fsp.readdir(dir);
  return names
    .filter((n) => n.startsWith(prefix))
    .map((n) => path.join(dir, n));
}

function cryptoRandom(): string {
  // 32 hex chars, like Python's uuid4().hex
  return Array.from({ length: 32 }, () =>
    Math.floor(Math.random() * 16).toString(16)
  ).join("");
}

// ── Cleanup old downloads (runs once per server process) ─────────────────────

declare global {
  // eslint-disable-next-line no-var
  var __rillixCleanup: NodeJS.Timeout | undefined;
}

if (!globalThis.__rillixCleanup) {
  globalThis.__rillixCleanup = setInterval(async () => {
    try {
      const dir = path.resolve(DOWNLOAD_DIR);
      const now = Date.now();
      for (const name of await fsp.readdir(dir)) {
        const fp = path.join(dir, name);
        const st = await fsp.stat(fp).catch(() => null);
        if (st?.isFile() && now - st.mtimeMs > 3600_000) {
          await fsp.unlink(fp).catch(() => {});
        }
      }
    } catch {
      /* dir may not exist yet */
    }
  }, 3600_000);
  // Don't keep the event loop alive just for cleanup.
  globalThis.__rillixCleanup.unref?.();
}

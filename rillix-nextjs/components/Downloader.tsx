"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// ── Types (mirror lib/ytdlp.ts InfoResult / progress.ts ProgressState) ────────
interface PlaylistItem {
  index: number;
  id: string;
  title: string;
  thumbnail: string;
  type: "video" | "image";
  duration: string;
}
interface InfoResult {
  type: "single" | "playlist";
  title: string;
  platform: string;
  thumbnail?: string;
  duration?: string;
  uploader?: string;
  available_heights?: number[];
  count?: number;
  items?: PlaylistItem[];
}
interface ProgressState {
  status: string;
  percent: number;
  total_size: string;
  downloaded: string;
  speed: string;
  eta: string;
}
interface ProgUI {
  percent: number;
  label: string;
  size: string;
  dl: string;
  speed: string;
  eta: string;
}
interface StatusMsg {
  msg: string;
  type: "info" | "success" | "error";
}

const PLATFORMS = [
  "YouTube",
  "TikTok",
  "Instagram",
  "X / Twitter",
  "Pinterest",
  "Reddit",
  "Vimeo",
  "Facebook",
  "1000+ more",
];

const emptyProg = (): ProgUI => ({
  percent: 0,
  label: "Downloading…",
  size: "—",
  dl: "—",
  speed: "—",
  eta: "—",
});

const enc = encodeURIComponent;

// When the UI is hosted separately from the engine (e.g. page on Vercel,
// yt-dlp engine on Railway/Render), point this at the engine's origin, e.g.
// NEXT_PUBLIC_API_BASE=https://rillix-engine.up.railway.app
// Leave empty for an all-in-one deploy (same origin).
const API_BASE = (process.env.NEXT_PUBLIC_API_BASE || "").replace(/\/$/, "");

function DownloadIcon() {
  return (
    <svg
      width="15"
      height="15"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth="2.5"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5 5-5M12 4v11"
      />
    </svg>
  );
}

export default function Downloader() {
  const [url, setUrl] = useState("");
  const [fetching, setFetching] = useState(false);
  const [status, setStatus] = useState<StatusMsg | null>(null);
  const [result, setResult] = useState<InfoResult | null>(null);

  // single
  const [fmt, setFmt] = useState<"video" | "audio">("video");
  const [quality, setQuality] = useState("best");
  const [prog, setProg] = useState<ProgUI | null>(null);
  const [downloading, setDownloading] = useState(false);

  // playlist
  const [fmtP, setFmtP] = useState<"video" | "audio">("video");
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [progP, setProgP] = useState<ProgUI | null>(null);
  const [dlP, setDlP] = useState(false);

  const esRef = useRef<EventSource | null>(null);
  const clientIdRef = useRef<string | null>(null);
  const cancelledPRef = useRef(false);
  const fetchedUrlRef = useRef("");

  // ── SSE ──────────────────────────────────────────────────────────────────
  const closeSSE = useCallback(() => {
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }
  }, []);

  const startSSE = useCallback(
    (cid: string, setter: React.Dispatch<React.SetStateAction<ProgUI | null>>) => {
      closeSSE();
      const es = new EventSource(`${API_BASE}/api/progress/${cid}`);
      esRef.current = es;
      es.onmessage = (e) => {
        try {
          const d: ProgressState = JSON.parse(e.data);
          setter((prev) => {
            const base = prev ?? emptyProg();
            return {
              percent:
                typeof d.percent === "number" ? d.percent : base.percent,
              label: d.status === "processing" ? "Merging…" : "Downloading…",
              size: d.total_size || base.size,
              dl: d.downloaded || base.dl,
              speed: d.speed || base.speed,
              eta: d.eta || base.eta,
            };
          });
        } catch {
          /* ignore malformed frame */
        }
      };
      es.onerror = () => {
        /* stream closes when the download finishes; nothing to do */
      };
    },
    [closeSSE]
  );

  useEffect(() => () => closeSSE(), [closeSSE]);

  // Keep-alive: ping the engine every 4 min while this tab is open, so a free
  // host (e.g. Render) doesn't sleep mid-session. Harmless when same-origin.
  useEffect(() => {
    const id = setInterval(() => {
      fetch(`${API_BASE}/api/health`).catch(() => {});
    }, 4 * 60 * 1000);
    return () => clearInterval(id);
  }, []);

  // ── Save blob ──────────────────────────────────────────────────────────────
  const save = useCallback(async (res: Response, fallback: string) => {
    const blob = await res.blob();
    const cd = res.headers.get("content-disposition") || "";
    const m = cd.match(/filename="?(.+?)"?(?:;|$)/i);
    const name = m ? m[1] : fallback;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(a.href);
  }, []);

  // ── Fetch info ─────────────────────────────────────────────────────────────
  const fetchInfo = useCallback(async () => {
    const u = url.trim();
    if (!u) {
      setStatus({ msg: "Paste a URL first.", type: "error" });
      return;
    }
    setFetching(true);
    setStatus(null);
    setResult(null);
    try {
      const res = await fetch(`${API_BASE}/api/info?url=${enc(u)}`);
      const d = await res.json();
      if (!res.ok) throw new Error(d.detail || "Error");
      fetchedUrlRef.current = u;
      setResult(d as InfoResult);
      if (d.type === "playlist") {
        setSel(new Set((d.items || []).map((_: PlaylistItem, i: number) => i)));
        setFmtP("video");
        setProgP(null);
      } else {
        setFmt("video");
        setQuality("best");
        setProg(null);
      }
    } catch (e) {
      setStatus({ msg: "⚠ " + (e as Error).message, type: "error" });
    } finally {
      setFetching(false);
    }
  }, [url]);

  // ── Single download ────────────────────────────────────────────────────────
  const doDownload = useCallback(async () => {
    const u = fetchedUrlRef.current || url.trim();
    setDownloading(true);
    setProg({ ...emptyProg(), label: "Starting…" });
    setStatus(null);

    const cid = "rx_" + Date.now();
    clientIdRef.current = cid;
    startSSE(cid, setProg);

    const isAudio = fmt === "audio";
    const ep = isAudio
      ? `${API_BASE}/api/download-audio?url=${enc(u)}&client_id=${cid}`
      : `${API_BASE}/api/download?url=${enc(u)}&client_id=${cid}&quality=${quality}`;

    try {
      const res = await fetch(ep);
      closeSSE();
      if (!res.ok) {
        const e = await res.json();
        throw new Error(e.detail || "Error");
      }
      await save(res, isAudio ? "audio.mp3" : "video.mp4");
      setProg((p) => ({ ...(p ?? emptyProg()), percent: 100, label: "Complete!" }));
      setStatus({ msg: "✓ Download complete!", type: "success" });
    } catch (e) {
      closeSSE();
      const msg = (e as Error).message;
      if (!msg.toLowerCase().includes("cancel"))
        setStatus({ msg: "⚠ " + msg, type: "error" });
    } finally {
      setDownloading(false);
    }
  }, [url, fmt, quality, startSSE, closeSSE, save]);

  const doCancel = useCallback(async () => {
    const cid = clientIdRef.current;
    if (!cid) return;
    try {
      await fetch(`${API_BASE}/api/cancel/${cid}`, { method: "POST" });
    } catch {
      /* ignore */
    }
    closeSSE();
    setProg(null);
    setStatus({ msg: "Download cancelled.", type: "error" });
    setDownloading(false);
  }, [closeSSE]);

  // ── Playlist ───────────────────────────────────────────────────────────────
  const togglePick = useCallback((i: number) => {
    setSel((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }, []);
  const selAll = useCallback(() => {
    setSel(new Set((result?.items || []).map((_, i) => i)));
  }, [result]);
  const selNone = useCallback(() => setSel(new Set()), []);

  const doPlaylistDl = useCallback(async () => {
    const indices = [...sel].sort((a, b) => a - b);
    if (!indices.length) return;
    const items = result?.items || [];
    const pUrl = fetchedUrlRef.current;
    cancelledPRef.current = false;
    setDlP(true);
    setProgP(emptyProg());
    const isAudio = fmtP === "audio";
    let done = 0;

    for (const idx of indices) {
      if (cancelledPRef.current) break;
      const item = items[idx];
      setProgP({
        ...emptyProg(),
        label: `${done + 1}/${indices.length}: ${item?.title || "Item"}`,
      });

      const cid = "rx_" + Date.now() + "_" + idx;
      clientIdRef.current = cid;
      startSSE(cid, setProgP);

      const ep = isAudio
        ? `${API_BASE}/api/download-audio?url=${enc(pUrl)}&client_id=${cid}&index=${idx}`
        : `${API_BASE}/api/download?url=${enc(pUrl)}&client_id=${cid}&quality=best&index=${idx}`;
      try {
        const res = await fetch(ep);
        closeSSE();
        if (!res.ok) {
          const e = await res.json();
          throw new Error(e.detail || "Error");
        }
        await save(res, (item?.title || "item_" + idx) + (isAudio ? ".mp3" : ".mp4"));
        done++;
      } catch (e) {
        closeSSE();
        const msg = (e as Error).message;
        if (msg.toLowerCase().includes("cancel")) {
          cancelledPRef.current = true;
          break;
        }
        setStatus({ msg: `⚠ Item ${idx + 1} failed: ${msg}`, type: "error" });
      }
    }

    setProgP((p) => ({
      ...(p ?? emptyProg()),
      percent: 100,
      label: `Done — ${done}/${indices.length}`,
    }));
    if (done > 0)
      setStatus({
        msg: `✓ ${done} file${done > 1 ? "s" : ""} downloaded!`,
        type: "success",
      });
    setDlP(false);
  }, [sel, result, fmtP, startSSE, closeSSE, save]);

  const doCancelP = useCallback(() => {
    cancelledPRef.current = true;
    const cid = clientIdRef.current;
    if (cid) fetch(`${API_BASE}/api/cancel/${cid}`, { method: "POST" }).catch(() => {});
    closeSSE();
    setStatus({ msg: "Cancelled.", type: "error" });
    setDlP(false);
  }, [closeSSE]);

  // ── Render ────────────────────────────────────────────────────────────────
  const heights = result?.available_heights || [];
  const showPanel = !!result || !!status;

  return (
    <div className="page">
      <div className="hero">
        <div className="wordmark">Rillix</div>
        <p className="tagline">Download any video from anywhere</p>
      </div>

      <div className="input-stage">
        <div className="input-card">
          <input
            className="url-input"
            type="text"
            placeholder="Paste any video link…"
            autoComplete="off"
            spellCheck={false}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") fetchInfo();
            }}
          />
          <button
            className="btn-fetch"
            disabled={fetching}
            onClick={fetchInfo}
          >
            {fetching ? <span className="spin" /> : "Fetch"}
          </button>
        </div>

        <div className="platforms">
          {PLATFORMS.map((p) => (
            <span className="chip" key={p}>
              {p}
            </span>
          ))}
        </div>
      </div>

      {showPanel && (
        <div className="result-panel">
          {result?.type === "single" && (
            <div className="panel-card">
              <div className="preview-row">
                <div className="thumb-wrap">
                  {result.thumbnail ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={result.thumbnail} alt="" />
                  ) : (
                    <div className="thumb-ph">
                      <svg
                        width="20"
                        height="20"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="#222"
                        strokeWidth="1.5"
                      >
                        <path
                          strokeLinecap="round"
                          d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M3 8a2 2 0 012-2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z"
                        />
                      </svg>
                    </div>
                  )}
                </div>
                <div className="meta">
                  <div className="vid-title">{result.title || "Unknown"}</div>
                  <div className="tags">
                    {result.platform && (
                      <span className="tag">{result.platform}</span>
                    )}
                    {result.duration && (
                      <span className="tag">{result.duration}</span>
                    )}
                    {result.uploader && (
                      <span className="tag">{result.uploader}</span>
                    )}
                  </div>
                </div>
              </div>

              <div className="controls">
                <div className="fmt-row">
                  <button
                    className={`fmt-tab${fmt === "video" ? " active" : ""}`}
                    onClick={() => setFmt("video")}
                  >
                    🎬 Video
                  </button>
                  <button
                    className={`fmt-tab${fmt === "audio" ? " active" : ""}`}
                    onClick={() => setFmt("audio")}
                  >
                    🎵 Audio MP3
                  </button>
                </div>

                {fmt === "video" && (
                  <div>
                    <div className="q-label">Quality</div>
                    <div className="q-row">
                      <button
                        className={`q-chip best${
                          quality === "best" ? " active" : ""
                        }`}
                        onClick={() => setQuality("best")}
                      >
                        ✦ Best
                      </button>
                      {heights.map((h) => (
                        <button
                          key={h}
                          className={`q-chip${
                            quality === String(h) ? " active" : ""
                          }`}
                          onClick={() => setQuality(String(h))}
                        >
                          {h}p
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <button
                  className="btn-dl"
                  disabled={downloading}
                  onClick={doDownload}
                >
                  {downloading ? (
                    <>
                      <span className="spin" /> Starting…
                    </>
                  ) : (
                    <>
                      <DownloadIcon /> Download
                    </>
                  )}
                </button>
              </div>

              {prog && (
                <div className="prog-wrap">
                  <div className="prog-top">
                    <span className="prog-lbl">{prog.label}</span>
                    <span className="prog-pct">{prog.percent}%</span>
                  </div>
                  <div className="bar-bg">
                    <div
                      className="bar-fg"
                      style={{ width: `${prog.percent}%` }}
                    />
                  </div>
                  <div className="stat-row">
                    <div className="stat">
                      <span className="sl">Size</span>
                      <span className="sv">{prog.size}</span>
                    </div>
                    <div className="stat">
                      <span className="sl">Done</span>
                      <span className="sv">{prog.dl}</span>
                    </div>
                    <div className="stat">
                      <span className="sl">Speed</span>
                      <span className="sv">{prog.speed}</span>
                    </div>
                    <div className="stat">
                      <span className="sl">ETA</span>
                      <span className="sv">{prog.eta}</span>
                    </div>
                  </div>
                  {downloading && (
                    <div className="cancel-row">
                      <button className="btn-cancel" onClick={doCancel}>
                        Cancel
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {result?.type === "playlist" && (
            <div className="panel-card">
              <div className="picker-hdr">
                <span className="picker-title">
                  {result.title || "Select items"}
                </span>
                <span className="picker-sub">
                  {result.count} items · {result.platform}
                </span>
              </div>
              <div className="picker-grid">
                {(result.items || []).map((item, i) => (
                  <div
                    key={i}
                    className={`pick-item${sel.has(i) ? " sel" : ""}`}
                    onClick={() => togglePick(i)}
                  >
                    {item.thumbnail ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        className="pick-img"
                        src={item.thumbnail}
                        alt=""
                        loading="lazy"
                      />
                    ) : (
                      <div className="pick-ph">
                        <svg
                          width="16"
                          height="16"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="#222"
                          strokeWidth="1.5"
                        >
                          <rect x="3" y="3" width="18" height="18" rx="2" />
                        </svg>
                      </div>
                    )}
                    <span
                      className={`pick-type ${item.type === "video" ? "v" : "i"}`}
                    >
                      {item.type === "video" ? "VID" : "IMG"}
                    </span>
                    <span className="chk">
                      <svg
                        viewBox="0 0 12 12"
                        fill="none"
                        stroke="white"
                        strokeWidth="2.5"
                        width="10"
                        height="10"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M2 6l3 3 5-5"
                        />
                      </svg>
                    </span>
                    <div className="pick-name">
                      {item.title || "Item " + (i + 1)}
                    </div>
                  </div>
                ))}
              </div>
              <div className="picker-footer">
                <div className="sel-btns">
                  <button className="sel-btn" onClick={selAll}>
                    All
                  </button>
                  <button className="sel-btn" onClick={selNone}>
                    None
                  </button>
                </div>
                <span className="sel-count">
                  {sel.size} of {result.items?.length || 0} selected
                </span>
              </div>
              <div
                className="controls"
                style={{ borderTop: "1px solid var(--border)" }}
              >
                <div className="fmt-row">
                  <button
                    className={`fmt-tab${fmtP === "video" ? " active" : ""}`}
                    onClick={() => setFmtP("video")}
                  >
                    🎬 Video
                  </button>
                  <button
                    className={`fmt-tab${fmtP === "audio" ? " active" : ""}`}
                    onClick={() => setFmtP("audio")}
                  >
                    🎵 Audio MP3
                  </button>
                </div>
                <button
                  className="btn-dl"
                  disabled={dlP || sel.size === 0}
                  onClick={doPlaylistDl}
                >
                  {dlP ? (
                    <>
                      <span className="spin" /> Downloading…
                    </>
                  ) : (
                    <>
                      <DownloadIcon /> Download Selected
                    </>
                  )}
                </button>

                {progP && (
                  <div style={{ marginTop: 14 }}>
                    <div className="prog-top">
                      <span className="prog-lbl">{progP.label}</span>
                      <span className="prog-pct">{progP.percent}%</span>
                    </div>
                    <div className="bar-bg">
                      <div
                        className="bar-fg"
                        style={{ width: `${progP.percent}%` }}
                      />
                    </div>
                    <div className="stat-row" style={{ marginTop: 8 }}>
                      <div className="stat">
                        <span className="sl">Size</span>
                        <span className="sv">{progP.size}</span>
                      </div>
                      <div className="stat">
                        <span className="sl">Done</span>
                        <span className="sv">{progP.dl}</span>
                      </div>
                      <div className="stat">
                        <span className="sl">Speed</span>
                        <span className="sv">{progP.speed}</span>
                      </div>
                      <div className="stat">
                        <span className="sl">ETA</span>
                        <span className="sv">{progP.eta}</span>
                      </div>
                    </div>
                    {dlP && (
                      <div className="cancel-row">
                        <button className="btn-cancel" onClick={doCancelP}>
                          Cancel
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {status && (
            <div className={`status ${status.type}`}>{status.msg}</div>
          )}
        </div>
      )}
    </div>
  );
}

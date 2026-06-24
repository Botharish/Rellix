# Bugs fixed & behavior changes

These are the issues found in the original FastAPI + HTML version and how the
Next.js port addresses them.

## Correctness / reliability bugs

1. **Blocking network I/O on the request path.**
   `get_invidious_url()` did up to 5 sequential `urllib.request.urlopen(...)`
   calls with a 5s timeout each — up to ~25s of **synchronous** blocking inside
   the `/info` and YouTube `/download` handlers, stalling the server.
   → Removed the Invidious probing entirely; YouTube now relies on yt-dlp's
   own multi-client fallback (`android` → `tv_embedded` → `web`).

2. **Dead/unreliable Invidious proxies.** The hard-coded public Invidious
   instances are frequently down or rate-limited, so the "fast path" usually
   failed and fell through anyway.
   → Dropped in favor of the client-fallback chain above.

3. **Android player client applied to *every* platform in `/info`.**
   The metadata call always sent `player_client=android` + a YouTube app
   User-Agent, even for TikTok/Instagram/etc., which can break those extractors.
   → The YouTube-specific hint is now only sent for YouTube URLs.

4. **Hard-coded backend URL in the frontend.**
   `const BACKEND = "http://127.0.0.1:8000"` meant the static page only worked
   against a local backend and depended on permissive CORS in production.
   → The UI now calls same-origin `/api/*` routes. No CORS, no editing a URL
   before deploy.

5. **`Content-Disposition` header could be corrupted by non-ASCII filenames.**
   Playlist items were saved with `filename=<item.title>.mp4`; titles containing
   non-latin characters, quotes, or newlines produce an invalid HTTP header.
   → Filenames are sanitized to ASCII with an RFC 5987 `filename*=UTF-8''…`
   companion for correct Unicode names.

6. **Frontend filename parsing broke with the new header.**
   The original `save()` regex `/filename="?(.+?)"?$/i` would mis-parse a header
   that also contains `filename*=…`.
   → Updated to `/filename="?(.+?)"?(?:;|$)/i`.

7. **Possible HTML injection / breakage from titles.**
   The vanilla JS built the playlist grid with `innerHTML` and interpolated
   `item.title` directly. A title containing markup would break the DOM (or
   worse).
   → React escapes all interpolated text by default.

8. **Stale progress between playlist items.**
   `resetProg()` only ever reset the *single-video* stat fields and was never
   called for the playlist, so size/speed/ETA from item N lingered on screen
   until item N+1's first progress frame arrived.
   → Each item resets its progress UI to a clean state before starting.

9. **Temp files lingered after a successful download.**
   Files were only removed by the hourly cleanup loop, so every download sat on
   disk for up to an hour.
   → The temp file is deleted as soon as the response stream closes; the hourly
   sweep is kept as a safety net.

10. **Cancellation was best-effort via a progress-hook exception.**
    → Cancelling now kills the yt-dlp child process directly, which reliably
    stops the work and frees the slot.

## Operational / safety changes

11. **Removed runtime `pip install --upgrade yt-dlp` on every boot.**
    Running a package install at startup is slow, requires network + a writable
    environment, and is a supply-chain/timing risk. The Docker image installs
    the latest yt-dlp at **build** time instead.

12. **Mutable default arguments** (`make_opts(..., extra={})`,
    `download_url(..., extra_opts={})`) — a classic Python footgun — are simply
    absent in the TypeScript port (options are built fresh per call).

## Known limitation (unchanged by design)

- The progress/cancel store is **in-memory per process**, exactly like the
  original's module-level dicts. Deploy as a single long-running Node server
  (`next start` / Docker), not on stateless serverless. See README.
- The SSE stream self-terminates after ~10 minutes (1500 × 400ms), matching the
  original's bound.

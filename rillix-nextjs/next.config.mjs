// Allow the UI (possibly hosted on a different origin, e.g. Vercel) to call the
// engine's API. Set ALLOWED_ORIGIN to your UI's URL in production; defaults to
// "*" to mirror the original FastAPI CORS config.
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "*";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // yt-dlp / ffmpeg are spawned as external binaries from the API routes,
  // so nothing extra needs bundling here.
  async headers() {
    return [
      {
        source: "/api/:path*",
        headers: [
          { key: "Access-Control-Allow-Origin", value: ALLOWED_ORIGIN },
          { key: "Access-Control-Allow-Methods", value: "GET, POST, OPTIONS" },
          { key: "Access-Control-Allow-Headers", value: "Content-Type" },
        ],
      },
    ];
  },
};

export default nextConfig;

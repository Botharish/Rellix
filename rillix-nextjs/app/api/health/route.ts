import { NextResponse } from "next/server";
import { spawn } from "node:child_process";
import { YTDLP_PATH } from "@/lib/ytdlp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function ytdlpVersion(): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      const child = spawn(YTDLP_PATH, ["--version"], { windowsHide: true });
      let out = "";
      child.stdout.on("data", (d) => (out += d.toString()));
      child.on("error", () => resolve(null));
      child.on("close", (code) => resolve(code === 0 ? out.trim() : null));
    } catch {
      resolve(null);
    }
  });
}

export async function GET() {
  const version = await ytdlpVersion();
  return NextResponse.json({
    status: "ok",
    ytdlp: version !== null,
    ytdlp_version: version,
  });
}

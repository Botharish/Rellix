import { NextRequest, NextResponse } from "next/server";
import { download, CancelError } from "@/lib/ytdlp";
import { setProgress, clearCancel } from "@/lib/progress";
import { fileResponse } from "@/lib/fileResponse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function cookiesFromBody(req: NextRequest): Promise<string | undefined> {
  try {
    const body = await req.json();
    return typeof body?.cookies === "string" ? body.cookies : undefined;
  } catch {
    return undefined;
  }
}

async function handleDownload(req: NextRequest, cookiesText?: string) {
  const sp = req.nextUrl.searchParams;
  const url = sp.get("url");
  const clientId = sp.get("client_id");
  const indexRaw = sp.get("index");

  if (!url || !clientId) {
    return NextResponse.json(
      { detail: "Missing url or client_id" },
      { status: 400 }
    );
  }

  try {
    const { file } = await download({
      url,
      clientId,
      audio: true,
      playlistIndex: indexRaw !== null ? parseInt(indexRaw, 10) : undefined,
      cookiesText,
    });

    setProgress(clientId, {
      status: "complete",
      percent: 100,
      total_size: "Done",
      downloaded: "",
      speed: "",
      eta: "",
    });

    return await fileResponse(file, "audio.mp3", "audio/mpeg");
  } catch (e) {
    const cancelled = e instanceof CancelError;
    const msg = cancelled ? "Cancelled" : (e as Error).message;
    setProgress(clientId, {
      status: cancelled ? "cancelled" : "error",
      percent: 0,
      total_size: msg,
      downloaded: "",
      speed: "",
      eta: "",
    });
    return NextResponse.json({ detail: msg }, { status: 500 });
  } finally {
    clearCancel(clientId);
  }
}

export async function GET(req: NextRequest) {
  return handleDownload(req);
}

export async function POST(req: NextRequest) {
  return handleDownload(req, await cookiesFromBody(req));
}

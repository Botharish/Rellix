import { NextRequest, NextResponse } from "next/server";
import { getInfo } from "@/lib/ytdlp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url");
  if (!url) {
    return NextResponse.json({ detail: "Missing url" }, { status: 400 });
  }
  try {
    const info = await getInfo(url);
    return NextResponse.json(info);
  } catch (e) {
    return NextResponse.json(
      { detail: (e as Error).message },
      { status: 400 }
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import { cancel } from "@/lib/progress";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _req: NextRequest,
  { params }: { params: { clientId: string } }
) {
  cancel(params.clientId);
  return NextResponse.json({ ok: true });
}

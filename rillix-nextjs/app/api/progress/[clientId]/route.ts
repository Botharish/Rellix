import { NextRequest } from "next/server";
import { getProgress, isTerminal } from "@/lib/progress";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Server-Sent Events stream of download progress, mirroring the FastAPI
// /progress/{client_id} endpoint.
export async function GET(
  _req: NextRequest,
  { params }: { params: { clientId: string } }
) {
  const { clientId } = params;
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const send = (obj: unknown) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));

      for (let i = 0; i < 1500 && !closed; i++) {
        const data = getProgress(clientId);
        if (data) {
          try {
            send(data);
          } catch {
            break;
          }
          if (isTerminal(data.status)) break;
        }
        await new Promise((r) => setTimeout(r, 400));
      }
      try {
        controller.close();
      } catch {
        /* already closed */
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

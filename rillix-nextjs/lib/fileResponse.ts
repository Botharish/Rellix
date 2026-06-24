import fs from "node:fs";
import fsp from "node:fs/promises";
import { Readable } from "node:stream";

/**
 * Stream a file back to the client (equivalent to FastAPI's FileResponse),
 * then delete it once the response has been fully sent.
 */
export async function fileResponse(
  filePath: string,
  downloadName: string,
  contentType: string
): Promise<Response> {
  const stat = await fsp.stat(filePath);
  const nodeStream = fs.createReadStream(filePath);

  const cleanup = () => {
    fsp.unlink(filePath).catch(() => {});
  };
  nodeStream.on("close", cleanup);
  nodeStream.on("error", cleanup);

  const webStream = Readable.toWeb(nodeStream) as unknown as ReadableStream;

  // RFC 5987 encoding for non-ASCII filenames + an ASCII fallback.
  const asciiName = downloadName.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "");
  const encoded = encodeURIComponent(downloadName);

  return new Response(webStream, {
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(stat.size),
      "Content-Disposition": `attachment; filename="${asciiName}"; filename*=UTF-8''${encoded}`,
      "Cache-Control": "no-store",
    },
  });
}

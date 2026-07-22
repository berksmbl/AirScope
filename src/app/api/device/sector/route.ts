import { NextRequest, NextResponse } from "next/server";
import { getSectorStatus } from "@/lib/mikrotik";

export const runtime = "nodejs";

interface SectorBody {
  host: string;
  user: string;
  password?: string;
  port?: number;
  iface: string;
}

/**
 * Live sector health as an SSE feed (over a POST body so credentials never
 * touch the URL): active-channel status (`monitor once`) plus the
 * registration table, pushed every 2 s until the client disconnects.
 *
 * Both are plain reads that never take the radio off its service channel,
 * so this runs whenever a device is connected — scanning or not.
 * Each event is `data: <json>` with `{ sector }` or `{ error }`.
 */
export async function POST(req: NextRequest) {
  let body: SectorBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { host, user, password, port, iface } = body;
  if (!host || !user || !iface) {
    return NextResponse.json(
      { error: "host, user and iface are required" },
      { status: 400 }
    );
  }

  const creds = { host, user, password: password ?? "", port };
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      let timer: ReturnType<typeof setInterval> | null = null;
      let inFlight = false;

      const close = () => {
        if (closed) return;
        closed = true;
        if (timer) clearInterval(timer);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };
      req.signal.addEventListener("abort", close);

      const send = (obj: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
        } catch {
          close();
        }
      };

      const tick = async () => {
        if (closed || inFlight) return;
        inFlight = true;
        try {
          send({ sector: await getSectorStatus(creds, iface) });
        } catch (err) {
          send({
            error: err instanceof Error ? err.message : "Sector status failed",
          });
        } finally {
          inFlight = false;
        }
      };

      await tick();
      timer = setInterval(() => void tick(), 2000);
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

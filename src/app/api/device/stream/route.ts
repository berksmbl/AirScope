import { NextRequest, NextResponse } from "next/server";
import {
  getScanSnapshot,
  getUsageSnapshot,
  stopScanMonitors,
  stopUsageMonitors,
} from "@/lib/mikrotik";
import type { ScanMode } from "@/lib/types";

export const runtime = "nodejs";

interface StreamBody {
  host: string;
  user: string;
  password?: string;
  port?: number;
  iface: string;
  wifiKind: "wireless" | "wifi";
  mode: ScanMode;
}

const friendly = (message: string): string =>
  message.includes("other tool")
    ? "Radio is busy — close Winbox Scanner/Freq. Usage on this interface, or wait a moment"
    : message;

/**
 * Live data feed (SSE over a POST body so credentials never touch the URL).
 * The server already runs the RouterOS tools as continuous streams; this
 * endpoint pushes their accumulated state to the client once a second
 * until the client disconnects. Each event is `data: <json>\n\n` with
 * `{ type: "networks" | "usage" | "error", ... }`.
 */
export async function POST(req: NextRequest) {
  let body: StreamBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { host, user, password, port, iface, wifiKind, mode } = body;
  if (!host || !user || !iface || !wifiKind) {
    return NextResponse.json(
      { error: "host, user, iface and wifiKind are required" },
      { status: 400 }
    );
  }
  if (mode === "usage" && wifiKind !== "wireless") {
    return NextResponse.json(
      { error: "Frequency usage requires the legacy wireless package (RouterOS v6)" },
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
          if (mode === "usage") {
            const snap = await getUsageSnapshot(creds, iface);
            send({
              type: "usage",
              usage: snap.points,
              monitoringFor: snap.monitoringFor,
              error: snap.error ? friendly(snap.error) : null,
            });
          } else {
            const snap = await getScanSnapshot(creds, iface, wifiKind);
            send({
              type: "networks",
              networks: snap.networks,
              monitoringFor: snap.monitoringFor,
              error: snap.error ? friendly(snap.error) : null,
            });
          }
        } catch (err) {
          send({
            type: "error",
            error: friendly(err instanceof Error ? err.message : "Scan failed"),
          });
        } finally {
          inFlight = false;
        }
      };

      try {
        // the two RouterOS tools cannot share the radio — entering one mode
        // stops the other's monitors across all interfaces of this host
        const stopped =
          mode === "usage" ? await stopScanMonitors(creds) : await stopUsageMonitors(creds);
        if (stopped) await new Promise((r) => setTimeout(r, 600));
      } catch {
        /* nothing to stop */
      }

      await tick();
      timer = setInterval(() => void tick(), 1000);
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

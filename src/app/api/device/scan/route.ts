import { NextRequest, NextResponse } from "next/server";
import {
  getScanSnapshot,
  getUsageSnapshot,
  resetUsagePeaks,
  stopScanMonitors,
  stopUsageMonitors,
} from "@/lib/mikrotik";
import type { ScanMode } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

interface ScanBody {
  host: string;
  user: string;
  password?: string;
  port?: number;
  iface: string;
  wifiKind: "wireless" | "wifi";
  mode: ScanMode;
  /** usage mode: clear max-hold peaks before returning this snapshot */
  resetPeaks?: boolean;
}

const friendly = (message: string): string =>
  message.includes("other tool")
    ? "Radio is busy — close Winbox Scanner/Freq. Usage on this interface, or wait a moment"
    : message;

export async function POST(req: NextRequest) {
  let body: ScanBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { host, user, password, port, iface, wifiKind, mode, resetPeaks } = body;
  if (!host || !user || !iface || !wifiKind) {
    return NextResponse.json(
      { error: "host, user, iface and wifiKind are required" },
      { status: 400 }
    );
  }

  const creds = { host, user, password: password ?? "", port };

  // the frequency monitor and the scanner cannot share the radio — each
  // mode runs one continuous background tool and stops the other
  try {
    if (mode === "usage") {
      if (wifiKind !== "wireless") {
        return NextResponse.json(
          { error: "Frequency usage requires the legacy wireless package (RouterOS v6)" },
          { status: 400 }
        );
      }
      const stopped = await stopScanMonitors(creds);
      if (stopped) await new Promise((r) => setTimeout(r, 600));

      if (resetPeaks) resetUsagePeaks(creds, iface);
      const snap = await getUsageSnapshot(creds, iface);
      if (snap.error && snap.points.length === 0) {
        return NextResponse.json({ error: friendly(snap.error) }, { status: 502 });
      }
      return NextResponse.json({
        ok: true,
        usage: snap.points,
        monitoringFor: snap.monitoringFor,
      });
    }

    const stopped = await stopUsageMonitors(creds);
    if (stopped) await new Promise((r) => setTimeout(r, 600));

    const snap = await getScanSnapshot(creds, iface, wifiKind);
    if (snap.error && snap.networks.length === 0) {
      return NextResponse.json({ error: friendly(snap.error) }, { status: 502 });
    }
    return NextResponse.json({
      ok: true,
      networks: snap.networks,
      monitoringFor: snap.monitoringFor,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Scan failed";
    return NextResponse.json({ error: friendly(message) }, { status: 502 });
  }
}

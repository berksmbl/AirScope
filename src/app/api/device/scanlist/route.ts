import { NextRequest, NextResponse } from "next/server";
import { applyScanList, getScanListInfo, restoreScanList } from "@/lib/mikrotik";

export const runtime = "nodejs";

interface ScanListBody {
  host: string;
  user: string;
  password?: string;
  port?: number;
  iface: string;
  action: "get" | "set" | "restore";
  /** required for "set": e.g. "5500-5700" */
  value?: string;
}

/**
 * Read or change the interface's scan-list — the range the radio actually
 * sweeps. "set" is an explicit user action (persistent device config!);
 * the pre-change value is remembered server-side for "restore".
 */
export async function POST(req: NextRequest) {
  let body: ScanListBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { host, user, password, port, iface, action, value } = body;
  if (!host || !user || !iface || !action) {
    return NextResponse.json(
      { error: "host, user, iface and action are required" },
      { status: 400 }
    );
  }

  const creds = { host, user, password: password ?? "", port };

  try {
    if (action === "set") {
      if (!value || !/^[\d,\-\s]+$|^default$/.test(value)) {
        return NextResponse.json(
          { error: "A frequency range like 5500-5700 is required" },
          { status: 400 }
        );
      }
      const scanList = await applyScanList(creds, iface, value);
      return NextResponse.json({ ok: true, scanList });
    }
    if (action === "restore") {
      const scanList = await restoreScanList(creds, iface);
      return NextResponse.json({ ok: true, scanList });
    }
    const scanList = await getScanListInfo(creds, iface);
    return NextResponse.json({ ok: true, scanList });
  } catch (err) {
    const message = err instanceof Error ? err.message : "scan-list operation failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

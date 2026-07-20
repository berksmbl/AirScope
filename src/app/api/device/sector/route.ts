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
 * Non-disruptive sector health: active-channel status (`monitor once`) and
 * the registration table. Safe to poll continuously — never takes the radio
 * off its service channel.
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

  try {
    const sector = await getSectorStatus(
      { host, user, password: password ?? "", port },
      iface
    );
    return NextResponse.json({ ok: true, sector });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Sector status failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

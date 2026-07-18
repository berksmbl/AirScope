import { NextRequest, NextResponse } from "next/server";
import { dropConnection, getConnection, getDeviceInfo } from "@/lib/mikrotik";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  let body: { host?: string; user?: string; password?: string; port?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { host, user, password, port } = body;
  if (!host || !user) {
    return NextResponse.json({ error: "Host and username are required" }, { status: 400 });
  }

  try {
    const api = await getConnection({ host, user, password: password ?? "", port });
    const info = await getDeviceInfo(api);
    return NextResponse.json({ ok: true, info });
  } catch (err) {
    dropConnection({ host, user, password: password ?? "", port });
    const message =
      err instanceof Error ? err.message : "Could not connect to device";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

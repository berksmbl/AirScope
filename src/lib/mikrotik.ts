import { RouterOSAPI } from "node-routeros";
import type { RStream } from "node-routeros/dist/RStream";
import { BANDS, bandForFrequency } from "./bands";
import { USAGE_HIST_BUCKETS } from "./types";
import type {
  Band,
  DetectedNetwork,
  DeviceInfo,
  FreqUsagePoint,
  ScanListInfo,
  SectorClient,
  SectorStatus,
  WirelessIface,
} from "./types";

/**
 * Server-side RouterOS API access. Connections are pooled per
 * host:port:user so repeated scan polls reuse the same session.
 */

export interface Credentials {
  host: string;
  user: string;
  password: string;
  port?: number;
}

interface PoolEntry {
  api: RouterOSAPI;
  lastUsed: number;
}

const g = globalThis as unknown as { __rosPool?: Map<string, PoolEntry> };
const pool: Map<string, PoolEntry> = (g.__rosPool ??= new Map());

const POOL_IDLE_MS = 5 * 60 * 1000;

function evictIdle() {
  const now = Date.now();
  for (const [key, entry] of pool) {
    if (now - entry.lastUsed > POOL_IDLE_MS) {
      entry.api.close().catch(() => {});
      pool.delete(key);
    }
  }
}

export async function getConnection(creds: Credentials): Promise<RouterOSAPI> {
  evictIdle();
  const port = creds.port ?? 8728;
  const key = `${creds.host}:${port}:${creds.user}`;
  const existing = pool.get(key);
  if (existing?.api.connected) {
    existing.lastUsed = Date.now();
    return existing.api;
  }
  if (existing) pool.delete(key);

  const api = new RouterOSAPI({
    host: creds.host,
    user: creds.user,
    password: creds.password,
    port,
    timeout: 15,
    keepalive: true,
  });
  await api.connect();
  pool.set(key, { api, lastUsed: Date.now() });
  return api;
}

export function dropConnection(creds: Credentials) {
  const key = `${creds.host}:${creds.port ?? 8728}:${creds.user}`;
  const entry = pool.get(key);
  if (entry) {
    entry.api.close().catch(() => {});
    pool.delete(key);
  }
}

type RosRow = Record<string, string>;

function toIface(r: RosRow): WirelessIface {
  return {
    name: r.name,
    band: r.band,
    frequency: num(r.frequency) ?? undefined,
    mode: r.mode,
    ssid: r.ssid,
    scanList: r["scan-list"],
  };
}

export async function getDeviceInfo(api: RouterOSAPI): Promise<DeviceInfo> {
  const [identity] = (await api.write("/system/identity/print")) as RosRow[];
  const [resource] = (await api.write("/system/resource/print")) as RosRow[];

  let interfaces: WirelessIface[] = [];
  let wifiKind: DeviceInfo["wifiKind"] = "none";

  try {
    const rows = (await api.write("/interface/wireless/print")) as RosRow[];
    if (rows.length > 0) {
      interfaces = rows.map(toIface);
      wifiKind = "wireless";
    }
  } catch {
    /* wireless package not present */
  }

  if (wifiKind === "none") {
    try {
      // RouterOS v7 wifi / wifiwave2 package
      const rows = (await api.write("/interface/wifi/print")) as RosRow[];
      if (rows.length > 0) {
        interfaces = rows.map(toIface);
        wifiKind = "wifi";
      }
    } catch {
      /* wifi package not present either */
    }
  }

  return {
    identity: identity?.name ?? "MikroTik",
    board: resource?.["board-name"] ?? "unknown",
    version: resource?.version ?? "unknown",
    interfaces,
    wifiKind,
  };
}

/** Parse RouterOS channel strings like "5180/20-Ceee/ac" or "2412/20/gn" */
function parseChannel(raw: string | undefined): { freq: number; width: number } | null {
  if (!raw) return null;
  const m = raw.match(/^(\d{4})(?:\/(\d{2,3}))?/);
  if (!m) return null;
  const freq = parseInt(m[1], 10);
  let width = m[2] ? parseInt(m[2], 10) : 20;
  // "20-Ceee" style: extension chars widen the channel
  const ext = raw.match(/\/\d+(-[A-Za-z]+)/);
  if (ext) {
    const extents = ext[1].replace("-", "").length;
    width = 20 * Math.max(1, extents);
  }
  return { freq, width };
}

const num = (v: string | undefined): number | null => {
  if (v === undefined) return null;
  // signal may look like "-65@HT20" on some versions
  const m = String(v).match(/-?\d+/);
  return m ? parseInt(m[0], 10) : null;
};

export function normalizeScanRows(rows: RosRow[]): DetectedNetwork[] {
  const out: DetectedNetwork[] = [];
  for (const r of rows) {
    const bssid = r.address ?? r.bssid ?? "";
    if (!bssid) continue;

    const chan = parseChannel(r.channel);
    const freq = chan?.freq ?? num(r.freq) ?? num(r.frequency);
    if (!freq) continue;

    const band: Band = bandForFrequency(freq);
    const signal = num(r.sig) ?? num(r.signal) ?? num(r["signal-strength"]) ?? -90;
    const noise = num(r.nf) ?? num(r["noise-floor"]) ?? BANDS[band].noise;

    // RouterOS v6 API scan rows carry no security/flags information —
    // leave it empty rather than claiming "Open"
    let security = r.security ?? "";
    if (!security) {
      const flags = r.flags ?? r[".flags"] ?? "";
      if (flags.includes("p") || r.privacy === "true") security = "Secured";
    }

    out.push({
      id: bssid,
      ssid: r.ssid && r.ssid.length > 0 ? r.ssid : "Hidden Network",
      bssid,
      frequency: freq,
      signal,
      noise,
      width: chan?.width ?? 20,
      security,
      band,
      radioName: r["radio-name"],
    });
  }
  // dedupe by bssid keeping strongest reading
  const map = new Map<string, DetectedNetwork>();
  for (const n of out) {
    const prev = map.get(n.bssid);
    if (!prev || n.signal > prev.signal) map.set(n.bssid, n);
  }
  return [...map.values()].sort((a, b) => b.signal - a.signal);
}

/* ── Device scan-list control ───────────────────────────────────────
 * RouterOS scan & frequency-monitor take no range parameter — they sweep
 * whatever the interface's scan-list says. To let the UI range actually
 * drive the hardware sweep we write scan-list on the device (an explicit,
 * user-triggered action). The pre-change value is remembered so it can be
 * restored with one click. Running monitors are stopped so the next poll
 * restarts them against the new list.
 */

const go = globalThis as unknown as { __origScanLists?: Map<string, string> };
const origScanLists: Map<string, string> = (go.__origScanLists ??= new Map());

async function findWirelessIface(
  api: RouterOSAPI,
  iface: string
): Promise<{ id: string; scanList: string }> {
  const rows = (await api.write("/interface/wireless/print", [
    `?name=${iface}`,
  ])) as RosRow[];
  const r = rows[0];
  if (!r) throw new Error(`Interface ${iface} not found`);
  return { id: r[".id"], scanList: r["scan-list"] ?? "default" };
}

export async function getScanListInfo(
  creds: Credentials,
  iface: string
): Promise<ScanListInfo> {
  const api = await getConnection(creds);
  const { scanList } = await findWirelessIface(api, iface);
  return {
    current: scanList,
    original: origScanLists.get(monitorKey(creds, iface)) ?? null,
  };
}

export async function applyScanList(
  creds: Credentials,
  iface: string,
  value: string
): Promise<ScanListInfo> {
  const api = await getConnection(creds);
  const key = monitorKey(creds, iface);
  const { id, scanList } = await findWirelessIface(api, iface);
  if (scanList === value) {
    return { current: scanList, original: origScanLists.get(key) ?? null };
  }
  // remember the true original only once, across repeated applies
  if (!origScanLists.has(key)) origScanLists.set(key, scanList);
  await api.write("/interface/wireless/set", [`=.id=${id}`, `=scan-list=${value}`]);
  // monitors must restart to sweep the new list
  await stopScanMonitors(creds);
  await stopUsageMonitors(creds);
  return { current: value, original: origScanLists.get(key) ?? null };
}

export async function restoreScanList(
  creds: Credentials,
  iface: string
): Promise<ScanListInfo> {
  const key = monitorKey(creds, iface);
  const original = origScanLists.get(key);
  if (original === undefined) return getScanListInfo(creds, iface);
  const api = await getConnection(creds);
  const { id } = await findWirelessIface(api, iface);
  await api.write("/interface/wireless/set", [`=.id=${id}`, `=scan-list=${original}`]);
  origScanLists.delete(key);
  await stopScanMonitors(creds);
  await stopUsageMonitors(creds);
  return { current: original, original: null };
}

/* ── Sector status (non-disruptive) ─────────────────────────────────
 * `monitor once` + registration-table are plain reads: they never take
 * the radio off its service channel, so they can run continuously —
 * even alongside a scan or frequency sweep — without dropping clients.
 */

function parseSectorClient(r: RosRow): SectorClient {
  // RouterOS reports "bytes" as "tx,rx"
  const [txB, rxB] = String(r.bytes ?? "0,0")
    .split(",")
    .map((v) => parseInt(v.replace(/\D/g, ""), 10) || 0);
  return {
    mac: r["mac-address"] ?? "",
    radioName: r["radio-name"],
    signal: num(r["signal-strength"]) ?? -100,
    snr: num(r["signal-to-noise"]) ?? undefined,
    ccq: num(r["rx-ccq"]) ?? undefined,
    txRate: r["tx-rate"],
    rxRate: r["rx-rate"],
    txBytes: txB,
    rxBytes: rxB,
    uptime: r.uptime,
    distance: num(r.distance) ?? undefined,
    retx: num(r["tdma-retx"]) ?? undefined,
    version: r["routeros-version"],
  };
}

export async function getSectorStatus(
  creds: Credentials,
  iface: string
): Promise<SectorStatus> {
  const api = await getConnection(creds);
  const out: SectorStatus = { clients: [] };

  try {
    const [m] = (await api.write("/interface/wireless/monitor", [
      `=numbers=${iface}`,
      "=once=",
    ])) as RosRow[];
    if (m) {
      out.status = m.status;
      out.protocol = m["wireless-protocol"];
      out.noiseFloor = num(m["noise-floor"]) ?? undefined;
      const ch = parseChannel(m.channel);
      if (ch) out.channel = ch;
    }
  } catch {
    /* interface may be mid-scan — monitor is best-effort */
  }

  try {
    const rows = (await api.write(
      "/interface/wireless/registration-table/print"
    )) as RosRow[];
    out.clients = rows
      .filter((r) => !r.interface || r.interface === iface)
      .map(parseSectorClient)
      .filter((c) => c.mac)
      .sort((a, b) => b.signal - a.signal);
  } catch {
    /* registration table unavailable */
  }

  return out;
}

/* ── Continuous background scan ─────────────────────────────────────
 * Winbox's scanner window accumulates networks over minutes; a one-shot
 * 5 s scan only catches a handful and takes the radio out of service.
 * background=yes keeps the interface serving clients while the scan
 * crawls the scan-list, streaming rows as it finds them. We accumulate
 * per-BSSID server-side and return the growing table on every poll.
 */

interface ScanMonitor {
  stream: RStream | null;
  rows: Map<string, { row: RosRow; seen: number }>;
  lastPoll: number;
  startedAt: number;
  /** when the stream last delivered rows — used to detect a silently dead stream */
  lastData: number;
  /** throttle for restart attempts */
  lastRestart: number;
  error: string | null;
  /** background scan unsupported (station/nv2 modes) — continuous foreground instead */
  fallback: boolean;
}

const gs = globalThis as unknown as {
  __scanMonitors?: Map<string, ScanMonitor>;
  __bgUnsupported?: Set<string>;
};
const scanMonitors: Map<string, ScanMonitor> = (gs.__scanMonitors ??= new Map());
/** devices whose radio mode refuses background scans — go straight to foreground */
const bgUnsupported: Set<string> = (gs.__bgUnsupported ??= new Set());

const SCAN_ENTRY_TTL_MS = 180_000;
/** a healthy sweep delivers rows at least this often; longer means the stream is dead */
const STREAM_STALL_MS = 45_000;
const RESTART_THROTTLE_MS = 5_000;

export async function getScanSnapshot(
  creds: Credentials,
  iface: string,
  wifiKind: "wireless" | "wifi"
): Promise<{ networks: DetectedNetwork[]; monitoringFor: number; error: string | null }> {
  const api = await getConnection(creds);
  const key = monitorKey(creds, iface);
  const path = wifiKind === "wireless" ? "/interface/wireless/scan" : "/interface/wifi/scan";

  const scanCallback = (err: Error | null, packet: unknown) => {
    const m = scanMonitors.get(key);
    if (!m) return;
    if (err) {
      m.error = err.message;
      return;
    }
    const rows = (Array.isArray(packet) ? packet : packet ? [packet] : []) as RosRow[];
    const seenAt = Date.now();
    for (const r of rows) {
      const bssid = r.address ?? r.bssid;
      if (!bssid) continue;
      m.rows.set(bssid, { row: r, seen: seenAt });
    }
    if (rows.length > 0) {
      m.error = null;
      m.lastData = seenAt;
    }
  };

  const startStream = (m: ScanMonitor) => {
    m.lastRestart = Date.now();
    m.stream = api.stream(
      m.fallback ? [path, `=.id=${iface}`] : [path, `=.id=${iface}`, "=background=yes"],
      scanCallback
    );
  };

  let mon = scanMonitors.get(key);

  // background scan refused (station/nv2 modes) — remember and switch to a
  // continuous foreground scan, exactly what the Winbox scanner window runs
  if (mon && !mon.fallback && mon.error?.includes("not supported")) {
    mon.fallback = true;
    mon.error = null;
    bgUnsupported.add(key);
    mon.stream?.stop().catch(() => {});
    startStream(mon);
  }

  // self-heal: errored (radio was busy) or silently dead stream — restart it,
  // keeping whatever the table already accumulated
  if (
    mon &&
    (mon.error !== null || Date.now() - mon.lastData > STREAM_STALL_MS) &&
    Date.now() - mon.lastRestart > RESTART_THROTTLE_MS
  ) {
    mon.error = null;
    mon.lastData = Date.now();
    mon.stream?.stop().catch(() => {});
    await new Promise((r) => setTimeout(r, 500));
    startStream(mon);
  }

  if (!mon) {
    // prefer a background scan (radio keeps serving clients) unless this
    // device already told us it can't
    mon = {
      stream: null,
      rows: new Map(),
      lastPoll: Date.now(),
      startedAt: Date.now(),
      lastData: Date.now(),
      lastRestart: 0,
      error: null,
      fallback: bgUnsupported.has(key),
    };
    scanMonitors.set(key, mon);
    startReaper();
    startStream(mon);
  }

  mon.lastPoll = Date.now();

  const now = Date.now();
  for (const [bssid, entry] of mon.rows) {
    if (now - entry.seen > SCAN_ENTRY_TTL_MS) mon.rows.delete(bssid);
  }
  const networks = normalizeScanRows([...mon.rows.values()].map((e) => e.row));
  for (const n of networks) {
    n.lastSeen = mon.rows.get(n.bssid)?.seen;
  }
  return {
    networks,
    monitoringFor: Math.round((now - mon.startedAt) / 1000),
    error: mon.error,
  };
}

/**
 * Stop every scan monitor on this host (any interface): virtual APs share
 * the physical radio, so a monitor left on another interface would hold it.
 */
export async function stopScanMonitors(creds: Credentials): Promise<boolean> {
  const prefix = `${creds.host}:${creds.port ?? 8728}:`;
  let stopped = false;
  for (const [key, mon] of scanMonitors) {
    if (!key.startsWith(prefix)) continue;
    scanMonitors.delete(key);
    if (mon.stream) await mon.stream.stop().catch(() => {});
    stopped = true;
  }
  return stopped;
}

/* ── Continuous frequency-usage monitor ─────────────────────────────
 * The Winbox "Freq. Usage" tool (/interface/wireless/frequency-monitor)
 * sweeps the whole band once per ~30-60 s and RESTARTS from the lowest
 * frequency on every invocation — short one-shot calls never get past
 * the first few bins. So we run it as a continuous stream per device
 * and accumulate bins server-side; scan polls just read the cache.
 * A reaper stops streams nobody has polled recently, because the
 * monitor occupies the radio (a scan cannot run at the same time).
 */

interface UsageMonitor {
  stream: RStream | null;
  bins: Map<number, FreqUsagePoint>;
  lastPoll: number;
  startedAt: number;
  /** when the stream last delivered bins — used to detect a silently dead stream */
  lastData: number;
  /** throttle for restart attempts */
  lastRestart: number;
  error: string | null;
}

const gm = globalThis as unknown as {
  __usageMonitors?: Map<string, UsageMonitor>;
  __usageReaper?: ReturnType<typeof setInterval>;
};
const monitors: Map<string, UsageMonitor> = (gm.__usageMonitors ??= new Map());

const monitorKey = (creds: Credentials, iface: string) =>
  `${creds.host}:${creds.port ?? 8728}:${iface}`;

function startReaper() {
  if (gm.__usageReaper) return;
  gm.__usageReaper = setInterval(() => {
    for (const map of [monitors, scanMonitors] as Map<
      string,
      { lastPoll: number; stream: RStream | null }
    >[]) {
      for (const [key, mon] of map) {
        if (Date.now() - mon.lastPoll > 20_000) {
          map.delete(key);
          mon.stream?.stop().catch(() => {});
        }
      }
    }
  }, 5_000);
}

export async function getUsageSnapshot(
  creds: Credentials,
  iface: string
): Promise<{ points: FreqUsagePoint[]; monitoringFor: number; error: string | null }> {
  const api = await getConnection(creds);
  const key = monitorKey(creds, iface);

  const usageCallback = (err: Error | null, packet: unknown) => {
    const m = monitors.get(key);
    if (!m) return;
    if (err) {
      m.error = err.message;
      return;
    }
    const rows = (Array.isArray(packet) ? packet : packet ? [packet] : []) as RosRow[];
    for (const r of rows) {
      const freq = num(r.freq ?? r.frequency);
      const usageRaw = r.use ?? r.usage;
      const usage =
        usageRaw !== undefined ? parseFloat(String(usageRaw).replace("%", "")) : NaN;
      if (freq === null || Number.isNaN(usage)) continue;
      const rounded = Math.round(usage * 10) / 10;
      // max-hold across sweeps: TDD/bursty transmitters only show up in
      // the sweeps whose dwell overlaps their burst
      const prev = m.bins.get(freq);
      // occurrence histogram for the persistence (CDF) view
      const hist = prev?.hist ?? new Array<number>(USAGE_HIST_BUCKETS).fill(0);
      hist[Math.min(USAGE_HIST_BUCKETS - 1, Math.floor(rounded / 5))]++;
      m.bins.set(freq, {
        freq,
        usage: rounded,
        peak: Math.max(prev?.peak ?? 0, rounded),
        noise: num(r.nf ?? r["noise-floor"]) ?? -110,
        hist,
        samples: (prev?.samples ?? 0) + 1,
      });
    }
    if (rows.length > 0) {
      m.error = null;
      m.lastData = Date.now();
    }
  };

  const startStream = (m: UsageMonitor) => {
    m.lastRestart = Date.now();
    m.stream = api.stream(
      ["/interface/wireless/frequency-monitor", `=.id=${iface}`],
      usageCallback
    );
  };

  let mon = monitors.get(key);

  // self-heal: errored (radio was busy) or silently dead stream — restart it,
  // keeping the accumulated bins and max-hold peaks
  if (
    mon &&
    (mon.error !== null || Date.now() - mon.lastData > STREAM_STALL_MS) &&
    Date.now() - mon.lastRestart > RESTART_THROTTLE_MS
  ) {
    mon.error = null;
    mon.lastData = Date.now();
    mon.stream?.stop().catch(() => {});
    await new Promise((r) => setTimeout(r, 500));
    startStream(mon);
  }

  if (!mon) {
    mon = {
      stream: null,
      bins: new Map(),
      lastPoll: Date.now(),
      startedAt: Date.now(),
      lastData: Date.now(),
      lastRestart: 0,
      error: null,
    };
    monitors.set(key, mon);
    startReaper();
    startStream(mon);
  }

  mon.lastPoll = Date.now();
  return {
    points: [...mon.bins.values()].sort((a, b) => a.freq - b.freq),
    monitoringFor: Math.round((Date.now() - mon.startedAt) / 1000),
    error: mon.error,
  };
}

/**
 * Start a fresh observation window without restarting the sweep: clears
 * max-hold peaks and the persistence histograms.
 */
export function resetUsagePeaks(creds: Credentials, iface: string): void {
  const mon = monitors.get(monitorKey(creds, iface));
  if (!mon) return;
  for (const [freq, bin] of mon.bins) {
    mon.bins.set(freq, {
      ...bin,
      peak: bin.usage,
      hist: new Array<number>(USAGE_HIST_BUCKETS).fill(0),
      samples: 0,
    });
  }
}

/**
 * Stop every usage monitor on this host (any interface) so the shared
 * physical radio is free for a network scan.
 */
export async function stopUsageMonitors(creds: Credentials): Promise<boolean> {
  const prefix = `${creds.host}:${creds.port ?? 8728}:`;
  let stopped = false;
  for (const [key, mon] of monitors) {
    if (!key.startsWith(prefix)) continue;
    monitors.delete(key);
    if (mon.stream) await mon.stream.stop().catch(() => {});
    stopped = true;
  }
  return stopped;
}

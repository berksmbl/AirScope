"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BANDS, bandForFrequency } from "@/lib/bands";
import {
  averageCongestion,
  computeChannelStats,
  detectInterferenceFromUsage,
  recommend,
  synthesizeSpectrum,
} from "@/lib/analysis";
import { useStoredJson } from "@/lib/clientStore";
import { uid } from "@/lib/utils";
import type {
  Band,
  ConnState,
  DetectedNetwork,
  DeviceInfo,
  FreqUsagePoint,
  InterferenceRegion,
  ScanListInfo,
  ScanMode,
  ScanSnapshot,
  SectorStatus,
  SpectrumPoint,
  StoredScan,
} from "@/lib/types";

export interface Focus {
  kind: "network" | "channel";
  /** bssid for network, center freq for channel */
  key: string | number;
}

export interface LiveCreds {
  host: string;
  user: string;
  password: string;
  port: number;
}

interface StreamPayload {
  type: "networks" | "usage" | "error";
  networks?: DetectedNetwork[];
  usage?: FreqUsagePoint[];
  monitoringFor?: number;
  error?: string | null;
}

const HISTORY_KEY = "airscope:history";
const HISTORY_MAX = 24;
/** a usage sweep stays part of the analysis this long after mode switch */
const USAGE_HOLD_MS = 10 * 60 * 1000;
/** wait before re-opening a dropped stream */
const RECONNECT_MS = 2000;

export type Scanner = ReturnType<typeof useScanner>;

export function useScanner() {
  // ── connection ──
  const [connState, setConnState] = useState<ConnState>("disconnected");
  const [connError, setConnError] = useState<string | null>(null);
  const [device, setDevice] = useState<DeviceInfo | null>(null);
  const [iface, setIface] = useState<string | null>(null);
  const credsRef = useRef<LiveCreds | null>(null);

  // ── scan parameters ──
  const [band, setBandState] = useState<Band>("5g");
  const [range, setRange] = useState<[number, number]>([
    BANDS["5g"].defaultMin,
    BANDS["5g"].defaultMax,
  ]);
  const [mode, setMode] = useState<ScanMode>("scan");
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  /** how long the device-side tool has been collecting, seconds */
  const [collectingFor, setCollectingFor] = useState(0);

  // ── data ──
  const [snapshot, setSnapshot] = useState<ScanSnapshot | null>(null);
  const [waterfall, setWaterfall] = useState<SpectrumPoint[][]>([]);
  const [focus, setFocus] = useState<Focus | null>(null);
  /** live sector health — polled independently of scanning (non-disruptive) */
  const [sector, setSector] = useState<SectorStatus | null>(null);
  /** the range the radio actually sweeps (device scan-list) */
  const [scanListInfo, setScanListInfo] = useState<ScanListInfo | null>(null);
  // per-client signal/ccq rings for sparklines (keyed by MAC)
  const clientHistory = useRef(new Map<string, { signal: number; ccq: number | null }[]>());
  // shared crosshair: hovering any chart highlights the same frequency on all
  const [hoverFreq, setHoverFreqState] = useState<number | null>(null);
  const setHoverFreq = useCallback((f: number | null) => {
    // snap to 5 MHz so mouse movement inside a bin doesn't re-render anything
    setHoverFreqState((prev) => {
      const next = f === null ? null : Math.round(f / 5) * 5;
      return prev === next ? prev : next;
    });
  }, []);
  const [history, persistHistory] = useStoredJson<StoredScan[]>(HISTORY_KEY);
  const [compareId, setCompareId] = useState<string | null>(null);

  const tickRef = useRef(0);
  // band/range are read by the stream consumer without restarting the stream
  const paramsRef = useRef<{ band: Band; range: [number, number] }>({ band, range });
  useEffect(() => {
    paramsRef.current = { band, range };
  }, [band, range]);

  // stable color slot per network (first-seen order, max 8) so colors follow
  // the entity, not its current rank in the list
  const colorMap = useRef(new Map<string, number>());
  // max-hold for interference: pulsed sources (radar bursts) stay visible for
  // a few sweeps after they last fired instead of flickering in and out
  const regionMemory = useRef<{ r: InterferenceRegion; ttl: number }[]>([]);
  // networks survive switching into usage mode; usage survives switching into
  // scan mode — so the analysis always merges both real measurements
  const netsMemory = useRef<DetectedNetwork[]>([]);
  const usageMemory = useRef<{ points: FreqUsagePoint[]; at: number } | null>(null);

  const colorIndex = useCallback((bssid: string): number | null => {
    const idx = colorMap.current.get(bssid);
    return idx === undefined ? null : idx;
  }, []);

  const resetData = useCallback(() => {
    setSnapshot(null);
    setWaterfall([]);
    setFocus(null);
    setCollectingFor(0);
    setSector(null);
    colorMap.current.clear();
    regionMemory.current = [];
    netsMemory.current = [];
    usageMemory.current = null;
    clientHistory.current.clear();
    tickRef.current = 0;
  }, []);

  // ── connection actions ──
  const connect = useCallback(async (creds: LiveCreds) => {
    setConnState("connecting");
    setConnError(null);
    try {
      const res = await fetch("/api/device/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(creds),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Connection failed");
      const info: DeviceInfo = data.info;
      credsRef.current = creds;
      setDevice(info);
      setConnState("connected");
      resetData();

      const first = info.interfaces[0] ?? null;
      setIface(first?.name ?? null);
      setScanListInfo(
        first?.scanList ? { current: first.scanList, original: null } : null
      );
      // land on the band the radio actually lives in; scanning itself stays
      // manual so range/mode/scan-list can be configured first
      if (first?.frequency) {
        const b = bandForFrequency(first.frequency);
        setBandState(b);
        setRange([BANDS[b].defaultMin, BANDS[b].defaultMax]);
      }
      return info;
    } catch (err) {
      setConnState("error");
      setConnError(err instanceof Error ? err.message : "Connection failed");
      return null;
    }
  }, [resetData]);

  const disconnect = useCallback(() => {
    credsRef.current = null;
    setDevice(null);
    setIface(null);
    setConnState("disconnected");
    setScanning(false);
    setScanListInfo(null);
    resetData();
  }, [resetData]);

  /** switching radios means a different RF world — drop accumulated data */
  const selectIface = useCallback(
    (name: string) => {
      setIface(name);
      const info = device?.interfaces.find((i) => i.name === name);
      setScanListInfo(
        info?.scanList ? { current: info.scanList, original: null } : null
      );
      resetData();
    },
    [device, resetData]
  );

  /**
   * Write the selected range to the device's scan-list ("set") or put the
   * remembered original back ("restore"). Explicit user actions — this is
   * persistent device config. Server restarts its monitors afterwards.
   */
  const scanListAction = useCallback(
    async (action: "set" | "restore") => {
      const creds = credsRef.current;
      if (!creds || !device || !iface || device.wifiKind !== "wireless") return;
      try {
        const res = await fetch("/api/device/scanlist", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...creds,
            iface,
            action,
            value: action === "set" ? `${range[0]}-${range[1]}` : undefined,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "scan-list update failed");
        setScanListInfo(data.scanList as ScanListInfo);
        // monitors were restarted server-side — old frames mix ranges
        setWaterfall([]);
        setCollectingFor(0);
        setScanError(null);
      } catch (err) {
        setScanError(err instanceof Error ? err.message : "scan-list update failed");
      }
    },
    [device, iface, range]
  );

  const applyScanListToDevice = useCallback(() => scanListAction("set"), [scanListAction]);
  const restoreDeviceScanList = useCallback(
    () => scanListAction("restore"),
    [scanListAction]
  );

  // ── live data feed ──
  // One SSE connection per (mode, iface): the server pushes the accumulated
  // state of its continuous RouterOS streams once a second. Reconnects with
  // a short backoff if the stream drops.
  useEffect(() => {
    if (!scanning || !device || !iface || !credsRef.current) return;
    const creds = credsRef.current;
    const wifiKind = device.wifiKind;
    const deviceName = device.identity;
    let cancelled = false;
    const ctrl = new AbortController();

    const apply = (payload: StreamPayload) => {
      if (cancelled) return;
      if (payload.type === "error") {
        setScanError(payload.error ?? "Scan failed");
        return;
      }
      setCollectingFor(payload.monitoringFor ?? 0);

      if (payload.type === "networks" && payload.networks) {
        netsMemory.current = payload.networks;
      }
      const usageLive = payload.type === "usage";
      if (usageLive && payload.usage && payload.usage.length > 0) {
        usageMemory.current = { points: payload.usage, at: Date.now() };
      }
      if (usageMemory.current && Date.now() - usageMemory.current.at > USAGE_HOLD_MS) {
        usageMemory.current = null;
      }

      const { band: b, range: r } = paramsRef.current;
      const [min, max] = r;
      const networks = netsMemory.current
        .filter((n) => n.frequency >= min - 20 && n.frequency <= max + 20)
        .sort((a, b2) => b2.signal - a.signal);
      const usage = (usageMemory.current?.points ?? []).filter(
        (u) => u.freq >= min && u.freq <= max
      );

      tickRef.current++;
      const spectrum = synthesizeSpectrum(networks, b, min, max, tickRef.current);

      for (const n of networks) {
        if (!colorMap.current.has(n.id) && colorMap.current.size < 8) {
          colorMap.current.set(n.id, colorMap.current.size);
        }
      }

      // interference from measured airtime, with a few sweeps of max-hold
      const fresh = detectInterferenceFromUsage(usage, networks);
      const overlaps = (a: InterferenceRegion, b2: InterferenceRegion) =>
        a.from <= b2.to + 4 && b2.from <= a.to + 4;
      regionMemory.current = [
        ...fresh.map((reg) => ({ r: reg, ttl: 5 })),
        ...regionMemory.current
          .map((m) => ({ ...m, ttl: m.ttl - 1 }))
          .filter((m) => m.ttl > 0 && !fresh.some((reg) => overlaps(reg, m.r))),
      ];
      const regions = regionMemory.current
        .map((m) => m.r)
        .sort((a, b2) => b2.peak - a.peak)
        .slice(0, 4);

      const channels = computeChannelStats(networks, b, usage, regions);
      const noiseFloor = Math.round(
        usage.length > 0
          ? usage.reduce((s, u) => s + u.noise, 0) / usage.length
          : spectrum.reduce((s, p) => s + p.noise, 0) / Math.max(1, spectrum.length)
      );

      setSnapshot({
        id: uid(),
        timestamp: Date.now(),
        band: b,
        mode,
        rangeMin: min,
        rangeMax: max,
        networks,
        spectrum,
        channels,
        interference: regions,
        usage,
        usageLive,
        usageAt: usageMemory.current?.at ?? null,
        noiseFloor,
        deviceName,
      });

      // waterfall: real airtime over time while monitoring, else the envelope
      const frame =
        usageLive && usage.length > 0
          ? usage.map((u) => ({
              freq: u.freq,
              power: u.noise + 8 + (u.usage / 100) * 45,
              noise: u.noise,
            }))
          : spectrum;
      setWaterfall((prev) => [...prev.slice(-89), frame]);
      setScanError(payload.error ?? null);
    };

    const run = async () => {
      while (!cancelled) {
        try {
          const res = await fetch("/api/device/stream", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...creds, iface, wifiKind, mode }),
            signal: ctrl.signal,
          });
          if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            throw new Error(
              (data as { error?: string }).error ?? "Live stream failed"
            );
          }
          if (!res.body) throw new Error("Streaming not supported");

          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buf = "";
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            buf += decoder.decode(value, { stream: true });
            let sep: number;
            while ((sep = buf.indexOf("\n\n")) >= 0) {
              const chunk = buf.slice(0, sep);
              buf = buf.slice(sep + 2);
              const line = chunk.split("\n").find((l) => l.startsWith("data: "));
              if (!line) continue;
              try {
                apply(JSON.parse(line.slice(6)) as StreamPayload);
              } catch {
                /* malformed frame — skip */
              }
            }
          }
        } catch (err) {
          if (cancelled) return;
          setScanError(err instanceof Error ? err.message : "Live stream failed");
        }
        if (cancelled) return;
        await new Promise((r) => setTimeout(r, RECONNECT_MS));
      }
    };

    void run();
    return () => {
      cancelled = true;
      ctrl.abort();
    };
  }, [scanning, mode, device, iface]);

  // ── sector health loop ──
  // Plain reads (monitor once + registration-table): never touch the radio's
  // channel, so this runs whenever we're connected — scanning or not.
  useEffect(() => {
    if (connState !== "connected" || !device || !iface || !credsRef.current) {
      return;
    }
    const creds = credsRef.current;
    let cancelled = false;

    const tick = async () => {
      try {
        const res = await fetch("/api/device/sector", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...creds, iface }),
        });
        if (!res.ok || cancelled) return;
        const data = await res.json();
        const s: SectorStatus = data.sector;
        for (const c of s.clients) {
          const h = clientHistory.current.get(c.mac) ?? [];
          h.push({ signal: c.signal, ccq: c.ccq ?? null });
          if (h.length > 150) h.shift();
          clientHistory.current.set(c.mac, h);
        }
        // during a sweep `monitor` can't report a channel — keep the last known
        setSector((prev) => ({ ...s, channel: s.channel ?? prev?.channel }));
      } catch {
        /* transient — next tick retries */
      }
    };

    void tick();
    const id = setInterval(() => void tick(), 2000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [connState, device, iface]);

  // ── parameter changes reset transient views ──
  const setBand = useCallback((b: Band) => {
    setBandState(b);
    setRange([BANDS[b].defaultMin, BANDS[b].defaultMax]);
    setWaterfall([]);
    setFocus(null);
    setSnapshot(null);
    colorMap.current.clear();
    regionMemory.current = [];
    netsMemory.current = [];
    usageMemory.current = null;
  }, []);

  const setFreqRange = useCallback((min: number, max: number) => {
    setRange([min, max]);
    setWaterfall([]);
  }, []);

  /** waterfall frames mean different things per mode (dBm envelope vs airtime) */
  const selectMode = useCallback((m: ScanMode) => {
    setMode(m);
    setWaterfall([]);
    setCollectingFor(0);
  }, []);

  /** clear max-hold peaks + persistence histograms — fresh observation window */
  const resetUsagePeaks = useCallback(() => {
    const creds = credsRef.current;
    if (!creds || !device || !iface || mode !== "usage") return;
    void fetch("/api/device/scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...creds,
        iface,
        wifiKind: device.wifiKind,
        mode: "usage",
        resetPeaks: true,
      }),
    }).catch(() => {});
  }, [device, iface, mode]);

  // ── derived ──
  const recommendation = useMemo(() => {
    if (!snapshot) return null;
    return recommend(snapshot.channels, snapshot.networks, snapshot.rangeMin, snapshot.rangeMax);
  }, [snapshot]);

  const avgCongestion = useMemo(
    () => (snapshot ? averageCongestion(snapshot.channels) : 0),
    [snapshot]
  );

  const interference = snapshot?.interference ?? [];

  const compareScan = useMemo(() => {
    if (!compareId) return null;
    const stored = history.find((h) => h.id === compareId);
    if (!stored || stored.band !== band) return null;
    const spectrum = synthesizeSpectrum(stored.networks, stored.band, range[0], range[1], 0);
    return { stored, spectrum };
  }, [compareId, history, band, range]);

  // ── history actions ──
  const saveCurrentScan = useCallback(() => {
    if (!snapshot) return;
    const stored: StoredScan = {
      id: snapshot.id,
      timestamp: snapshot.timestamp,
      band: snapshot.band,
      mode: snapshot.mode,
      rangeMin: snapshot.rangeMin,
      rangeMax: snapshot.rangeMax,
      networks: snapshot.networks,
      // strip persistence histograms — history only needs the curves
      usage:
        snapshot.usage.length > 0
          ? snapshot.usage.map(({ freq, usage, peak, noise }) => ({
              freq,
              usage,
              peak,
              noise,
            }))
          : undefined,
      noiseFloor: snapshot.noiseFloor,
      deviceName: snapshot.deviceName,
    };
    persistHistory([stored, ...history].slice(0, HISTORY_MAX));
  }, [snapshot, history, persistHistory]);

  const deleteScan = useCallback(
    (id: string) => {
      persistHistory(history.filter((h) => h.id !== id));
      if (compareId === id) setCompareId(null);
    },
    [history, compareId, persistHistory]
  );

  return {
    // connection
    connState,
    connError,
    device,
    iface,
    setIface: selectIface,
    connect,
    disconnect,
    // params
    band,
    setBand,
    range,
    setFreqRange,
    mode,
    setMode: selectMode,
    scanning,
    setScanning,
    scanError,
    collectingFor,
    resetUsagePeaks,
    scanListInfo,
    applyScanListToDevice,
    restoreDeviceScanList,
    // data
    snapshot,
    waterfall,
    focus,
    setFocus,
    hoverFreq,
    setHoverFreq,
    colorIndex,
    recommendation,
    avgCongestion,
    interference,
    sector,
    clientHistory: clientHistory.current,
    // history
    history,
    saveCurrentScan,
    deleteScan,
    compareId,
    setCompareId,
    compareScan,
  };
}

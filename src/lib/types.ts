export type Band = "2g" | "5g" | "6g";
/** "scan" = network discovery, "usage" = per-frequency airtime monitoring */
export type ScanMode = "scan" | "usage";
export type ConnState = "disconnected" | "connecting" | "connected" | "error";

export interface DeviceProfile {
  id: string;
  name: string;
  host: string;
  user: string;
  port: number;
}

export interface WirelessIface {
  name: string;
  /** e.g. "5ghz-a/n/ac" */
  band?: string;
  /** configured frequency, MHz */
  frequency?: number;
  /** e.g. "ap-bridge", "station" */
  mode?: string;
  ssid?: string;
  /** the range(s) scan & frequency-monitor actually sweep, e.g. "5000-6000" */
  scanList?: string;
}

/** device scan-list state as tracked by the server */
export interface ScanListInfo {
  current: string;
  /** pre-change value the server remembers, null if we haven't touched it */
  original: string | null;
}

export interface DeviceInfo {
  identity: string;
  board: string;
  version: string;
  /** wireless interfaces discovered on the device */
  interfaces: WirelessIface[];
  /** which RouterOS package exposes them */
  wifiKind: "wireless" | "wifi" | "none";
}

/** one subscriber CPE registered on our sector (registration-table row) */
export interface SectorClient {
  mac: string;
  radioName?: string;
  /** dBm, as heard by the AP */
  signal: number;
  /** signal-to-noise, dB */
  snr?: number;
  /** rx-ccq link quality, % */
  ccq?: number;
  txRate?: string;
  rxRate?: string;
  /** cumulative bytes since registration */
  txBytes: number;
  rxBytes: number;
  uptime?: string;
  /** TDMA distance units */
  distance?: number;
  /** TDMA retransmissions */
  retx?: number;
  version?: string;
}

/**
 * Live health of our own radio + subscribers — read without taking the
 * radio off its service channel (monitor once + registration-table).
 */
export interface SectorStatus {
  /** e.g. "running-ap" */
  status?: string;
  /** the channel we are serving on right now */
  channel?: { freq: number; width: number };
  /** real noise floor measured ON the active channel, dBm */
  noiseFloor?: number;
  /** e.g. "nv2", "802.11" */
  protocol?: string;
  clients: SectorClient[];
}

export interface DetectedNetwork {
  id: string; // bssid
  ssid: string;
  bssid: string;
  /** center frequency, MHz */
  frequency: number;
  /** dBm */
  signal: number;
  /** dBm */
  noise: number;
  /** channel width, MHz */
  width: number;
  security: string;
  band: Band;
  /** radio-name reported by RouterOS neighbors */
  radioName?: string;
  /** when the scanner last heard this BSSID (epoch ms) */
  lastSeen?: number;
}

export interface SpectrumPoint {
  freq: number;
  /** measured/estimated power at this frequency, dBm */
  power: number;
  /** noise floor, dBm */
  noise: number;
}

export interface ChannelStat {
  channel: number;
  freq: number;
  /** combined congestion score 0 (clean) .. 100 (saturated) */
  score: number;
  /** contribution from detected Wi-Fi networks */
  wifiScore: number;
  /** contribution from raw spectrum energy (frequency usage) */
  rfScore: number;
  /** significant RF energy not explained by any detected network */
  nonWifi: boolean;
  /** number of networks overlapping this channel */
  networks: number;
  /** strongest overlapping signal, dBm */
  strongest: number | null;
}

/** contiguous spectrum region with energy not attributable to Wi-Fi */
export interface InterferenceRegion {
  from: number;
  to: number;
  /** peak power (dBm) or peak usage (%) depending on unit */
  peak: number;
  unit: "dbm" | "pct";
}

/** number of 5%-wide histogram buckets per usage bin (0..100%) */
export const USAGE_HIST_BUCKETS = 21;

/** one bin of real per-frequency airtime usage (Winbox "Freq. Usage") */
export interface FreqUsagePoint {
  freq: number;
  /** latest sweep's airtime usage, 0..100 % */
  usage: number;
  /**
   * max-hold: highest usage seen on this bin since monitoring began.
   * Catches TDD/bursty transmitters whose duty happens to be idle
   * during a single sweep's dwell. Optional for legacy stored scans.
   */
  peak?: number;
  /** measured noise floor, dBm */
  noise: number;
  /**
   * occurrence histogram across sweeps: hist[i] counts readings in
   * [i*5, (i+1)*5) % usage. Drives the Mimosa-style persistence (CDF)
   * view — how OFTEN each level occurs, not just the worst case.
   */
  hist?: number[];
  /** total readings accumulated into hist */
  samples?: number;
}

export interface Recommendation {
  freq: number;
  channel: number;
  score: number;
  /** e.g. "Low interference" */
  label: string;
  reason: string;
  /** runner-up alternatives */
  alternates: { freq: number; channel: number; score: number }[];
  /**
   * cleanest contiguous wider blocks (40/80 MHz) — scored by their WORST
   * member channel, since one busy channel ruins the whole bond
   */
  blocks: { width: number; freq: number; from: number; to: number; score: number }[];
}

export interface ScanSnapshot {
  id: string;
  timestamp: number;
  band: Band;
  mode: ScanMode;
  rangeMin: number;
  rangeMax: number;
  networks: DetectedNetwork[];
  spectrum: SpectrumPoint[];
  channels: ChannelStat[];
  interference: InterferenceRegion[];
  /** per-frequency airtime usage measured by the device's frequency monitor */
  usage: FreqUsagePoint[];
  /** true when usage is streaming right now (usage mode); false when held from an earlier sweep */
  usageLive: boolean;
  /** when the usage data was last refreshed (epoch ms) */
  usageAt: number | null;
  noiseFloor: number;
  deviceName?: string;
}

/** compact stored version for scan history (localStorage) */
export interface StoredScan {
  id: string;
  timestamp: number;
  band: Band;
  mode: ScanMode;
  rangeMin: number;
  rangeMax: number;
  networks: DetectedNetwork[];
  /** measured airtime at save time, if a sweep had run */
  usage?: FreqUsagePoint[];
  noiseFloor: number;
  deviceName?: string;
}

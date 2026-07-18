import type { Band } from "./types";

export interface BandDef {
  id: Band;
  label: string;
  short: string;
  /** full tunable range, MHz */
  min: number;
  max: number;
  /** default visible range */
  defaultMin: number;
  defaultMax: number;
  /** spectrum sampling step, MHz */
  step: number;
  /** typical noise floor, dBm */
  noise: number;
  /** what the heatmap cells lead with — WISP 5 GHz thinks in MHz */
  labelBy: "channel" | "freq";
  channels: { channel: number; freq: number }[];
}

const range = (from: number, to: number, step = 1): number[] => {
  const out: number[] = [];
  for (let v = from; v <= to; v += step) out.push(v);
  return out;
};

export const BANDS: Record<Band, BandDef> = {
  "2g": {
    id: "2g",
    label: "2.4 GHz",
    short: "2.4G",
    min: 2400,
    max: 2495,
    defaultMin: 2400,
    defaultMax: 2485,
    step: 1,
    noise: -98,
    labelBy: "channel",
    channels: range(1, 13).map((channel) => ({ channel, freq: 2407 + 5 * channel })),
  },
  "5g": {
    // full superchannel span RouterOS sweeps (Freq. Usage walks 5000-6000);
    // WISP links commonly sit outside the standard Wi-Fi channel grid
    id: "5g",
    label: "5 GHz",
    short: "5G",
    min: 5000,
    max: 6000,
    defaultMin: 5000,
    defaultMax: 5900,
    step: 2,
    noise: -106,
    labelBy: "freq",
    channels: range(5000, 5980, 20).map((freq) => ({
      channel: (freq - 5000) / 5,
      freq,
    })),
  },
  "6g": {
    id: "6g",
    label: "6 GHz",
    short: "6G",
    min: 5925,
    max: 7125,
    defaultMin: 5945,
    defaultMax: 6425,
    step: 2,
    noise: -108,
    labelBy: "channel",
    channels: range(1, 93, 4).map((channel) => ({ channel, freq: 5950 + 5 * channel })),
  },
};

export const BAND_ORDER: Band[] = ["2g", "5g", "6g"];

export function bandForFrequency(freq: number): Band {
  if (freq < 3000) return "2g";
  if (freq < 5925) return "5g";
  return "6g";
}

export function channelForFrequency(freq: number, band: Band): number | null {
  const match = BANDS[band].channels.find((c) => Math.abs(c.freq - freq) < 3);
  return match ? match.channel : null;
}

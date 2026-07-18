import { BANDS } from "./bands";
import { clamp } from "./utils";
import type {
  Band,
  ChannelStat,
  DetectedNetwork,
  FreqUsagePoint,
  InterferenceRegion,
  Recommendation,
  SpectrumPoint,
} from "./types";

/** fraction of a 20 MHz channel that an emitter's occupied bandwidth overlaps */
function overlapFraction(
  chanFreq: number,
  chanWidth: number,
  netFreq: number,
  netWidth: number
): number {
  const lo = Math.max(chanFreq - chanWidth / 2, netFreq - netWidth / 2);
  const hi = Math.min(chanFreq + chanWidth / 2, netFreq + netWidth / 2);
  return Math.max(0, hi - lo) / chanWidth;
}

/**
 * Congestion per channel from two independent measurements:
 *
 * - `wifiScore` — detected networks: each overlapping AP contributes by
 *   strength (a -50 dBm neighbor hurts far more than a -90 dBm one) and by
 *   how much of the channel it occupies.
 * - `rfScore`  — measured airtime % from the device's frequency monitor,
 *   using each bin's max-hold peak so TDD/bursty transmitters count even
 *   when the latest sweep happened to catch them idle. This also covers
 *   non-Wi-Fi sources (microwave ovens, radar, analog senders) that a
 *   network scan is blind to.
 *
 * The combined `score` is the worse of the two; `nonWifi` flags channels
 * that overlap a detected interference region.
 */
export function computeChannelStats(
  networks: DetectedNetwork[],
  band: Band,
  usage: FreqUsagePoint[],
  interference: InterferenceRegion[] = []
): ChannelStat[] {
  return BANDS[band].channels.map(({ channel, freq }) => {
    let wifi = 0;
    let count = 0;
    let strongest: number | null = null;
    for (const n of networks) {
      const overlap = overlapFraction(freq, 20, n.frequency, n.width);
      if (overlap <= 0.02) continue;
      count++;
      strongest = strongest === null ? n.signal : Math.max(strongest, n.signal);
      // -95 dBm -> 0, -50 dBm -> 45; strong signals weigh superlinearly
      const strength = clamp(n.signal + 95, 0, 45);
      wifi += overlap * strength * (0.65 + strength / 60);
    }
    const wifiScore = Math.round(clamp(wifi, 0, 100));

    // measured airtime from max-hold peaks: average the channel's bins,
    // weight the busiest bin in so a single carrier is not diluted
    let rfScore = 0;
    let sum = 0;
    let peak = 0;
    let bins = 0;
    for (const u of usage) {
      if (u.freq < freq - 10 || u.freq > freq + 10) continue;
      const held = u.peak ?? u.usage;
      sum += held;
      peak = Math.max(peak, held);
      bins++;
    }
    if (bins > 0) rfScore = Math.round(clamp((sum / bins) * 0.6 + peak * 0.4, 0, 100));

    return {
      channel,
      freq,
      score: Math.max(wifiScore, Math.round(rfScore * 0.9)),
      wifiScore,
      rfScore,
      nonWifi: interference.some((r) => r.to >= freq - 10 && r.from <= freq + 10),
      networks: count,
      strongest,
    };
  });
}

/**
 * Interference from real airtime measurements: sustained usage on
 * frequencies no detected network occupies — microwave ovens, radar,
 * analog video, non-802.11 links. Airtime doesn't leak into neighbor
 * bins the way power does, so a geometric guard around each network
 * is sufficient.
 */
export function detectInterferenceFromUsage(
  usage: FreqUsagePoint[],
  networks: DetectedNetwork[]
): InterferenceRegion[] {
  const covered = (f: number) =>
    networks.some((n) => Math.abs(f - n.frequency) <= n.width / 2 + 6);
  // judge on max-hold peaks so pulsed sources (radar, TDD bursts) stay caught
  const isHot = (u: FreqUsagePoint) => (u.peak ?? u.usage) >= 20 && !covered(u.freq);

  const regions: InterferenceRegion[] = [];
  let start: number | null = null;
  let peak = 0;
  let hotBins = 0;

  const flush = (end: number) => {
    // require at least two adjacent hot bins (~10 MHz) so lone spikes don't register
    if (start !== null && hotBins >= 2) {
      regions.push({ from: start, to: end, peak: Math.round(peak), unit: "pct" });
    }
    start = null;
    peak = 0;
    hotBins = 0;
  };

  for (let i = 0; i < usage.length; i++) {
    const u = usage[i];
    if (isHot(u)) {
      if (start === null) start = u.freq;
      peak = Math.max(peak, u.peak ?? u.usage);
      hotBins++;
    } else if (start !== null) {
      // tolerate a single cool bin inside a region
      const next = usage[i + 1];
      if (!(next && isHot(next))) {
        flush(usage[i - 1].freq);
      }
    }
  }
  if (start !== null) flush(usage[usage.length - 1].freq);

  return regions.sort((a, b) => b.peak - a.peak).slice(0, 4);
}

const scoreLabel = (score: number) =>
  score < 20 ? "Low interference" : score < 45 ? "Moderate interference" : "Congested";

/**
 * Pick the best channel: lowest combined congestion, tie-broken by distance
 * from the strongest transmitters (prefer spectrum that is quiet *and* far
 * from noise).
 */
export function recommend(
  channels: ChannelStat[],
  networks: DetectedNetwork[],
  rangeMin: number,
  rangeMax: number
): Recommendation | null {
  const inRange = channels.filter((c) => c.freq >= rangeMin && c.freq <= rangeMax);
  if (inRange.length === 0) return null;

  const strongAPs = networks.filter((n) => n.signal > -75);
  const scored = inRange
    .map((c) => {
      const nearestStrong = strongAPs.length
        ? Math.min(...strongAPs.map((n) => Math.abs(n.frequency - c.freq)))
        : 500;
      // distance bonus caps at 100 MHz away
      const distanceBonus = clamp(nearestStrong, 0, 100) / 100;
      return { ...c, fitness: c.score - distanceBonus * 8 };
    })
    .sort((a, b) => a.fitness - b.fitness);

  const best = scored[0];
  let reason: string;
  if (best.networks === 0 && best.rfScore < 15) {
    reason = "No networks and no measured airtime on this channel";
  } else if (best.networks === 0) {
    reason = `No networks; residual airtime ${best.rfScore}/100`;
  } else {
    reason = `${best.networks} weak overlapping ${best.networks === 1 ? "network" : "networks"}, strongest at ${best.strongest} dBm`;
  }
  if (best.nonWifi) reason += " — carries non-Wi-Fi energy";

  // cleanest contiguous 40/80 MHz blocks (only on bands with a contiguous
  // 20 MHz grid — 2.4 GHz channels overlap, so blocks don't apply there).
  // A block is only as good as its worst member.
  const blocks: Recommendation["blocks"] = [];
  const contiguous = inRange.every(
    (c, i, arr) => i === 0 || c.freq - arr[i - 1].freq === 20
  );
  if (contiguous) {
    for (const width of [40, 80]) {
      const n = width / 20;
      if (inRange.length < n) continue;
      let bestBlock: Recommendation["blocks"][number] | null = null;
      for (let i = 0; i + n <= inRange.length; i++) {
        const slice = inRange.slice(i, i + n);
        const worst = Math.max(...slice.map((c) => c.score));
        if (!bestBlock || worst < bestBlock.score) {
          bestBlock = {
            width,
            freq: (slice[0].freq + slice[n - 1].freq) / 2,
            from: slice[0].freq - 10,
            to: slice[n - 1].freq + 10,
            score: worst,
          };
        }
      }
      if (bestBlock) blocks.push(bestBlock);
    }
  }

  return {
    freq: best.freq,
    channel: best.channel,
    score: best.score,
    label: scoreLabel(best.score),
    reason,
    alternates: scored.slice(1, 4).map((c) => ({
      freq: c.freq,
      channel: c.channel,
      score: c.score,
    })),
    blocks,
  };
}

/** flat-top emitter mask with quadratic skirt roll-off, dBm at frequency f */
function maskPower(center: number, width: number, peak: number, f: number): number {
  const d = Math.abs(f - center);
  const half = width / 2;
  if (d <= half) return peak;
  const excess = d - half;
  return peak - 3 - Math.pow(excess / (width * 0.22), 2) * 12;
}

/**
 * Build a spectrum envelope from the detected networks: each network is a
 * flat-top mask with quadratic skirt roll-off, power-summed onto the noise
 * floor, with light traffic ripple so consecutive sweeps read as live.
 * (RouterOS exposes no true spectral sweep over the API on modern
 * hardware — this is the visual envelope of what the scanner heard.)
 */
export function synthesizeSpectrum(
  networks: DetectedNetwork[],
  band: Band,
  rangeMin: number,
  rangeMax: number,
  t: number
): SpectrumPoint[] {
  const def = BANDS[band];
  const points: SpectrumPoint[] = [];

  for (let f = rangeMin; f <= rangeMax; f += def.step) {
    // gently undulating noise floor with fast jitter
    const noise =
      def.noise +
      Math.sin(f / 37 + t / 9) * 1.2 +
      Math.sin(f / 11 - t / 5) * 0.6;

    let mw = Math.pow(10, noise / 10);
    for (const n of networks) {
      const half = n.width / 2;
      const d = Math.abs(f - n.frequency);
      let p: number;
      if (d <= half) {
        const ripple =
          Math.sin(f / 3.1 + t * 1.7 + n.frequency) * 1.5 +
          Math.sin(t * 2.3 + n.frequency / 7) * 2;
        p = n.signal + ripple;
      } else {
        p = maskPower(n.frequency, n.width, n.signal, f);
      }
      if (p > noise - 12) mw += Math.pow(10, p / 10);
    }

    const power = 10 * Math.log10(mw) + (Math.random() - 0.5) * 1.2;
    points.push({
      freq: f,
      power: Math.round(power * 10) / 10,
      noise: Math.round(noise * 10) / 10,
    });
  }
  return points;
}

export function averageCongestion(channels: ChannelStat[]): number {
  if (channels.length === 0) return 0;
  return Math.round(
    channels.reduce((sum, c) => sum + c.score, 0) / channels.length
  );
}

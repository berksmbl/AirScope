import { BANDS, channelForFrequency } from "./bands";
import { clamp } from "./utils";
import type {
  Band,
  ChannelStat,
  Confidence,
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

/** value at percentile p (0..1) of a bin's occurrence histogram */
function percentileOf(hist: number[] | undefined, samples: number, p: number): number | null {
  if (!hist || samples <= 0) return null;
  const target = samples * p;
  let cum = 0;
  for (let i = 0; i < hist.length; i++) {
    cum += hist[i];
    if (cum >= target) return Math.min(100, i * 5 + 2.5); // bucket midpoint
  }
  return 100;
}

/**
 * Everything the scorer needs that is constant across candidate windows.
 * Building it once keeps the per-window work cheap and lets the noise
 * term be judged against the quietest part of the band actually measured.
 */
export interface ScoreContext {
  networks: DetectedNetwork[];
  usage: FreqUsagePoint[];
  interference: InterferenceRegion[];
  /** quietest measured noise floor in the sweep, dBm — the reference for the noise penalty */
  refNoise: number | null;
}

export function makeScoreContext(
  networks: DetectedNetwork[],
  usage: FreqUsagePoint[],
  interference: InterferenceRegion[] = []
): ScoreContext {
  let refNoise: number | null = null;
  for (const u of usage) {
    if (Number.isFinite(u.noise) && (refNoise === null || u.noise < refNoise)) {
      refNoise = u.noise;
    }
  }
  return { networks, usage, interference, refNoise };
}

const confidenceOf = (samples: number): Confidence =>
  samples >= 40 ? "high" : samples >= 10 ? "medium" : "low";

/** pseudo-observations of the presence-based prior, for shrinkage on thin data */
const PRIOR_WEIGHT = 5;

/**
 * Score an arbitrary channel window (center + width) — the core primitive
 * behind both the congestion profile and the recommendation. Any center
 * frequency is valid, which is what superchannel radios need.
 *
 * Two independent signals are combined:
 *
 * - `wifiScore` — *interference potential* from detected networks. In-band
 *   neighbours count by strength and overlap; neighbours just outside the
 *   window still count through an adjacent-channel skirt, because a strong
 *   carrier next door desensitises the receiver even when it never overlaps.
 *   An AP that is idle right now still belongs here: it will transmit later.
 *
 * - `rfScore` — *measured occupancy*, from the per-bin occurrence
 *   histograms rather than a max-hold peak. Max-hold only ever grows, so
 *   after a long observation every bin approaches its all-time maximum and
 *   the ranking collapses; percentiles stay stable. p50 is the typical
 *   load, p95 the near-worst case, and their spread is burstiness — which
 *   TDMA links feel more sharply than steady load. The measured noise
 *   floor is folded in here too: at equal airtime, 9 dB of extra noise is
 *   roughly a modulation step of lost capacity.
 *
 * The two are fused as `worse + 25% of the other` (never `max`, which
 * throws information away), and the measured half is shrunk toward the
 * presence prior while samples are still thin.
 */
export function scoreWindow(center: number, width: number, ctx: ScoreContext): ChannelStat {
  const half = width / 2;
  const { networks, usage, interference, refNoise } = ctx;

  // ── interference potential ──
  let wifi = 0;
  let count = 0;
  let strongest: number | null = null;
  for (const n of networks) {
    // -95 dBm -> 0, -50 dBm -> 45; strong signals weigh superlinearly
    const strength = clamp(n.signal + 95, 0, 45);
    if (strength <= 0) continue;
    const weighted = strength * (0.65 + strength / 60);

    const overlap = overlapFraction(center, width, n.frequency, n.width);
    if (overlap > 0.02) {
      count++;
      strongest = strongest === null ? n.signal : Math.max(strongest, n.signal);
      wifi += overlap * weighted;
      continue;
    }
    // adjacent-channel skirt: edge-to-edge gap, decaying with separation
    const gap = Math.abs(n.frequency - center) - (width + n.width) / 2;
    if (gap >= 0 && gap < 40) wifi += weighted * 0.35 * Math.exp(-gap / 15);
  }
  const wifiScore = Math.round(clamp(wifi, 0, 100));

  // ── measured occupancy ──
  const p50s: number[] = [];
  const p95s: number[] = [];
  let noiseSum = 0;
  let noiseBins = 0;
  let minSamples = Infinity;
  for (const u of usage) {
    if (u.freq < center - half || u.freq > center + half) continue;
    const s = u.samples ?? 0;
    const p50 = percentileOf(u.hist, s, 0.5);
    const p95 = percentileOf(u.hist, s, 0.95);
    // stored scans (and the first sweep) carry no histogram — fall back
    p50s.push(p50 ?? u.usage);
    p95s.push(p95 ?? u.peak ?? u.usage);
    minSamples = Math.min(minSamples, s);
    if (Number.isFinite(u.noise)) {
      noiseSum += u.noise;
      noiseBins++;
    }
  }

  const measuredBins = p50s.length;
  const samples = measuredBins > 0 && Number.isFinite(minSamples) ? minSamples : 0;
  // typical load across the window, but near-worst of its busiest sub-band:
  // one hot 5 MHz slice ruins the whole channel
  const p50 = measuredBins ? p50s.reduce((a, b) => a + b, 0) / measuredBins : 0;
  const p95 = measuredBins ? Math.max(...p95s) : 0;
  const burst = Math.max(0, p95 - p50);
  const noiseFloor = noiseBins ? Math.round(noiseSum / noiseBins) : null;

  // airtime + burstiness + excess noise, all on the same 0..100 scale
  const airtime = 0.55 * p50 + 0.45 * p95;
  const burstPenalty = Math.min(12, burst * 0.15);
  const noisePenalty =
    noiseFloor !== null && refNoise !== null
      ? clamp((noiseFloor - refNoise) * 2.5, 0, 25)
      : 0;
  const measured = clamp(airtime + burstPenalty + noisePenalty, 0, 100);

  // thin data leans on the presence prior; plentiful data speaks for itself
  const shrunk =
    measuredBins === 0
      ? wifiScore
      : (measured * samples + wifiScore * PRIOR_WEIGHT) / (samples + PRIOR_WEIGHT);

  const hi = Math.max(shrunk, wifiScore);
  const lo = Math.min(shrunk, wifiScore);

  return {
    channel: null,
    freq: center,
    width,
    score: Math.round(clamp(hi + lo * 0.25, 0, 100)),
    wifiScore,
    rfScore: Math.round(measured),
    p50: Math.round(p50 * 10) / 10,
    p95: Math.round(p95 * 10) / 10,
    burst: Math.round(burst * 10) / 10,
    noiseFloor,
    nonWifi: interference.some((r) => r.to >= center - half && r.from <= center + half),
    networks: count,
    strongest,
    samples,
    confidence: confidenceOf(samples),
  };
}

/**
 * Congestion as a function of center frequency: a sliding window stepped at
 * the measurement's own resolution. On superchannel radios the centre is
 * free, so a 20 MHz grid would hide most of the usable spectrum.
 */
export function congestionProfile(
  ctx: ScoreContext,
  band: Band,
  rangeMin: number,
  rangeMax: number,
  width = 20
): ChannelStat[] {
  const step = candidateStep(ctx.usage);
  const half = width / 2;
  const out: ChannelStat[] = [];
  const start = Math.ceil((rangeMin + half) / step) * step;
  for (let c = start; c + half <= rangeMax; c += step) {
    const stat = scoreWindow(c, width, ctx);
    stat.channel = channelForFrequency(c, band);
    out.push(stat);
  }
  return out;
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

/** the finest candidate spacing the measurements can honestly support */
function candidateStep(usage: FreqUsagePoint[]): number {
  if (usage.length < 2) return 5;
  let spacing = Infinity;
  for (let i = 1; i < usage.length; i++) {
    const d = usage[i].freq - usage[i - 1].freq;
    if (d > 0) spacing = Math.min(spacing, d);
  }
  return Number.isFinite(spacing) ? clamp(spacing, 1, 20) : 5;
}

/**
 * Pick the best center frequency: lowest combined congestion, tie-broken by
 * distance from the strongest transmitters (prefer spectrum that is quiet
 * *and* far from noise).
 *
 * Candidates are scanned at the measurement's own resolution (5 MHz on
 * RouterOS frequency-monitor) rather than the standard 20 MHz grid, because
 * superchannel radios can tune anywhere — the cleanest spot is often
 * between grid channels. Alternates are forced at least one channel width
 * apart so they are genuinely different options, not neighbouring offsets.
 */
export function recommend(
  ctx: ScoreContext,
  rangeMin: number,
  rangeMax: number,
  band: Band,
  opts: {
    /** width the operator will actually deploy */
    width?: number;
    /** currently shown pick — kept unless a rival wins by `margin` (anti-flap) */
    preferFreq?: number | null;
    margin?: number;
  } = {}
): Recommendation | null {
  const width = opts.width ?? 20;
  const margin = opts.margin ?? 5;
  const step = candidateStep(ctx.usage);
  const strongAPs = ctx.networks.filter((n) => n.signal > -75);

  /** every center whose full window fits inside the selected range */
  const centers = (w: number): number[] => {
    const half = w / 2;
    const out: number[] = [];
    const start = Math.ceil((rangeMin + half) / step) * step;
    for (let c = start; c + half <= rangeMax; c += step) out.push(c);
    return out;
  };

  /** a window is only as good as its busiest 20 MHz part */
  const worstSub = (center: number, w: number): ChannelStat => {
    if (w <= 20) return scoreWindow(center, w, ctx);
    let worst: ChannelStat | null = null;
    for (let sub = center - w / 2 + 10; sub <= center + w / 2 - 10; sub += 20) {
      const s = scoreWindow(sub, 20, ctx);
      if (!worst || s.score > worst.score) worst = s;
    }
    return { ...(worst as ChannelStat), freq: center, width: w };
  };

  const scored = centers(width)
    .map((c) => worstSub(c, width))
    .map((c) => {
      const nearestStrong = strongAPs.length
        ? Math.min(...strongAPs.map((n) => Math.abs(n.frequency - c.freq)))
        : 500;
      // distance bonus caps at 100 MHz away
      const distanceBonus = clamp(nearestStrong, 0, 100) / 100;
      return { ...c, fitness: c.score - distanceBonus * 8 };
    })
    .sort((a, b) => a.fitness - b.fitness);

  if (scored.length === 0) return null;

  // keep picks a full channel apart, otherwise "alternatives" are just the
  // same channel shifted by one bin
  const picks: typeof scored = [];
  for (const c of scored) {
    if (picks.every((p) => Math.abs(p.freq - c.freq) >= width)) picks.push(c);
    if (picks.length >= 4) break;
  }

  // hysteresis: a near-tie should not make the recommendation jump around
  if (opts.preferFreq != null) {
    const held = scored.find((c) => Math.abs(c.freq - opts.preferFreq!) < step / 2);
    if (held && held.fitness <= picks[0].fitness + margin) {
      const rest = picks.filter((p) => p.freq !== held.freq);
      picks.length = 0;
      picks.push(held, ...rest.slice(0, 3));
    }
  }

  const best = picks[0];
  let reason: string;
  if (best.networks === 0 && best.p95 < 15) {
    reason = "No networks and no measured airtime here";
  } else if (best.networks === 0) {
    reason = `No networks; airtime ${best.p50}% typical / ${best.p95}% peak`;
  } else {
    reason = `${best.networks} weak overlapping ${best.networks === 1 ? "network" : "networks"}, strongest at ${best.strongest} dBm`;
  }
  if (best.burst >= 25) reason += `, bursty (+${Math.round(best.burst)}%)`;
  if (best.nonWifi) reason += " — carries non-Wi-Fi energy";
  if (best.confidence === "low") reason += " · still gathering samples";

  // Wider bonded channels than the deployed width, for planning ahead
  const blocks: Recommendation["blocks"] = [];
  for (const w of [40, 80]) {
    if (w <= width || rangeMax - rangeMin < w) continue;
    let bestBlock: Recommendation["blocks"][number] | null = null;
    for (const center of centers(w)) {
      const s = worstSub(center, w);
      if (!bestBlock || s.score < bestBlock.score) {
        bestBlock = {
          width: w,
          freq: center,
          from: center - w / 2,
          to: center + w / 2,
          score: s.score,
        };
      }
    }
    if (bestBlock) blocks.push(bestBlock);
  }

  return {
    freq: best.freq,
    channel: channelForFrequency(best.freq, band),
    width,
    score: best.score,
    label: scoreLabel(best.score),
    reason,
    confidence: best.confidence,
    stat: best,
    alternates: picks.slice(1, 4).map((c) => ({
      freq: c.freq,
      channel: channelForFrequency(c.freq, band),
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

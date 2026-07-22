"use client";

import { useMemo, useState } from "react";
import { Grid3X3, Radio } from "lucide-react";
import { Card, Segmented } from "./ui";
import { cn, lerpColor } from "@/lib/utils";
import type { Scanner } from "@/hooks/useScanner";
import type { ChannelStat } from "@/lib/types";

/** green (clean) → yellow (moderate) → red (congested) */
const HEAT_STOPS = ["#0ca30c", "#7ab00d", "#fab219", "#ec835a", "#d03b3b"];

export const heatColor = (score: number) => lerpColor(HEAT_STOPS, score / 100);

function Tooltip({ c, leftPct }: { c: ChannelStat; leftPct: number }) {
  // keep the card inside the panel at both ends of the strip
  const shift = leftPct < 18 ? "0%" : leftPct > 82 ? "-100%" : "-50%";
  return (
    <div
      className="card pointer-events-none absolute top-full z-20 mt-2 w-56 px-3 py-2 text-[11.5px] shadow-xl"
      style={{ left: `${leftPct}%`, transform: `translateX(${shift})` }}
    >
      <div className="mono mb-1 font-semibold text-ink">
        {c.freq} MHz · {c.width} MHz wide
        {c.channel !== null && <span className="text-ink-3"> · ch {c.channel}</span>}
      </div>
      <div className="flex justify-between text-ink-2">
        <span>Congestion</span>
        <span className="mono text-ink">{c.score}/100</span>
      </div>
      <div className="flex justify-between text-ink-2">
        <span>Airtime typ / peak</span>
        <span className="mono">
          {c.p50}% / {c.p95}%
        </span>
      </div>
      {c.burst >= 10 && (
        <div className="flex justify-between text-ink-2">
          <span>Burstiness</span>
          <span className="mono text-warn">+{c.burst}%</span>
        </div>
      )}
      {c.noiseFloor !== null && (
        <div className="flex justify-between text-ink-2">
          <span>Noise floor</span>
          <span className="mono">{c.noiseFloor} dBm</span>
        </div>
      )}
      <div className="flex justify-between text-ink-2">
        <span>Networks</span>
        <span className="mono">
          {c.networks}
          {c.strongest !== null && ` · ${c.strongest} dBm`}
        </span>
      </div>
      <div className="mt-1 flex justify-between border-t border-line pt-1 text-ink-3">
        <span>{c.samples} samples</span>
        <span
          className={cn(
            c.confidence === "high"
              ? "text-good"
              : c.confidence === "medium"
                ? "text-warn"
                : "text-critical"
          )}
        >
          {c.confidence} confidence
        </span>
      </div>
      {c.nonWifi && <div className="mt-0.5 text-warn">⚠ non–Wi-Fi energy</div>}
    </div>
  );
}

export function ChannelHeatmap({ scanner }: { scanner: Scanner }) {
  const {
    snapshot,
    focus,
    setFocus,
    hoverFreq,
    setHoverFreq,
    recommendation,
    interference,
    sector,
    width,
    setWidth,
    range,
  } = scanner;
  const profile = useMemo(() => snapshot?.channels ?? [], [snapshot]);
  const active = sector?.channel ?? null;
  /** true only while the pointer is over this strip */
  const [overStrip, setOverStrip] = useState(false);

  // ticks every 100 MHz across the swept range
  const ticks = useMemo(() => {
    const out: number[] = [];
    const startTick = Math.ceil(range[0] / 100) * 100;
    for (let f = startTick; f <= range[1]; f += 100) out.push(f);
    return out;
  }, [range]);

  const pctOf = (freq: number) =>
    ((freq - range[0]) / Math.max(1, range[1] - range[0])) * 100;

  // the point under the shared crosshair — also fires when hovering the
  // spectrum or usage chart, so all four views explain the same frequency
  const hovered = useMemo(() => {
    if (hoverFreq === null || profile.length === 0) return null;
    let best: ChannelStat | null = null;
    let bestDist = Infinity;
    for (const c of profile) {
      const d = Math.abs(c.freq - hoverFreq);
      if (d < bestDist) {
        bestDist = d;
        best = c;
      }
    }
    return bestDist <= 10 ? best : null;
  }, [hoverFreq, profile]);

  return (
    <Card
      // every .card retains a transform from its entry animation, which makes
      // it a stacking context — later cards would paint over a tooltip that
      // reaches past this card's edge, so lift the whole card while it is open
      className={overStrip ? "relative z-30" : undefined}
      title="Channel congestion"
      icon={<Grid3X3 size={14} />}
      actions={
        <>
          <Segmented<string>
            options={[
              { value: "20", label: "20" },
              { value: "40", label: "40" },
              { value: "80", label: "80" },
            ]}
            value={String(width)}
            onChange={(v) => setWidth(Number(v))}
          />
          <div className="hidden items-center gap-1.5 text-[10.5px] text-ink-3 sm:flex">
            clean
            <span
              className="h-1.5 w-16 rounded-full"
              style={{ background: `linear-gradient(90deg, ${HEAT_STOPS.join(", ")})` }}
            />
            busy
          </div>
        </>
      }
    >
      {profile.length === 0 ? (
        <div className="grid h-32 place-items-center text-[13px] text-ink-3">
          Start a scan to map channel usage
        </div>
      ) : (
        <div className="p-4 pt-3">
          <p className="mb-2 text-[11.5px] text-ink-3">
            Congestion of a {width} MHz channel centred at each frequency — stepped at
            the measurement resolution, since a superchannel radio can sit anywhere.
          </p>

          {/* sliding-window congestion strip — the tooltip lives outside the
              clipped strip so it is not cut off at the top edge */}
          <div className="relative">
            {/* the tooltip belongs to the chart the pointer is actually on;
                the crosshair below still follows hovers from other charts */}
            {overStrip && hovered && (
              <Tooltip c={hovered} leftPct={pctOf(hovered.freq)} />
            )}

            <div
              className="flex h-14 overflow-hidden rounded-lg border border-line"
              onMouseEnter={() => setOverStrip(true)}
              onMouseLeave={() => {
                setOverStrip(false);
                setHoverFreq(null);
              }}
            >
              {profile.map((c) => {
                const isFocused = focus?.kind === "channel" && focus.key === c.freq;
                const isHovered = hovered?.freq === c.freq;
                return (
                  <button
                    key={c.freq}
                    type="button"
                    className="relative h-full flex-1 transition-[filter] hover:brightness-125"
                    style={{ backgroundColor: heatColor(c.score) }}
                    onMouseEnter={() => setHoverFreq(c.freq)}
                    onClick={() =>
                      setFocus(isFocused ? null : { kind: "channel", key: c.freq })
                    }
                    aria-label={`${c.freq} MHz, congestion ${c.score}`}
                  >
                    {(isFocused || isHovered) && (
                      <span className="pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-white mix-blend-difference" />
                    )}
                  </button>
                );
              })}
            </div>

            {/* our own service channel */}
            {active && active.freq >= range[0] && active.freq <= range[1] && (
              <span
                className="pointer-events-none absolute -top-1 -bottom-1 border-x-2 border-[var(--good)]"
                style={{
                  left: `${pctOf(active.freq - active.width / 2)}%`,
                  width: `${(active.width / Math.max(1, range[1] - range[0])) * 100}%`,
                }}
                title={`Serving on ${active.freq} MHz`}
              />
            )}

            {/* recommended centre */}
            {recommendation &&
              recommendation.freq >= range[0] &&
              recommendation.freq <= range[1] && (
                <span
                  className="pointer-events-none absolute -top-2 grid -translate-x-1/2 place-items-center text-[10px] font-bold text-ink"
                  style={{ left: `${pctOf(recommendation.freq)}%` }}
                  title={`Recommended: ${recommendation.freq} MHz`}
                >
                  ★
                </span>
              )}
          </div>

          {/* frequency axis */}
          <div className="relative mt-1 h-4">
            {ticks.map((f) => (
              <span
                key={f}
                className="mono absolute -translate-x-1/2 text-[10px] text-ink-3"
                style={{ left: `${pctOf(f)}%` }}
              >
                {f}
              </span>
            ))}
          </div>

          <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-ink-3">
            <span className="flex items-center gap-1.5">
              <span className="text-ink">★</span> recommended
            </span>
            {active && (
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-3 w-2 border-x-2 border-[var(--good)]" />
                active channel
              </span>
            )}
            <span className="ml-auto">hover a point for the full breakdown</span>
          </div>
        </div>
      )}

      {profile.length > 0 && interference.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 border-t border-line px-4 py-2.5">
          <span className="section-label mr-1 flex items-center gap-1.5 text-warn">
            <Radio size={12} /> Non–Wi-Fi RF
          </span>
          {interference.map((r) => {
            const center = Math.round((r.from + r.to) / 2);
            const isActive = focus?.kind === "channel" && focus.key === center;
            return (
              <button
                key={`${r.from}-${r.to}`}
                type="button"
                onClick={() =>
                  setFocus(isActive ? null : { kind: "channel", key: center })
                }
                className={cn(
                  "mono rounded-full border px-2 py-0.5 text-[11px] transition-colors",
                  isActive
                    ? "border-warn bg-warn/15 text-warn"
                    : "border-warn/35 bg-warn/8 text-warn hover:bg-warn/15"
                )}
                title="Energy with no matching network — click to highlight on the spectrum"
              >
                {r.from === r.to ? `${r.from}` : `${r.from}–${r.to}`} MHz · peak{" "}
                {r.unit === "pct" ? `${r.peak}%` : `${r.peak} dBm`}
              </button>
            );
          })}
        </div>
      )}
    </Card>
  );
}

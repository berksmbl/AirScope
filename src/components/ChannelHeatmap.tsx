"use client";

import { Grid3X3, Radio } from "lucide-react";
import { Card } from "./ui";
import { BANDS } from "@/lib/bands";
import { cn, lerpColor } from "@/lib/utils";
import type { Scanner } from "@/hooks/useScanner";

/** green (clean) → yellow (moderate) → red (congested) */
const HEAT_STOPS = ["#0ca30c", "#7ab00d", "#fab219", "#ec835a", "#d03b3b"];

export const heatColor = (score: number) => lerpColor(HEAT_STOPS, score / 100);

export function ChannelHeatmap({ scanner }: { scanner: Scanner }) {
  const { snapshot, focus, setFocus, hoverFreq, setHoverFreq, recommendation, interference, band } =
    scanner;
  const channels = snapshot?.channels ?? [];
  const labelByFreq = BANDS[band].labelBy === "freq";

  return (
    <Card
      title="Channel congestion"
      icon={<Grid3X3 size={14} />}
      actions={
        <div className="flex items-center gap-1.5 text-[10.5px] text-ink-3">
          clean
          <span
            className="h-1.5 w-20 rounded-full"
            style={{
              background: `linear-gradient(90deg, ${HEAT_STOPS.join(", ")})`,
            }}
          />
          congested
        </div>
      }
    >
      {channels.length === 0 ? (
        <div className="grid h-40 place-items-center text-[13px] text-ink-3">
          Start a scan to map channel usage
        </div>
      ) : (
        <div
          className="grid grid-cols-[repeat(auto-fill,minmax(64px,1fr))] gap-1.5 p-4"
          onMouseLeave={() => setHoverFreq(null)}
        >
          {channels.map((c) => {
            const isFocused = focus?.kind === "channel" && focus.key === c.freq;
            const isBest = recommendation?.freq === c.freq;
            const isHovered = hoverFreq !== null && Math.abs(hoverFreq - c.freq) <= 10;
            const dark = c.score > 40;
            return (
              <button
                key={c.channel}
                type="button"
                onMouseEnter={() => setHoverFreq(c.freq)}
                onClick={() =>
                  setFocus(isFocused ? null : { kind: "channel", key: c.freq })
                }
                title={`Channel ${c.channel} · ${c.freq} MHz · congestion ${c.score}/100 (Wi-Fi ${c.wifiScore} · RF usage ${c.rfScore}) · ${c.networks} network(s)${c.strongest !== null ? ` · strongest ${c.strongest} dBm` : ""}${c.nonWifi ? " · ⚠ non-Wi-Fi energy" : ""}`}
                className={cn(
                  "heat-cell relative flex aspect-[1.5] flex-col items-center justify-center rounded-lg",
                  isFocused && "ring-2 ring-[var(--accent)] ring-offset-2 ring-offset-[var(--panel)]",
                  isBest && !isFocused && "ring-1 ring-white/40",
                  isHovered && !isFocused && "ring-2 ring-ink/60"
                )}
                style={{ backgroundColor: heatColor(c.score) }}
              >
                <span
                  className={cn(
                    "font-semibold leading-none",
                    labelByFreq ? "mono text-[11px]" : "text-[13px]",
                    dark ? "text-white" : "text-black/80"
                  )}
                >
                  {labelByFreq ? c.freq : c.channel}
                </span>
                <span
                  className={cn(
                    "mono mt-0.5 text-[9.5px] leading-none",
                    dark ? "text-white/75" : "text-black/55"
                  )}
                >
                  {c.score}
                </span>
                {isBest && (
                  <span className="absolute -top-1 -right-1 grid size-3.5 place-items-center rounded-full bg-white text-[8px] font-bold text-black shadow">
                    ★
                  </span>
                )}
                {c.nonWifi && (
                  <span
                    className="absolute -top-1 -left-1 grid size-3.5 place-items-center rounded-full bg-black/80 text-white shadow"
                    aria-label="non-Wi-Fi energy"
                  >
                    <Radio size={8} />
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
      {channels.length > 0 && interference.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 border-t border-line px-4 py-2.5">
          <span className="section-label mr-1 flex items-center gap-1.5 text-warn">
            <Radio size={12} /> Non–Wi-Fi RF
          </span>
          {interference.map((r) => {
            const center = Math.round((r.from + r.to) / 2);
            const active = focus?.kind === "channel" && focus.key === center;
            return (
              <button
                key={`${r.from}-${r.to}`}
                type="button"
                onClick={() =>
                  setFocus(active ? null : { kind: "channel", key: center })
                }
                className={cn(
                  "mono rounded-full border px-2 py-0.5 text-[11px] transition-colors",
                  active
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
      {channels.length > 0 && (
        <p className="border-t border-line px-4 py-2 text-[11.5px] text-ink-3">
          Cell = 20 MHz channel · score = worse of Wi-Fi congestion and raw RF usage ·
          ★ = recommended · <Radio size={10} className="inline -mt-0.5" /> = non-Wi-Fi
          energy · click to highlight on the spectrum
        </p>
      )}
    </Card>
  );
}

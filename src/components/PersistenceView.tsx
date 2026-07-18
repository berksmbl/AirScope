"use client";

import { useEffect, useRef } from "react";
import { USAGE_HIST_BUCKETS } from "@/lib/types";
import { clamp } from "@/lib/utils";
import type { FreqUsagePoint } from "@/lib/types";

/**
 * Mimosa-style persistence display: each frequency column is painted by how
 * OFTEN each airtime level occurs (CDF over sweeps). Red = the level is
 * exceeded on every sweep (baseline), purple = reached only rarely (bursts).
 * This separates a constantly-busy channel from an occasional TDD burst —
 * both of which look identical in a plain max-hold trace.
 */

// CDF 1 (always) → 0 (rare): red → orange → yellow → green → cyan → blue → purple
const CDF_STOPS: [number, [number, number, number]][] = [
  [1.0, [214, 40, 40]],
  [0.8, [244, 121, 31]],
  [0.6, [250, 199, 16]],
  [0.4, [76, 185, 68]],
  [0.25, [28, 189, 209]],
  [0.1, [43, 92, 230]],
  [0.0, [124, 51, 185]],
];

function cdfColor(t: number): [number, number, number] {
  const x = clamp(t, 0, 1);
  for (let i = 0; i < CDF_STOPS.length - 1; i++) {
    const [hi, cHi] = CDF_STOPS[i];
    const [lo, cLo] = CDF_STOPS[i + 1];
    if (x <= hi && x >= lo) {
      const f = hi === lo ? 0 : (x - lo) / (hi - lo);
      return [
        Math.round(cLo[0] + (cHi[0] - cLo[0]) * f),
        Math.round(cLo[1] + (cHi[1] - cLo[1]) * f),
        Math.round(cLo[2] + (cHi[2] - cLo[2]) * f),
      ];
    }
  }
  return CDF_STOPS[0][1];
}

export function PersistenceView({
  usage,
  domain,
  height = 200,
  hoverFreq,
  onHover,
}: {
  usage: FreqUsagePoint[];
  domain: [number, number];
  height?: number;
  /** shared crosshair frequency, MHz */
  hoverFreq?: number | null;
  onHover?: (freq: number | null) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const freqFromPointer = (clientX: number): number | null => {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return null;
    const t = (clientX - rect.left) / rect.width;
    return domain[0] + t * (domain[1] - domain[0]);
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const W = 480;
    const H = 160;
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const img = ctx.createImageData(W, H);
    const [lo, hi] = domain;
    const span = hi - lo || 1;

    // index bins by frequency for nearest-neighbor column lookup
    const bins = usage.filter((u) => u.hist && (u.samples ?? 0) > 0);
    if (bins.length === 0) {
      ctx.putImageData(img, 0, 0);
      return;
    }
    let spacing = 5;
    for (let i = 1; i < bins.length; i++) {
      spacing = Math.min(spacing, bins[i].freq - bins[i - 1].freq || spacing);
    }

    // precompute per-bin exceedance counts from the top bucket down
    const exceed = bins.map((b) => {
      const cum = new Array<number>(USAGE_HIST_BUCKETS).fill(0);
      let run = 0;
      for (let k = USAGE_HIST_BUCKETS - 1; k >= 0; k--) {
        run += b.hist![k];
        cum[k] = run;
      }
      return { freq: b.freq, cum, samples: b.samples! };
    });

    let bi = 0;
    for (let x = 0; x < W; x++) {
      const f = lo + (span * x) / (W - 1);
      // advance to the nearest bin (bins are sorted by freq)
      while (bi < exceed.length - 1 && Math.abs(exceed[bi + 1].freq - f) < Math.abs(exceed[bi].freq - f)) {
        bi++;
      }
      const bin = exceed[bi];
      if (Math.abs(bin.freq - f) > spacing) continue; // gap: leave background

      for (let y = 0; y < H; y++) {
        const level = (1 - y / H) * 100; // top = 100 % airtime
        const k = Math.min(USAGE_HIST_BUCKETS - 1, Math.floor(level / 5));
        const p = bin.cum[k] / bin.samples;
        if (p <= 0) continue; // never reached: background shows through
        const [r, g, b] = cdfColor(p);
        const o = (y * W + x) * 4;
        img.data[o] = r;
        img.data[o + 1] = g;
        img.data[o + 2] = b;
        img.data[o + 3] = 255;
      }
      bi = Math.max(0, bi - 1); // allow re-evaluation for the next column
    }
    ctx.putImageData(img, 0, 0);
  }, [usage, domain]);

  const sweeps = usage.reduce((m, u) => Math.max(m, u.samples ?? 0), 0);

  const hoverPct =
    hoverFreq !== null &&
    hoverFreq !== undefined &&
    hoverFreq >= domain[0] &&
    hoverFreq <= domain[1]
      ? ((hoverFreq - domain[0]) / (domain[1] - domain[0] || 1)) * 100
      : null;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex gap-2">
        {/* y-axis labels */}
        <div
          className="mono flex flex-col justify-between py-0.5 text-right text-[10px] text-ink-3"
          style={{ height }}
        >
          <span>100%</span>
          <span>50%</span>
          <span>0%</span>
        </div>
        <div
          ref={wrapRef}
          className="relative min-w-0 flex-1 overflow-hidden rounded-lg border border-line bg-panel-2"
          onPointerMove={(e) => onHover?.(freqFromPointer(e.clientX))}
          onPointerLeave={() => onHover?.(null)}
        >
          <canvas
            ref={canvasRef}
            className="block h-full w-full"
            style={{ height, imageRendering: "auto" }}
            role="img"
            aria-label="Persistence view: how often each airtime level occurs per frequency"
          />
          {hoverPct !== null && (
            <>
              <div
                className="pointer-events-none absolute inset-y-0 border-l border-dashed border-white/70 mix-blend-difference"
                style={{ left: `${hoverPct}%` }}
                aria-hidden
              />
              <span
                className="mono pointer-events-none absolute top-1 rounded bg-black/60 px-1 text-[10px] text-white"
                style={{
                  left: `${hoverPct}%`,
                  transform: hoverPct > 88 ? "translateX(-100%)" : "translateX(4px)",
                }}
              >
                {hoverFreq} MHz
              </span>
            </>
          )}
        </div>
      </div>
      <div className="flex items-center justify-between pl-8">
        <span className="mono text-[10px] text-ink-3">{domain[0]} MHz</span>
        <span className="flex items-center gap-1.5 text-[10px] text-ink-3">
          always
          <span
            className="h-1.5 w-24 rounded-full"
            style={{
              background:
                "linear-gradient(90deg, rgb(214,40,40), rgb(250,199,16), rgb(76,185,68), rgb(28,189,209), rgb(43,92,230), rgb(124,51,185))",
            }}
          />
          rare · {sweeps} sweeps
        </span>
        <span className="mono text-[10px] text-ink-3">{domain[1]} MHz</span>
      </div>
    </div>
  );
}

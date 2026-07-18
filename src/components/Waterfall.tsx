"use client";

import { useEffect, useRef } from "react";
import { clamp } from "@/lib/utils";
import type { SpectrumPoint } from "@/lib/types";

/**
 * Spectrogram-style waterfall: rows are sweeps (newest on top), columns are
 * frequency bins. Inferno-like ramp — perceptually ordered dark→bright, the
 * convention for RF waterfalls.
 */
const RAMP: [number, number, number][] = [
  [8, 6, 24],      // near-black indigo
  [59, 15, 112],   // deep violet
  [140, 41, 129],  // magenta
  [222, 73, 104],  // rose
  [254, 159, 109], // orange
  [252, 253, 191], // pale yellow
];

function rampColor(t: number): [number, number, number] {
  const x = clamp(t, 0, 1) * (RAMP.length - 1);
  const i = Math.min(Math.floor(x), RAMP.length - 2);
  const f = x - i;
  const a = RAMP[i];
  const b = RAMP[i + 1];
  return [
    a[0] + (b[0] - a[0]) * f,
    a[1] + (b[1] - a[1]) * f,
    a[2] + (b[2] - a[2]) * f,
  ];
}

export function Waterfall({
  frames,
  domain,
  noiseFloor,
  height = 110,
  hoverFreq,
  onHover,
}: {
  frames: SpectrumPoint[][];
  domain: [number, number];
  noiseFloor: number;
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
    if (!canvas || frames.length === 0) return;

    const cols = 360;
    const rows = frames.length;
    canvas.width = cols;
    canvas.height = rows;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const img = ctx.createImageData(cols, rows);
    const [lo, hi] = domain;
    const span = hi - lo;
    const floor = noiseFloor - 3;
    const ceil = -45;

    for (let r = 0; r < rows; r++) {
      const frame = frames[rows - 1 - r]; // newest sweep at top
      if (frame.length === 0) continue;
      for (let c = 0; c < cols; c++) {
        const freq = lo + (span * c) / (cols - 1);
        // nearest sample (frames are evenly spaced in freq)
        const idx = clamp(
          Math.round(((freq - frame[0].freq) / (frame[frame.length - 1].freq - frame[0].freq || 1)) * (frame.length - 1)),
          0,
          frame.length - 1
        );
        const p = frame[idx];
        const t = (p.power - floor) / (ceil - floor);
        const [rr, gg, bb] = rampColor(t);
        const o = (r * cols + c) * 4;
        img.data[o] = rr;
        img.data[o + 1] = gg;
        img.data[o + 2] = bb;
        img.data[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }, [frames, domain, noiseFloor]);

  const hoverPct =
    hoverFreq !== null &&
    hoverFreq !== undefined &&
    hoverFreq >= domain[0] &&
    hoverFreq <= domain[1]
      ? ((hoverFreq - domain[0]) / (domain[1] - domain[0] || 1)) * 100
      : null;

  return (
    <div className="overflow-hidden rounded-lg border border-line">
      <div
        ref={wrapRef}
        className="relative"
        onPointerMove={(e) => onHover?.(freqFromPointer(e.clientX))}
        onPointerLeave={() => onHover?.(null)}
      >
        <canvas
          ref={canvasRef}
          className="block w-full"
          style={{ height, imageRendering: "auto" }}
          role="img"
          aria-label="Spectral waterfall of recent sweeps"
        />
        {hoverPct !== null && (
          <div
            className="pointer-events-none absolute inset-y-0 border-l border-dashed border-white/70 mix-blend-difference"
            style={{ left: `${hoverPct}%` }}
            aria-hidden
          />
        )}
      </div>
      <div className="flex items-center justify-between bg-panel-2 px-2.5 py-1">
        <span className="mono text-[10px] text-ink-3">{domain[0]} MHz</span>
        <span className="flex items-center gap-1.5 text-[10px] text-ink-3">
          quiet
          <span
            className="h-1.5 w-16 rounded-full"
            style={{
              background:
                "linear-gradient(90deg, rgb(8,6,24), rgb(140,41,129), rgb(254,159,109), rgb(252,253,191))",
            }}
          />
          busy
        </span>
        <span className="mono text-[10px] text-ink-3">{domain[1]} MHz</span>
      </div>
    </div>
  );
}

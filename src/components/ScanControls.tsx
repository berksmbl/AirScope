"use client";

import { Activity, Pause, Play, SlidersHorizontal } from "lucide-react";
import { Button, Card, Field, Segmented } from "./ui";
import { BANDS, BAND_ORDER } from "@/lib/bands";
import { clamp } from "@/lib/utils";
import type { Scanner } from "@/hooks/useScanner";
import type { Band, ScanMode } from "@/lib/types";

function DualRange({
  min,
  max,
  value,
  onChange,
}: {
  min: number;
  max: number;
  value: [number, number];
  onChange: (lo: number, hi: number) => void;
}) {
  const [lo, hi] = value;
  const pct = (v: number) => ((v - min) / (max - min)) * 100;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="relative h-5">
        {/* track */}
        <div className="absolute top-1/2 h-1 w-full -translate-y-1/2 rounded-full bg-panel-3" />
        <div
          className="absolute top-1/2 h-1 -translate-y-1/2 rounded-full bg-accent/70"
          style={{ left: `${pct(lo)}%`, width: `${pct(hi) - pct(lo)}%` }}
        />
        {/* two thumbs: upper input only captures events near its thumb */}
        <input
          type="range"
          min={min}
          max={max}
          step={5}
          value={lo}
          onChange={(e) => onChange(clamp(Number(e.target.value), min, hi - 20), hi)}
          className="dual-thumb absolute inset-0 w-full appearance-none bg-transparent pointer-events-none
            [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:appearance-none
            [&::-webkit-slider-thumb]:size-3.5 [&::-webkit-slider-thumb]:rounded-full
            [&::-webkit-slider-thumb]:bg-accent [&::-webkit-slider-thumb]:border-2
            [&::-webkit-slider-thumb]:border-white/80 [&::-webkit-slider-thumb]:cursor-grab
            [&::-moz-range-thumb]:pointer-events-auto [&::-moz-range-thumb]:size-3.5
            [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-accent
            [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-white/80"
        />
        <input
          type="range"
          min={min}
          max={max}
          step={5}
          value={hi}
          onChange={(e) => onChange(lo, clamp(Number(e.target.value), lo + 20, max))}
          className="dual-thumb absolute inset-0 w-full appearance-none bg-transparent pointer-events-none
            [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:appearance-none
            [&::-webkit-slider-thumb]:size-3.5 [&::-webkit-slider-thumb]:rounded-full
            [&::-webkit-slider-thumb]:bg-accent [&::-webkit-slider-thumb]:border-2
            [&::-webkit-slider-thumb]:border-white/80 [&::-webkit-slider-thumb]:cursor-grab
            [&::-moz-range-thumb]:pointer-events-auto [&::-moz-range-thumb]:size-3.5
            [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-accent
            [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-white/80"
        />
      </div>
      <div className="flex justify-between">
        <span className="mono text-[11px] text-ink-3">{lo} MHz</span>
        <span className="mono text-[11px] text-ink-3">{hi} MHz</span>
      </div>
    </div>
  );
}

export function ScanControls({ scanner }: { scanner: Scanner }) {
  const {
    band,
    setBand,
    range,
    setFreqRange,
    mode,
    setMode,
    scanning,
    setScanning,
    scanError,
    connState,
    collectingFor,
  } = scanner;

  const def = BANDS[band];
  const connected = connState === "connected";

  return (
    <Card title="Scan control" icon={<SlidersHorizontal size={14} />}>
      <div className="flex flex-col gap-3.5 p-4">
        <Field label="Band">
          <Segmented<Band>
            options={BAND_ORDER.map((b) => ({ value: b, label: BANDS[b].label }))}
            value={band}
            onChange={setBand}
          />
        </Field>

        <Field label="Frequency range">
          <DualRange
            min={def.min}
            max={def.max}
            value={range}
            onChange={setFreqRange}
          />
        </Field>

        <Field label="Scan mode">
          <Segmented<ScanMode>
            options={[
              { value: "scan", label: "Networks" },
              { value: "usage", label: "Freq. usage" },
            ]}
            value={mode}
            onChange={setMode}
          />
        </Field>

        <Button
          variant={scanning ? "danger" : "primary"}
          className="h-9 text-[13.5px]"
          disabled={!connected}
          title={connected ? undefined : "Connect to a device first"}
          onClick={() => setScanning(!scanning)}
        >
          {scanning ? (
            <>
              <Pause size={15} /> Stop scan
            </>
          ) : (
            <>
              <Play size={15} /> Start scan
            </>
          )}
        </Button>

        {!connected && (
          <p className="text-center text-[11.5px] text-ink-3">
            Connect to a MikroTik above to start scanning
          </p>
        )}

        {scanning && (
          <>
            <div className="sweep-bar h-1 rounded-full bg-panel-3" aria-hidden />
            {collectingFor > 0 && (
              <p className="mono text-center text-[11px] text-ink-3">
                {mode === "usage" ? "sweeping" : "collecting"} for {collectingFor}s
              </p>
            )}
          </>
        )}

        {scanError && (
          <p className="flex items-center gap-1.5 rounded-lg border border-critical/30 bg-critical/10 px-3 py-2 text-[12px] text-critical">
            <Activity size={13} /> {scanError}
          </p>
        )}
      </div>
    </Card>
  );
}

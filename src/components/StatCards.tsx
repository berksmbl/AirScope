"use client";

import { Antenna, GaugeCircle, Signal, Waves } from "lucide-react";
import { heatColor } from "./ChannelHeatmap";
import type { Scanner } from "@/hooks/useScanner";
import type { ReactNode } from "react";

function Tile({
  icon,
  label,
  value,
  suffix,
  hint,
  accent,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  suffix?: string;
  hint?: string;
  accent?: string;
}) {
  return (
    <div className="card rise-in flex items-center gap-3 px-4 py-3">
      <span
        className="grid size-9 shrink-0 place-items-center rounded-lg"
        style={{
          color: accent ?? "var(--accent)",
          backgroundColor: "color-mix(in srgb, currentColor 12%, transparent)",
        }}
      >
        {icon}
      </span>
      <div className="min-w-0">
        <div className="section-label">{label}</div>
        <div className="flex items-baseline gap-1">
          <span className="mono text-[20px] font-semibold leading-tight text-ink">
            {value}
          </span>
          {suffix && <span className="text-[11.5px] text-ink-3">{suffix}</span>}
        </div>
        {hint && <div className="truncate text-[11px] text-ink-3">{hint}</div>}
      </div>
    </div>
  );
}

export function StatCards({ scanner }: { scanner: Scanner }) {
  const { snapshot, avgCongestion, recommendation, interference } = scanner;
  const nets = snapshot?.networks ?? [];
  const strongest = nets[0];

  return (
    <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
      <Tile
        icon={<Antenna size={17} />}
        label="Networks found"
        value={snapshot ? String(nets.length) : "—"}
        hint={strongest ? `strongest: ${strongest.ssid}` : undefined}
      />
      <Tile
        icon={<GaugeCircle size={17} />}
        label="Avg congestion"
        value={snapshot ? String(avgCongestion) : "—"}
        suffix="/100"
        accent={snapshot ? heatColor(avgCongestion) : undefined}
        hint={
          snapshot
            ? avgCongestion < 20
              ? "spectrum is quiet"
              : avgCongestion < 45
                ? "moderate usage"
                : "heavy usage"
            : undefined
        }
      />
      <Tile
        icon={<Signal size={17} />}
        label="Best channel"
        value={recommendation ? String(recommendation.freq) : "—"}
        suffix={recommendation ? "MHz" : undefined}
        accent="var(--good)"
        hint={recommendation ? recommendation.label : undefined}
      />
      <Tile
        icon={<Waves size={17} />}
        label="Noise floor"
        value={snapshot ? String(snapshot.noiseFloor) : "—"}
        suffix={snapshot ? "dBm" : undefined}
        accent={interference.length > 0 ? "var(--warn)" : "var(--series-5)"}
        hint={
          snapshot
            ? interference.length > 0
              ? `${interference.length} non–Wi-Fi source${interference.length > 1 ? "s" : ""} on air`
              : `${snapshot.mode === "usage" ? "freq. usage" : "network"} scan`
            : undefined
        }
      />
    </div>
  );
}

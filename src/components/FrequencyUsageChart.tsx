"use client";

import { useMemo, useState } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { BarChart3, Download, RotateCcw } from "lucide-react";
import { Button, Card, Chip, Segmented } from "./ui";
import { PersistenceView } from "./PersistenceView";
import { channelForFrequency } from "@/lib/bands";
import { downloadCsv, timeAgo } from "@/lib/utils";
import type { Scanner } from "@/hooks/useScanner";

interface UsageTooltipEntry {
  value?: number | string;
  dataKey?: string | number;
}

function UsageTooltip({
  active,
  label,
  payload,
  band,
}: {
  active?: boolean;
  label?: number | string;
  payload?: UsageTooltipEntry[];
  band: "2g" | "5g" | "6g";
}) {
  if (!active || label === undefined || !payload?.length) return null;
  const freq = Number(label);
  const usage = payload.find((p) => p.dataKey === "usage")?.value;
  const peak = payload.find((p) => p.dataKey === "peak")?.value;
  const chan = channelForFrequency(freq, band);
  return (
    <div className="card min-w-36 px-3 py-2 text-[12px] shadow-xl">
      <div className="mono mb-0.5 font-semibold text-ink">
        {freq} MHz{chan !== null && <span className="text-ink-3"> · ch {chan}</span>}
      </div>
      <div className="flex justify-between gap-4 text-ink-2">
        <span>Airtime</span>
        <span className="mono text-ink">{usage}%</span>
      </div>
      {peak !== undefined && (
        <div className="flex justify-between gap-4 text-ink-2">
          <span>Max hold</span>
          <span className="mono text-ink">{peak}%</span>
        </div>
      )}
    </div>
  );
}

export function FrequencyUsageChart({ scanner }: { scanner: Scanner }) {
  const {
    snapshot,
    range,
    focus,
    setFocus,
    hoverFreq,
    setHoverFreq,
    interference,
    band,
    recommendation,
    compareScan,
    resetUsagePeaks,
  } = scanner;
  const usage = useMemo(
    () =>
      (snapshot?.usage ?? [])
        .filter((u) => u.freq >= range[0] && u.freq <= range[1])
        .map((u) => ({ ...u, peak: u.peak ?? u.usage })),
    [snapshot, range]
  );
  const live = snapshot?.usageLive ?? false;
  const usageAt = snapshot?.usageAt ?? null;
  const [view, setView] = useState<"chart" | "cdf">("chart");
  const hasHist = usage.some((u) => u.hist && (u.samples ?? 0) > 0);

  const compareUsage = useMemo(
    () =>
      (compareScan?.stored.usage ?? []).filter(
        (u) => u.freq >= range[0] && u.freq <= range[1]
      ),
    [compareScan, range]
  );

  // sweep-fill progress (real monitor walks the band bin by bin)
  const progress = useMemo(() => {
    if (!live || usage.length < 2) return null;
    let spacing = Infinity;
    for (let i = 1; i < usage.length; i++) {
      spacing = Math.min(spacing, usage[i].freq - usage[i - 1].freq);
    }
    if (!Number.isFinite(spacing) || spacing <= 0) return null;
    const expected = Math.floor((range[1] - range[0]) / spacing) + 1;
    return { have: usage.length, expected: Math.max(expected, usage.length) };
  }, [usage, live, range]);

  const maxHeld = usage.reduce((m, u) => Math.max(m, u.peak), 0);

  return (
    <Card
      title="Frequency usage"
      icon={<BarChart3 size={14} />}
      actions={
        <>
          {hasHist && (
            <Segmented<"chart" | "cdf">
              options={[
                { value: "chart", label: "Chart" },
                { value: "cdf", label: "Persistence" },
              ]}
              value={view}
              onChange={setView}
            />
          )}
          {usage.length > 0 &&
            (live ? (
              <Chip color="accent">live from device</Chip>
            ) : (
              usageAt && <Chip>sweep from {timeAgo(usageAt)}</Chip>
            ))}
          {progress && progress.have < progress.expected && (
            <Chip color="warn">
              sweep {progress.have}/{progress.expected}
            </Chip>
          )}
          {usage.length > 0 && (
            <Button
              variant="ghost"
              title="Export usage data as CSV"
              onClick={() =>
                downloadCsv(
                  `airscope-usage-${new Date().toISOString().slice(0, 19).replaceAll(":", "-")}.csv`,
                  [
                    ["Frequency (MHz)", "Usage (%)", "Max hold (%)", "Noise floor (dBm)", "Samples"],
                    ...usage.map((u) => [u.freq, u.usage, u.peak, u.noise, u.samples]),
                  ]
                )
              }
            >
              <Download size={14} />
            </Button>
          )}
          {live && usage.length > 0 && (
            <Button
              variant="ghost"
              title="Reset max-hold peaks (fresh observation window)"
              onClick={resetUsagePeaks}
            >
              <RotateCcw size={14} />
            </Button>
          )}
        </>
      }
    >
      {usage.length === 0 ? (
        <div className="grid h-40 place-items-center px-6 text-center text-[13px] text-ink-3">
          {snapshot?.mode === "usage"
            ? "Waiting for the frequency monitor — bins fill in as the radio sweeps the band"
            : "Switch scan mode to “Freq. usage” to measure real per-frequency airtime"}
        </div>
      ) : view === "cdf" && hasHist ? (
        <div className="p-4 pt-3">
          <PersistenceView
            usage={usage}
            domain={range}
            hoverFreq={hoverFreq}
            onHover={setHoverFreq}
          />
          <p className="mt-2 text-[11.5px] leading-relaxed text-ink-3">
            Each column shows how often every airtime level occurs across sweeps —
            red baseline is always there, purple tops are rare bursts. A tall purple
            spike that never turns green is an intermittent (TDD) transmitter; a
            solid green/yellow column is a genuinely busy channel. The ↺ button
            starts a fresh window.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden p-2 pt-3">
          <ResponsiveContainer width="100%" height={180}>
            <ComposedChart
              data={usage}
              margin={{ top: 6, right: 12, bottom: 0, left: -16 }}
              onMouseMove={(e) => {
                if (e?.activeLabel !== undefined) setHoverFreq(Number(e.activeLabel));
              }}
              onMouseLeave={() => setHoverFreq(null)}
            >
              <defs>
                <linearGradient id="usageFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--series-2)" stopOpacity={0.4} />
                  <stop offset="100%" stopColor="var(--series-2)" stopOpacity={0.04} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="freq"
                type="number"
                domain={range}
                tickCount={9}
                tickFormatter={(v: number) => `${v}`}
                axisLine={{ stroke: "var(--border-strong)" }}
                tickLine={false}
              />
              <YAxis
                domain={[0, 100]}
                tickCount={5}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v: number) => `${v}%`}
              />

              {interference
                .filter((r) => r.to >= range[0] && r.from <= range[1])
                .map((r) => (
                  <ReferenceArea
                    key={`u-intf-${r.from}`}
                    x1={Math.max(range[0], r.from)}
                    x2={Math.min(range[1], Math.max(r.to, r.from + 1))}
                    fill="var(--warn)"
                    fillOpacity={0.1}
                    stroke="var(--warn)"
                    strokeOpacity={0.45}
                    strokeDasharray="2 3"
                  />
                ))}

              {focus?.kind === "channel" && (
                <ReferenceArea
                  x1={Math.max(range[0], Number(focus.key) - 10)}
                  x2={Math.min(range[1], Number(focus.key) + 10)}
                  fill="var(--accent)"
                  fillOpacity={0.12}
                  stroke="var(--accent)"
                  strokeOpacity={0.5}
                  strokeDasharray="4 3"
                />
              )}

              {recommendation && (
                <ReferenceLine
                  x={recommendation.freq}
                  stroke="var(--good)"
                  strokeDasharray="5 4"
                  strokeOpacity={0.8}
                />
              )}

              {/* shared crosshair from the other charts */}
              {hoverFreq !== null && hoverFreq >= range[0] && hoverFreq <= range[1] && (
                <ReferenceLine
                  x={hoverFreq}
                  stroke="var(--border-strong)"
                  strokeDasharray="3 3"
                />
              )}

              {/* max-hold outline: peaks seen since monitoring began */}
              <Line
                dataKey="peak"
                type="step"
                stroke="var(--series-3)"
                strokeWidth={1.5}
                dot={false}
                isAnimationActive={false}
                name="Max hold"
              />
              <Area
                dataKey="usage"
                type="step"
                stroke="var(--series-2)"
                strokeWidth={1.5}
                fill="url(#usageFill)"
                isAnimationActive={false}
                dot={false}
                activeDot={{ r: 3, strokeWidth: 0 }}
                name="Airtime"
              />
              {compareUsage.length > 0 && (
                <Line
                  data={compareUsage}
                  dataKey="usage"
                  type="step"
                  stroke="var(--series-5)"
                  strokeWidth={1.5}
                  strokeDasharray="7 4"
                  dot={false}
                  isAnimationActive={false}
                  name="Saved sweep"
                />
              )}

              <Tooltip
                content={<UsageTooltip band={band} />}
                cursor={{ stroke: "var(--border-strong)", strokeDasharray: "3 3" }}
                isAnimationActive={false}
              />
            </ComposedChart>
          </ResponsiveContainer>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 pt-1 pb-1 text-[11.5px] text-ink-2">
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-4 rounded-sm bg-[var(--series-2)]/40 border border-[var(--series-2)]" />
              Airtime %
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-0 w-4 border-t-2 border-[var(--series-3)]" />
              Max hold (catches TDD bursts)
            </span>
            {recommendation && (
              <button
                type="button"
                className="flex items-center gap-1.5 hover:text-ink"
                onClick={() => setFocus({ kind: "channel", key: recommendation.freq })}
              >
                <span className="h-0 w-4 border-t-2 border-dashed border-[var(--good)]" />
                Recommended {recommendation.freq} MHz
              </button>
            )}
            {compareUsage.length > 0 && compareScan && (
              <span className="flex items-center gap-1.5">
                <span className="h-0 w-4 border-t-2 border-dashed border-[var(--series-5)]" />
                Saved · {new Date(compareScan.stored.timestamp).toLocaleTimeString()}
              </span>
            )}
            <span className="mono ml-auto text-ink-3">max hold {maxHeld.toFixed(1)}%</span>
          </div>
        </div>
      )}
    </Card>
  );
}

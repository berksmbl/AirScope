"use client";

import { useCallback, useMemo, useRef, useState } from "react";
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
import { AudioWaveform, Download, SearchX, ZoomOut } from "lucide-react";
import { Button, Card, Chip } from "./ui";
import { Waterfall } from "./Waterfall";
import { channelForFrequency } from "@/lib/bands";
import type { Scanner } from "@/hooks/useScanner";
import type { DetectedNetwork } from "@/lib/types";

const SERIES_VARS = [
  "--series-1", "--series-2", "--series-3", "--series-4",
  "--series-5", "--series-6", "--series-7", "--series-8",
];

export const seriesVar = (idx: number | null): string =>
  idx === null ? "var(--text-3)" : `var(${SERIES_VARS[idx % 8]})`;

/** clone the live SVG, bake computed styles in, rasterize to PNG */
function exportChartPng(container: HTMLElement, filename: string) {
  const svg = container.querySelector("svg");
  if (!svg) return;
  const clone = svg.cloneNode(true) as SVGSVGElement;
  const src = svg.querySelectorAll<SVGElement>("*");
  const dst = clone.querySelectorAll<SVGElement>("*");
  src.forEach((el, i) => {
    const cs = getComputedStyle(el);
    dst[i].setAttribute("fill", cs.fill);
    dst[i].setAttribute("stroke", cs.stroke);
    dst[i].setAttribute("font-family", "sans-serif");
    dst[i].setAttribute("font-size", cs.fontSize);
  });
  const rect = svg.getBoundingClientRect();
  clone.setAttribute("width", String(rect.width));
  clone.setAttribute("height", String(rect.height));

  const bg = getComputedStyle(document.documentElement).getPropertyValue("--panel").trim();
  const data = new XMLSerializer().serializeToString(clone);
  const img = new Image();
  img.onload = () => {
    const canvas = document.createElement("canvas");
    canvas.width = rect.width * 2;
    canvas.height = rect.height * 2;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = bg || "#12161f";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.scale(2, 2);
    ctx.drawImage(img, 0, 0);
    const a = document.createElement("a");
    a.download = filename;
    a.href = canvas.toDataURL("image/png");
    a.click();
  };
  img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(data);
}

interface TooltipPayloadEntry {
  value?: number | string;
  dataKey?: string | number;
}

function SpectrumTooltip({
  active,
  label,
  payload,
  networks,
  band,
}: {
  active?: boolean;
  label?: number | string;
  payload?: TooltipPayloadEntry[];
  networks: DetectedNetwork[];
  band: "2g" | "5g" | "6g";
}) {
  if (!active || label === undefined || !payload?.length) return null;
  const freq = Number(label);
  const power = payload.find((p) => p.dataKey === "power")?.value;
  const noise = payload.find((p) => p.dataKey === "noise")?.value;
  const chan = channelForFrequency(freq, band);
  const overlapping = networks.filter(
    (n) => Math.abs(n.frequency - freq) <= n.width / 2
  );

  return (
    <div className="card min-w-44 px-3 py-2.5 text-[12px] shadow-xl">
      <div className="mono mb-1 font-semibold text-ink">
        {freq} MHz{chan !== null && <span className="text-ink-3"> · ch {chan}</span>}
      </div>
      <div className="flex justify-between gap-4 text-ink-2">
        <span>Power</span>
        <span className="mono text-ink">{power} dBm</span>
      </div>
      <div className="flex justify-between gap-4 text-ink-2">
        <span>Noise</span>
        <span className="mono">{noise} dBm</span>
      </div>
      {overlapping.length > 0 && (
        <div className="mt-1.5 border-t border-line pt-1.5">
          {overlapping.slice(0, 4).map((n) => (
            <div key={n.id} className="flex justify-between gap-3 text-ink-2">
              <span className="truncate max-w-32">{n.ssid}</span>
              <span className="mono">{n.signal} dBm</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function SpectrumChart({ scanner }: { scanner: Scanner }) {
  const {
    snapshot,
    waterfall,
    focus,
    setFocus,
    hoverFreq,
    setHoverFreq,
    colorIndex,
    band,
    range,
    compareScan,
    interference,
  } = scanner;
  const containerRef = useRef<HTMLDivElement>(null);

  const [zoom, setZoom] = useState<[number, number] | null>(null);
  const [dragStart, setDragStart] = useState<number | null>(null);
  const [dragEnd, setDragEnd] = useState<number | null>(null);

  // clamp the zoom window to the active range so a stale zoom (from a
  // previous band or a narrowed slider) can never blank the chart
  const domain = useMemo<[number, number]>(() => {
    if (!zoom) return range;
    const lo = Math.max(zoom[0], range[0]);
    const hi = Math.min(zoom[1], range[1]);
    return hi - lo >= 10 ? [lo, hi] : range;
  }, [zoom, range]);

  const data = useMemo(
    () =>
      (snapshot?.spectrum ?? []).filter(
        (p) => p.freq >= domain[0] && p.freq <= domain[1]
      ),
    [snapshot, domain]
  );

  const compareData = useMemo(
    () =>
      (compareScan?.spectrum ?? []).filter(
        (p) => p.freq >= domain[0] && p.freq <= domain[1]
      ),
    [compareScan, domain]
  );

  const networks = snapshot?.networks ?? [];
  const visibleNets = networks.filter(
    (n) =>
      n.frequency + n.width / 2 >= domain[0] && n.frequency - n.width / 2 <= domain[1]
  );

  const focusedNet =
    focus?.kind === "network" ? networks.find((n) => n.id === focus.key) : undefined;

  const commitZoom = useCallback(() => {
    if (dragStart !== null && dragEnd !== null && Math.abs(dragEnd - dragStart) >= 10) {
      setZoom([Math.min(dragStart, dragEnd), Math.max(dragStart, dragEnd)]);
    }
    setDragStart(null);
    setDragEnd(null);
  }, [dragStart, dragEnd]);

  const empty = !snapshot || data.length === 0;

  return (
    <Card
      title="Live spectrum"
      icon={<AudioWaveform size={14} />}
      actions={
        <>
          {compareScan && <Chip color="neutral">comparing</Chip>}
          {zoom && (
            <Button variant="ghost" onClick={() => setZoom(null)} title="Reset zoom">
              <ZoomOut size={14} />
            </Button>
          )}
          <Button
            variant="ghost"
            title="Export as PNG"
            disabled={empty}
            onClick={() =>
              containerRef.current &&
              exportChartPng(
                containerRef.current,
                `airscope-${band}-${new Date().toISOString().slice(0, 19).replaceAll(":", "-")}.png`
              )
            }
          >
            <Download size={14} />
          </Button>
        </>
      }
    >
      <div className="overflow-hidden p-2 pt-3">
        {empty ? (
          <div className="flex h-72 flex-col items-center justify-center gap-2 text-ink-3">
            <SearchX size={28} strokeWidth={1.5} />
            <p className="text-[13px]">
              No data yet — connect to a MikroTik and start a scan
            </p>
          </div>
        ) : (
          <div ref={containerRef} className="select-none">
            <ResponsiveContainer width="100%" height={300}>
              <ComposedChart
                data={data}
                margin={{ top: 8, right: 12, bottom: 0, left: -10 }}
                onMouseDown={(e) => {
                  if (e?.activeLabel !== undefined) setDragStart(Number(e.activeLabel));
                }}
                onMouseMove={(e) => {
                  if (e?.activeLabel !== undefined) setHoverFreq(Number(e.activeLabel));
                  if (dragStart !== null && e?.activeLabel !== undefined)
                    setDragEnd(Number(e.activeLabel));
                }}
                onMouseUp={commitZoom}
                onMouseLeave={() => {
                  setHoverFreq(null);
                  setDragStart(null);
                  setDragEnd(null);
                }}
              >
                <defs>
                  <linearGradient id="spectrumFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--series-1)" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="var(--series-1)" stopOpacity={0.03} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} />
                <XAxis
                  dataKey="freq"
                  type="number"
                  domain={domain}
                  tickCount={9}
                  unit=""
                  tickFormatter={(v: number) => `${v}`}
                  axisLine={{ stroke: "var(--border-strong)" }}
                  tickLine={false}
                />
                <YAxis
                  domain={[-115, -35]}
                  tickCount={9}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v: number) => `${v}`}
                />

                {/* network occupancy bands */}
                {visibleNets.slice(0, 10).map((n) => {
                  const idx = colorIndex(n.id);
                  const isFocus = focusedNet?.id === n.id;
                  return (
                    <ReferenceArea
                      key={n.id}
                      x1={Math.max(domain[0], n.frequency - n.width / 2)}
                      x2={Math.min(domain[1], n.frequency + n.width / 2)}
                      fill={seriesVar(idx)}
                      fillOpacity={isFocus ? 0.22 : 0.06}
                      stroke={isFocus ? seriesVar(idx) : undefined}
                      strokeOpacity={0.7}
                      onClick={() => setFocus({ kind: "network", key: n.id })}
                    />
                  );
                })}

                {/* non-Wi-Fi interference regions */}
                {interference
                  .filter((r) => r.to >= domain[0] && r.from <= domain[1])
                  .map((r) => (
                    <ReferenceArea
                      key={`intf-${r.from}`}
                      x1={Math.max(domain[0], r.from)}
                      x2={Math.min(domain[1], Math.max(r.to, r.from + 1))}
                      fill="var(--warn)"
                      fillOpacity={0.09}
                      stroke="var(--warn)"
                      strokeOpacity={0.45}
                      strokeDasharray="2 3"
                    />
                  ))}

                {/* focused channel from heatmap */}
                {focus?.kind === "channel" && (
                  <ReferenceArea
                    x1={Math.max(domain[0], Number(focus.key) - 10)}
                    x2={Math.min(domain[1], Number(focus.key) + 10)}
                    fill="var(--accent)"
                    fillOpacity={0.14}
                    stroke="var(--accent)"
                    strokeOpacity={0.6}
                    strokeDasharray="4 3"
                  />
                )}

                {/* focused network center + label */}
                {focusedNet && (
                  <ReferenceLine
                    x={focusedNet.frequency}
                    stroke={seriesVar(colorIndex(focusedNet.id))}
                    strokeWidth={1.5}
                    label={{
                      value: focusedNet.ssid,
                      position: "top",
                      fill: "var(--text-1)",
                      fontSize: 11,
                    }}
                  />
                )}

                {/* shared crosshair from the other charts */}
                {hoverFreq !== null && hoverFreq >= domain[0] && hoverFreq <= domain[1] && (
                  <ReferenceLine
                    x={hoverFreq}
                    stroke="var(--border-strong)"
                    strokeDasharray="3 3"
                  />
                )}

                {/* drag-to-zoom preview */}
                {dragStart !== null && dragEnd !== null && (
                  <ReferenceArea
                    x1={Math.min(dragStart, dragEnd)}
                    x2={Math.max(dragStart, dragEnd)}
                    fill="var(--accent)"
                    fillOpacity={0.12}
                    stroke="var(--accent)"
                    strokeOpacity={0.5}
                  />
                )}

                <Area
                  dataKey="power"
                  type="monotone"
                  stroke="var(--series-1)"
                  strokeWidth={2}
                  fill="url(#spectrumFill)"
                  isAnimationActive={false}
                  dot={false}
                  activeDot={{ r: 3.5, strokeWidth: 0 }}
                  name="Current"
                />
                <Line
                  dataKey="noise"
                  type="monotone"
                  stroke="var(--noise-line)"
                  strokeWidth={1}
                  strokeDasharray="5 4"
                  dot={false}
                  isAnimationActive={false}
                  name="Noise floor"
                />
                {compareData.length > 0 && (
                  <Line
                    data={compareData}
                    dataKey="power"
                    type="monotone"
                    stroke="var(--series-5)"
                    strokeWidth={1.5}
                    strokeDasharray="7 4"
                    dot={false}
                    isAnimationActive={false}
                    name="Saved scan"
                  />
                )}

                <Tooltip
                  content={
                    <SpectrumTooltip networks={networks} band={band} />
                  }
                  cursor={{ stroke: "var(--border-strong)", strokeDasharray: "3 3" }}
                  isAnimationActive={false}
                />
              </ComposedChart>
            </ResponsiveContainer>

            {/* legend */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 pt-1 pb-1 text-[11.5px] text-ink-2">
              <span className="flex items-center gap-1.5">
                <span className="h-0.5 w-4 rounded bg-[var(--series-1)]" /> Signal power
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-0 w-4 border-t border-dashed border-[var(--noise-line)]" />
                Noise floor
              </span>
              {interference.length > 0 && (
                <span className="flex items-center gap-1.5">
                  <span className="h-2.5 w-4 rounded-sm border border-dashed border-[var(--warn)] bg-[var(--warn)]/10" />
                  Non–Wi-Fi energy
                </span>
              )}
              {compareScan && (
                <span className="flex items-center gap-1.5">
                  <span className="h-0 w-4 border-t-2 border-dashed border-[var(--series-5)]" />
                  Saved · {new Date(compareScan.stored.timestamp).toLocaleTimeString()}
                </span>
              )}
              <span className="ml-auto hidden text-ink-3 sm:inline">
                drag to zoom · dBm vs MHz
              </span>
            </div>
          </div>
        )}

        {waterfall.length > 2 && (
          <div className="mt-2 border-t border-line px-2 pt-2.5">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="section-label">Waterfall — last {waterfall.length} sweeps</span>
              <span className="text-[10.5px] text-ink-3">newest on top</span>
            </div>
            <Waterfall
              frames={waterfall}
              domain={domain}
              noiseFloor={snapshot?.noiseFloor ?? -100}
              hoverFreq={hoverFreq}
              onHover={setHoverFreq}
            />
          </div>
        )}
      </div>
    </Card>
  );
}

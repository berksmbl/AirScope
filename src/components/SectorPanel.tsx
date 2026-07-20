"use client";

import { useMemo, useState } from "react";
import { ChevronDown, Download, TriangleAlert, Users } from "lucide-react";
import { Button, Card, Chip, inputClass } from "./ui";
import { clamp, cn, downloadCsv } from "@/lib/utils";
import type { Scanner } from "@/hooks/useScanner";
import type { SectorClient } from "@/lib/types";

type SortKey = "signal" | "ccq" | "traffic" | "name";

/** an operator only chases the problem clients: weak signal or poor link quality */
const isWeak = (c: SectorClient) => c.signal < -78 || (c.ccq !== undefined && c.ccq < 25);

/** tiny inline signal-history sparkline; -95..-45 dBm mapped to 16 px */
function Spark({ values }: { values: number[] }) {
  if (values.length < 2) {
    return <span className="mono w-16 text-center text-[10px] text-ink-3">…</span>;
  }
  const W = 64;
  const H = 16;
  const pts = values
    .slice(-60)
    .map((v, i, arr) => {
      const x = (i / (arr.length - 1)) * W;
      const y = H - clamp((v + 95) / 50, 0, 1) * H;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg width={W} height={H} className="shrink-0" aria-hidden>
      <polyline
        points={pts}
        fill="none"
        stroke="var(--series-1)"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const fmtBytes = (b: number): string => {
  if (b >= 1e9) return `${(b / 1e9).toFixed(1)} GB`;
  if (b >= 1e6) return `${(b / 1e6).toFixed(1)} MB`;
  return `${Math.round(b / 1e3)} kB`;
};

/** just the Mbps number: "43.3Mbps-20MHz/2S/SGI" → "43" */
const fmtRate = (r?: string): string => {
  const m = r?.match(/([\d.]+)Mbps/);
  return m ? String(Math.round(parseFloat(m[1]))) : "—";
};

const ccqTextTone = (ccq?: number) =>
  ccq === undefined
    ? "text-ink-3"
    : ccq >= 50
      ? "text-good"
      : ccq >= 25
        ? "text-warn"
        : "text-critical";

/** shared column widths so the header and every row line up */
const COL = {
  trend: "hidden w-16 md:block",
  ccq: "hidden w-11 sm:block",
  rate: "hidden w-20 lg:block",
  signal: "w-14",
};

function ClientRow({
  c,
  history,
}: {
  c: SectorClient;
  history: { signal: number; ccq: number | null }[];
}) {
  const sigTone =
    c.signal > -60 ? "var(--good)" : c.signal > -75 ? "var(--warn)" : "var(--critical)";
  return (
    <li
      className="flex items-center gap-2.5 rounded-md border border-transparent px-2.5 py-1 hover:bg-panel-2"
      title={[
        c.mac,
        c.version && `v${c.version}`,
        c.uptime && `up ${c.uptime}`,
        c.distance !== undefined && `dist ${c.distance}`,
        c.retx !== undefined && `retx ${c.retx}`,
        `traffic ${fmtBytes(c.txBytes)} / ${fmtBytes(c.rxBytes)}`,
      ]
        .filter(Boolean)
        .join(" · ")}
    >
      {isWeak(c) ? (
        <TriangleAlert size={11} className="shrink-0 text-warn" aria-label="weak link" />
      ) : (
        <span className="shrink-0" style={{ width: 11 }} />
      )}

      <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-ink">
        {c.radioName ?? c.mac}
      </span>

      <span className={cn("shrink-0", COL.trend)}>
        <Spark values={history.map((h) => h.signal)} />
      </span>

      <span
        className={cn("mono shrink-0 text-right text-[11.5px]", COL.ccq, ccqTextTone(c.ccq))}
      >
        {c.ccq ?? "—"}%
      </span>

      <span className={cn("mono shrink-0 text-right text-[11px] text-ink-2", COL.rate)}>
        ↓{fmtRate(c.txRate)} ↑{fmtRate(c.rxRate)}
      </span>

      <span className="h-1.5 w-10 shrink-0 overflow-hidden rounded-full bg-panel-3">
        <span
          className="block h-full rounded-full transition-all duration-500"
          style={{
            width: `${clamp(((c.signal + 95) / 50) * 100, 4, 100)}%`,
            backgroundColor: sigTone,
          }}
        />
      </span>
      <span className={cn("mono shrink-0 text-right text-[12px] text-ink", COL.signal)}>
        {c.signal}
        {c.snr !== undefined && <span className="text-[10px] text-ink-3"> /{c.snr}</span>}
      </span>
    </li>
  );
}

/** column headers so the dense value columns are self-explanatory */
function ClientHeader() {
  return (
    <div className="flex items-center gap-2.5 px-2.5 pb-1 text-[10px] font-medium uppercase tracking-wide text-ink-3">
      <span className="shrink-0" style={{ width: 11 }} />
      <span className="min-w-0 flex-1">Client</span>
      <span className={cn("shrink-0 text-center", COL.trend)}>Signal trend</span>
      <span className={cn("shrink-0 text-right", COL.ccq)} title="rx-ccq link quality">
        CCQ
      </span>
      <span className={cn("shrink-0 text-right", COL.rate)} title="tx / rx PHY rate, Mbps">
        Rate ↓↑
      </span>
      <span className="w-10 shrink-0" />
      <span className={cn("shrink-0 text-right", COL.signal)}>dBm/SNR</span>
    </div>
  );
}

export function SectorPanel({ scanner }: { scanner: Scanner }) {
  const { sector, clientHistory, connState, scanning, mode } = scanner;
  const clients = useMemo(() => sector?.clients ?? [], [sector]);
  const [open, setOpen] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("signal");

  const summary = useMemo(() => {
    if (clients.length === 0) return null;
    const avg = Math.round(clients.reduce((s, c) => s + c.signal, 0) / clients.length);
    const weak = clients.filter(isWeak).length;
    const ccqs = clients.map((c) => c.ccq).filter((v): v is number => v !== undefined);
    const worstCcq = ccqs.length ? Math.min(...ccqs) : null;
    return { avg, weak, worstCcq };
  }, [clients]);

  const sorted = useMemo(() => {
    const arr = [...clients];
    if (sortKey === "signal") arr.sort((a, b) => b.signal - a.signal);
    else if (sortKey === "ccq") arr.sort((a, b) => (a.ccq ?? 999) - (b.ccq ?? 999));
    else if (sortKey === "traffic")
      arr.sort((a, b) => b.txBytes + b.rxBytes - (a.txBytes + a.rxBytes));
    else arr.sort((a, b) => (a.radioName ?? a.mac).localeCompare(b.radioName ?? b.mac));
    return arr;
  }, [clients, sortKey]);

  const canOpen = connState === "connected" && clients.length > 0;

  return (
    <Card
      title={`Sector clients${clients.length ? ` · ${clients.length}` : ""}`}
      icon={<Users size={14} />}
      actions={
        <>
          {sector?.channel && (
            <Chip color="good" className="mono">
              {sector.channel.freq} MHz
            </Chip>
          )}
          {open && clients.length > 0 && (
            <Button
              variant="ghost"
              title="Export clients as CSV"
              onClick={() =>
                downloadCsv(
                  `airscope-clients-${new Date().toISOString().slice(0, 19).replaceAll(":", "-")}.csv`,
                  [
                    ["Radio name", "MAC", "Signal (dBm)", "SNR (dB)", "CCQ (%)", "TX rate", "RX rate", "TX bytes", "RX bytes", "Uptime", "Distance", "TDMA retx", "RouterOS"],
                    ...sorted.map((c) => [
                      c.radioName,
                      c.mac,
                      c.signal,
                      c.snr,
                      c.ccq,
                      c.txRate,
                      c.rxRate,
                      c.txBytes,
                      c.rxBytes,
                      c.uptime,
                      c.distance,
                      c.retx,
                      c.version,
                    ]),
                  ]
                )
              }
            >
              <Download size={14} />
            </Button>
          )}
          <button
            type="button"
            disabled={!canOpen}
            onClick={() => setOpen((v) => !v)}
            title={open ? "Collapse" : "Show clients"}
            className={cn(
              "grid size-6 place-items-center rounded-md text-ink-3 transition-all hover:text-ink disabled:opacity-30",
              open && "rotate-180"
            )}
          >
            <ChevronDown size={15} />
          </button>
        </>
      }
    >
      {connState !== "connected" ? (
        <div className="px-4 py-3 text-[12.5px] text-ink-3">
          Connect to see the subscribers on this sector.
        </div>
      ) : clients.length === 0 ? (
        <div className="px-4 py-3 text-[12.5px] text-ink-3">
          No clients registered right now.
        </div>
      ) : (
        <>
          {/* one-line summary — always visible */}
          {summary && (
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5 text-left text-[12.5px]"
            >
              <span className="text-ink-2">
                avg signal <span className="mono text-ink">{summary.avg} dBm</span>
              </span>
              {summary.worstCcq !== null && (
                <span className="text-ink-2">
                  worst CCQ{" "}
                  <span
                    className={cn(
                      "mono",
                      summary.worstCcq < 25
                        ? "text-critical"
                        : summary.worstCcq < 50
                          ? "text-warn"
                          : "text-ink"
                    )}
                  >
                    {summary.worstCcq}%
                  </span>
                </span>
              )}
              <span
                className={cn(
                  "flex items-center gap-1",
                  summary.weak > 0 ? "text-warn" : "text-ink-3"
                )}
              >
                {summary.weak > 0 && <TriangleAlert size={12} />}
                {summary.weak} weak link{summary.weak === 1 ? "" : "s"}
              </span>
              <span className="ml-auto text-ink-3">{open ? "hide" : "show all"}</span>
            </button>
          )}

          {open && (
            <div className="border-t border-line">
              {scanning && (
                <p className="mx-3 mt-2.5 rounded-lg border border-warn/30 bg-warn/10 px-3 py-1.5 text-[11.5px] text-warn">
                  {mode === "usage" ? "Frequency sweep" : "Scanning"} takes the radio
                  off-channel — clients drop and re-register when it stops.
                </p>
              )}
              <div className="flex items-center justify-between gap-2 px-3 pt-2.5 pb-1">
                <span className="section-label">Subscribers</span>
                <label className="flex items-center gap-1.5 text-[11px] text-ink-3">
                  Sort
                  <select
                    className={cn(inputClass, "h-7 w-28 py-0 text-[12px]")}
                    value={sortKey}
                    onChange={(e) => setSortKey(e.target.value as SortKey)}
                  >
                    <option value="signal">Signal</option>
                    <option value="ccq">Worst CCQ</option>
                    <option value="traffic">Traffic</option>
                    <option value="name">Name</option>
                  </select>
                </label>
              </div>
              <div className="px-2">
                <ClientHeader />
              </div>
              <ul className="flex max-h-96 flex-col overflow-y-auto p-2 pt-0">
                {sorted.map((c) => (
                  <ClientRow key={c.mac} c={c} history={clientHistory.get(c.mac) ?? []} />
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </Card>
  );
}

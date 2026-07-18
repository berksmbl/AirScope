"use client";

import { useMemo, useState } from "react";
import { ArrowDownWideNarrow, Download, Lock, LockOpen, Search, Wifi } from "lucide-react";
import { Button, Card, Chip, inputClass } from "./ui";
import { seriesVar } from "./SpectrumChart";
import { channelForFrequency } from "@/lib/bands";
import { clamp, cn, downloadCsv } from "@/lib/utils";
import type { Scanner } from "@/hooks/useScanner";

type SortKey = "signal" | "freq" | "ssid";

function SignalBar({ signal }: { signal: number }) {
  const pct = clamp(((signal + 95) / 50) * 100, 4, 100);
  const tone =
    signal > -60 ? "var(--critical)" : signal > -75 ? "var(--warn)" : "var(--good)";
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-14 overflow-hidden rounded-full bg-panel-3">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${pct}%`, backgroundColor: tone }}
        />
      </div>
      <span className="mono w-14 text-right text-[12px] text-ink">{signal} dBm</span>
    </div>
  );
}

export function NetworkList({ scanner }: { scanner: Scanner }) {
  const { snapshot, focus, setFocus, colorIndex, band } = scanner;
  const networks = useMemo(() => snapshot?.networks ?? [], [snapshot]);
  // staleness is judged against the snapshot's own clock (refreshes per poll)
  const now = snapshot?.timestamp ?? 0;
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("signal");

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? networks.filter(
          (n) =>
            n.ssid.toLowerCase().includes(q) || n.bssid.toLowerCase().includes(q)
        )
      : networks;
    return [...filtered].sort((a, b) =>
      sortKey === "signal"
        ? b.signal - a.signal
        : sortKey === "freq"
          ? a.frequency - b.frequency
          : a.ssid.localeCompare(b.ssid)
    );
  }, [networks, query, sortKey]);

  return (
    <Card
      title={`Detected networks${networks.length ? ` · ${networks.length}` : ""}`}
      icon={<Wifi size={14} />}
      className="flex flex-col"
      actions={
        networks.length > 0 ? (
          <div className="flex items-center gap-1.5">
            <div className="relative">
              <Search
                size={13}
                className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-ink-3"
              />
              <input
                className={cn(inputClass, "h-7 w-36 pl-7 text-[12px] sm:w-44")}
                placeholder="Filter SSID / BSSID"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                spellCheck={false}
              />
            </div>
            <div className="relative">
              <ArrowDownWideNarrow
                size={13}
                className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-ink-3"
              />
              <select
                className={cn(inputClass, "h-7 w-27 appearance-none pl-7 text-[12px]")}
                value={sortKey}
                onChange={(e) => setSortKey(e.target.value as SortKey)}
                title="Sort by"
              >
                <option value="signal">Signal</option>
                <option value="freq">Frequency</option>
                <option value="ssid">Name</option>
              </select>
            </div>
            <Button
              variant="ghost"
              title="Export list as CSV"
              onClick={() =>
                downloadCsv(
                  `airscope-networks-${new Date().toISOString().slice(0, 19).replaceAll(":", "-")}.csv`,
                  [
                    ["SSID", "BSSID", "Frequency (MHz)", "Channel", "Width (MHz)", "Signal (dBm)", "Noise (dBm)", "Radio name"],
                    ...visible.map((n) => [
                      n.ssid,
                      n.bssid,
                      n.frequency,
                      channelForFrequency(n.frequency, band),
                      n.width,
                      n.signal,
                      n.noise,
                      n.radioName,
                    ]),
                  ]
                )
              }
            >
              <Download size={14} />
            </Button>
          </div>
        ) : undefined
      }
    >
      {networks.length === 0 ? (
        <div className="grid h-40 place-items-center text-[13px] text-ink-3">
          No networks detected yet
        </div>
      ) : visible.length === 0 ? (
        <div className="grid h-24 place-items-center text-[13px] text-ink-3">
          No match for “{query}”
        </div>
      ) : (
        <ul className="max-h-105 overflow-y-auto p-2">
          {visible.map((n) => {
            const selected = focus?.kind === "network" && focus.key === n.id;
            const chan = channelForFrequency(n.frequency, band);
            // scanner entries linger a while after last heard — dim the stale ones
            const stale = n.lastSeen !== undefined && now - n.lastSeen > 45_000;
            return (
              <li key={n.id}>
                <button
                  type="button"
                  onClick={() =>
                    setFocus(selected ? null : { kind: "network", key: n.id })
                  }
                  className={cn(
                    "net-row grid w-full grid-cols-[10px_minmax(0,1.4fr)_auto] items-center gap-x-3 gap-y-1 rounded-lg border px-3 py-2 text-left",
                    "sm:grid-cols-[10px_minmax(0,1.4fr)_minmax(0,1fr)_auto]",
                    stale && !selected && "opacity-55",
                    selected
                      ? "border-[var(--accent)] bg-accent/10"
                      : "border-transparent hover:bg-panel-2"
                  )}
                  title={
                    n.lastSeen
                      ? `Last heard ${Math.max(0, Math.round((now - n.lastSeen) / 1000))}s ago${n.radioName ? ` · radio: ${n.radioName}` : ""}`
                      : undefined
                  }
                >
                  <span
                    className="size-2.5 rounded-full"
                    style={{ backgroundColor: seriesVar(colorIndex(n.id)) }}
                    aria-hidden
                  />
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-medium text-ink">
                      {n.ssid}
                    </span>
                    <span className="mono block truncate text-[10.5px] text-ink-3">
                      {n.bssid}
                      {n.radioName && n.radioName !== n.ssid && (
                        <span className="text-ink-3/70"> · {n.radioName}</span>
                      )}
                    </span>
                  </span>
                  <span className="hidden items-center gap-1.5 sm:flex">
                    <Chip className="mono">
                      {n.frequency}
                      {chan !== null && <span className="text-ink-3">/{chan}</span>}
                    </Chip>
                    <Chip className="mono">{n.width} MHz</Chip>
                    {n.security && (
                      <Chip color={n.security === "Open" ? "warn" : "neutral"}>
                        {n.security === "Open" ? (
                          <LockOpen size={10} />
                        ) : (
                          <Lock size={10} />
                        )}
                        {n.security}
                      </Chip>
                    )}
                  </span>
                  <SignalBar signal={n.signal} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

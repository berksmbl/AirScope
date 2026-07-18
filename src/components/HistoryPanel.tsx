"use client";

import { Eye, EyeOff, History, Save, Trash2 } from "lucide-react";
import { Button, Card, Chip } from "./ui";
import { BANDS } from "@/lib/bands";
import { cn, timeAgo } from "@/lib/utils";
import type { Scanner } from "@/hooks/useScanner";

export function HistoryPanel({ scanner }: { scanner: Scanner }) {
  const { history, saveCurrentScan, deleteScan, compareId, setCompareId, snapshot, band } =
    scanner;

  return (
    <Card
      title="Scan history"
      icon={<History size={14} />}
      actions={
        <Button
          variant="ghost"
          disabled={!snapshot}
          onClick={saveCurrentScan}
          title="Save current scan"
        >
          <Save size={14} />
          <span className="hidden sm:inline">Save current</span>
        </Button>
      }
    >
      {history.length === 0 ? (
        <div className="grid h-32 place-items-center px-6 text-center text-[13px] text-ink-3">
          Saved scans appear here — save one to compare environments over time
        </div>
      ) : (
        <ul className="flex max-h-72 flex-col gap-1 overflow-y-auto p-2">
          {history.map((h) => {
            const comparing = compareId === h.id;
            const sameBand = h.band === band;
            return (
              <li
                key={h.id}
                className={cn(
                  "flex items-center gap-2.5 rounded-lg border px-3 py-2",
                  comparing ? "border-[var(--series-5)] bg-panel-2" : "border-line bg-panel-2/50"
                )}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[12.5px] font-medium text-ink">
                      {new Date(h.timestamp).toLocaleString([], {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                    <Chip>{BANDS[h.band].short}</Chip>
                    {h.mode === "usage" && <Chip color="accent">usage</Chip>}
                  </div>
                  <div className="mt-0.5 truncate text-[11px] text-ink-3">
                    {h.networks.length} networks · noise {h.noiseFloor} dBm ·{" "}
                    {h.deviceName ?? "device"} · {timeAgo(h.timestamp)}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  title={
                    !sameBand
                      ? "Switch to this scan's band to compare"
                      : comparing
                        ? "Stop comparing"
                        : "Overlay on spectrum"
                  }
                  disabled={!sameBand}
                  onClick={() => setCompareId(comparing ? null : h.id)}
                >
                  {comparing ? <EyeOff size={14} /> : <Eye size={14} />}
                </Button>
                <Button variant="ghost" title="Delete" onClick={() => deleteScan(h.id)}>
                  <Trash2 size={14} className="text-ink-3 hover:text-critical" />
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

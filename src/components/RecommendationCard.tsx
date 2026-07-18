"use client";

import { Sparkles } from "lucide-react";
import { Card, Chip } from "./ui";
import { heatColor } from "./ChannelHeatmap";
import type { Scanner } from "@/hooks/useScanner";

export function RecommendationCard({ scanner }: { scanner: Scanner }) {
  const { recommendation, setFocus, focus } = scanner;

  return (
    <Card title="Smart recommendation" icon={<Sparkles size={14} />}>
      {!recommendation ? (
        <div className="grid h-40 place-items-center px-6 text-center text-[13px] text-ink-3">
          Run a scan and the engine will suggest the cleanest channel
        </div>
      ) : (
        <div className="flex flex-col gap-3 p-4">
          <button
            type="button"
            onClick={() => setFocus({ kind: "channel", key: recommendation.freq })}
            className="group rounded-xl border border-good/25 bg-good/8 px-4 py-3 text-left transition-colors hover:border-good/50"
            title="Highlight on spectrum"
          >
            <div className="text-[11px] font-medium uppercase tracking-wider text-good">
              Best channel
            </div>
            <div className="mt-0.5 flex items-baseline gap-2">
              <span className="mono text-[26px] font-semibold leading-none text-ink">
                {recommendation.freq}
                <span className="ml-1 text-[13px] font-normal text-ink-3">MHz</span>
              </span>
              <Chip color={recommendation.score < 20 ? "good" : recommendation.score < 45 ? "warn" : "critical"}>
                {recommendation.label}
              </Chip>
            </div>
            <div className="mt-1 text-[12px] text-ink-2">
              Channel {recommendation.channel} · {recommendation.reason}
            </div>
          </button>

          {recommendation.blocks.length > 0 && (
            <div>
              <div className="section-label mb-1.5">Wider channels</div>
              <div className="flex flex-col gap-1">
                {recommendation.blocks.map((b) => {
                  const active = focus?.kind === "channel" && focus.key === b.freq;
                  return (
                    <button
                      key={b.width}
                      type="button"
                      onClick={() =>
                        setFocus(active ? null : { kind: "channel", key: b.freq })
                      }
                      title={`Cleanest contiguous ${b.width} MHz block — scored by its busiest member channel`}
                      className={`flex items-center gap-2.5 rounded-lg border px-3 py-1.5 text-[12.5px] transition-colors ${
                        active
                          ? "border-[var(--accent)] bg-accent/10"
                          : "border-line bg-panel-2 hover:border-accent/40"
                      }`}
                    >
                      <span
                        className="size-2 rounded-full"
                        style={{ backgroundColor: heatColor(b.score) }}
                      />
                      <span className="font-medium text-ink">{b.width} MHz</span>
                      <span className="mono text-ink-2">
                        {b.from}–{b.to}
                      </span>
                      <span className="mono ml-auto text-[11.5px] text-ink-2">
                        worst {b.score}/100
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {recommendation.alternates.length > 0 && (
            <div>
              <div className="section-label mb-1.5">Alternatives</div>
              <div className="flex flex-col gap-1">
                {recommendation.alternates.map((a) => {
                  const active = focus?.kind === "channel" && focus.key === a.freq;
                  return (
                    <button
                      key={a.freq}
                      type="button"
                      onClick={() => setFocus(active ? null : { kind: "channel", key: a.freq })}
                      className={`flex items-center gap-2.5 rounded-lg border px-3 py-1.5 text-[12.5px] transition-colors ${
                        active
                          ? "border-[var(--accent)] bg-accent/10"
                          : "border-line bg-panel-2 hover:border-accent/40"
                      }`}
                    >
                      <span
                        className="size-2 rounded-full"
                        style={{ backgroundColor: heatColor(a.score) }}
                      />
                      <span className="mono text-ink">{a.freq} MHz</span>
                      <span className="text-ink-3">ch {a.channel}</span>
                      <span className="mono ml-auto text-[11.5px] text-ink-2">
                        {a.score}/100
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

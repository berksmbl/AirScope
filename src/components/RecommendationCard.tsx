"use client";

import { useMemo } from "react";
import { ArrowRight, Sparkles } from "lucide-react";
import { Card, Chip } from "./ui";
import { heatColor } from "./ChannelHeatmap";
import type { Scanner } from "@/hooks/useScanner";

export function RecommendationCard({ scanner }: { scanner: Scanner }) {
  const { recommendation, setFocus, focus, sector, snapshot } = scanner;

  // how does the channel we're serving on right now compare?
  const activeScore = useMemo(() => {
    const ch = sector?.channel;
    if (!ch || !snapshot) return null;
    const overlapping = snapshot.channels.filter(
      (c) => Math.abs(c.freq - ch.freq) < ch.width / 2 + 10
    );
    if (overlapping.length === 0) return null;
    return Math.max(...overlapping.map((c) => c.score));
  }, [sector, snapshot]);

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
            <div className="mt-0.5 flex flex-wrap items-baseline gap-2">
              <span className="mono text-[26px] font-semibold leading-none text-ink">
                {recommendation.freq}
                <span className="ml-1 text-[13px] font-normal text-ink-3">MHz</span>
              </span>
              <Chip className="mono">{recommendation.width} MHz</Chip>
              <Chip color={recommendation.score < 20 ? "good" : recommendation.score < 45 ? "warn" : "critical"}>
                {recommendation.label}
              </Chip>
              <Chip
                color={
                  recommendation.confidence === "high"
                    ? "good"
                    : recommendation.confidence === "medium"
                      ? "warn"
                      : "critical"
                }
                title={`${recommendation.stat.samples} readings behind the least-measured bin of this channel`}
              >
                {recommendation.confidence} confidence
              </Chip>
            </div>
            <div className="mt-1 text-[12px] text-ink-2">
              {recommendation.channel !== null && `Channel ${recommendation.channel} · `}
              {recommendation.reason}
            </div>
            {/* the measurements behind the score */}
            <div className="mono mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-ink-3">
              <span title="typical / near-worst airtime">
                air {recommendation.stat.p50}% / {recommendation.stat.p95}%
              </span>
              {recommendation.stat.noiseFloor !== null && (
                <span title="mean measured noise floor in this channel">
                  NF {recommendation.stat.noiseFloor} dBm
                </span>
              )}
              {recommendation.stat.burst >= 10 && (
                <span className="text-warn" title="p95 − p50 spread; TDMA dislikes variance">
                  burst +{recommendation.stat.burst}%
                </span>
              )}
              <span title="interference potential from detected networks (in-band + adjacent)">
                nbr {recommendation.stat.wifiScore}
              </span>
            </div>
          </button>

          {activeScore !== null && sector?.channel && (
            <div
              className="flex items-center gap-2 rounded-lg border border-line bg-panel-2 px-3 py-2 text-[12.5px]"
              title="Worst congestion score across the channels your active band overlaps"
            >
              <span className="text-ink-2">Serving on</span>
              <span className="mono font-medium text-ink">{sector.channel.freq} MHz</span>
              <span
                className="size-2 rounded-full"
                style={{ backgroundColor: heatColor(activeScore) }}
              />
              <span className="mono text-ink-2">{activeScore}/100</span>
              {activeScore - recommendation.score > 10 ? (
                <span className="ml-auto flex items-center gap-1 text-good">
                  <ArrowRight size={13} />
                  switch saves {activeScore - recommendation.score} pts
                </span>
              ) : (
                <span className="ml-auto text-ink-3">already near-optimal</span>
              )}
            </div>
          )}

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
                      {a.channel !== null && <span className="text-ink-3">ch {a.channel}</span>}
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

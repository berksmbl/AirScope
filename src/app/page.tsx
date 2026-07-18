"use client";

import { useScanner } from "@/hooks/useScanner";
import { Header, REPO_URL } from "@/components/Header";
import { ConnectionPanel } from "@/components/ConnectionPanel";
import { ScanControls } from "@/components/ScanControls";
import { StatCards } from "@/components/StatCards";
import { SpectrumChart } from "@/components/SpectrumChart";
import { FrequencyUsageChart } from "@/components/FrequencyUsageChart";
import { ChannelHeatmap } from "@/components/ChannelHeatmap";
import { NetworkList } from "@/components/NetworkList";
import { RecommendationCard } from "@/components/RecommendationCard";
import { HistoryPanel } from "@/components/HistoryPanel";

export default function Home() {
  const scanner = useScanner();

  return (
    <div className="flex min-h-dvh flex-col">
      <Header scanner={scanner} />

      <main className="mx-auto w-full max-w-[1600px] flex-1 px-4 py-4">
        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
          {/* left rail */}
          <div className="flex flex-col gap-4 lg:sticky lg:top-[72px]">
            <ConnectionPanel scanner={scanner} />
            <ScanControls scanner={scanner} />
          </div>

          {/* main column */}
          <div className="flex min-w-0 flex-col gap-4">
            <StatCards scanner={scanner} />
            <SpectrumChart scanner={scanner} />
            <FrequencyUsageChart scanner={scanner} />
            <ChannelHeatmap scanner={scanner} />
            <div className="grid grid-cols-1 gap-4 2xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
              <NetworkList scanner={scanner} />
              <div className="flex flex-col gap-4">
                <RecommendationCard scanner={scanner} />
                <HistoryPanel scanner={scanner} />
              </div>
            </div>
          </div>
        </div>
      </main>

      <footer className="border-t border-line py-3 text-center text-[11px] text-ink-3">
        AirScope · frequency planning for MikroTik · scans via RouterOS API ·{" "}
        <a
          href={REPO_URL}
          target="_blank"
          rel="noreferrer noopener"
          className="text-ink-2 underline decoration-line underline-offset-2 transition-colors hover:text-accent"
        >
          GitHub
        </a>
      </footer>
    </div>
  );
}

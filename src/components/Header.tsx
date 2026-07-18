"use client";

import { Moon, Radar, Sun } from "lucide-react";
import { useStoredString } from "@/lib/clientStore";
import { cn } from "@/lib/utils";
import type { Scanner } from "@/hooks/useScanner";

export const REPO_URL = "https://github.com/BerkSMBL/AirScope";

function GithubMark({ size = 15 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden
    >
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

export function Header({ scanner }: { scanner: Scanner }) {
  const [theme, setTheme] = useStoredString("airscope:theme", "dark");

  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    if (next === "light") {
      document.documentElement.setAttribute("data-theme", "light");
    } else {
      document.documentElement.removeAttribute("data-theme");
    }
  };

  const { connState, device, scanning } = scanner;
  const connected = connState === "connected";

  return (
    <header className="sticky top-0 z-20 border-b border-line bg-bg/85 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-[1600px] items-center gap-3 px-4">
        <div className="flex items-center gap-2.5">
          <span className="grid size-8 place-items-center rounded-lg bg-accent/15 text-accent">
            <Radar size={18} />
          </span>
          <div className="leading-tight">
            <div className="text-[15px] font-semibold tracking-tight">AirScope</div>
            <div className="text-[10px] text-ink-3 -mt-0.5">
              MikroTik Frequency Analyzer
            </div>
          </div>
        </div>

        <div className="ml-auto flex items-center gap-2">
          {scanning && (
            <span className="hidden sm:inline-flex items-center gap-1.5 rounded-full border border-accent/30 bg-accent/10 px-2.5 py-1 text-[11px] font-medium text-accent">
              <span className="relative flex size-1.5">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-accent opacity-60" />
                <span className="relative inline-flex size-1.5 rounded-full bg-accent" />
              </span>
              Scanning
            </span>
          )}

          <span
            className={cn(
              "inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-[11.5px] font-medium",
              connected
                ? "border-good/30 bg-good/10 text-good"
                : connState === "connecting"
                  ? "border-warn/30 bg-warn/10 text-warn"
                  : "border-line bg-panel-3 text-ink-3"
            )}
          >
            <span
              className={cn(
                "size-2 rounded-full",
                connected
                  ? "bg-good dot-live"
                  : connState === "connecting"
                    ? "bg-warn"
                    : "bg-ink-3"
              )}
            />
            {connected
              ? (device?.identity ?? "Connected")
              : connState === "connecting"
                ? "Connecting…"
                : "Disconnected"}
          </span>

          <a
            href={REPO_URL}
            target="_blank"
            rel="noreferrer noopener"
            title="View source on GitHub"
            className="grid size-8 place-items-center rounded-lg border border-line bg-panel-2 text-ink-2 transition-colors hover:text-ink"
          >
            <GithubMark size={15} />
          </a>

          <button
            type="button"
            onClick={toggleTheme}
            title="Toggle theme"
            className="grid size-8 place-items-center rounded-lg border border-line bg-panel-2 text-ink-2 transition-colors hover:text-ink"
          >
            {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
          </button>
        </div>
      </div>
    </header>
  );
}

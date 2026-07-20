"use client";

import { useState } from "react";
import { Bookmark, Cable, Cpu, Plug, Trash2, Unplug } from "lucide-react";
import { Button, Card, Field, inputClass } from "./ui";
import { useStoredJson, useStoredString } from "@/lib/clientStore";
import { cn, uid } from "@/lib/utils";
import type { Scanner } from "@/hooks/useScanner";
import type { DeviceProfile } from "@/lib/types";

const PROFILES_KEY = "airscope:profiles";

export function ConnectionPanel({ scanner }: { scanner: Scanner }) {
  // connection fields persist across sessions (password never does)
  const [host, setHost] = useStoredString("airscope:last-host", "192.168.88.1");
  const [user, setUser] = useStoredString("airscope:last-user", "admin");
  const [portStr, setPortStr] = useStoredString("airscope:last-port", "8728");
  const [password, setPassword] = useState("");
  const [profiles, persist] = useStoredJson<DeviceProfile[]>(PROFILES_KEY);
  const port = parseInt(portStr, 10) || 8728;

  const saveProfile = (identity?: string) => {
    if (!host) return;
    // reuse an earlier identity if we're saving the same target without one
    const prior = profiles.find((p) => p.host === host && p.user === user);
    const name = identity || prior?.name || `${user}@${host}`;
    const profile: DeviceProfile = { id: uid(), name, host, user, port };
    persist([profile, ...profiles.filter((p) => p.host !== host || p.user !== user)].slice(0, 8));
  };

  const loadProfile = (p: DeviceProfile) => {
    setHost(p.host);
    setUser(p.user);
    setPortStr(String(p.port));
  };

  const { connState, connError, device, connect, disconnect, iface, setIface } = scanner;
  const connected = connState === "connected";
  const connecting = connState === "connecting";

  return (
    <Card title="Device connection" icon={<Cable size={14} />}>
      <div className="flex flex-col gap-3 p-4">
        {!connected && (
          <>
            <div className="grid grid-cols-[1fr_84px] gap-2">
              <Field label="Router IP">
                <input
                  className={inputClass}
                  value={host}
                  onChange={(e) => setHost(e.target.value)}
                  placeholder="192.168.88.1"
                  spellCheck={false}
                />
              </Field>
              <Field label="API port">
                <input
                  className={cn(inputClass, "mono")}
                  value={portStr}
                  onChange={(e) => setPortStr(e.target.value)}
                  inputMode="numeric"
                />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Username">
                <input
                  className={inputClass}
                  value={user}
                  onChange={(e) => setUser(e.target.value)}
                  autoComplete="username"
                  spellCheck={false}
                />
              </Field>
              <Field label="Password">
                <input
                  className={inputClass}
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                />
              </Field>
            </div>

            <div className="flex gap-2">
              <Button
                variant="primary"
                className="flex-1"
                disabled={connecting || !host || !user}
                onClick={() =>
                  void connect({ host, user, password, port }).then((info) => {
                    // remember successful targets under the device's own name
                    if (info) saveProfile(info.identity);
                  })
                }
              >
                <Plug size={14} />
                {connecting ? "Connecting…" : "Connect"}
              </Button>
              <Button variant="ghost" onClick={saveProfile} title="Save device profile">
                <Bookmark size={14} />
              </Button>
            </div>

            {connError && (
              <p className="rounded-lg border border-critical/30 bg-critical/10 px-3 py-2 text-[12px] text-critical">
                {connError}
              </p>
            )}

            {profiles.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <span className="section-label">Saved profiles</span>
                <div className="flex flex-col gap-1">
                  {profiles.map((p) => (
                    <div
                      key={p.id}
                      className="group flex items-center gap-2 rounded-lg border border-line bg-panel-2 px-2.5 py-1.5 text-[12.5px] transition-colors hover:border-accent/40 cursor-pointer"
                      onClick={() => loadProfile(p)}
                    >
                      <Cpu size={13} className="shrink-0 text-ink-3" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium text-ink">
                          {p.name}
                        </span>
                        {p.name !== `${p.user}@${p.host}` && (
                          <span className="mono block truncate text-[10.5px] text-ink-3">
                            {p.user}@{p.host}
                          </span>
                        )}
                      </span>
                      <span className="mono shrink-0 text-[11px] text-ink-3">:{p.port}</span>
                      <button
                        type="button"
                        className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100 text-ink-3 hover:text-critical"
                        onClick={(e) => {
                          e.stopPropagation();
                          persist(profiles.filter((x) => x.id !== p.id));
                        }}
                        title="Delete profile"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {connected && device && (
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2.5 rounded-lg border border-good/25 bg-good/8 px-3 py-2.5">
              <span className="size-2 rounded-full bg-good dot-live shrink-0" />
              <div className="min-w-0">
                <div className="truncate text-[13.5px] font-semibold">{device.identity}</div>
                <div className="truncate text-[11.5px] text-ink-3">
                  {device.board} · RouterOS {device.version}
                </div>
              </div>
              <Button variant="ghost" className="ml-auto" onClick={disconnect} title="Disconnect">
                <Unplug size={14} />
              </Button>
            </div>

            {device.interfaces.length > 0 ? (
              <Field label="Wireless interface">
                <select
                  className={inputClass}
                  value={iface ?? ""}
                  onChange={(e) => setIface(e.target.value)}
                >
                  {device.interfaces.map((i) => (
                    <option key={i.name} value={i.name}>
                      {i.name}
                      {i.frequency ? ` · ${i.frequency} MHz` : i.band ? ` · ${i.band}` : ""}
                      {i.mode ? ` · ${i.mode}` : ""}
                    </option>
                  ))}
                </select>
              </Field>
            ) : (
              <p className="text-[12px] text-warn">
                No wireless interfaces found on this device.
              </p>
            )}

            <p className="text-[11.5px] leading-relaxed text-ink-3">
              Scanning takes the radio off its service channel — client traffic on
              this interface is interrupted while a scan or frequency sweep runs.
            </p>
          </div>
        )}
      </div>
    </Card>
  );
}

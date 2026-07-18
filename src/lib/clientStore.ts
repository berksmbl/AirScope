"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";

/**
 * localStorage-backed state that is SSR/hydration-safe: the server snapshot
 * is the fallback, the client snapshot is the stored value, and writes
 * notify every subscribed component.
 */

const listeners = new Map<string, Set<() => void>>();

function subscribeKey(key: string) {
  return (cb: () => void) => {
    let set = listeners.get(key);
    if (!set) {
      set = new Set();
      listeners.set(key, set);
    }
    set.add(cb);
    return () => {
      set.delete(cb);
    };
  };
}

function notifyKey(key: string) {
  listeners.get(key)?.forEach((cb) => cb());
}

export function useStoredString(
  key: string,
  fallback: string
): [string, (v: string) => void] {
  const subscribe = useMemo(() => subscribeKey(key), [key]);
  const value = useSyncExternalStore(
    subscribe,
    () => {
      try {
        return localStorage.getItem(key) ?? fallback;
      } catch {
        return fallback;
      }
    },
    () => fallback
  );
  const set = useCallback(
    (v: string) => {
      try {
        localStorage.setItem(key, v);
      } catch {
        /* storage unavailable */
      }
      notifyKey(key);
    },
    [key]
  );
  return [value, set];
}

export function useStoredJson<T>(
  key: string,
  fallbackJson = "[]"
): [T, (v: T) => void] {
  const [raw, setRaw] = useStoredString(key, fallbackJson);
  const value = useMemo(() => {
    try {
      return JSON.parse(raw) as T;
    } catch {
      return JSON.parse(fallbackJson) as T;
    }
  }, [raw, fallbackJson]);
  const set = useCallback((v: T) => setRaw(JSON.stringify(v)), [setRaw]);
  return [value, set];
}

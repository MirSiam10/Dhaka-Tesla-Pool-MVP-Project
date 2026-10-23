'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

interface Polled<T> {
  data: T | undefined;
  /** Error from the most recent attempt; cleared on the next success. Old data stays visible. */
  error: Error | null;
  /** True only until the first response (or failure) arrives. */
  loading: boolean;
  refresh: () => Promise<void>;
}

/**
 * Loads once, then re-fetches every `intervalMs` while the tab is visible.
 * Polling is the MVP's "real time": simple, works behind any proxy. Push (SSE/WebSocket)
 * is the documented next step once polling load matters (see README scaling section).
 */
export function usePolling<T>(load: () => Promise<T>, intervalMs: number, enabled = true): Polled<T> {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);
  const loadRef = useRef(load);
  loadRef.current = load;
  const inFlight = useRef(false);

  const refresh = useCallback(async () => {
    if (inFlight.current) return; // never stack requests if the server is slow
    inFlight.current = true;
    try {
      setData(await loadRef.current());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    void refresh();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, intervalMs);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refresh, intervalMs, enabled]);

  return { data, error, loading, refresh };
}

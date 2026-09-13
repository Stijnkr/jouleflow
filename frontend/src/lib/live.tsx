import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Reading } from "./api";

type LiveValue = {
  reading: Reading | null;
  connected: boolean;
  /** Subscribe to every incoming reading (for appending to live charts). */
  subscribe: (fn: (r: Reading) => void) => () => void;
};

const LiveContext = createContext<LiveValue | null>(null);

export function LiveProvider({ children }: { children: ReactNode }) {
  const [reading, setReading] = useState<Reading | null>(null);
  const [connected, setConnected] = useState(false);
  const listeners = useRef(new Set<(r: Reading) => void>());

  useEffect(() => {
    let socket: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout>;
    let delay = 1000;
    let closed = false;

    const connect = () => {
      const proto = location.protocol === "https:" ? "wss" : "ws";
      socket = new WebSocket(`${proto}://${location.host}/api/ws`);
      socket.onopen = () => {
        setConnected(true);
        delay = 1000;
      };
      socket.onmessage = (e) => {
        const r = JSON.parse(e.data) as Reading;
        setReading(r);
        listeners.current.forEach((fn) => fn(r));
      };
      socket.onclose = () => {
        setConnected(false);
        if (closed) return;
        retry = setTimeout(connect, delay);
        delay = Math.min(delay * 2, 15000);
      };
    };
    connect();
    return () => {
      closed = true;
      clearTimeout(retry);
      socket?.close();
    };
  }, []);

  const subscribe = useCallback((fn: (r: Reading) => void) => {
    listeners.current.add(fn);
    return () => {
      listeners.current.delete(fn);
    };
  }, []);

  return (
    <LiveContext.Provider value={{ reading, connected, subscribe }}>{children}</LiveContext.Provider>
  );
}

export function useLive() {
  const ctx = useContext(LiveContext);
  if (!ctx) throw new Error("useLive must be used inside LiveProvider");
  return ctx;
}

/** Re-renders every `ms` so relative times stay current. */
export function useNow(ms = 1000) {
  const [now, setNow] = useState(() => Date.now() / 1000);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now() / 1000), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

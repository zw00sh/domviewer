import { useEffect, useRef, useState, useCallback } from "react";

type WSStatus = "connecting" | "open" | "closed";

interface UseWebSocketOptions {
  /**
   * Called synchronously for every incoming message — fires for every message
   * regardless of React render batching, so no messages are ever dropped.
   */
  onMessage?: (event: MessageEvent) => void;
}

export function useWebSocket(url: string | null, options?: UseWebSocketOptions) {
  const [status, setStatus] = useState<WSStatus>("closed");
  const [lastMessage, setLastMessage] = useState<MessageEvent | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const onMessageRef = useRef(options?.onMessage);

  // Keep the ref current without re-running the WS setup effect
  useEffect(() => {
    onMessageRef.current = options?.onMessage;
  }, [options?.onMessage]);

  useEffect(() => {
    if (!url) return;

    setStatus("connecting");
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.addEventListener("open", () => setStatus("open"));
    ws.addEventListener("close", () => setStatus("closed"));
    ws.addEventListener("message", (e) => {
      onMessageRef.current?.(e); // always fires synchronously for every message
      setLastMessage(e);          // backward-compat: still updates state for other consumers
    });

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [url]);

  const send = useCallback((data: string | ArrayBufferLike) => {
    wsRef.current?.send(data);
  }, []);

  return { status, lastMessage, send };
}

"use client";

import { useEffect, useRef } from "react";
import { init, type WidgetOptions } from "../browser/index.js";

export interface AgentIdentificationProps extends Omit<WidgetOptions, "container"> {
  className?: string;
  id?: string;
}

/** Optional React integration; all network and DOM work happens after mount. */
export function AgentIdentification({
  className,
  id,
  onRecorded,
  onError,
  ...options
}: AgentIdentificationProps) {
  const container = useRef<HTMLDivElement>(null);
  const callbacks = useRef({ onRecorded, onError });
  callbacks.current = { onRecorded, onError };

  useEffect(() => {
    if (!container.current) return;
    let widget;
    try {
      widget = init({
        ...options,
        container: container.current,
        onRecorded: (response) => callbacks.current.onRecorded?.(response),
        onError: (error) => callbacks.current.onError?.(error),
      });
    } catch (error) {
      const failure =
        error instanceof Error ? error : new Error("Identification could not initialize.");
      const notice = document.createElement("p");
      notice.setAttribute("role", "alert");
      notice.textContent = `Visitor identification unavailable. ${failure.message}`;
      container.current.append(notice);
      callbacks.current.onError?.(failure);
      return () => notice.remove();
    }
    return () => widget.destroy();
  }, [
    options.apiUrl,
    options.siteId,
    options.mode,
    options.gate,
    options.styleUrl,
    options.bindingContext,
    options.storage,
  ]);

  return <div ref={container} className={className} id={id} />;
}

import { init, type WidgetOptions } from "./index.js";

declare global {
  interface Window {
    AgentIdentification: { init: typeof init };
  }
}

window.AgentIdentification = Object.freeze({ init });
const script = document.currentScript as HTMLScriptElement | null;

if (script?.dataset.site) {
  const boot = () => {
    try {
      let container: HTMLElement | string;
      if (script.dataset.target) {
        container = script.dataset.target;
      } else {
        container = document.createElement("div");
        container.dataset.agentIdentificationContainer = "";
        document.body.append(container);
      }
      const options: WidgetOptions = {
        container,
        siteId: script.dataset.site!,
        apiUrl: script.dataset.api ?? new URL(script.src).origin,
        mode: script.dataset.mode as WidgetOptions["mode"],
        gate: script.dataset.gate,
        storage: script.dataset.storage as WidgetOptions["storage"],
        styleUrl: script.dataset.style,
        onRecorded: (declaration) => {
          const target =
            typeof container === "string" ? document.querySelector(container)! : container;
          target.dispatchEvent(
            new CustomEvent("agent-identification:recorded", {
              detail: declaration,
              bubbles: true,
            }),
          );
        },
        onError: (error) => {
          document.dispatchEvent(
            new CustomEvent("agent-identification:error", { detail: { message: error.message } }),
          );
        },
      };
      init(options);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Identification widget could not initialize.";
      const notice = document.createElement("p");
      notice.setAttribute("role", "alert");
      notice.textContent = `Visitor identification unavailable. ${message}`;
      script.insertAdjacentElement("afterend", notice);
      document.dispatchEvent(
        new CustomEvent("agent-identification:error", { detail: { message } }),
      );
    }
  };
  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
}

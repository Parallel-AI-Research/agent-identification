import { track, type TrackerOptions } from "./track.js";

declare global {
  interface Window {
    AgentIdentificationTracker: { track: typeof track };
  }
}

window.AgentIdentificationTracker = Object.freeze({ track });
const script = document.currentScript as HTMLScriptElement | null;

// It draws nothing, even when it fails: errors only reach listeners for this event.
function reportError(message: string): void {
  document.dispatchEvent(new CustomEvent("agent-identification:error", { detail: { message } }));
}

if (script?.dataset.site) {
  try {
    track({
      siteId: script.dataset.site,
      apiUrl: script.dataset.api ?? new URL(script.src).origin,
      storage: script.dataset.storage as TrackerOptions["storage"],
      route: script.dataset.route,
      navigation: script.dataset.navigation !== "off",
      automationSignals: script.dataset.automationSignals !== "off",
      onError: (error) => reportError(error.message),
    });
  } catch (error) {
    reportError(error instanceof Error ? error.message : "Agent Identification could not start.");
  }
}

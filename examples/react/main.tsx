import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { AgentIdentification } from "@parallel-research/agent-identification/react";

const apiUrl =
  document.querySelector<HTMLMetaElement>('meta[name="agent-id-api"]')?.content ??
  "http://127.0.0.1:4310";
const siteId =
  document.querySelector<HTMLMetaElement>('meta[name="agent-id-site"]')?.content ?? "demo-site";
const reactPath =
  document.querySelector<HTMLMetaElement>('meta[name="agent-id-react-path"]')?.content ?? "/react/";
const scriptPath =
  document.querySelector<HTMLMetaElement>('meta[name="agent-id-script-path"]')?.content ??
  "/plain/";

function App() {
  const [mounted, setMounted] = useState(true);
  const [message, setMessage] = useState("");
  const [choice, setChoice] = useState("");
  const mode =
    new URLSearchParams(location.search).get("mode") === "optional" ? "optional" : "required";
  return (
    <>
      <header>
        <nav>
          <div className="brand">
            <span>f</span>fieldwork
          </div>
          <div className="tag">Team workspace · React example</div>
        </nav>
      </header>
      <main>
        <div className="eyebrow">Workspace / Announcements</div>
        <h1>A little progress, shared.</h1>
        <p className="intro">
          The same widget, imported as a React component. Your application owns mounting, callbacks,
          and the controls it chooses to gate.
        </p>
        {mounted && (
          <AgentIdentification
            id="visitor-choice"
            siteId={siteId}
            apiUrl={apiUrl}
            mode={mode}
            gate="#publish-form"
            onRecorded={(event) => setChoice(event.choice)}
          />
        )}
        <div className="layout">
          <section className="card">
            <h2>Publish an update</h2>
            <p>Give the team a short update about what you’re working on.</p>
            <form
              id="publish-form"
              onSubmit={(event) => {
                event.preventDefault();
                setMessage("Update published locally. No content was sent.");
              }}
            >
              <label>
                Headline
                <input name="headline" placeholder="What’s new?" required />
              </label>
              <label>
                Update
                <textarea name="update" placeholder="A few words for your team…" />
              </label>
              <button type="submit">Publish update</button>
            </form>
            <output aria-live="polite">{message}</output>
          </section>
          <aside className="card">
            <h2>Fits your application.</h2>
            <p>
              This uses the package’s React export and runs under Strict Mode. Unmounting removes
              the widget and restores the form’s original inert state.
            </p>
            <p className="small">
              The classification is self-reported. Backend authorization requires a separate
              server-side integration.
            </p>
            <div className="divider">
              <a href={`${reactPath}?mode=optional`}>Try optional mode</a> ·{" "}
              <a href={reactPath}>Required mode</a>
              <div className="controls">
                <button className="secondary" onClick={() => setMounted((value) => !value)}>
                  {mounted ? "Remove widget" : "Mount widget"}
                </button>
              </div>
              <output id="callback-result" aria-live="polite">
                {choice ? `Application received: ${choice}` : ""}
              </output>
            </div>
          </aside>
        </div>
        <footer>
          Fieldwork demo · <a href={scriptPath}>Open script example</a>
        </footer>
      </main>
    </>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

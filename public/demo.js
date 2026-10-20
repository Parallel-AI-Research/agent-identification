const mode =
  new URLSearchParams(location.search).get("mode") === "optional" ? "optional" : "required";
if (mode === "optional") {
  document.querySelector("#try-title").textContent = "An invitation to identify yourself.";
  document.querySelector("#mode-description").textContent =
    "Choose an option or continue without answering. The form stays available.";
}
const widget = window.AgentIdentification.init({
  container: "#visitor-choice",
  gate: "#demo-form",
  apiUrl: location.origin,
  siteId: "public-demo",
  mode,
});
document.querySelector("#demo-form").addEventListener("submit", (event) => {
  event.preventDefault();
  document.querySelector("#preview-result").textContent = "Preview ready. No headline was sent.";
});
document.querySelector("#reset").addEventListener("click", async (event) => {
  event.currentTarget.disabled = true;
  try {
    await widget.reset();
    document.querySelector("#preview-result").textContent = "";
  } catch {
    // The widget displays the failure and offers a retry.
  } finally {
    document.querySelector("#reset").disabled = false;
  }
});
const snippet = `<div id="visitor-choice"></div>
<script defer
  src="${location.origin}/sdk/v0.1.0/agent-id.js"
  data-site="parallel"
  data-target="#visitor-choice"
  data-mode="optional"
></script>`;
document.querySelector("#install-code").textContent = snippet;
document.querySelector("#package-code").textContent =
  `npm install ${location.origin}/downloads/parallel-research-agent-identification-0.1.0.tgz`;
document.querySelector("#copy").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(snippet);
    document.querySelector("#copy-result").textContent = "Copied.";
  } catch {
    document.querySelector("#copy-result").textContent = "Select and copy the snippet above.";
  }
});

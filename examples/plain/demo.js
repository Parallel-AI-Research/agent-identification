/* Demo controls are separate from the snippet. A real site only needs the snippet. */
const installation = document.querySelector("#identification-script");
const options = {
  container: "#visitor-choice",
  siteId: installation.dataset.site,
  apiUrl: installation.dataset.api,
  mode: installation.dataset.mode,
  gate: "#publish-form",
};
let widget = window.AgentIdentification.init(options);
const lifecycleResult = document.querySelector("#lifecycle-result");
document.querySelector("#publish-form").addEventListener("submit", (event) => {
  event.preventDefault();
  document.querySelector("#publish-result").textContent =
    "Update published locally. No content was sent.";
});
document.querySelector("#reset").addEventListener("click", async () => {
  try {
    await widget.reset();
    lifecycleResult.textContent = "New anonymous session started.";
  } catch {
    lifecycleResult.textContent = "Reset failed. Your previous session was not cleared.";
  }
});
document.querySelector("#remove").addEventListener("click", () => {
  widget.destroy();
  lifecycleResult.textContent = "Widget removed.";
});
document.querySelector("#mount").addEventListener("click", () => {
  widget = window.AgentIdentification.init(options);
  lifecycleResult.textContent = "Widget mounted.";
});

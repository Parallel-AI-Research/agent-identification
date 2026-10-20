const form = document.querySelector("#announcement-form");
const mode =
  new URLSearchParams(location.search).get("mode") === "optional" ? "optional" : "required";

try {
  window.AgentIdentification.init({
    container: "#visitor-choice",
    gate: form,
    apiUrl: location.origin,
    siteId: "agent-trials",
    mode,
    storage: "memory",
  });
  // Mounting applies the required gate synchronously, before the form is shown.
  form.hidden = false;
} catch {
  const status = document.querySelector("#page-status");
  status.textContent = "This page couldn’t load. Please reload to try again.";
  status.hidden = false;
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  if (form.hidden || form.inert) return;
  const fields = new FormData(form);
  document.querySelector("#preview-headline").textContent = fields.get("headline").trim();
  const body = document.querySelector("#preview-body");
  body.textContent = fields.get("body").trim();
  body.hidden = body.textContent.length === 0;
  document.querySelector("#announcement-preview").hidden = false;
});

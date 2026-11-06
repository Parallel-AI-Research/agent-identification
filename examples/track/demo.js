/* A tiny single-page router for the demo. A real site only needs the script tag. */
for (const link of document.querySelectorAll("[data-navigate]")) {
  link.addEventListener("click", (event) => {
    event.preventDefault();
    history.pushState({}, "", link.getAttribute("href"));
    document.querySelector("#section").textContent = link.textContent;
  });
}

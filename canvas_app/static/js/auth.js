// [Codex] Exchange a launcher-only fragment for an HttpOnly local session.
// Tokens never enter storage, query strings, rendered content, or console output.
window.canvasSessionReady = (async () => {
  let token = new URLSearchParams(window.location.hash.slice(1)).get("bootstrap");
  if (token !== null) history.replaceState(null, "", window.location.pathname + window.location.search);
  try {
    if (token) {
      const response = await fetch("/api/auth/session", {
        method: "POST", credentials: "same-origin", cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token })
      });
      token = null;
      if (response.ok) return true;
    }
    return (await fetch("/api/auth/session", { credentials: "same-origin", cache: "no-store" })).ok;
  } catch (_) {
    return false;
  } finally {
    token = null;
  }
})();

function showLocalSessionRequired() {
  const panel = document.createElement("main");
  panel.className = "local-session-required";
  const title = document.createElement("h1");
  title.textContent = "Open Canvas from its launcher";
  const message = document.createElement("p");
  message.textContent = "Your local session is unavailable. Restart the Canvas launcher and use the browser window it opens to access your courses.";
  panel.append(title, message);
  document.body.replaceChildren(panel);
}

// A browser may reuse a locked tab for the launcher's fragment URL.
window.addEventListener("hashchange", () => {
  if (new URLSearchParams(window.location.hash.slice(1)).has("bootstrap")) window.location.reload();
});

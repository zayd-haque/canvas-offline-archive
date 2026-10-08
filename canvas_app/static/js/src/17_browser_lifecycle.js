// [Codex] Keep the launcher alive while any authenticated app tab is open.
(async function () {
  if (!await window.canvasSessionReady) return;
  const tabId = Array.from(crypto.getRandomValues(new Uint8Array(16)),
    byte => byte.toString(16).padStart(2, "0")).join("");
  const payload = JSON.stringify({ tab_id: tabId });
  const heartbeat = () => fetch("/api/browser/heartbeat", {
    method: "POST", credentials: "same-origin",
    headers: { "Content-Type": "application/json" }, body: payload,
    keepalive: true
  }).catch(() => {});
  let closed = false;
  let timer;
  const release = () => {
    closed = true;
    if (timer) clearInterval(timer);
    navigator.sendBeacon("/api/browser/release",
      new Blob([payload], { type: "application/json" }));
  };
  window.addEventListener("pagehide", release, { once: true });
  await heartbeat();
  if (closed) release(); // A close may race the first heartbeat response.
  else timer = setInterval(heartbeat, 5000);
})();

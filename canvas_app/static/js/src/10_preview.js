// [Codex] Ignore late document responses after navigation, close, or course changes.
let previewGeneration = 0;
let previewController = null;

async function openPreviewModal(fileName, filePath, fileList = null, fileIndex = -1) {
  const generation = ++previewGeneration;
  if (previewController) previewController.abort();
  const controller = new AbortController();
  previewController = controller;
  const course = state.currentCourse;
  const active = () => generation === previewGeneration && !controller.signal.aborted && course === state.currentCourse;
  state.activeFile = { name: fileName, path: filePath };
  const ext = fileName.split(".").pop().toLowerCase();
  
  // Track and update preview navigation state
  updatePreviewFileList(fileName, filePath, fileList, fileIndex);

  els.previewFileName.textContent = fileName;
  els.previewFileIcon.innerHTML = getFileIcon(fileName);
  els.btnOpenMac.innerHTML = Icons.macApp + " Open in Default App";

  // Update folder/module context badge
  if (els.previewFolderBadge) {
    const activeEntry = (state.previewFileList && state.previewFileList[state.previewCurrentIndex]) || null;
    let contextName = activeEntry?.context || "";
    if (!contextName && filePath && filePath.includes("/")) {
      const parts = filePath.split("/");
      contextName = parts[parts.length - 2] || "";
    }
    if (contextName) {
      els.previewFolderBadge.textContent = contextName;
      els.previewFolderBadge.title = `Contained in: ${contextName}`;
      els.previewFolderBadge.style.display = "inline-flex";
    } else {
      els.previewFolderBadge.style.display = "none";
    }
  }
  
  // Reset previous views
  els.previewIframe.style.display = "none";
  els.previewIframe.src = "about:blank";
  if (els.previewCustomContent) {
    els.previewCustomContent.style.display = "none";
    els.previewCustomContent.innerHTML = "";
  }
  
  let ph = document.getElementById("non-previewable-placeholder");
  if (!ph) {
    ph = document.createElement("div");
    ph.id = "non-previewable-placeholder";
    ph.style.cssText = "display:flex; flex-direction:column; align-items:center; justify-content:center; height:100%; color:#FFFFFF; text-align:center; padding:30px;";
    els.previewIframe.parentNode.appendChild(ph);
  }
  ph.innerHTML = `
    <div style="margin-bottom:16px;">${Icons.refresh}</div>
    <h3 style="font-size:16px; margin-bottom:6px;">Loading preview for ${escapeHtml(fileName)}...</h3>
    <p style="font-size:13px; color:#94A3B8;">Preparing document view...</p>
  `;
  els.previewModal.classList.remove("hidden");

  const bindNativeActions = () => {
    ph.querySelectorAll("[data-preview-action]").forEach(button => {
      button.addEventListener("click", () => systemAction(filePath, button.getAttribute("data-preview-action"), course));
    });
  };

  try {
    const res = await fetch(`/api/courses/${encodeURIComponent(course)}/preview-document`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ file_path: filePath }),
      signal: controller.signal
    });
    
    if (!res.ok) throw new Error("Failed to load document preview");
    const data = await res.json();
    if (!active()) return;
    
    if (els.previewFileSize && data.formatted_size) {
      els.previewFileSize.textContent = data.formatted_size;
    }

    // Direct server-side formatted content (assignments, markdown, text files, code, images)
    if (data.formatted_html) {
      els.btnOpenTab.href = data.url || "#";
      if (ph) ph.remove();
      els.previewIframe.style.display = "none";
      els.previewIframe.src = "about:blank";
      if (els.previewCustomContent) {
        els.previewCustomContent.style.display = "block";
        els.previewCustomContent.style.fontSize = state.settings?.readerFontSize || "15px";
        els.previewCustomContent.innerHTML = data.formatted_html;
        els.previewCustomContent.querySelectorAll(".inline-file-btn, .btn-drawer-file").forEach(btn => {
          btn.addEventListener("click", (e) => {
            const path = btn.getAttribute("data-filepath");
            if (path) {
              e.preventDefault();
              e.stopPropagation();
              const title = btn.getAttribute("data-title") || "File";
              handleFileClick(title, path);
            }
          });
        });
      }
      return;
    }
    
    if (data.type === "direct" || data.type === "html_preview" || data.type === "pdf") {
      let finalUrl = data.viewer_url || data.url;
      
      if (data.type === "pdf" || ext === "pdf" || data.extension === ".pdf" || data.url.endsWith(".pdf")) {
        const fileUrlWithCacheBust = data.url + (data.url.includes("?") ? "&" : "?") + `t=${Date.now()}`;
        const zoomHash = state.settings?.pdfDefaultZoom ? `#zoom=${state.settings.pdfDefaultZoom}` : "";
        finalUrl = data.viewer_url || `/static/pdfjs/web/viewer.html?file=${encodeURIComponent(fileUrlWithCacheBust)}${zoomHash}`;
      }
      
      els.btnOpenTab.href = finalUrl;
      if (ph) ph.remove();
      if (els.previewCustomContent) els.previewCustomContent.style.display = "none";
      els.previewIframe.style.display = "block";
      if (data.type === "html_preview") {
        els.previewIframe.onload = () => {
          try {
            const doc = els.previewIframe.contentDocument || els.previewIframe.contentWindow?.document;
            if (!doc) return;
            if (doc.querySelector(".slide") || doc.querySelector("div.slide")) {
              if (!doc.getElementById("canvas-injected-slide-style")) {
                const style = doc.createElement("style");
                style.id = "canvas-injected-slide-style";
                style.textContent = `
                  html, body {
                    margin: 0 !important;
                    padding: 0 !important;
                    width: 100% !important;
                    min-height: 100% !important;
                    background: #525659 !important;
                  }
                  body {
                    display: flex !important;
                    flex-direction: column !important;
                    align-items: center !important;
                    justify-content: flex-start !important;
                    padding: 24px 0 !important;
                    box-sizing: border-box !important;
                  }
                  div.slide, div.loading-slide {
                    margin-left: auto !important;
                    margin-right: auto !important;
                    margin-top: 20px !important;
                    margin-bottom: 20px !important;
                    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.4) !important;
                    flex-shrink: 0 !important;
                  }
                  div.slide:first-of-type {
                    margin-top: 0 !important;
                  }
                `;
                (doc.head || doc.body).appendChild(style);
              }
            }
          } catch (e) {
            // Frame access error guard
          }
        };
      } else {
        els.previewIframe.onload = null;
      }
      els.previewIframe.src = finalUrl;
    } else {
      // Fallback for non-renderable binaries
      ph.innerHTML = `
        <div style="margin-bottom:16px;">${Icons.file}</div>
        <h3 style="font-size:18px; margin-bottom:8px;">${escapeHtml(fileName)}</h3>
        <p style="font-size:14px; color:#CBD5E1; max-width:400px; margin-bottom:24px;">
          This file format is best opened directly using Microsoft PowerPoint or your default application.
        </p>
        <div style="display:flex; gap:12px;">
          <button class="btn-preview-action" data-preview-action="open" style="padding:8px 16px; font-size:14px;">
            ${Icons.macApp} Open in Application
          </button>
          <button class="btn-preview-action" data-preview-action="reveal" style="padding:8px 16px; font-size:14px;">
            ${Icons.macFinder} Show in Folder
          </button>
        </div>
      `;
      bindNativeActions();
    }
  } catch (err) {
    if (!active() || err.name === "AbortError") return;
    console.error("Preview error:", err);
    ph.innerHTML = `
      <div style="margin-bottom:16px;">${Icons.file}</div>
      <h3 style="font-size:16px; margin-bottom:8px;">Preview unavailable in browser</h3>
      <p style="font-size:13px; color:#CBD5E1; margin-bottom:20px;">You can open this file directly on your computer.</p>
      <button class="btn-preview-action" data-preview-action="open">
        ${Icons.macApp} Open in Default App
      </button>
    `;
    bindNativeActions();
  }
}

function closePreviewModal() {
  previewGeneration++;
  if (previewController) previewController.abort();
  previewController = null;
  els.previewModal.classList.add("hidden");
  if (els.previewModalContainer) els.previewModalContainer.classList.remove("modal-fullscreen");
  els.previewModal.classList.remove("is-fullscreen");
  const iconEl = document.getElementById("icon-fullscreen");
  if (iconEl) iconEl.innerHTML = Icons.fullscreen;
  els.previewIframe.src = "about:blank";
  if (els.previewCustomContent) {
    els.previewCustomContent.style.display = "none";
    els.previewCustomContent.innerHTML = "";
  }
  if (els.previewFileSize) {
    els.previewFileSize.textContent = "-- KB";
  }
  const ph = document.getElementById("non-previewable-placeholder");
  if (ph) ph.remove();
  state.activeFile = null;
  state.previewFileList = [];
  state.previewCurrentIndex = -1;
  renderPreviewNavControls();
}

// Call macOS system action (Preview or Finder)
async function systemAction(filePath, action = "open", targetCourse = null) {
  const course = targetCourse || state.currentCourse;
  if (!course) {
    console.warn("Cannot perform system action without active course");
    return;
  }
  try {
    const res = await fetch(`/api/courses/${encodeURIComponent(course)}/open-system`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ file_path: filePath, action })
    });
    if (!res.ok) {
      const err = await res.json();
      console.warn("System action failed:", err);
    }
  } catch (err) {
    console.error("Failed to execute system action:", err);
  }
}


// --- Settings & Preferences Management ---

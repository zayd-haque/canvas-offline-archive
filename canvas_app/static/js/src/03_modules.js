function renderCanvasView() {
  if (!state.courseData) return;
  const tab = state.activeCanvasTab;

  if (tab === "modules") {
    renderModulesTab();
  } else if (tab === "announcements") {
    renderAnnouncementsTab();
  } else if (tab === "assignments") {
    renderAssignmentsTab();
  } else if (tab === "discussions") {
    renderDiscussionsTab();
  } else if (tab === "media") {
    renderMediaTab();
  } else if (tab === "syllabus") {
    renderSyllabusTab();
  } else if (tab === "grades") {
    renderGradesTab();
  }
}

// [Codex] Coalesce typing updates for large module inventories.
let moduleSearchTimer = null;

// Render Modules Accordion View
function renderModulesTab() {
  const modules = state.courseData.modules || [];
  const q = state.moduleSearch.toLowerCase().trim();
  const isSynthesized = modules.some(m => String(m.id || "").startsWith("synth_"));

  let html = `
    <div class="modules-container">
      <div class="modules-top-bar">
        <div class="search-box">
          <span class="search-icon-inside">${Icons.search}</span>
          <input type="text" id="module-search-input" placeholder="Search modules and course items..." value="${escapeHtml(state.moduleSearch)}">
        </div>
        <button class="collapse-all-btn" id="btn-toggle-all-modules">
          ${state.collapsedModules.size === modules.length ? "Expand All Modules" : "Collapse All"}
        </button>
      </div>
  `;

  if (isSynthesized) {
    html += `
      <div style="background:rgba(59,130,246,0.08); border:1px solid rgba(59,130,246,0.2); border-radius:8px; padding:12px 16px; margin-bottom:16px; display:flex; align-items:center; gap:12px;">
        <span style="font-size:20px;">📂</span>
        <div>
          <div style="font-weight:600; font-size:13px; color:var(--text-main);">Course Materials Organized from Desktop Folders</div>
          <div style="font-size:12px; color:var(--text-muted);">This course materials structure is organized directly from your categorized academic files on disk.</div>
        </div>
      </div>
    `;
  }

  html += `
      <div class="modules-accordion-list">
  `;

  if (modules.length === 0) {
    html += `<div style="text-align:center; padding:40px; color:#6B7280;">No modules found in this blueprint.</div>`;
  } else {
    modules.forEach((mod, modIdx) => {
      const items = mod.items || [];
      const filteredItems = items.filter(itm => {
        if (!q) return true;
        return (itm.title || "").toLowerCase().includes(q) || (itm.local_file || "").toLowerCase().includes(q);
      });

      if (q && filteredItems.length === 0) return;

      const isCollapsed = state.collapsedModules.has(modIdx);
      html += `
        <div class="module-block">
          <div class="module-header" data-mod-idx="${modIdx}">
            <div class="module-header-title">
              <span class="chevron-icon">${isCollapsed ? Icons.chevronRight : Icons.chevronDown}</span>
              <span>${escapeHtml(mod.title || "Module " + (modIdx + 1))}</span>
            </div>
            <div class="module-header-meta">
              <span>${filteredItems.length} items</span>
            </div>
          </div>
          <div class="module-items-list" style="display: ${isCollapsed ? "none" : "flex"};">
      `;

      if (filteredItems.length === 0) {
        html += `<div style="padding:16px 24px; color:#9CA3AF; font-size:13px;">Empty module</div>`;
      } else {
        filteredItems.forEach((itm) => {
          const isSubheader = itm.type === "sub_header" || itm.type === "subheader";
          const indentClass = `indent-${Math.min(itm.indent || 0, 4)}`;
          const hasLocalFile = !!itm.local_file;

          if (isSubheader) {
            html += `
              <div class="module-item-row is-subheader ${indentClass}">
                <span>${escapeHtml(itm.title)}</span>
              </div>
            `;
          } else {
            const ext = (itm.local_file || itm.title || "").split(".").pop().toLowerCase();
            const isFileFormat = ["pdf", "pptx", "ppt", "key", "docx", "doc", "pages", "txt", "md", "png", "jpg", "jpeg", "gif", "webp"].includes(ext);
            let icon = getFileIcon(itm.local_file || itm.title);

            // Only override with Canvas activity icons if it is NOT a physical document/file
            if (!hasLocalFile && !isFileFormat) {
              const itmType = (itm.type || "").toLowerCase();
              const itmTitle = (itm.title || "").toLowerCase();
              if (itmType === "quiz" || itmTitle.includes("quiz")) {
                icon = Icons.quizzes;
              } else if (itmType === "discussion" || itmTitle.includes("discussion")) {
                icon = Icons.discussions;
              } else if (itmType === "assignment" || itmTitle.includes("assignment")) {
                icon = Icons.assignments;
              } else if (itmType === "external_url" || itm.is_external || itm.url) {
                icon = Icons.externalLink;
              }
            }

            html += `
              <div class="module-item-row ${indentClass}">
                <span class="item-icon">${icon}</span>
                <span class="item-title" ${hasLocalFile ? `data-filepath="${escapeHtml(itm.local_file)}" data-title="${escapeHtml(itm.title)}"` : (itm.url ? `data-url="${escapeHtml(itm.url)}" style="cursor:pointer;"` : '')}>
                  ${escapeHtml(itm.title)}
                </span>
                ${hasLocalFile ? `<span class="item-badge badge-local-file">Local File</span>` : (itm.url ? `<span class="item-badge" style="background:rgba(59,130,246,0.1); color:var(--canvas-blue);">Web Link</span>` : "")}
                <div class="item-actions">
                  ${hasLocalFile ? `
                    <button class="quick-btn btn-quick-preview" data-filepath="${escapeHtml(itm.local_file)}" data-title="${escapeHtml(itm.title)}" title="In-Browser Preview">
                      ${Icons.preview}
                    </button>
                    <button class="quick-btn btn-quick-mac" data-filepath="${escapeHtml(itm.local_file)}" title="Open in Default App">
                      ${Icons.macApp}
                    </button>
                  ` : (itm.url ? `
                    <a href="${escapeHtml(safeExternalUrl(itm.url))}" target="_blank" rel="noopener noreferrer" class="quick-btn" title="Open Link" style="display:inline-flex; align-items:center; color:var(--canvas-blue); text-decoration:none;">
                      ${Icons.externalLink}
                    </a>
                  ` : "")}
                  <span title="Completed" style="display:flex; align-items:center;">${Icons.checkCircle}</span>
                </div>
              </div>
            `;
          }
        });
      }

      html += `
          </div>
        </div>
      `;
    });
  }

  html += `
      </div>
    </div>
  `;

  els.viewCanvas.innerHTML = html;

  // Search input handler
  const searchInput = document.getElementById("module-search-input");
  if (searchInput) {
    searchInput.addEventListener("input", (e) => {
      state.moduleSearch = e.target.value;
      clearTimeout(moduleSearchTimer);
      const course = state.currentCourse;
      moduleSearchTimer = setTimeout(() => {
        if (!searchInput.isConnected || state.currentCourse !== course || state.activeCanvasTab !== "modules") return;
        const start = searchInput.selectionStart;
        const end = searchInput.selectionEnd;
        renderModulesTab();
        const updatedInput = document.getElementById("module-search-input");
        if (updatedInput) {
          updatedInput.focus();
          updatedInput.setSelectionRange(start, end);
        }
      }, 180);
    });
  }

  document.querySelectorAll(".module-header").forEach(h => {
    h.addEventListener("click", () => {
      const idx = parseInt(h.getAttribute("data-mod-idx"), 10);
      if (state.collapsedModules.has(idx)) {
        state.collapsedModules.delete(idx);
      } else {
        state.collapsedModules.add(idx);
      }
      renderModulesTab();
    });
  });

  const toggleAllBtn = document.getElementById("btn-toggle-all-modules");
  if (toggleAllBtn) {
    toggleAllBtn.addEventListener("click", () => {
      if (state.collapsedModules.size === modules.length) {
        state.collapsedModules.clear();
      } else {
        modules.forEach((_, idx) => state.collapsedModules.add(idx));
      }
      renderModulesTab();
    });
  }

  // Click on title uses default action preference (Web Viewer or Mac App)
  document.querySelectorAll(".item-title[data-filepath]").forEach(btn => {
    btn.addEventListener("click", () => {
      const path = btn.getAttribute("data-filepath");
      const title = btn.getAttribute("data-title");
      if (path) {
        const modCard = btn.closest(".module-card");
        let fileList = null;
        let fIdx = -1;
        if (modCard) {
          const modHeader = modCard.querySelector(".module-header-title")?.textContent?.trim() || "";
          fileList = Array.from(modCard.querySelectorAll(".btn-quick-preview[data-filepath]")).map(b => ({
            name: b.getAttribute("data-title") || b.getAttribute("data-filepath").split("/").pop(),
            path: b.getAttribute("data-filepath"),
            context: modHeader
          }));
          fIdx = fileList.findIndex(f => f.path === path);
        }
        handleFileClick(title, path, fileList, fIdx);
      }
    });
  });

  // Click on web link title
  document.querySelectorAll(".item-title[data-url]").forEach(btn => {
    btn.addEventListener("click", () => {
      const url = btn.getAttribute("data-url");
      if (safeExternalUrl(url) !== "#") window.open(safeExternalUrl(url), "_blank", "noopener,noreferrer");
    });
  });

  // Explicit in-browser preview button
  document.querySelectorAll(".btn-quick-preview").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const path = btn.getAttribute("data-filepath");
      const title = btn.getAttribute("data-title");
      if (path) {
        const modCard = btn.closest(".module-card");
        let fileList = null;
        let fIdx = -1;
        if (modCard) {
          const modHeader = modCard.querySelector(".module-header-title")?.textContent?.trim() || "";
          fileList = Array.from(modCard.querySelectorAll(".btn-quick-preview[data-filepath]")).map(b => ({
            name: b.getAttribute("data-title") || b.getAttribute("data-filepath").split("/").pop(),
            path: b.getAttribute("data-filepath"),
            context: modHeader
          }));
          fIdx = fileList.findIndex(f => f.path === path);
        }
        openPreviewModal(title, path, fileList, fIdx);
      }
    });
  });

  // your default application button
  document.querySelectorAll(".btn-quick-mac").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const path = btn.getAttribute("data-filepath");
      if (path) systemAction(path, "open");
    });
  });
}

// Helper to format rich text: converts markdown links, detects downloaded local files,
// and formats them as standard, clean hyperlinks without badge or button clutter

function renderFoldersView() {
  const folders = state.folderData?.categories || [];
  const totalFiles = state.folderData?.total_files || 0;
  const coursePath = state.courseData?._course_meta?.path || "";
  const q = state.folderSearch.toLowerCase().trim();

  let html = `
    <div class="folder-view-container">
      <div class="folder-stats-banner">
        <div>
          <h2 style="font-size:20px; font-weight:700; margin-bottom:4px;">Desktop Organized Folders</h2>
          <p style="font-size:13px; opacity:0.9; font-family:monospace;">${escapeHtml(coursePath)}</p>
        </div>
        <div style="text-align:right;">
          <div style="font-size:24px; font-weight:800;">${totalFiles}</div>
          <div style="font-size:12px; opacity:0.8;">Total Files On Disk</div>
        </div>
      </div>

      <div style="margin-bottom:20px;">
        <div class="search-box" style="max-width:100%;">
          <span class="search-icon-inside">${Icons.search}</span>
          <input type="text" id="folder-search-input" placeholder="Search physical files across all folders..." value="${escapeHtml(state.folderSearch)}">
        </div>
      </div>
  `;

  if (folders.length === 0) {
    html += `<div style="text-align:center; padding:40px; color:#6B7280;">No organized folders found.</div>`;
  } else {
    folders.forEach((cat) => {
      const filteredFiles = cat.files.filter(f => {
        if (!q) return true;
        return f.name.toLowerCase().includes(q) || f.folder.toLowerCase().includes(q);
      });

      if (q && filteredFiles.length === 0) return;

      html += `
        <div class="folder-category-block">
          <div class="folder-category-header">
            <div class="folder-category-title">
              <span>${Icons.folderOpen}</span>
              <span>${escapeHtml(cat.folder_name)}</span>
              <span style="font-size:12px; font-weight:400; color:#6B7280;">(${escapeHtml(cat.folder_path)})</span>
            </div>
            <span class="item-badge">${filteredFiles.length} files</span>
          </div>
          <div class="folder-file-grid">
      `;

      filteredFiles.forEach((file) => {
        const icon = getFileIcon(file.name);
        html += `
          <div class="file-tile">
            <div class="file-tile-top">
              <span style="flex-shrink:0;">${icon}</span>
              <div class="file-tile-name" data-filepath="${escapeHtml(file.relative_path)}" data-title="${escapeHtml(file.name)}">
                ${escapeHtml(file.name)}
              </div>
            </div>
            <div class="file-tile-bottom">
              <span class="file-tile-size-badge">${file.size_str}</span>
              <div class="file-tile-actions">
                <button class="btn-mini btn-tile-preview" data-filepath="${escapeHtml(file.relative_path)}" data-title="${escapeHtml(file.name)}" title="Preview in offline viewer">
                  ${Icons.preview} <span>Preview</span>
                </button>
                <button class="btn-mini btn-tile-mac" data-filepath="${escapeHtml(file.relative_path)}" title="Open in Default App">
                  ${Icons.macApp} <span>Open</span>
                </button>
                <button class="btn-mini btn-tile-reveal" data-filepath="${escapeHtml(file.relative_path)}" title="Show in Folder">
                  ${Icons.macFinder} <span>Folder</span>
                </button>
              </div>
            </div>
          </div>
        `;
      });

      html += `
          </div>
        </div>
      `;
    });
  }

  html += `</div>`;
  els.viewFolders.innerHTML = html;

  const searchInput = document.getElementById("folder-search-input");
  if (searchInput) {
    searchInput.addEventListener("input", (e) => {
      state.folderSearch = e.target.value;
      renderFoldersView();
      const updatedInput = document.getElementById("folder-search-input");
      if (updatedInput) {
        updatedInput.focus();
        updatedInput.setSelectionRange(updatedInput.value.length, updatedInput.value.length);
      }
    });
  }

  // Clicking file name uses default preference
  document.querySelectorAll(".file-tile-name").forEach(btn => {
    btn.addEventListener("click", () => {
      const path = btn.getAttribute("data-filepath");
      const title = btn.getAttribute("data-title");
      if (path) {
        const folderCard = btn.closest(".folder-card");
        let fileList = null;
        let fIdx = -1;
        if (folderCard) {
          const folderTitle = folderCard.querySelector(".folder-header h3")?.textContent?.trim() || "";
          fileList = Array.from(folderCard.querySelectorAll(".btn-tile-preview[data-filepath]")).map(b => ({
            name: b.getAttribute("data-title") || b.getAttribute("data-filepath").split("/").pop(),
            path: b.getAttribute("data-filepath"),
            context: folderTitle
          }));
          fIdx = fileList.findIndex(f => f.path === path);
        }
        handleFileClick(title, path, fileList, fIdx);
      }
    });
  });

  // Explicit in-browser preview button
  document.querySelectorAll(".btn-tile-preview").forEach((btn, idx) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const path = btn.getAttribute("data-filepath");
      const title = btn.getAttribute("data-title");
      if (path) {
        const folderCard = btn.closest(".folder-card");
        let fileList = null;
        let fIdx = -1;
        if (folderCard) {
          const folderTitle = folderCard.querySelector(".folder-header h3")?.textContent?.trim() || "";
          fileList = Array.from(folderCard.querySelectorAll(".btn-tile-preview[data-filepath]")).map(b => ({
            name: b.getAttribute("data-title") || b.getAttribute("data-filepath").split("/").pop(),
            path: b.getAttribute("data-filepath"),
            context: folderTitle
          }));
          fIdx = fileList.findIndex(f => f.path === path);
        }
        openPreviewModal(title, path, fileList, fIdx >= 0 ? fIdx : idx);
      }
    });
  });

  document.querySelectorAll(".btn-tile-mac").forEach(btn => {
    btn.addEventListener("click", () => {
      const path = btn.getAttribute("data-filepath");
      if (path) systemAction(path, "open");
    });
  });

  document.querySelectorAll(".btn-tile-reveal").forEach(btn => {
    btn.addEventListener("click", () => {
      const path = btn.getAttribute("data-filepath");
      if (path) systemAction(path, "reveal");
    });
  });
}

// 5. In-App File Preview Modal (Supports PDF, PPTX, Images, Assignment Prompts, Markdown, etc.)

function getAuthorInitials(name) {
  if (!name) return "CI";
  const clean = name.replace(/^(?:Dr\.|Prof\.|Professor)\s+/i, "").trim();
  const parts = clean.split(/\s+/).filter(p => p && !/^(and|&)$/i.test(p));
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  if (parts.length === 1 && parts[0].length >= 2) {
    return parts[0].slice(0, 2).toUpperCase();
  }
  return "CI";
}

// Render Announcements Tab
function renderAnnouncementsTab() {
  const anns = state.courseData.announcements || [];
  const fileMap = state.courseData.file_path_map || {};

  let html = `
    <div style="max-width: 920px; margin: 0 auto;">
      <h2 style="font-size:20px; font-weight:700; margin-bottom:20px;">Announcements (${anns.length})</h2>
  `;

  if (anns.length === 0) {
    html += `<div style="text-align:center; padding:40px; color:#6B7280;">No announcements archived.</div>`;
  } else {
    anns.forEach((a, idx) => {
      const isExpanded = state.expandedAnnouncements.has(idx);
      const dateStr = formatDate(a.posted_at || a.date);
      const formattedBody = a.body_html || escapeHtml(a.body || "No content.");
      const attachments = a.attachments || [];
      const author = a.author || "Course Instructor";
      const initials = getAuthorInitials(author);

      html += `
        <div class="announcement-card">
          <div class="announcement-card-header">
            <div class="announcement-author-row">
              <div class="announcement-avatar" title="${escapeHtml(author)}">
                ${escapeHtml(initials)}
              </div>
              <div class="announcement-author-info">
                <span class="announcement-author-name">${escapeHtml(author)}</span>
                <span class="announcement-author-role">Instructor</span>
              </div>
            </div>
            <div class="announcement-date-pill">
              ${Icons.calendar || ""}
              <span>${escapeHtml(dateStr)}</span>
            </div>
          </div>

          <h3 class="announcement-card-title">${escapeHtml(a.title || "Untitled Announcement")}</h3>

          <div class="announcement-body">${formattedBody}</div>

          ${attachments.length > 0 ? `
            <div class="announcement-card-footer">
              <div class="announcement-att-heading">
                ${Icons.paperclip || ""}
                <span>Attachments (${attachments.length})</span>
              </div>
              <div class="announcement-att-chips">
                ${attachments.map(att => {
                  if (att.local_file) {
                    return `
                      <a href="#" class="announcement-chip-attachment announcement-inline-link btn-chip-preview" data-filepath="${escapeHtml(att.local_file)}" data-title="${escapeHtml(att.title)}" title="Open ${escapeHtml(att.title)}">
                        <span class="att-chip-icon">${getFileIcon(att.local_file || att.title)}</span>
                        <span class="att-chip-title">${escapeHtml(att.title)}</span>
                      </a>
                    `;
                  } else {
                    return `
                      <span class="announcement-chip-attachment is-archived" title="File was not archived or is no longer hosted on Canvas">
                        <span class="att-chip-icon">${getFileIcon(att.title)}</span>
                        <span class="att-chip-title">${escapeHtml(att.title)}</span>
                        <span class="att-chip-badge">(archived)</span>
                      </span>
                    `;
                  }
                }).join("")}
              </div>
            </div>
          ` : ""}
        </div>
      `;
    });
  }

  html += `</div>`;
  els.viewCanvas.innerHTML = html;

  // Toggle Read More / Show Less
  document.querySelectorAll(".btn-toggle-ann").forEach(btn => {
    btn.addEventListener("click", () => {
      const idx = parseInt(btn.getAttribute("data-ann-idx"), 10);
      if (state.expandedAnnouncements.has(idx)) {
        state.expandedAnnouncements.delete(idx);
      } else {
        state.expandedAnnouncements.add(idx);
      }
      renderAnnouncementsTab();
    });
  });

  // Wire up inline local file hyperlinks and attachment chips
  document.querySelectorAll(".announcement-inline-link, .inline-file-btn, .btn-chip-preview").forEach(link => {
    link.addEventListener("click", (e) => {
      const rawPath = link.getAttribute("data-filepath");
      if (rawPath) {
        e.preventDefault();
        e.stopPropagation();
        const rawTitle = link.getAttribute("data-title");

        const card = link.closest(".announcement-card");
        let cardFiles = null;
        let cardIdx = -1;
        const normClickPath = normalizeDocPath(rawPath);
        const fileMap = state.courseData?.file_path_map || {};
        const resolvedClickPath = fileMap[normClickPath] || fileMap[normClickPath.split("/").pop()] || normClickPath;
        const clickDocTitle = (rawTitle || resolvedClickPath.split("/").pop() || "Document").trim();
        const clickBaseName = clickDocTitle.toLowerCase();

        if (card) {
          const cardTitle = card.querySelector(".announcement-card-title")?.textContent?.trim() || "Announcement";
          const linksInCard = Array.from(card.querySelectorAll("[data-filepath]"));
          const seenKeys = new Set();
          const seenNames = new Set();
          cardFiles = [];

          linksInCard.forEach(el => {
            const elRawP = el.getAttribute("data-filepath");
            if (!elRawP) return;
            const elNormP = normalizeDocPath(elRawP);
            const elResolvedP = fileMap[elNormP] || fileMap[elNormP.split("/").pop()] || elNormP;
            const elTitle = (el.getAttribute("data-title") || elResolvedP.split("/").pop() || "Document").trim();
            const elBaseName = elTitle.toLowerCase();
            const pathKey = elResolvedP.toLowerCase();

            // Deduplicate by resolved canonical path AND filename
            if (!seenKeys.has(pathKey) && !seenNames.has(elBaseName)) {
              seenKeys.add(pathKey);
              seenNames.add(elBaseName);
              cardFiles.push({
                name: elTitle,
                path: elResolvedP,
                context: cardTitle
              });
            }
          });

          // Match active item
          cardIdx = cardFiles.findIndex(f => {
            const fNorm = normalizeDocPath(f.path).toLowerCase();
            const fName = (f.name || "").toLowerCase();
            return fNorm === resolvedClickPath.toLowerCase() || fName === clickBaseName;
          });
          if (cardIdx === -1 && cardFiles.length > 0) {
            cardIdx = 0;
          }
        }

        handleFileClick(clickDocTitle, resolvedClickPath, cardFiles, cardIdx);
      }
    });
  });

  // Wire up macOS system action
  document.querySelectorAll(".btn-chip-mac").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const path = btn.getAttribute("data-filepath");
      if (path) systemAction(path, "open");
    });
  });
}

// Render Assignments Tab

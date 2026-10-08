function renderAssignmentsTab() {
  const assigns = state.courseData.assignments || [];
  const fileMap = state.courseData.file_path_map || {};

  let html = `
    <div style="max-width: 960px; margin: 0 auto;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px;">
        <h2 style="font-size:20px; font-weight:700;">Assignments (${assigns.length})</h2>
      </div>
      <table class="assignment-table">
        <thead>
          <tr>
            <th>Assignment</th>
            <th>Due Date</th>
            <th>Score / Points</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
  `;

  if (assigns.length === 0) {
    html += `<tr><td colspan="4" style="text-align:center; padding:30px; color:#6B7280;">No assignments available.</td></tr>`;
  } else {
    assigns.forEach((a, idx) => {
      const isSubmitted = (a.submission_status || "").toLowerCase() === "submitted";
      const isGs = !!a.is_gradescope;
      html += `
        <tr>
          <td>
            <div style="display:flex; align-items:center; gap:8px;">
              <div style="font-weight:600; color:var(--canvas-blue); cursor:pointer;" class="assignment-row-title" data-assign-idx="${idx}">
                ${escapeHtml(a.title)}
              </div>
              ${isGs ? `<span class="badge-gradescope" title="Graded via Gradescope">Gradescope</span>` : ""}
            </div>
          </td>
          <td style="color:#4B5563;">${escapeHtml(formatDate(a.due_date || a.due))}</td>
          <td>${a.points !== null && a.points !== undefined ? escapeHtml(a.points) + " pts" : "--"}</td>
          <td>
            <span class="${isSubmitted ? "badge-submitted" : "badge-unsubmitted"}">
              ${isSubmitted ? "Submitted" : "Archived"}
            </span>
          </td>
        </tr>
      `;
    });
  }

  html += `
        </tbody>
      </table>
      <div id="assignment-details-drawer" class="assignment-details-drawer">
        <div id="drawer-gradescope-container"></div>
        <h3 id="assign-drawer-title" style="font-size:16px; font-weight:700; margin-bottom:8px;"></h3>
        <div id="assign-drawer-body" style="font-size:14px; line-height:1.6;"></div>
      </div>
    </div>
  `;

  els.viewCanvas.innerHTML = html;

  document.querySelectorAll(".assignment-row-title").forEach(row => {
    row.addEventListener("click", () => {
      const idx = parseInt(row.getAttribute("data-assign-idx"), 10);
      const a = assigns[idx];
      if (!a) return;

      const drawer = document.getElementById("assignment-details-drawer");
      const gsContainer = document.getElementById("drawer-gradescope-container");
      const titleElem = document.getElementById("assign-drawer-title");
      const bodyElem = document.getElementById("assign-drawer-body");

      titleElem.textContent = a.title;
      
      // Render Gradescope action card if this is a Gradescope assignment
      if (a.is_gradescope || (a.body && a.body.toLowerCase().includes("gradescope"))) {
        const gsUrl = a.gradescope_url || "https://www.gradescope.com/";
        const canvasUrl = a.url || "";
        const localFile = a.local_file;

        gsContainer.innerHTML = `
          <div class="gradescope-card">
            <div class="gradescope-card-header">
              <span class="gradescope-badge-icon">🎓</span>
              <div class="gradescope-card-info">
                <h4>Gradescope Online Assignment</h4>
                <p>This assignment is hosted, submitted, and evaluated via Gradescope.</p>
              </div>
            </div>
            <div class="gradescope-card-actions">
              <a href="${escapeHtml(safeExternalUrl(gsUrl))}" target="_blank" rel="noopener noreferrer" class="btn-gradescope-launch" title="Open Gradescope portal in browser">
                🔗 Open Gradescope Portal ↗
              </a>
              ${localFile ? `
                <button class="btn-gradescope-file btn-drawer-file" data-filepath="${escapeHtml(localFile)}" data-title="${escapeHtml(a.title)}">
                  📄 View Local Assignment File
                </button>
              ` : ""}
            </div>
          </div>
        `;
      } else {
        gsContainer.innerHTML = "";
      }

      // Format body text with rich links & local file buttons
      bodyElem.innerHTML = a.body_html || escapeHtml(a.body || "(No prompt text provided)");
      drawer.style.display = "block";
      drawer.scrollIntoView({ behavior: "smooth" });

      // Wire up links and buttons in drawer
      drawer.querySelectorAll(".announcement-inline-link, .inline-file-btn, .btn-drawer-file").forEach(link => {
        link.addEventListener("click", (e) => {
          const rawPath = link.getAttribute("data-filepath");
          if (rawPath) {
            e.preventDefault();
            e.stopPropagation();
            const rawTitle = link.getAttribute("data-title");
            const normClickPath = normalizeDocPath(rawPath);
            const fileMap = state.courseData?.file_path_map || {};
            const resolvedClickPath = fileMap[normClickPath] || fileMap[normClickPath.split("/").pop()] || normClickPath;
            const clickDocTitle = (rawTitle || resolvedClickPath.split("/").pop() || "Assignment File").trim();
            const clickBaseName = clickDocTitle.toLowerCase();
            const drawerTitle = a.name || a.title || "Assignment";

            const linksInDrawer = Array.from(drawer.querySelectorAll("[data-filepath]"));
            const seenKeys = new Set();
            const seenNames = new Set();
            const drawerFiles = [];

            linksInDrawer.forEach(el => {
              const elRawP = el.getAttribute("data-filepath");
              if (!elRawP) return;
              const elNormP = normalizeDocPath(elRawP);
              const elResolvedP = fileMap[elNormP] || fileMap[elNormP.split("/").pop()] || elNormP;
              const elTitle = (el.getAttribute("data-title") || elResolvedP.split("/").pop() || "File").trim();
              const elBaseName = elTitle.toLowerCase();
              const pathKey = elResolvedP.toLowerCase();

              if (!seenKeys.has(pathKey) && !seenNames.has(elBaseName)) {
                seenKeys.add(pathKey);
                seenNames.add(elBaseName);
                drawerFiles.push({
                  name: elTitle,
                  path: elResolvedP,
                  context: drawerTitle
                });
              }
            });

            let drawerIdx = drawerFiles.findIndex(f => {
              const fNorm = normalizeDocPath(f.path).toLowerCase();
              const fName = (f.name || "").toLowerCase();
              return fNorm === resolvedClickPath.toLowerCase() || fName === clickBaseName;
            });
            if (drawerIdx === -1 && drawerFiles.length > 0) drawerIdx = 0;

            handleFileClick(clickDocTitle, resolvedClickPath, drawerFiles, drawerIdx);
          }
        });
      });
    });
  });
}

// Helper to locate the best official syllabus PDF for the current course

function findSyllabusPdf(courseData) {
  if (!courseData) return null;

  const syl = courseData.syllabus || {};
  const map = courseData.file_path_map || {};

  // 1. Explicit syllabus.pdf_path
  if (syl.pdf_path) {
    return { name: syl.pdf_file || "Course Syllabus.pdf", path: syl.pdf_path };
  }

  // 2. Explicit syllabus.pdf_file mapped to relative path
  if (syl.pdf_file) {
    const p = map[syl.pdf_file] || syl.pdf_file;
    return { name: syl.pdf_file, path: p };
  }

  // 3. Explicit syllabus.local_file
  if (syl.local_file && syl.local_file.toLowerCase().endsWith(".pdf")) {
    const p = map[syl.local_file] || syl.local_file;
    return { name: syl.title || syl.local_file, path: p };
  }

  // 4. Search in file_path_map
  const candidates = [];
  const courseName = (courseData.course_name || "").toLowerCase();
  const tokens = courseName.split(/[\s_-]+/).filter(t => t.length >= 2);

  for (const [fileName, filePath] of Object.entries(map)) {
    if (!filePath || !fileName.toLowerCase().endsWith(".pdf")) continue;
    const lowerName = fileName.toLowerCase();
    const lowerPath = filePath.toLowerCase();

    if (lowerName.includes("syllabus") || lowerPath.includes("syllabus")) {
      let score = 10;
      if (lowerName.includes("syllabus")) score += 20;
      for (const tok of tokens) {
        if (lowerName.includes(tok)) score += 15;
      }
      if (lowerName.includes("snapshot") || lowerName.includes("visual")) score -= 60;
      if (lowerName.includes("congrats")) score -= 25;
      if (lowerName.includes("polic")) score -= 5;
      if (lowerName.includes("schedule") && !lowerName.includes("syllabus")) score -= 10;

      candidates.push({ name: fileName, path: filePath, score });
    }
  }

  if (candidates.length > 0) {
    candidates.sort((a, b) => b.score - a.score);
    if (candidates[0].score > 0) {
      return candidates[0];
    }
  }

  return null;
}

// Helper to locate Canvas visual snapshot PDF if available
function findSyllabusSnapshot(courseData) {
  if (!courseData) return null;
  const syl = courseData.syllabus || {};
  const map = courseData.file_path_map || {};

  if (syl.snapshot_path) {
    return { name: syl.snapshot_pdf || "Syllabus_Visual_Snapshot.pdf", path: syl.snapshot_path };
  }
  if (syl.snapshot_pdf && map[syl.snapshot_pdf]) {
    return { name: syl.snapshot_pdf, path: map[syl.snapshot_pdf] };
  }
  for (const [fName, fPath] of Object.entries(map)) {
    const low = fName.toLowerCase();
    if ((low.includes("snapshot") || low.includes("visual")) && low.endsWith(".pdf")) {
      return { name: fName, path: fPath };
    }
  }
  return null;
}

// Renders the modern, clean Course Logistics & Schedule view
function renderFormattedSyllabusHtml(courseData, syl, fileMap) {
  const structured = syl.structured || {};
  const lecture = structured.lecture || {};
  const instructors = structured.instructors || [];
  const tas = structured.teaching_assistants || [];
  const schedule = structured.schedule || [];

  const rawBody = (syl.body || "").trim();

  // If structured data is available, build the full component layout
  if (instructors.length > 0 || schedule.length > 0) {
    return `
      <div class="syllabus-page-wrapper">
        <!-- Course Hero Card -->
        <div class="syllabus-hero-card">
          <div class="syllabus-hero-info">
            <h1>${escapeHtml(lecture.title || courseData.course_name || "Course Syllabus")}</h1>
            <p>
              <span style="display:inline-flex; align-items:center; gap:6px;">
                📅 ${escapeHtml(lecture.schedule || "See course schedule")}
              </span>
            </p>
          </div>
        </div>

        <!-- Instructors Section -->
        ${instructors.length > 0 ? `
          <div class="syllabus-section-card">
            <div class="syllabus-section-header">
              <h3>👨‍🏫 Course Instructors</h3>
            </div>
            <div class="syllabus-instructors-grid">
              ${instructors.map(inst => {
                const parts = inst.name.replace(/^(Dr\.|Prof\.)\s*/, "").split(" ");
                const initials = parts.map(p => p[0]).join("").slice(0, 2).toUpperCase() || "IN";
                return `
                  <div class="syllabus-faculty-card">
                    <div class="syllabus-faculty-top">
                      <div class="syllabus-avatar">${escapeHtml(initials)}</div>
                      <div class="syllabus-faculty-details">
                        <h4>${escapeHtml(inst.name)}</h4>
                        <span>${escapeHtml(inst.role || "Instructor")}</span>
                      </div>
                    </div>
                    <div class="syllabus-info-row">
                      <strong>Email:</strong>
                      <a href="mailto:${escapeHtml(inst.email)}" style="color:var(--canvas-blue); text-decoration:none; font-weight:600;">
                        ${escapeHtml(inst.email)}
                      </a>
                    </div>
                    <div class="syllabus-info-row">
                      <strong>Office Hours:</strong>
                      <div>
                        ${escapeHtml(inst.office_hours || "See announcements")}
                        ${inst.note ? `<div style="font-size:11px; color:#D97706; margin-top:3px; font-style:italic;">${escapeHtml(inst.note)}</div>` : ""}
                      </div>
                    </div>
                  </div>
                `;
              }).join("")}
            </div>
          </div>
        ` : ""}

        <!-- Teaching Assistants Directory -->
        ${tas.length > 0 ? `
          <div class="syllabus-section-card">
            <div class="syllabus-section-header">
              <h3>👥 Teaching Assistants & Discussion Sections</h3>
            </div>
            <div class="syllabus-table-wrapper">
              <table class="syllabus-modern-table">
                <thead>
                  <tr>
                    <th style="width:100px;">Sections</th>
                    <th>TA Name</th>
                    <th>Email</th>
                    <th>Office Hours</th>
                  </tr>
                </thead>
                <tbody>
                  ${tas.map(ta => `
                    <tr>
                      <td><strong>${escapeHtml(ta.sections)}</strong></td>
                      <td style="font-weight:600;">${escapeHtml(ta.name)}</td>
                      <td>
                        <a href="mailto:${escapeHtml(ta.email)}" style="color:var(--canvas-blue); text-decoration:none; font-weight:500;">
                          ${escapeHtml(ta.email)}
                        </a>
                      </td>
                      <td>
                        <span style="font-weight:500;">${escapeHtml(ta.office_hours)}</span>
                      </td>
                    </tr>
                  `).join("")}
                </tbody>
              </table>
            </div>
          </div>
        ` : ""}

        <!-- Course Summary & Schedule -->
        ${schedule.length > 0 ? `
          <div class="syllabus-section-card">
            <div class="syllabus-section-header" style="justify-content:space-between; flex-wrap:wrap; gap:10px;">
              <div style="display:flex; align-items:center; gap:8px;">
                <h3>📅 Course Summary & Schedule</h3>
                <span style="font-size:12px; color:var(--text-muted);">(${schedule.length} events & deadlines)</span>
              </div>
              <div style="display:flex; gap:8px; align-items:center;">
                <input type="text" id="syllabus-schedule-search" placeholder="Filter schedule..." style="padding:5px 12px; font-size:12px; border:1px solid var(--border-light); border-radius:6px; background:var(--bg-subtle); color:var(--text-main); width:190px;">
              </div>
            </div>
            <div class="syllabus-table-wrapper" style="max-height:560px; overflow-y:auto;">
              <table class="syllabus-modern-table" id="syllabus-schedule-table">
                <thead>
                  <tr>
                    <th style="width:140px;">Date</th>
                    <th style="width:130px;">Type</th>
                    <th>Topic / Title</th>
                    <th style="width:140px;">Due / Time</th>
                  </tr>
                </thead>
                <tbody>
                  ${schedule.map(item => {
                    const isAssign = item.type === "Assignment";
                    const badgeClass = isAssign ? "badge-syl-assign" : "badge-syl-event";
                    const badgeLabel = isAssign ? "Assignment" : "Calendar Event";
                    const linkHtml = item.file_path ? `
                      <a href="#" class="syl-linked-file" data-name="${escapeHtml(item.file_name || item.title)}" data-path="${escapeHtml(item.file_path)}" style="color:var(--canvas-blue); text-decoration:none; font-weight:600;">
                        📄 ${escapeHtml(item.title)}
                      </a>
                    ` : `<span>${escapeHtml(item.title)}</span>`;
                    return `
                      <tr class="syl-schedule-row" data-search="${escapeHtml((item.date + ' ' + item.title + ' ' + item.type).toLowerCase())}">
                        <td style="font-weight:600; white-space:nowrap;">${escapeHtml(item.date)}</td>
                        <td><span class="${badgeClass}">${badgeLabel}</span></td>
                        <td>${linkHtml}</td>
                        <td style="white-space:nowrap; color:var(--text-muted);">${escapeHtml(item.time || "-")}</td>
                      </tr>
                    `;
                  }).join("")}
                </tbody>
              </table>
            </div>
          </div>
        ` : ""}
      </div>
    `;
  }

  // Use server-side pre-formatted HTML if available
  if (syl.body_html) {
    return `
      <div class="syllabus-page-wrapper">
        <div class="syllabus-section-card">
          <div class="syllabus-section-header">
            <h3>📖 Course Syllabus</h3>
          </div>
          <div style="line-height:1.7; font-size:14px; color:var(--text-main);">
            ${syl.body_html}
          </div>
        </div>
      </div>
    `;
  }


  return `
    <div class="syllabus-page-wrapper">
      <div class="syllabus-section-card">
        <div class="syllabus-section-header">
          <h3>📖 Course Syllabus</h3>
        </div>
        <div style="line-height:1.7; font-size:14px; color:var(--text-main);">
          ${escapeHtml(rawBody || "No syllabus text archived for this course.")}
        </div>
      </div>
    </div>
  `;
}

// Render Syllabus Tab: PDF first, with formatted logistics and snapshot switcher
function renderSyllabusTab() {
  const syl = state.courseData.syllabus || {};
  const fileMap = state.courseData.file_path_map || {};
  const syllabusPdf = findSyllabusPdf(state.courseData);
  const snapshotPdf = findSyllabusSnapshot(state.courseData);

  const rawBody = (syl.body || "").trim();
  const hasPageText = (rawBody.length > 0 && rawBody !== "No syllabus body archived.") || (syl.structured && Object.keys(syl.structured).length > 0);

  // Determine initial view: PDF if available, else Logistics Page
  const initialMode = syllabusPdf ? "pdf" : "logistics";

  // Build switcher tabs
  const switcherBtns = [];
  if (syllabusPdf) {
    switcherBtns.push(`
      <button class="syllabus-switch-btn ${initialMode === 'pdf' ? 'active' : ''}" id="btn-syl-view-pdf">
        📄 Official Syllabus PDF
      </button>
    `);
  }
  if (hasPageText) {
    switcherBtns.push(`
      <button class="syllabus-switch-btn ${initialMode === 'logistics' ? 'active' : ''}" id="btn-syl-view-logistics">
        📋 Course Logistics & Schedule
      </button>
    `);
  }
  if (snapshotPdf) {
    switcherBtns.push(`
      <button class="syllabus-switch-btn" id="btn-syl-view-snapshot">
        📸 Canvas Visual Page
      </button>
    `);
  }

  const switcherHtml = switcherBtns.length > 1 ? `
    <div class="syllabus-tab-switcher">
      ${switcherBtns.join("")}
    </div>
  ` : "";

  // PDF URLs with timestamp cache-busting
  const officialPdfUrl = syllabusPdf ? `/static/pdfjs/web/viewer.html?file=${encodeURIComponent('/api/courses/' + encodeURIComponent(state.currentCourse) + '/files/' + encodeURIComponent(syllabusPdf.path) + '?t=' + Date.now())}` : "";
  const snapshotPdfUrl = snapshotPdf ? `/static/pdfjs/web/viewer.html?file=${encodeURIComponent('/api/courses/' + encodeURIComponent(state.currentCourse) + '/files/' + encodeURIComponent(snapshotPdf.path) + '?t=' + Date.now())}` : "";

  const titleBadge = syllabusPdf ? `<span class="syllabus-badge-pdf">Official PDF</span>` : `<span class="item-badge badge-canvas">Canvas Page</span>`;
  const titleSub = syllabusPdf ? escapeHtml(syllabusPdf.name) : (state.courseData.course_name || "Syllabus");

  let html = `
    <div class="syllabus-container">
      <div class="syllabus-header-bar">
        <div class="syllabus-title-area">
          <h2 style="font-size:20px; font-weight:700; margin:0;">Course Syllabus</h2>
          ${titleBadge}
          <span style="font-size:13px; color:var(--text-muted); font-weight:500;">
            ${titleSub}
          </span>
        </div>

        ${switcherHtml}

        <div class="syllabus-actions-area">
          <button class="syllabus-action-btn" id="btn-syl-fullscreen" title="Open in Fullscreen Document Viewer">
            ${Icons.fullscreen} Fullscreen
          </button>
          <button class="syllabus-action-btn" id="btn-syl-mac" title="Open in Apple Preview">
            ${Icons.macApp} Default App
          </button>
        </div>
      </div>

      <!-- 1. Official PDF Pane -->
      ${syllabusPdf ? `
        <div class="syllabus-iframe-wrapper" id="syllabus-pdf-pane" style="display:${initialMode === 'pdf' ? 'block' : 'none'};">
          <iframe src="${officialPdfUrl}" title="Course Syllabus PDF"></iframe>
        </div>
      ` : ""}

      <!-- 2. Formatted Course Logistics & Schedule Pane -->
      <div class="syllabus-text-container" id="syllabus-logistics-pane" style="display:${initialMode === 'logistics' ? 'block' : 'none'}; padding: 16px 20px;">
        ${renderFormattedSyllabusHtml(state.courseData, syl, fileMap)}
      </div>

      <!-- 3. Canvas Visual Snapshot Pane (Optional) -->
      ${snapshotPdf ? `
        <div class="syllabus-iframe-wrapper" id="syllabus-snapshot-pane" style="display:none;">
          <iframe src="${snapshotPdfUrl}" title="Canvas Visual Page Snapshot"></iframe>
        </div>
      ` : ""}
    </div>
  `;

  els.viewCanvas.innerHTML = html;

  // Track currently active document for Fullscreen & Default App buttons
  let activeDoc = syllabusPdf || snapshotPdf;

  const btnFs = document.getElementById("btn-syl-fullscreen");
  if (btnFs) {
    btnFs.addEventListener("click", () => {
      if (activeDoc) {
        handleFileClick(activeDoc.name, activeDoc.path);
      }
    });
  }

  const btnMac = document.getElementById("btn-syl-mac");
  if (btnMac) {
    btnMac.addEventListener("click", () => {
      if (activeDoc) {
        systemAction(activeDoc.path, "open");
      }
    });
  }

  // Wire Tab Switchers
  const btnViewPdf = document.getElementById("btn-syl-view-pdf");
  const btnViewLogistics = document.getElementById("btn-syl-view-logistics");
  const btnViewSnapshot = document.getElementById("btn-syl-view-snapshot");

  const pdfPane = document.getElementById("syllabus-pdf-pane");
  const logisticsPane = document.getElementById("syllabus-logistics-pane");
  const snapshotPane = document.getElementById("syllabus-snapshot-pane");

  function setSyllabusView(view) {
    if (btnViewPdf) btnViewPdf.classList.toggle("active", view === "pdf");
    if (btnViewLogistics) btnViewLogistics.classList.toggle("active", view === "logistics");
    if (btnViewSnapshot) btnViewSnapshot.classList.toggle("active", view === "snapshot");

    if (pdfPane) pdfPane.style.display = (view === "pdf") ? "block" : "none";
    if (logisticsPane) logisticsPane.style.display = (view === "logistics") ? "block" : "none";
    if (snapshotPane) snapshotPane.style.display = (view === "snapshot") ? "block" : "none";

    if (view === "pdf" && syllabusPdf) {
      activeDoc = syllabusPdf;
      if (btnFs) btnFs.style.display = "inline-flex";
      if (btnMac) btnMac.style.display = "inline-flex";
    } else if (view === "snapshot" && snapshotPdf) {
      activeDoc = snapshotPdf;
      if (btnFs) btnFs.style.display = "inline-flex";
      if (btnMac) btnMac.style.display = "inline-flex";
    } else {
      if (syllabusPdf) {
        activeDoc = syllabusPdf;
      }
    }
  }

  if (btnViewPdf) {
    btnViewPdf.addEventListener("click", () => setSyllabusView("pdf"));
  }
  if (btnViewLogistics) {
    btnViewLogistics.addEventListener("click", () => setSyllabusView("logistics"));
  }
  if (btnViewSnapshot) {
    btnViewSnapshot.addEventListener("click", () => setSyllabusView("snapshot"));
  }

  // Wire Schedule Linked Files
  document.querySelectorAll(".syl-linked-file").forEach(link => {
    link.addEventListener("click", (e) => {
      e.preventDefault();
      const fName = link.getAttribute("data-name");
      const fPath = link.getAttribute("data-path");
      if (fName && fPath) {
        handleFileClick(fName, fPath);
      }
    });
  });

  // Wire Schedule Search Filter
  const searchInput = document.getElementById("syllabus-schedule-search");
  if (searchInput) {
    searchInput.addEventListener("input", (e) => {
      const q = e.target.value.toLowerCase().trim();
      document.querySelectorAll(".syl-schedule-row").forEach(row => {
        const s = row.getAttribute("data-search") || "";
        row.style.display = (!q || s.includes(q)) ? "" : "none";
      });
    });
  }
}

// Render Grades Tab

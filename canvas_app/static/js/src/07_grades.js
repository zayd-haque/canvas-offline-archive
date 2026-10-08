function renderGradesTab() {
  const grades = state.courseData.grades || {};
  const hasLocal = !!grades.local_file;
  const assignments = state.courseData.assignments || [];
  const courseFolder = state.courseData?._course_meta?.folder_name || state.currentCourse;
  const workDir = `${courseFolder} Work`;
  const relFile = hasLocal ? (grades.local_file.includes("/") ? grades.local_file : `${workDir}/${grades.local_file}`) : "";

  let html = `
    <div style="max-width: 900px; margin: 0 auto; padding-bottom: 40px;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
        <h2 style="font-size:22px; font-weight:700; margin:0;">Grades & Feedback</h2>
        <div style="font-size:13px; color:#4B5563;">
          Student: <strong style="color:var(--text-dark);">${escapeHtml(state.courseData.student_name || "Enrolled Student")}</strong> &bull; Course: <strong style="color:var(--text-dark);">${escapeHtml(state.courseData.course_name || state.currentCourse)}</strong>
        </div>
      </div>

      <div class="grades-card">
        <p style="margin:0 0 14px 0; color:var(--text-muted); font-size:14px; line-height:1.5;">
          A complete, high-fidelity visual archive of course grades, teacher rubrics, and detailed score breakdowns was captured for this course.
        </p>
  `;

  if (hasLocal) {
    html += `
      <div class="grade-report-banner">
        <span style="display:flex; align-items:center; color:#DC2626;">${Icons.pdf}</span>
        <div style="flex:1;">
          <div style="font-weight:600; font-size:14px; color:var(--canvas-blue);">${escapeHtml(grades.local_file)}</div>
          <div style="font-size:12px; color:var(--text-muted); display:flex; align-items:center; gap:6px; margin-top:2px;">
            <span>Official Gradebook & Comments Archive</span>
            <span>&bull;</span>
            <span style="color:#059669; font-weight:600;">✓ Unobstructed Snapshot</span>
          </div>
        </div>
        <div class="grade-report-actions" style="display:flex; gap:8px;">
          <button class="btn-mini" id="btn-preview-grade-pdf" style="padding:8px 14px; font-size:13px; font-weight:600; background:var(--canvas-blue); color:#FFF; border:none; border-radius:6px; cursor:pointer; display:inline-flex; align-items:center; gap:6px;">
            ${Icons.preview} Preview Official Gradebook
          </button>
          <button class="btn-mini" id="btn-open-grade-mac" style="padding:8px 14px; font-size:13px; font-weight:600; border-radius:6px;">
            ${Icons.macApp} Open in Default App
          </button>
        </div>
      </div>
    `;
  } else {
    html += `<p style="color:var(--text-muted); font-size:13px;">No grade PDF report linked.</p>`;
  }

  html += `
      </div>

      <!-- Interactive Canvas Gradebook Table -->
      <div class="grades-card">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px; flex-wrap:wrap; gap:10px;">
          <div>
            <h3 style="font-size:16px; font-weight:700; margin:0 0 2px 0;">Assignment Scores & Written Feedback</h3>
            <div style="font-size:12px; color:var(--text-muted);">Canvas LMS official grading breakdown</div>
          </div>
          <span class="grades-total-pill">
            ${assignments.length} Total Assignments
          </span>
        </div>

        <div style="overflow-x:auto;">
          <table class="assignment-table" style="margin-bottom:0;">
            <thead>
              <tr>
                <th style="width:48%;">Name</th>
                <th style="width:24%;">Due Date</th>
                <th style="width:14%;">Status</th>
                <th style="width:14%; text-align:right;">Score</th>
              </tr>
            </thead>
            <tbody>
  `;


  if (assignments.length > 0) {
    assignments.forEach(a => {
      // [Codex] Backend owns deadline status and archived text normalization.
      const isGs = !!a.is_gradescope;
      const dueText = a.due_display || a.due || a.due_date || "";

      // Determine score display
      let scoreText = "- / 0";
      if (a.score !== undefined && a.score !== null) {
        scoreText = `${a.score} / ${a.points !== undefined && a.points !== null ? a.points : 0}`;
      } else if (a.points !== undefined && a.points !== null) {
        scoreText = `- / ${a.points}`;
      }

      // Determine status badge (prefer server pre-calculated status)
      const assignmentStatus = a.status || "unsubmitted";
      let statusBadge = `<span class="badge-${escapeHtml(assignmentStatus)}">${escapeHtml(assignmentStatus)}</span>`;

      html += `
        <tr>
          <td>
            <div style="display:flex; align-items:flex-start; gap:8px;">
              <span style="color:${isGs ? '#818CF8' : 'var(--text-muted)'}; margin-top:2px;">
                ${isGs ? '🎓' : (Icons.document || Icons.file)}
              </span>
              <div>
                ${a.local_file ? `
                  <a href="#" class="grade-item-link" data-filepath="${escapeHtml(a.local_file)}" data-title="${escapeHtml(a.title)}" style="font-weight:600; color:var(--canvas-blue); text-decoration:none; display:inline-block; margin-bottom:2px;">
                    ${escapeHtml(a.title)}
                  </a>
                ` : `
                  <span style="font-weight:600; color:var(--text-main); display:inline-block; margin-bottom:2px;">
                    ${escapeHtml(a.title)}
                  </span>
                `}
                ${isGs ? '<span class="badge-gradescope" style="margin-left:6px;">Gradescope</span>' : ''}
                <div style="font-size:11px; color:var(--text-light);">
                  ${a.date_assigned ? `Assigned: ${escapeHtml(a.date_assigned)}` : ''}
                </div>
              </div>
            </div>
          </td>
          <td class="grade-td-due">
            ${escapeHtml(dueText || "—")}
          </td>
          <td>
            ${statusBadge}
          </td>
          <td class="grade-td-score">
            ${escapeHtml(scoreText)}
          </td>
        </tr>
      `;
    });

    // Category weight summary (prefer backend pre-calculated categories)
    if (grades.categories && grades.categories.length > 0) {
      grades.categories.forEach((cat, idx) => {
        html += `
          <tr class="grade-summary-row ${idx === 0 ? 'border-top' : ''}">
            <td colspan="3">${escapeHtml(cat.name)}</td>
            <td class="grade-summary-score">${escapeHtml(cat.formatted)}</td>
          </tr>
        `;
      });
      html += `
        <tr class="grade-total-row">
          <td colspan="3">Total</td>
          <td class="grade-total-score">${escapeHtml(grades.formatted_total || `${grades.total_score} / ${grades.total_possible}`)}</td>
        </tr>
      `;
    } else {
      // Dynamic summary weight categories fallback
      const groups = {};
      let totalScore = 0;
      let totalPossible = 0;
      assignments.forEach(a => {
        const g = a.group || "Assignments";
        if (!groups[g]) {
          groups[g] = { score: 0, possible: 0 };
        }
        const pts = parseFloat(a.points) || 0;
        const sc = parseFloat(a.score) || 0;
        groups[g].possible += pts;
        groups[g].score += sc;
        totalPossible += pts;
        totalScore += sc;
      });

      const groupKeys = Object.keys(groups);
      groupKeys.forEach((g, idx) => {
        const gData = groups[g];
        html += `
          <tr class="grade-summary-row ${idx === 0 ? 'border-top' : ''}">
            <td colspan="3">${escapeHtml(g)}</td>
            <td class="grade-summary-score">${gData.score.toFixed(2)} / ${gData.possible.toFixed(2)}</td>
          </tr>
        `;
      });
      html += `
        <tr class="grade-total-row">
          <td colspan="3">Total</td>
          <td class="grade-total-score">${totalScore.toFixed(2)} / ${totalPossible.toFixed(2)}</td>
        </tr>
      `;
    }
  } else {
    html += `
      <tr>
        <td colspan="4" style="text-align:center; padding:32px; color:var(--text-muted);">
          No individual grades listed. Use the button above to view the complete official grade report.
        </td>
      </tr>
    `;
  }

  html += `
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;

  els.viewCanvas.innerHTML = html;

  // Wire up assignment title links to local preview
  document.querySelectorAll(".grade-item-link").forEach(link => {
    link.addEventListener("click", () => {
      const path = link.getAttribute("data-filepath");
      const title = link.getAttribute("data-title");
      if (path) openPreviewModal(title, path);
    });
  });

  const btnPrev = document.getElementById("btn-preview-grade-pdf");
  if (btnPrev && relFile) {
    btnPrev.addEventListener("click", () => {
      openPreviewModal(grades.local_file, relFile);
    });
  }

  const btnMac = document.getElementById("btn-open-grade-mac");
  if (btnMac && relFile) {
    btnMac.addEventListener("click", () => {
      systemAction(relFile, "open");
    });
  }
}

// 3. Render Timeline View (Quarter Milestones)

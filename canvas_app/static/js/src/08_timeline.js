function renderTimelineView() {
  const timeline = state.courseData?.timeline || [];
  const filter = state.timelineFilter;

  const filteredTimeline = timeline.filter(item => {
    if (filter === "all") return true;
    if (filter === "assignment") return item.type === "assignment" && !item.title.toLowerCase().includes("exam");
    if (filter === "exam") return (item.type || "").includes("quiz") || (item.title || "").toLowerCase().includes("exam") || (item.title || "").toLowerCase().includes("midterm");
    return true;
  });

  let html = `
    <div class="timeline-container">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px;">
        <div>
          <h2 style="font-size:22px; font-weight:700;">Quarter Chronological Timeline</h2>
          <p style="font-size:13px; color:#6B7280;">Full chronological sequence of assignments, milestones, and deadlines across the academic term.</p>
        </div>
      </div>

      <div class="timeline-filters">
        <button class="filter-chip ${filter === "all" ? "active" : ""}" data-filter="all">All Events (${timeline.length})</button>
        <button class="filter-chip ${filter === "assignment" ? "active" : ""}" data-filter="assignment">Assignments</button>
        <button class="filter-chip ${filter === "exam" ? "active" : ""}" data-filter="exam">Exams & Quizzes</button>
      </div>

      <div class="timeline-stream">
  `;

  if (filteredTimeline.length === 0) {
    html += `<div style="text-align:center; padding:40px; color:#6B7280;">No milestone events match this filter.</div>`;
  } else {
    filteredTimeline.forEach((t) => {
      const isExam = (t.title || "").toLowerCase().includes("exam") || (t.title || "").toLowerCase().includes("midterm") || (t.type || "").includes("quiz");
      const isSubmitted = t.submission_status === "submitted";
      const nodeClass = isExam ? "milestone-exam" : (isSubmitted ? "milestone-submitted" : "");
      
      const dueStr = t.date_due ? formatDate(t.date_due) : "No due date specified";
      const assignedStr = t.date_assigned ? formatDate(t.date_assigned) : null;

      html += `
        <div class="timeline-milestone">
          <div class="timeline-node ${nodeClass}"></div>
          <div class="timeline-card">
            <div class="timeline-date-tag">
              <span>${Icons.timeline}</span>
              <span>DUE: ${escapeHtml(dueStr)}</span>
              ${assignedStr ? `<span style="margin-left:12px; color:#9CA3AF;">• ASSIGNED: ${escapeHtml(assignedStr)}</span>` : ""}
            </div>
            <div class="timeline-title">${escapeHtml(t.title)}</div>
            <div class="timeline-meta">
              <span>Type: <strong>${escapeHtml(t.type || "Milestone")}</strong></span>
              ${t.points !== undefined && t.points !== null ? `<span>• Points: <strong>${escapeHtml(t.points)} pts</strong></span>` : ""}
              ${t.group ? `<span>• Group: <strong>${escapeHtml(t.group)}</strong></span>` : ""}
              <span style="margin-left:auto;">
                <span class="${isSubmitted ? "badge-submitted" : "badge-unsubmitted"}">${isSubmitted ? "Submitted" : "Archived"}</span>
              </span>
            </div>
            ${t.local_file ? `
              <div class="timeline-file-preview-bar" style="margin-top:12px; padding-top:10px; border-top:1px solid var(--border-color, #E5E7EB); display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                <button class="btn-mini btn-timeline-preview" data-filepath="${escapeHtml(t.local_file)}" data-title="${escapeHtml(t.title)}" style="padding:6px 12px; font-size:12px; font-weight:600; background:var(--canvas-blue); color:#FFF; border:none; border-radius:6px; cursor:pointer; display:inline-flex; align-items:center; gap:6px;">
                  ${Icons.preview} Preview Document
                </button>
                <button class="btn-mini btn-timeline-mac" data-filepath="${escapeHtml(t.local_file)}" title="Open in Default App" style="padding:6px 10px; font-size:12px; font-weight:500; border-radius:6px; display:inline-flex; align-items:center; gap:4px;">
                  ${Icons.macApp} Default App
                </button>
                <button class="btn-mini btn-timeline-finder" data-filepath="${escapeHtml(t.local_file)}" title="Show in Folder" style="padding:6px 8px; font-size:12px; border-radius:6px; display:inline-flex; align-items:center;">
                  ${Icons.macFinder}
                </button>
                <span style="font-size:11px; color:var(--text-muted); font-family:monospace; margin-left:auto;">
                  ${escapeHtml(t.local_file.split('/').pop())}
                </span>
              </div>
            ` : ""}
          </div>
        </div>
      `;
    });
  }

  html += `
      </div>
    </div>
  `;

  els.viewTimeline.innerHTML = html;

  document.querySelectorAll(".filter-chip").forEach(btn => {
    btn.addEventListener("click", () => {
      state.timelineFilter = btn.getAttribute("data-filter");
      renderTimelineView();
    });
  });

  document.querySelectorAll(".btn-timeline-preview").forEach(btn => {
    btn.addEventListener("click", () => {
      const path = btn.getAttribute("data-filepath");
      const title = btn.getAttribute("data-title");
      if (path) openPreviewModal(title, path);
    });
  });

  document.querySelectorAll(".btn-timeline-mac").forEach(btn => {
    btn.addEventListener("click", () => {
      const path = btn.getAttribute("data-filepath");
      if (path) systemAction(path, "open");
    });
  });

  document.querySelectorAll(".btn-timeline-finder").forEach(btn => {
    btn.addEventListener("click", () => {
      const path = btn.getAttribute("data-filepath");
      if (path) systemAction(path, "reveal");
    });
  });
}

// Render Discussions & Community Tab
function renderDiscussionsTab() {
  const discussions = state.courseData?.discussions || [];
  const fileMap = state.courseData?.file_path_map || {};

  // Dynamically detect external community platforms (Discord, Slack, GroupMe, Ed, Piazza)
  let community = null;
  for (const disc of discussions) {
    const textToScan = `${disc.title || ""} ${disc.body || ""} ${disc.url || ""}`;
    const m = textToScan.match(/https?:\/\/(?:discord\.(?:gg|com\/invite)|join\.slack\.com|groupme\.com|piazza\.com|edstem\.org)\/[^\s\)\]]+/i);
    if (m || disc.community_url) {
      const detectedUrl = disc.community_url || (m ? m[0] : "");
      community = {
        url: detectedUrl,
        platform: /discord/i.test(detectedUrl) ? "Discord" :
                  /slack/i.test(detectedUrl) ? "Slack" :
                  /groupme/i.test(detectedUrl) ? "GroupMe" :
                  /piazza/i.test(detectedUrl) ? "Piazza" :
                  /edstem/i.test(detectedUrl) ? "Ed Discussion" : "Community",
        author: disc.author || "",
        quote: disc.quote || disc.snippet || "",
        file: disc.local_file || ""
      };
      break;
    }
  }

  // Fallback: check fileMap for saved discussion community post
  if (!community) {
    for (const [fn, fp] of Object.entries(fileMap)) {
      const fnLow = fn.toLowerCase();
      if ((fnLow.includes("disc server") || fnLow.includes("discord") || fnLow.includes("study group")) && fn.endsWith(".pdf")) {
        const matchingDisc = discussions.find(d => d.local_file === fp || fn.includes(d.title));
        community = {
          url: matchingDisc?.community_url || "",
          platform: "Discord",
          author: matchingDisc?.author || "",
          quote: matchingDisc?.quote || "",
          file: fp
        };
        break;
      }
    }
  }

  let html = `
    <div style="max-width: 900px; margin: 0 auto; padding-bottom: 40px;">
      <div style="margin-bottom: 24px;">
        <h2 style="font-size: 22px; font-weight: 700; margin: 0 0 6px 0;">Discussions &amp; Community</h2>
        <p style="font-size: 13px; color: var(--text-muted); margin: 0;">
          Class discussion boards, peer study networks, and community server archives.
        </p>
      </div>

      ${community ? `
      <!-- Community Hero Card -->
      <div class="discussion-hero-card">
        <div style="display:flex; align-items:flex-start; justify-content:space-between; gap:16px; flex-wrap:wrap;">
          <div style="display:flex; gap:14px; align-items:flex-start;">
            <div class="discord-icon-badge">
              💬
            </div>
            <div>
              <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                <h3 style="margin:0; font-size:17px; font-weight:700; color:#FFFFFF;">Course ${escapeHtml(community.platform)} Server</h3>
                <span class="discord-tag">Peer Study Group</span>
              </div>
              ${community.author ? `
              <div style="font-size:12px; color:rgba(255,255,255,0.85); margin-top:3px;">
                Posted by <strong>${escapeHtml(community.author)}</strong>
              </div>
              ` : ""}
              ${community.quote ? `
              <div class="discord-quote">
                &ldquo;${escapeHtml(community.quote)}&rdquo;
              </div>
              ` : ""}
            </div>
          </div>
          <div style="display:flex; flex-direction:column; gap:8px; align-items:flex-end;">
            ${community.url ? `
            <a href="${escapeHtml(safeExternalUrl(community.url))}" target="_blank" rel="noopener noreferrer" class="btn-discord-join">
              <span>Join Course ${escapeHtml(community.platform)}</span>
              <span style="font-size:14px;">↗</span>
            </a>
            ` : ""}
            <div style="display:flex; gap:6px;">
              ${community.file ? `
                <button class="btn-mini btn-disc-preview" data-filepath="${escapeHtml(community.file)}" data-title="Community Discussion Post" style="font-size:11px; padding:5px 10px; background:rgba(255,255,255,0.2); color:#FFFFFF; border:1px solid rgba(255,255,255,0.4); border-radius:6px; cursor:pointer;">
                  ${Icons.preview} Preview Thread
                </button>
                <button class="btn-mini btn-disc-mac" data-filepath="${escapeHtml(community.file)}" title="Open in Default App" style="font-size:11px; padding:5px 8px; background:rgba(255,255,255,0.2); color:#FFFFFF; border:1px solid rgba(255,255,255,0.4); border-radius:6px; cursor:pointer;">
                  ${Icons.macApp}
                </button>
              ` : ""}
            </div>
          </div>
        </div>
      </div>
      ` : ""}

      <!-- Discussion Topics List -->
      <div class="grades-card" style="margin-top:24px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
          <div>
            <h3 style="font-size:16px; font-weight:700; margin:0 0 2px 0;">Archived Discussion Topics</h3>
            <div style="font-size:12px; color:var(--text-muted);">Canvas LMS discussion threads and study exchanges</div>
          </div>
          <span class="grades-total-pill">${Math.max(discussions.length, 1)} Topic${discussions.length === 1 ? '' : 's'}</span>
        </div>

        <div class="discussions-list">
  `;

  if (discussions.length > 0) {
    discussions.forEach((disc, idx) => {
      const cleanTitle = disc.title.replace(/^unread,_\s*/i, "").replace(/_Disc Server/g, "Discord Server");
      const localFile = disc.local_file;
      html += `
        <div class="discussion-item-row">
          <div style="display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap;">
            <div style="display:flex; align-items:center; gap:12px;">
              <span style="color:var(--canvas-blue); display:flex; align-items:center;">${Icons.discussions}</span>
              <div>
                <div style="font-weight:600; font-size:14px; color:var(--text-main);">
                  ${escapeHtml(cleanTitle)}
                </div>
                <div style="font-size:12px; color:var(--text-muted); margin-top:2px;">
                  Topic ID: ${escapeHtml(disc.url ? (disc.url.split('/').pop() || idx + 1) : idx + 1)} &bull; ${escapeHtml(disc.module_name || "General")}
                </div>
              </div>
            </div>
            <div style="display:flex; gap:8px;">
              ${localFile ? `
                <button class="btn-mini btn-disc-preview" data-filepath="${escapeHtml(localFile)}" data-title="${escapeHtml(cleanTitle)}" style="padding:6px 12px; font-size:12px; font-weight:600; background:var(--canvas-blue); color:#FFF; border:none; border-radius:6px; cursor:pointer; display:inline-flex; align-items:center; gap:6px;">
                  ${Icons.preview} Preview Thread
                </button>
                <button class="btn-mini btn-disc-mac" data-filepath="${escapeHtml(localFile)}" title="Open in Default App" style="padding:6px 10px; font-size:12px; border-radius:6px;">
                  ${Icons.macApp}
                </button>
              ` : (disc.url ? `
                <a href="${escapeHtml(safeExternalUrl(disc.url))}" target="_blank" rel="noopener noreferrer" class="btn-mini" style="text-decoration:none; padding:6px 12px; font-size:12px; font-weight:500; display:inline-flex; align-items:center; gap:4px;">
                  View on Canvas ↗
                </a>
              ` : "")}
            </div>
          </div>
        </div>
      `;
    });
  } else {
    html += `
      <div style="text-align:center; padding:32px; color:var(--text-muted); font-size:13px;">
        No additional discussion topics published on Canvas for this course.
      </div>
    `;
  }

  html += `
        </div>
      </div>
    </div>
  `;

  els.viewCanvas.innerHTML = html;

  document.querySelectorAll(".btn-disc-preview").forEach(btn => {
    btn.addEventListener("click", () => {
      const path = btn.getAttribute("data-filepath");
      const title = btn.getAttribute("data-title");
      if (path) openPreviewModal(title, path);
    });
  });

  document.querySelectorAll(".btn-disc-mac").forEach(btn => {
    btn.addEventListener("click", () => {
      const path = btn.getAttribute("data-filepath");
      if (path) systemAction(path, "open");
    });
  });
}

// Render Zoom & Media Center Tab
function renderMediaTab() {
  const syl = state.courseData?.syllabus || {};
  const structured = syl.structured || {};
  const lecture = structured.lecture || {};
  const instructors = structured.instructors || [];
  const tas = structured.teaching_assistants || [];
  const fileMap = state.courseData?.file_path_map || {};

  let recordingsDoc = null;
  for (const [fn, fp] of Object.entries(fileMap)) {
    if (fn.toLowerCase().includes("video") || fn.toLowerCase().includes("recording")) {
      recordingsDoc = { name: fn, path: fp };
      break;
    }
  }

  let html = `
    <div style="max-width: 960px; margin: 0 auto; padding-bottom: 40px;">
      <div style="margin-bottom: 24px;">
        <h2 style="font-size: 22px; font-weight: 700; margin: 0 0 6px 0;">Zoom &amp; Media Center</h2>
        <p style="font-size: 13px; color: var(--text-muted); margin: 0;">
          Direct credentials and instant launchpad for lectures, faculty &amp; TA office hours, discussion sections, and recordings.
        </p>
      </div>

      <!-- Main Lecture Hero Card -->
      ${lecture.schedule || lecture.zoom_url ? `
      <div class="media-hero-card">
        <div style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:16px;">
          <div>
            <div class="media-badge-live">${lecture.zoom_url ? "SYNCHRONOUS LECTURE" : "COURSE LECTURE"}</div>
            <h3 style="margin:8px 0 4px 0; font-size:20px; font-weight:800; color:#FFFFFF;">
              ${escapeHtml(lecture.title || state.courseData.course_name || "Course Lecture")}
            </h3>
            <div style="color:rgba(255,255,255,0.9); font-size:13px; margin-bottom:12px;">
              🗓️ ${escapeHtml(lecture.schedule || "Refer to course syllabus for meeting schedule")}
            </div>
            ${lecture.meeting_id ? `
            <div class="media-id-chip">
              Meeting ID: <strong>${escapeHtml(lecture.meeting_id)}</strong>
            </div>
            ` : ""}
          </div>
          ${lecture.zoom_url ? `
          <div style="display:flex; flex-direction:column; gap:8px;">
            <a href="${escapeHtml(safeExternalUrl(lecture.zoom_url))}" target="_blank" rel="noopener noreferrer" class="btn-media-launch">
              <span>🎥 Launch Lecture Zoom</span>
              <span style="font-size:14px;">↗</span>
            </a>
          </div>
          ` : ""}
        </div>
      </div>
      ` : `
      <div class="grades-card" style="margin-bottom:24px; padding:20px; text-align:center;">
        <div style="font-size:14px; font-weight:600; color:var(--text-main); margin-bottom:4px;">In-Person Course Instruction</div>
        <div style="font-size:12px; color:var(--text-muted);">This course meets in-person. Check the course syllabus for hall locations and schedule details.</div>
      </div>
      `}

      <!-- Instructors Office Hours Section -->
      <div style="margin-top:28px;">
        <h3 style="font-size:17px; font-weight:700; margin:0 0 14px 0; display:flex; align-items:center; gap:8px;">
          <span>👨‍🏫</span> Faculty Office Hours
        </h3>
        <div class="media-instructors-grid">
          ${instructors.map(inst => `
            <div class="media-card">
              <div>
                <div class="media-card-header">
                  <div style="font-weight:700; font-size:15px; color:var(--text-main);">${escapeHtml(inst.name)}</div>
                  <div style="font-size:12px; color:var(--text-muted);">${escapeHtml(inst.role || "Instructor")}</div>
                </div>
                <div class="media-card-body">
                  <div style="font-size:13px; margin-bottom:8px; line-height:1.4;">
                    <strong>Office Hours:</strong> ${escapeHtml(inst.office_hours)}
                    ${inst.note ? `<div style="font-size:11px; color:#D97706; margin-top:3px; font-style:italic;">${escapeHtml(inst.note)}</div>` : ""}
                  </div>
                  <div style="font-size:12px; color:var(--text-muted); margin-bottom:12px;">
                    ✉️ <a href="mailto:${escapeHtml(inst.email)}" style="color:var(--canvas-blue); text-decoration:none;">${escapeHtml(inst.email)}</a>
                  </div>
                  ${inst.meeting_id ? `
                    <div style="font-size:12px; background:var(--bg-secondary); padding:6px 10px; border-radius:6px; margin-bottom:12px; display:inline-block;">
                      Meeting ID: <strong>${escapeHtml(inst.meeting_id)}</strong>
                      ${inst.passcode ? ` &bull; Passcode: <strong>${escapeHtml(inst.passcode)}</strong>` : ""}
                    </div>
                  ` : ""}
                </div>
              </div>
              <div class="media-card-footer">
                ${inst.zoom_url ? `
                  <a href="${escapeHtml(safeExternalUrl(inst.zoom_url))}" target="_blank" rel="noopener noreferrer" class="btn-media-card-join">
                    🎥 Join Office Hours Zoom ↗
                  </a>
                ` : `<span style="color:var(--text-muted); font-size:12px;">No Zoom link specified</span>`}
              </div>
            </div>
          `).join("")}
        </div>
      </div>

      <!-- Teaching Assistants Section & OH Grid -->
      ${tas.length > 0 ? `
        <div style="margin-top:32px;">
          <h3 style="font-size:17px; font-weight:700; margin:0 0 14px 0; display:flex; align-items:center; gap:8px;">
            <span>👥</span> Teaching Assistants: Discussion Sections &amp; Office Hours
          </h3>
          <div class="grades-card" style="padding:0; overflow:hidden;">
            <div style="overflow-x:auto;">
              <table class="syllabus-modern-table" style="margin-bottom:0;">
                <thead>
                  <tr>
                    <th style="width:90px;">Sections</th>
                    <th>TA Name</th>
                    <th>Discussion Zoom</th>
                    <th>Office Hours Schedule</th>
                    <th>Office Hours Zoom</th>
                  </tr>
                </thead>
                <tbody>
                  ${tas.map(ta => `
                    <tr>
                      <td style="font-weight:700; color:var(--canvas-blue); font-size:13px;">${escapeHtml(ta.sections)}</td>
                      <td>
                        <div style="font-weight:600; color:var(--text-main);">${escapeHtml(ta.name)}</div>
                        <div style="font-size:11px; color:var(--text-muted);">${escapeHtml(ta.email)}</div>
                      </td>
                      <td>
                        ${ta.discussion_zoom_url ? `
                          <a href="${escapeHtml(safeExternalUrl(ta.discussion_zoom_url))}" target="_blank" rel="noopener noreferrer" class="btn-zoom-mini">
                            🎥 Section Zoom
                          </a>
                          <div style="font-size:11px; color:var(--text-muted); margin-top:2px;">
                            ID: ${escapeHtml(ta.discussion_meeting_id || "-")}
                            ${ta.discussion_passcode ? `<br>Pass: <strong>${escapeHtml(ta.discussion_passcode)}</strong>` : ""}
                          </div>
                        ` : `<span style="color:var(--text-muted);">-</span>`}
                      </td>
                      <td>
                        <span style="font-weight:500; font-size:13px;">${escapeHtml(ta.office_hours)}</span>
                      </td>
                      <td>
                        ${ta.office_hours_zoom_url ? `
                          <a href="${escapeHtml(safeExternalUrl(ta.office_hours_zoom_url))}" target="_blank" rel="noopener noreferrer" class="btn-zoom-mini">
                            🎥 OH Zoom
                          </a>
                          <div style="font-size:11px; color:var(--text-muted); margin-top:2px;">
                            ID: ${escapeHtml(ta.office_hours_meeting_id || "-")}
                            ${ta.office_hours_passcode ? `<br>Pass: <strong>${escapeHtml(ta.office_hours_passcode)}</strong>` : ""}
                          </div>
                        ` : `<span style="color:var(--text-muted);">-</span>`}
                      </td>
                    </tr>
                  `).join("")}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ` : ""}

      <!-- Recordings Catalog Card -->
      <div class="grades-card" style="margin-top:28px;">
        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px;">
          <div>
            <h3 style="font-size:16px; font-weight:700; margin:0 0 2px 0;">Lecture &amp; Review Recordings</h3>
            <div style="font-size:12px; color:var(--text-muted);">Synchronous lectures and exam review sessions recorded during the term</div>
          </div>
          ${recordingsDoc ? `
            <div style="display:flex; gap:8px;">
              <button class="btn-mini btn-rec-preview" data-filepath="${escapeHtml(recordingsDoc.path)}" data-title="${escapeHtml(recordingsDoc.name)}" style="padding:6px 12px; font-size:12px; font-weight:600; background:var(--canvas-blue); color:#FFF; border:none; border-radius:6px; cursor:pointer;">
                ${Icons.preview} View Recordings Index
              </button>
            </div>
          ` : `
            <div style="font-size:12px; color:var(--text-muted); font-style:italic;">
              Recordings are published to BruinLearn / CCLE course media
            </div>
          `}
        </div>
      </div>
    </div>
  `;

  els.viewCanvas.innerHTML = html;

  document.querySelectorAll(".btn-rec-preview").forEach(btn => {
    btn.addEventListener("click", () => {
      const path = btn.getAttribute("data-filepath");
      const title = btn.getAttribute("data-title");
      if (path) openPreviewModal(title, path);
    });
  });
}

// 4. Render Desktop Folders View

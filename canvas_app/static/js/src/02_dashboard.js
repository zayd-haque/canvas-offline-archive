function getCourseBannerGradient(name) {
  const gradients = [
    "linear-gradient(135deg, #1e3a8a 0%, #3b82f6 100%)", // Blue
    "linear-gradient(135deg, #065f46 0%, #10b981 100%)", // Emerald
    "linear-gradient(135deg, #581c87 0%, #8b5cf6 100%)", // Purple
    "linear-gradient(135deg, #831843 0%, #ec4899 100%)", // Rose
    "linear-gradient(135deg, #7c2d12 0%, #f97316 100%)", // Amber/Orange
    "linear-gradient(135deg, #134e4a 0%, #14b8a6 100%)", // Teal
    "linear-gradient(135deg, #1e1b4b 0%, #6366f1 100%)", // Indigo
  ];
  let hash = 0;
  for (let i = 0; i < (name || "").length; i++) {
    hash = (hash << 5) - hash + name.charCodeAt(i);
    hash |= 0;
  }
  return gradients[Math.abs(hash) % gradients.length];
}

// Universal course department extraction from course name/code
function extractCourseDepartment(name) {
  if (!name) return "OTHER";
  const cleaned = name.replace(/\[.*?\]/g, "").trim();
  const m = cleaned.match(/^([A-Za-z&/\s\.-]+?)(?:\s*(?:[M|C|CM])?\d|\b$)/);
  if (m) {
    const dept = m[1].trim().replace(/[\s\-_]+$/, "");
    return dept.toUpperCase() || "OTHER";
  }
  return "OTHER";
}

// Universal academic quarter resolver
function getCourseTermDisplay(c) {
  if (!c) return "Archived Term";
  let termDisplay = c.term || c.quarter;
  if (!termDisplay && (c.name || c.folder_name)) {
    const m = (c.name + " " + (c.folder_name || "")).match(/(Summer|Spring|Fall|Winter)\s+\d{4}/i);
    if (m) termDisplay = m[0];
  }
  return termDisplay || "Archived Term";
}

// Chronological score for academic quarters: year * 10 + season (Winter: 1, Spring: 2, Summer: 3, Fall: 4)
function getCourseTermScore(termStr) {
  if (!termStr) return 0;
  const m = termStr.match(/(Winter|Spring|Summer|Fall)\s+(\d{4})/i);
  if (!m) {
    const y = termStr.match(/\b(20\d\d)\b/);
    return y ? parseInt(y[1], 10) * 10 : 0;
  }
  const season = m[1].toLowerCase();
  const year = parseInt(m[2], 10);
  const seasonWeights = { winter: 1, spring: 2, summer: 3, fall: 4 };
  return year * 10 + (seasonWeights[season] || 0);
}

// Formats folder path without system user prefixes (e.g. /Users/john/Desktop/Course -> Desktop/Course)
function formatCourseCardPath(rawPath, fallbackName) {
  if (!rawPath) return fallbackName || "";
  let p = String(rawPath).trim();
  if (p.startsWith("~/")) {
    p = p.substring(2);
  } else {
    p = p.replace(/^\/(?:Users|home)\/[^/]+\/?/i, "");
  }
  p = p.replace(/^\/+/, "");
  return p || fallbackName || "";
}

// Reusable Course Card HTML generator
function renderCourseCardHtml(c) {
  const isSelected = state.currentCourse === c.name;
  const gradient = getCourseBannerGradient(c.name);
  const termDisplay = getCourseTermDisplay(c);
  const stats = c.stats || {};
  const fileCount = stats.files || 0;
  const modCount = stats.modules || 0;
  const assignCount = stats.assignments || 0;
  const annCount = stats.announcements || 0;
  const displayPath = formatCourseCardPath(c.path, c.folder_name || c.name);

  return `
    <div class="course-card ${isSelected ? 'active-course' : ''}" data-course-name="${escapeHtml(c.name)}">
      <div class="course-card-banner" style="background: ${gradient};">
        <span class="course-card-quarter-pill">
          <span class="quarter-icon">${Icons.calendar || ""}</span>
          <span class="quarter-text">${escapeHtml(termDisplay)}</span>
        </span>
        <div class="course-card-code">${escapeHtml(c.name)}</div>
      </div>
      <div class="course-card-body">
        <div class="course-card-header course-card-title-wrap">
          <h3 class="course-card-title course-card-name">${escapeHtml(c.name)}</h3>
          <div class="course-card-folder course-card-path" title="${escapeHtml(c.path || "")}">${escapeHtml(displayPath)}</div>
        </div>
        <div class="course-card-stats-grid">
          <div class="course-stat-box">
            <span class="course-stat-val">${fileCount}</span>
            <span class="course-stat-lbl">Files</span>
          </div>
          <div class="course-stat-box">
            <span class="course-stat-val">${modCount}</span>
            <span class="course-stat-lbl">Modules</span>
          </div>
          <div class="course-stat-box">
            <span class="course-stat-val">${assignCount}</span>
            <span class="course-stat-lbl">Tasks</span>
          </div>
          <div class="course-stat-box">
            <span class="course-stat-val">${annCount}</span>
            <span class="course-stat-lbl">Posts</span>
          </div>
        </div>
        <div class="course-card-footer">
          <button class="btn-card-open" data-action="open-course" data-course-name="${escapeHtml(c.name)}">
            <span>Open Course</span>
            <span>→</span>
          </button>
          <div class="course-card-quick-actions">
            <button class="btn-card-chip" data-action="quick-modules" data-course-name="${escapeHtml(c.name)}" title="View Modules">
              ${Icons.modules || ""} Modules
            </button>
            <button class="btn-card-chip" data-action="quick-files" data-course-name="${escapeHtml(c.name)}" title="Explore Files on Disk">
              ${Icons.folders || ""} Files
            </button>
            <button class="btn-card-chip" data-action="quick-timeline" data-course-name="${escapeHtml(c.name)}" title="Quarter Timeline">
              ${Icons.timeline || ""} Timeline
            </button>
            <button class="btn-card-chip" data-action="quick-reveal" data-course-name="${escapeHtml(c.name)}" data-course-path="${escapeHtml(c.path || "")}" title="Show in Folder">
              ${Icons.macFinder || ""} Folder
            </button>
          </div>
        </div>
      </div>
    </div>
  `;
}

// Render Dashboard View with Course Cards
function renderDashboardView() {
  if (!els.viewDashboard) return;
  const courses = state.courses || [];

  if (courses.length === 0) {
    const hasRoots = Boolean(state.settings?.searchDirectories?.length);
    els.viewDashboard.innerHTML = `
      <div class="dashboard-container dashboard-welcome">
        <div class="dashboard-welcome-hero">
          <div class="dashboard-welcome-copy">
            <span class="dashboard-welcome-kicker">YOUR LOCAL LIBRARY</span>
            <h1>Start your course archive.</h1>
            <p>${hasRoots
              ? "No courses were found in your current scan directories. Capture a course or point the app to a folder you already have."
              : "No scan directories are selected. Add a course or choose a folder with an existing archive to get started."}</p>
            <div class="dashboard-welcome-actions">
              <button type="button" class="btn-dashboard-add-course" id="dashboard-welcome-add">${Icons.plus || ""}<span>Add a course</span></button>
              <button type="button" class="dashboard-welcome-secondary" id="dashboard-welcome-directories">${Icons.folders || ""}<span>Choose a directory</span></button>
            </div>
          </div>
          <div class="dashboard-welcome-preview" aria-hidden="true">
            <div class="dashboard-welcome-preview-top"><span>Courses</span><span>0 saved</span></div>
            <div class="dashboard-welcome-preview-card"><span class="dashboard-welcome-preview-icon">${Icons.modules || ""}</span><span>Course materials will appear here</span></div>
            <div class="dashboard-welcome-preview-row"></div>
            <div class="dashboard-welcome-preview-row short"></div>
          </div>
        </div>
        <div class="dashboard-welcome-steps">
          <div><span>01</span><strong>Choose what to save</strong><p>Select a Canvas course and the categories you want to capture.</p></div>
          <div><span>02</span><strong>Sign in and capture</strong><p>Use your own Canvas account while online. Your files stay on your computer.</p></div>
          <div><span>03</span><strong>Browse offline</strong><p>Return to saved files, timelines, and local search later.</p></div>
        </div>
      </div>`;
    els.viewDashboard.querySelector("#dashboard-welcome-add")?.addEventListener("click", () => switchView("launcher"));
    els.viewDashboard.querySelector("#dashboard-welcome-directories")?.addEventListener("click", () => openSettingsModal("directories"));
    return;
  }

  // Initialize persistent sorting & filtering state
  if (typeof state.dashboardSort === "undefined") {
    state.dashboardSort = localStorage.getItem("canvas_dashboard_sort") || "quarter-desc";
  }
  if (typeof state.dashboardFilter === "undefined") {
    state.dashboardFilter = localStorage.getItem("canvas_dashboard_filter") || "all";
  }

  // Extract department list with counts
  const deptCounts = {};
  courses.forEach(c => {
    const d = extractCourseDepartment(c.name);
    deptCounts[d] = (deptCounts[d] || 0) + 1;
  });
  const availableDepts = Object.keys(deptCounts).sort();

  // Extract quarter list with counts (ordered chronologically newest first)
  const quarterCounts = {};
  courses.forEach(c => {
    const t = getCourseTermDisplay(c);
    quarterCounts[t] = (quarterCounts[t] || 0) + 1;
  });
  const availableQuarters = Object.keys(quarterCounts).sort((a, b) => {
    return getCourseTermScore(b) - getCourseTermScore(a);
  });

  // Filter courses
  const q = (state.dashboardSearch || "").toLowerCase().trim();
  const activeFilter = state.dashboardFilter || "all";
  const filtered = courses.filter(c => {
    if (q) {
      const nameMatch = (c.name || "").toLowerCase().includes(q);
      const folderMatch = (c.folder_name || "").toLowerCase().includes(q);
      const pathMatch = (c.path || "").toLowerCase().includes(q);
      const termMatch = (c.term || c.quarter || "").toLowerCase().includes(q);
      if (!nameMatch && !folderMatch && !pathMatch && !termMatch) return false;
    }
    if (activeFilter.startsWith("dept:")) {
      const targetDept = activeFilter.slice(5);
      if (extractCourseDepartment(c.name) !== targetDept) return false;
    } else if (activeFilter.startsWith("quarter:")) {
      const targetQuarter = activeFilter.slice(8);
      if (getCourseTermDisplay(c) !== targetQuarter) return false;
    }
    return true;
  });

  // Sort courses
  const sortMode = state.dashboardSort || "quarter-desc";
  const sorted = [...filtered].sort((a, b) => {
    if (sortMode === "quarter-desc") {
      const scoreA = getCourseTermScore(getCourseTermDisplay(a));
      const scoreB = getCourseTermScore(getCourseTermDisplay(b));
      if (scoreB !== scoreA) return scoreB - scoreA;
      return (a.name || "").localeCompare(b.name || "");
    } else if (sortMode === "quarter-asc") {
      const scoreA = getCourseTermScore(getCourseTermDisplay(a));
      const scoreB = getCourseTermScore(getCourseTermDisplay(b));
      if (scoreA !== scoreB) return scoreA - scoreB;
      return (a.name || "").localeCompare(b.name || "");
    } else if (sortMode === "name-asc") {
      return (a.name || "").localeCompare(b.name || "");
    } else if (sortMode === "name-desc") {
      return (b.name || "").localeCompare(a.name || "");
    } else if (sortMode === "dept-asc") {
      const deptA = extractCourseDepartment(a.name);
      const deptB = extractCourseDepartment(b.name);
      if (deptA !== deptB) return deptA.localeCompare(deptB);
      return (a.name || "").localeCompare(b.name || "");
    } else if (sortMode === "files-desc") {
      const filesA = (a.stats && a.stats.files) || 0;
      const filesB = (b.stats && b.stats.files) || 0;
      if (filesB !== filesA) return filesB - filesA;
      return (a.name || "").localeCompare(b.name || "");
    }
    return 0;
  });

  const hasActiveFilters = Boolean(q || activeFilter !== "all");

  const sortOptions = [
    { id: "quarter-desc", label: "Quarter (Newest)" },
    { id: "quarter-asc", label: "Quarter (Oldest)" },
    { id: "name-asc", label: "Alphabetical (A → Z)" },
    { id: "name-desc", label: "Alphabetical (Z → A)" },
    { id: "dept-asc", label: "Department (A → Z)" },
    { id: "files-desc", label: "Most Files" },
  ];
  const sortLabels = Object.fromEntries(sortOptions.map(o => [o.id, o.label]));

  let filterLabel = `All Courses (${courses.length})`;
  if (activeFilter.startsWith("dept:")) {
    const d = activeFilter.slice(5);
    filterLabel = `${d} (${deptCounts[d] || 0})`;
  } else if (activeFilter.startsWith("quarter:")) {
    const qtr = activeFilter.slice(8);
    filterLabel = `${qtr} (${quarterCounts[qtr] || 0})`;
  }

  let html = `
    <div class="dashboard-container">
      <div class="dashboard-hero">
        <div class="dashboard-hero-title-area">
          <div class="dashboard-title-row">
            <h1 class="dashboard-title">Academic Courses</h1>
            <span class="dashboard-meta-pill">${sorted.length === courses.length ? `${courses.length} Courses Offline` : `Showing ${sorted.length} of ${courses.length}`}</span>
          </div>
          <p class="dashboard-subtitle">Select an archived course to explore modules, lecture notes, assignments, and offline materials.</p>
        </div>
        <div class="dashboard-hero-actions">
          <div class="dashboard-search-wrap">
            <span class="dashboard-search-icon">${Icons.search || ""}</span>
            <input type="text" id="dashboard-search-input" class="dashboard-search-input" placeholder="Search courses, folders, quarters..." value="${escapeHtml(state.dashboardSearch || "")}">
          </div>

          <!-- Sort Popover Menu -->
          <div class="dashboard-filter-menu-wrap" id="dashboard-sort-menu-wrap">
            <button type="button" class="dashboard-hero-select dashboard-filter-trigger-btn" id="dashboard-sort-trigger" aria-haspopup="true" aria-expanded="false" title="Sort courses">
              <span class="filter-trigger-icon">${Icons.sort || ""}</span>
              <span class="filter-trigger-text">${escapeHtml(sortLabels[sortMode] || "Sort")}</span>
              <span class="filter-trigger-chevron">▾</span>
            </button>

            <div class="dashboard-filter-popover hidden" id="dashboard-sort-popover" style="width: 220px;">
              <div class="filter-popover-list" id="sort-popover-list">
                ${sortOptions.map(opt => `
                  <div class="filter-popover-item ${sortMode === opt.id ? 'selected' : ''}" data-sort="${opt.id}">
                    <span class="filter-item-label">${escapeHtml(opt.label)}</span>
                    ${sortMode === opt.id ? `<span class="filter-item-check">${Icons.check || ""}</span>` : ''}
                  </div>
                `).join('')}
              </div>
            </div>
          </div>

          <!-- Custom Filter Popover Menu -->
          <div class="dashboard-filter-menu-wrap" id="dashboard-filter-menu-wrap">
            <button type="button" class="dashboard-hero-select dashboard-filter-trigger-btn ${activeFilter !== 'all' ? 'has-filter' : ''}" id="dashboard-filter-trigger" aria-haspopup="true" aria-expanded="false" title="Filter courses by department or quarter">
              <span class="filter-trigger-icon">${Icons.filter || ""}</span>
              <span class="filter-trigger-text">${escapeHtml(filterLabel)}</span>
              <span class="filter-trigger-chevron">▾</span>
            </button>

            <div class="dashboard-filter-popover hidden" id="dashboard-filter-popover">
              <div class="filter-popover-header">
                <div class="filter-popover-search-wrap">
                  <span class="filter-search-icon">${Icons.search || ""}</span>
                  <input type="text" class="filter-popover-search-input" id="filter-popover-search-input" placeholder="Search departments or quarters..." autocomplete="off">
                </div>
              </div>
              <div class="filter-popover-item ${activeFilter === 'all' ? 'selected' : ''}" data-filter="all" id="filter-all-courses-item">
                <span class="filter-item-label">All Courses</span>
                <span class="filter-item-count">${courses.length}</span>
                ${activeFilter === 'all' ? `<span class="filter-item-check">${Icons.check || ""}</span>` : ''}
              </div>
              <div class="filter-popover-tabs" id="filter-popover-tabs">
                <button type="button" class="filter-tab-btn ${activeFilter.startsWith('quarter:') ? '' : 'active'}" data-tab="depts" id="filter-tab-depts">Departments (${availableDepts.length})</button>
                <button type="button" class="filter-tab-btn ${activeFilter.startsWith('quarter:') ? 'active' : ''}" data-tab="quarters" id="filter-tab-quarters">Quarters (${availableQuarters.length})</button>
              </div>

              <!-- Unified Search Results Container (Shown when searching) -->
              <div class="filter-popover-list hidden" id="filter-unified-search-results"></div>

              <!-- Tabbed browsing lists -->
              <div class="filter-popover-list ${activeFilter.startsWith('quarter:') ? 'hidden' : ''}" id="filter-list-depts">
                ${availableDepts.map(d => `
                  <div class="filter-popover-item ${activeFilter === `dept:${d}` ? 'selected' : ''}" data-filter="dept:${escapeHtml(d)}">
                    <span class="filter-item-label">${escapeHtml(d)}</span>
                    <span class="filter-item-count">${deptCounts[d]}</span>
                    ${activeFilter === `dept:${d}` ? `<span class="filter-item-check">${Icons.check || ""}</span>` : ''}
                  </div>
                `).join("")}
              </div>
              <div class="filter-popover-list ${activeFilter.startsWith('quarter:') ? '' : 'hidden'}" id="filter-list-quarters">
                ${availableQuarters.map(t => `
                  <div class="filter-popover-item ${activeFilter === `quarter:${t}` ? 'selected' : ''}" data-filter="quarter:${escapeHtml(t)}">
                    <span class="filter-item-label">${escapeHtml(t)}</span>
                    <span class="filter-item-count">${quarterCounts[t]}</span>
                    ${activeFilter === `quarter:${t}` ? `<span class="filter-item-check">${Icons.check || ""}</span>` : ''}
                  </div>
                `).join("")}
              </div>
            </div>
          </div>

          ${hasActiveFilters ? `
            <button type="button" class="btn-dashboard-hero-clear" id="btn-dashboard-clear-filters" title="Reset all search & filters">
              Clear
            </button>
          ` : ''}

          <button class="btn-dashboard-add-course" id="btn-dashboard-add-course" title="Setup and add a new Canvas course">
            <span class="btn-icon">${Icons.plus || Icons.rocket || ""}</span>
            <span>Add Course</span>
          </button>
        </div>
      </div>
  `;

  if (sorted.length === 0) {
    html += `
      <div style="text-align: center; padding: 60px 20px; color: var(--text-muted); background: var(--bg-card); border-radius: 12px; border: 1px dashed var(--border-color); margin-top: 12px;">
        <div style="font-size: 28px; margin-bottom: 12px; opacity: 0.5;">${Icons.search || ""}</div>
        <div style="font-size: 16px; font-weight: 600; color: var(--text-main);">No courses found matching active filters</div>
        <div style="font-size: 13px; margin-top: 6px; margin-bottom: 16px;">Try adjusting your search keywords or filter selection.</div>
        <button type="button" class="btn-dashboard-add-course" id="btn-dashboard-empty-reset" style="margin: 0 auto; display: inline-flex;">
          <span>Reset All Filters</span>
        </button>
      </div>
    `;
  } else {
    html += `<div class="course-cards-grid">`;
    sorted.forEach(c => {
      html += renderCourseCardHtml(c);
    });
    html += `</div>`;
  }

  html += `</div>`;
  els.viewDashboard.innerHTML = html;

  // Wire search input
  const searchInput = els.viewDashboard.querySelector("#dashboard-search-input");
  if (searchInput) {
    searchInput.addEventListener("input", (e) => {
      state.dashboardSearch = e.target.value;
      renderDashboardView();
      const updatedInput = els.viewDashboard.querySelector("#dashboard-search-input");
      if (updatedInput) {
        updatedInput.focus();
        updatedInput.setSelectionRange(updatedInput.value.length, updatedInput.value.length);
      }
    });
  }

  // Wire Sort Popover Menu
  const sortWrap = els.viewDashboard.querySelector("#dashboard-sort-menu-wrap");
  const sortTrigger = els.viewDashboard.querySelector("#dashboard-sort-trigger");
  const sortPopover = els.viewDashboard.querySelector("#dashboard-sort-popover");

  // Wire Filter Popover Menu
  const filterWrap = els.viewDashboard.querySelector("#dashboard-filter-menu-wrap");
  const filterTrigger = els.viewDashboard.querySelector("#dashboard-filter-trigger");
  const filterPopover = els.viewDashboard.querySelector("#dashboard-filter-popover");
  const filterSearchInput = els.viewDashboard.querySelector("#filter-popover-search-input");
  const allCoursesItem = els.viewDashboard.querySelector("#filter-all-courses-item");
  const tabsBar = els.viewDashboard.querySelector("#filter-popover-tabs");
  const tabDepts = els.viewDashboard.querySelector("#filter-tab-depts");
  const tabQuarters = els.viewDashboard.querySelector("#filter-tab-quarters");
  const listDepts = els.viewDashboard.querySelector("#filter-list-depts");
  const listQuarters = els.viewDashboard.querySelector("#filter-list-quarters");
  const unifiedResults = els.viewDashboard.querySelector("#filter-unified-search-results");

  const closeSort = () => {
    if (sortPopover) {
      sortPopover.classList.add("hidden");
      sortTrigger?.setAttribute("aria-expanded", "false");
    }
  };

  const closeFilter = () => {
    if (filterPopover) {
      filterPopover.classList.add("hidden");
      filterTrigger?.setAttribute("aria-expanded", "false");
    }
  };

  // Outside click listener for both popovers
  const handleOutsideClick = (e) => {
    if (sortWrap && !sortWrap.contains(e.target)) {
      closeSort();
    }
    if (filterWrap && !filterWrap.contains(e.target)) {
      closeFilter();
    }
  };
  document.addEventListener("click", handleOutsideClick);

  // Wire Sort Menu toggle and selection
  if (sortTrigger && sortPopover) {
    sortTrigger.addEventListener("click", (e) => {
      e.stopPropagation();
      const isHidden = sortPopover.classList.contains("hidden");
      closeFilter();
      if (isHidden) {
        sortPopover.classList.remove("hidden");
        sortTrigger.setAttribute("aria-expanded", "true");
      } else {
        closeSort();
      }
    });

    sortPopover.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        closeSort();
        sortTrigger.focus();
      }
    });

    sortPopover.addEventListener("click", (e) => {
      const item = e.target.closest(".filter-popover-item");
      if (!item) return;
      const sortVal = item.getAttribute("data-sort");
      if (sortVal) {
        state.dashboardSort = sortVal;
        localStorage.setItem("canvas_dashboard_sort", sortVal);
        renderDashboardView();
      }
    });
  }

  // Wire Filter Menu toggle, tabs, unified search, and selection
  if (filterTrigger && filterPopover) {
    filterTrigger.addEventListener("click", (e) => {
      e.stopPropagation();
      const isHidden = filterPopover.classList.contains("hidden");
      closeSort();
      if (isHidden) {
        filterPopover.classList.remove("hidden");
        filterTrigger.setAttribute("aria-expanded", "true");
        if (filterSearchInput) {
          filterSearchInput.focus();
        }
      } else {
        closeFilter();
      }
    });

    filterPopover.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        closeFilter();
        filterTrigger.focus();
      }
    });

    // Tab switching: Departments vs Quarters
    if (tabDepts && tabQuarters && listDepts && listQuarters) {
      tabDepts.addEventListener("click", (e) => {
        e.stopPropagation();
        tabDepts.classList.add("active");
        tabQuarters.classList.remove("active");
        listDepts.classList.remove("hidden");
        listQuarters.classList.add("hidden");
      });

      tabQuarters.addEventListener("click", (e) => {
        e.stopPropagation();
        tabQuarters.classList.add("active");
        tabDepts.classList.remove("active");
        listQuarters.classList.remove("hidden");
        listDepts.classList.add("hidden");
      });
    }

    // Unified instant search across both tabs
    if (filterSearchInput && unifiedResults) {
      filterSearchInput.addEventListener("input", (e) => {
        const query = e.target.value.toLowerCase().trim();
        if (!query) {
          if (allCoursesItem) allCoursesItem.classList.remove("hidden");
          if (tabsBar) tabsBar.classList.remove("hidden");
          unifiedResults.classList.add("hidden");
          unifiedResults.innerHTML = "";
          const isQuarters = tabQuarters && tabQuarters.classList.contains("active");
          if (listDepts) listDepts.classList.toggle("hidden", isQuarters);
          if (listQuarters) listQuarters.classList.toggle("hidden", !isQuarters);
        } else {
          if (allCoursesItem) allCoursesItem.classList.add("hidden");
          if (tabsBar) tabsBar.classList.add("hidden");
          if (listDepts) listDepts.classList.add("hidden");
          if (listQuarters) listQuarters.classList.add("hidden");
          unifiedResults.classList.remove("hidden");

          const matchingDepts = availableDepts.filter(d => d.toLowerCase().includes(query));
          const matchingQuarters = availableQuarters.filter(t => t.toLowerCase().includes(query));
          const allMatches = "all courses".includes(query);

          let resHtml = "";

          if (allMatches) {
            resHtml += `
              <div class="filter-popover-item ${activeFilter === 'all' ? 'selected' : ''}" data-filter="all">
                <span class="filter-item-label">All Courses</span>
                <span class="filter-item-count">${courses.length}</span>
                ${activeFilter === 'all' ? `<span class="filter-item-check">${Icons.check || ""}</span>` : ''}
              </div>
            `;
          }

          if (matchingDepts.length > 0) {
            resHtml += `<div class="filter-search-group-header">Departments</div>`;
            matchingDepts.forEach(d => {
              resHtml += `
                <div class="filter-popover-item ${activeFilter === `dept:${d}` ? 'selected' : ''}" data-filter="dept:${escapeHtml(d)}">
                  <span class="filter-item-label">${escapeHtml(d)}</span>
                  <span class="filter-item-count">${deptCounts[d]}</span>
                  ${activeFilter === `dept:${d}` ? `<span class="filter-item-check">${Icons.check || ""}</span>` : ''}
                </div>
              `;
            });
          }

          if (matchingQuarters.length > 0) {
            resHtml += `<div class="filter-search-group-header">Quarters</div>`;
            matchingQuarters.forEach(t => {
              resHtml += `
                <div class="filter-popover-item ${activeFilter === `quarter:${t}` ? 'selected' : ''}" data-filter="quarter:${escapeHtml(t)}">
                  <span class="filter-item-label">${escapeHtml(t)}</span>
                  <span class="filter-item-count">${quarterCounts[t]}</span>
                  ${activeFilter === `quarter:${t}` ? `<span class="filter-item-check">${Icons.check || ""}</span>` : ''}
                </div>
              `;
            });
          }

          if (!allMatches && matchingDepts.length === 0 && matchingQuarters.length === 0) {
            resHtml = `<div class="filter-popover-no-results">No departments or quarters match "${escapeHtml(query)}"</div>`;
          }

          unifiedResults.innerHTML = resHtml;
        }
      });
    }

    // Filter selection via event delegation
    filterPopover.addEventListener("click", (e) => {
      const item = e.target.closest(".filter-popover-item");
      if (!item) return;
      const filterVal = item.getAttribute("data-filter");
      if (filterVal) {
        state.dashboardFilter = filterVal;
        if (filterVal === "all") {
          localStorage.removeItem("canvas_dashboard_filter");
        } else {
          localStorage.setItem("canvas_dashboard_filter", filterVal);
        }
        renderDashboardView();
      }
    });
  }

  // Wire clear filters buttons
  const clearFiltersBtn = els.viewDashboard.querySelector("#btn-dashboard-clear-filters");
  if (clearFiltersBtn) {
    clearFiltersBtn.addEventListener("click", () => {
      state.dashboardSearch = "";
      state.dashboardFilter = "all";
      localStorage.removeItem("canvas_dashboard_filter");
      renderDashboardView();
    });
  }

  const emptyResetBtn = els.viewDashboard.querySelector("#btn-dashboard-empty-reset");
  if (emptyResetBtn) {
    emptyResetBtn.addEventListener("click", () => {
      state.dashboardSearch = "";
      state.dashboardFilter = "all";
      localStorage.removeItem("canvas_dashboard_filter");
      renderDashboardView();
    });
  }

  // Wire add course button
  const addCourseBtn = els.viewDashboard.querySelector("#btn-dashboard-add-course");
  if (addCourseBtn) {
    addCourseBtn.addEventListener("click", () => switchView("launcher"));
  }

  // Wire card click actions
  els.viewDashboard.querySelectorAll(".course-card").forEach(card => {
    const courseName = card.dataset.courseName;
    card.addEventListener("click", async (e) => {
      if (e.target.closest("button")) return;
      if (state.currentCourse !== courseName) {
        els.courseSelector.value = courseName;
        await selectCourse(courseName);
      }
      switchView("canvas");
    });
  });

  // Wire buttons inside cards
  els.viewDashboard.querySelectorAll("[data-action]").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const action = btn.dataset.action;
      const courseName = btn.dataset.courseName;
      const coursePath = btn.dataset.coursePath;

      if (action === "quick-reveal") {
        const target = courseName || state.currentCourse;
        if (target) {
          openFileInSystem(".", "reveal", target);
        }
        return;
      }

      if (courseName && state.currentCourse !== courseName) {
        els.courseSelector.value = courseName;
        await selectCourse(courseName);
      }

      if (action === "open-course") {
        switchView("canvas");
      } else if (action === "quick-modules") {
        state.activeCanvasTab = "modules";
        switchView("canvas");
        renderCanvasView();
      } else if (action === "quick-files") {
        switchView("folders");
      } else if (action === "quick-timeline") {
        switchView("timeline");
      }
    });
  });
}

// 1. Render Sidebar for Canvas LMS
function renderSidebar() {
  if (!state.courseData) return;
  const d = state.courseData;
  const hasDiscussions = (d.discussions && d.discussions.length > 0) || !!d.syllabus?.structured;
  const tabs = [
    { id: "modules", label: "Modules", icon: Icons.modules, count: d.modules?.length },
    { id: "announcements", label: "Announcements", icon: Icons.announcements, count: d.announcements?.length },
    { id: "assignments", label: "Assignments", icon: Icons.assignments, count: d.assignments?.length },
    { id: "discussions", label: "Discussions", icon: Icons.discussions, count: d.discussions?.length || (hasDiscussions ? 1 : undefined) },
    { id: "media", label: "Zoom & Recordings", icon: Icons.video },
    { id: "syllabus", label: "Syllabus", icon: Icons.syllabus },
    { id: "grades", label: "Grades", icon: Icons.grades }
  ];

  els.sidebarNavList.innerHTML = "";
  tabs.forEach(t => {
    const item = document.createElement("a");
    item.className = `course-sidebar-item ${state.activeCanvasTab === t.id ? "active" : ""}`;
    item.innerHTML = `
      <span class="item-icon">${t.icon}</span>
      <span>${t.label}</span>
      ${t.count !== undefined ? `<span class="sidebar-badge">${t.count}</span>` : ""}
    `;
    item.addEventListener("click", () => {
      state.activeCanvasTab = t.id;
      els.currentPageLabel.textContent = t.label;
      renderSidebar();
      renderCanvasView();
    });
    els.sidebarNavList.appendChild(item);
  });
}

// 2. Render Canvas View Body

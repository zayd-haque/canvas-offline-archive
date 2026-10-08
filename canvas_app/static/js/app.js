// --- Module: 00_core.js ---
// Canvas Course Offline Archive Web App Logic

const state = {
  courses: [],
  currentCourse: "",
  courseData: null,
  folderData: null,
  activeView: "dashboard", // dashboard | canvas | timeline | folders
  activeCanvasTab: "modules", // modules | announcements | assignments | syllabus | grades
  activeFile: null,
  moduleSearch: "",
  dashboardSearch: "",
  courseMetadataCache: {},
  timelineFilter: "all",
  folderSearch: "",
  collapsedModules: new Set(),
  expandedAnnouncements: new Set(),
  settings: {
    defaultAction: "browser", // "browser" or "preview"
    theme: "light",          // "light", "dark", or "system"
    accentColor: "#005587",
    autoFullscreen: false,
    startupView: "dashboard", // "dashboard", "canvas", "timeline"
    fontScale: 100,           // 80 to 130 (%)
    readerFontSize: "15px",   // "13px", "15px", "17px"
    pdfDefaultZoom: "page-width", // "page-width", "page-fit", "100"
    geminiTier: "paid",       // "paid" or "free"
    aiProvider: "gemini",
    ollamaModel: "qwen2.5:7b",
    headless: true,
    terminalAutoscroll: true,
    ingestionCategories: null,
    searchDirectories: ["~/Desktop", "~/Documents", "~/Downloads"],
    defaultCourseDir: "~/Desktop",
    hierarchy: {
      preset: "standard",
      lecturesFolder: "{course} Lectures & Resources",
      enableWorkFolder: true,
      workFolder: "{course} Work",
      timelineFile: "{course} Assignments_and_Milestones_Timeline.md",
      categorizationStyle: "standard",
      prefixSubfolders: false,
      mainFolders: [
        { id: "main_lectures", name: "{course} Lectures & Resources", role: "study_materials" },
        { id: "main_work", name: "{course} Work", role: "student_work" }
      ],
      customFolders: [
        { id: "folder_slides", name: "Lecture Slides", parent: "study_materials", types: ["slides", "lectures"] },
        { id: "folder_solutions", name: "Homework Solutions", parent: "study_materials", types: ["solutions", "keys"] },
        { id: "folder_worksheets", name: "Discussion Worksheets", parent: "study_materials", types: ["discussions", "worksheets"] },
        { id: "folder_exams", name: "Exams & Quizzes", parent: "study_materials", types: ["exams", "quizzes"] },
        { id: "folder_syllabus", name: "Syllabus & Admin", parent: "study_materials", types: ["syllabus", "admin"] },
        { id: "folder_other", name: "Other Materials", parent: "study_materials", types: ["other", "reference"] },
        { id: "folder_assignments", name: "Assignments", parent: "student_work", types: ["assignments", "homework"] },
        { id: "folder_quizzes", name: "Quizzes", parent: "student_work", types: ["student_quizzes"] }
      ]
    }
  },
  // Spotlight & Live Search State
  search: {
    query: "",
    isOpen: false,
    isDropdownOpen: false,
    dropdownSelectedIndex: -1,
    activeFilter: "all",
    results: [],
    curriculumMatches: [],
    selectedIndex: 0,
    loading: false
  },
  previousCourseView: "canvas",
  // File Preview Navigation State
  previewFileList: [],
  previewCurrentIndex: -1
};

// DOM Elements
const els = {
  globalLogo: document.getElementById("global-logo"),
  globalLogoBtn: document.getElementById("global-logo-btn"),
  courseSelector: document.getElementById("course-selector"),
  courseSelectorWrapper: document.getElementById("course-selector-wrapper"),
  breadcrumbSep: document.getElementById("breadcrumb-sep"),
  currentPageLabel: document.getElementById("current-page-label"),
  courseSidebar: document.getElementById("course-sidebar"),
  sidebarNavList: document.getElementById("sidebar-nav-list"),
  mainContentPanel: document.getElementById("main-content-panel"),
  viewDashboard: document.getElementById("view-dashboard-container"),
  viewCanvas: document.getElementById("view-canvas-container"),
  viewTimeline: document.getElementById("view-timeline-container"),
  viewFolders: document.getElementById("view-folders-container"),
  viewSearch: document.getElementById("view-search-container"),
  viewLauncher: document.getElementById("view-launcher"),
  viewRescan: document.getElementById("view-rescan"),
  // Tabs & Nav
  navDashboard: document.getElementById("nav-btn-dashboard"),
  iconNavDashboard: document.getElementById("icon-nav-dashboard"),
  tabCanvas: document.getElementById("tab-canvas-view"),
  tabTimeline: document.getElementById("tab-timeline-view"),
  tabFolders: document.getElementById("tab-folders-view"),
  navCanvas: document.getElementById("nav-btn-canvas"),
  navTimeline: document.getElementById("nav-btn-timeline"),
  navFolders: document.getElementById("nav-btn-folders"),
  navLauncher: document.getElementById("nav-btn-launcher"),
  iconNavLauncher: document.getElementById("icon-nav-launcher"),
  navRescan: document.getElementById("nav-btn-rescan"),
  iconNavRescan: document.getElementById("icon-nav-rescan"),

  // Modal
  previewModal: document.getElementById("file-preview-modal"),
  previewIframe: document.getElementById("preview-iframe"),
  previewFileName: document.getElementById("preview-file-name"),
  previewFileSize: document.getElementById("preview-file-size"),
  previewFolderBadge: document.getElementById("preview-folder-badge"),
  previewFileIcon: document.getElementById("preview-file-icon"),
  btnOpenMac: document.getElementById("btn-open-mac"),
  btnRevealFinder: document.getElementById("btn-reveal-finder"),
  btnOpenTab: document.getElementById("btn-open-tab"),
  btnToggleFullscreen: document.getElementById("btn-toggle-fullscreen"),
  previewModalContainer: document.querySelector(".preview-modal-container"),
  previewCustomContent: document.getElementById("preview-custom-content"),
  btnCloseModal: document.getElementById("btn-close-modal"),
  // Preview Navigation Elements
  btnPreviewPrev: document.getElementById("btn-preview-prev"),
  btnPreviewNext: document.getElementById("btn-preview-next"),
  previewIndexCounter: document.getElementById("preview-index-counter"),
  floatingPreviewPrev: document.getElementById("floating-preview-prev"),
  floatingPreviewNext: document.getElementById("floating-preview-next"),
  // Settings Elements
  navSettings: document.getElementById("nav-btn-settings"),
  settingsModal: document.getElementById("settings-modal"),
  btnCloseSettings: document.getElementById("btn-close-settings"),
  btnSaveSettings: document.getElementById("btn-save-settings"),
  settingAutoFullscreen: document.getElementById("setting-auto-fullscreen"),
  iconNavSettings: document.getElementById("icon-nav-settings"),
  settingsHeaderIcon: document.getElementById("settings-header-icon"),
  iconCloseSettings: document.getElementById("icon-close-settings"),
  iconThemeLight: document.getElementById("icon-theme-light"),
  iconThemeDark: document.getElementById("icon-theme-dark"),
  // Header Index Progress Elements
  indexStatusContainer: document.getElementById("index-status-container"),
  indexProgressBtn: document.getElementById("index-progress-btn"),
  indexDetailsPopover: document.getElementById("index-details-popover"),
  indexPopoverBackdrop: document.getElementById("index-popover-backdrop"),
  btnCloseIndexPopover: document.getElementById("btn-close-index-popover"),
  indexStatusIndicator: document.getElementById("index-status-indicator"),
  indexStatusTitle: document.getElementById("index-status-title"),
  indexStatusPct: document.getElementById("index-status-pct"),
  indexMiniBarFill: document.getElementById("index-mini-bar-fill"),
  indexPopoverDot: document.getElementById("index-popover-dot"),
  indexStateBadge: document.getElementById("index-state-badge"),
  indexDetailFiles: document.getElementById("index-detail-files"),
  indexDetailOcr: document.getElementById("index-detail-ocr"),
  indexDetailOcrPages: document.getElementById("index-detail-ocr-pages"),
  indexDetailFileRow: document.getElementById("index-detail-file-row"),
  indexDetailCurrentFile: document.getElementById("index-detail-current-file"),
  btnTriggerReindex: document.getElementById("btn-trigger-reindex"),
  // Spotlight Search Elements
  headerSearchBar: document.getElementById("header-search-bar"),
  headerSearchDropdown: document.getElementById("header-search-dropdown"),
  globalSearchInput: document.getElementById("global-search-input"),
  searchClearBtn: document.getElementById("search-clear-btn"),
  iconHeaderSearch: document.getElementById("icon-header-search"),
  searchModal: document.getElementById("search-modal"),
  searchPopover: document.getElementById("search-popover"),
  spotlightSearchInput: document.getElementById("spotlight-search-input"),
  spotlightClearBtn: document.getElementById("spotlight-clear-btn"),
  iconSpotlightSearch: document.getElementById("icon-spotlight-search"),
  btnSpotlightClose: document.getElementById("btn-spotlight-close"),
  searchFilterChips: document.getElementById("search-filter-chips"),
  searchModalContent: document.getElementById("search-modal-content"),
  searchLoadingState: document.getElementById("search-loading-state"),
  curriculumMatchContainer: document.getElementById("curriculum-match-container"),
  searchResultsList: document.getElementById("search-results-list"),
  searchEmptyState: document.getElementById("search-empty-state"),
  searchNoResults: document.getElementById("search-no-results"),
  searchNoResultsDesc: document.getElementById("search-no-results-desc"),
  searchFooterStats: document.getElementById("search-footer-stats"),
  searchEmptyIcon: document.getElementById("search-empty-icon"),
  searchNoResultsIcon: document.getElementById("search-no-results-icon")
};

function formatHierarchyFolder(template, courseName) {
  if (!template || typeof template !== "string") return courseName || "";
  const name = (courseName && courseName.trim()) || (typeof state !== "undefined" && state.currentCourse && state.currentCourse.trim()) || "Course";
  return template.replace(/\{course\}/gi, name).trim();
}

function normalizeDocPath(p) {
  if (!p || typeof p !== "string") return "";
  let clean = p.trim();
  // Unescape HTML entities
  clean = clean.replace(/&amp;/g, "&")
               .replace(/&lt;/g, "<")
               .replace(/&gt;/g, ">")
               .replace(/&quot;/g, '"')
               .replace(/&#039;/g, "'");
  // Decode percent-encoded URI components safely
  try {
    if (/%[0-9a-fA-F]{2}/.test(clean)) {
      clean = decodeURIComponent(clean);
    }
  } catch {}
  // Normalize slashes and remove leading ./ or /
  clean = clean.replace(/\\/g, "/").replace(/^\.?\/+/, "").replace(/\/+/g, "/");
  return clean;
}

// Initialize App

// --- Module: 01_navigation.js ---
async function loadCourseList() {
  try {
    const res = await fetch("/api/courses");
    const data = await res.json();
    state.courses = data.courses || [];

    els.courseSelector.innerHTML = "";
    if (state.courses.length === 0) {
      ++courseLoadGeneration;
      if (courseLoadController) courseLoadController.abort();
      state.currentCourse = null;
      state.courseData = null;
      state.folderData = null;
      stopHeaderIndexPolling();
      stopSearchStatusPolling();
      els.courseSelector.innerHTML = `<option value="">No courses cataloged</option>`;
      switchView("dashboard");
      return;
    }

    state.courses.forEach((c) => {
      const opt = document.createElement("option");
      opt.value = c.name;
      opt.textContent = `${c.name} (${c.stats.files || 0} files)`;
      els.courseSelector.appendChild(opt);
    });

    // [Codex] Preserve user selection across refreshes without course-specific defaults.
    const defaultCourse = state.courses.find(c => c.name === state.currentCourse) || state.courses[0];
    els.courseSelector.value = defaultCourse.name;
    await selectCourse(defaultCourse.name);

    const startup = state.settings?.startupView || "dashboard";
    if (startup === "canvas" && defaultCourse) {
      switchView("canvas");
    } else if (startup === "timeline" && defaultCourse) {
      switchView("timeline");
    } else {
      switchView("dashboard");
    }
  } catch (err) {
    console.error("Failed to load courses:", err);
  }
}

let courseLoadGeneration = 0;
let courseLoadController = null;

async function selectCourse(courseName) {
  if (!courseName) return;
  const generation = ++courseLoadGeneration;
  if (courseLoadController) courseLoadController.abort();
  const controller = new AbortController();
  courseLoadController = controller;
  stopSearchStatusPolling();
  stopHeaderIndexPolling();
  closeIndexDetailsPopover();
  if (currentSearchAbortController) currentSearchAbortController.abort();
  clearTimeout(searchDebounceTimer);
  closeSearchDropdown();
  closePreviewModal();
  state.search.results = [];
  state.search.curriculumMatches = [];
  state.search.query = "";
  state.search.loading = false;
  state.search.selectedIndex = 0;
  state.search.activeFilter = "all";
  for (const input of [els.globalSearchInput, els.spotlightSearchInput]) {
    if (input) input.value = "";
  }
  for (const button of [els.searchClearBtn, els.spotlightClearBtn]) {
    if (button) button.classList.add("hidden");
  }
  state.courseData = null;
  state.folderData = null;
  for (const panel of [els.viewCanvas, els.viewTimeline, els.viewFolders, els.viewSearch, els.sidebarNavList]) {
    if (panel) panel.innerHTML = "";
  }
  state.currentCourse = courseName;
  state.headerIndexStatus = null;
  resetHeaderIndexProgressUI();
  if (state.search.isOpen) closeSearchModal();

  try {
    const [blueprintRes, foldersRes] = await Promise.all([
      fetch(`/api/courses/${encodeURIComponent(courseName)}`, { signal: controller.signal }),
      fetch(`/api/courses/${encodeURIComponent(courseName)}/folders`, { signal: controller.signal })
    ]);

    if (!blueprintRes.ok || !foldersRes.ok) throw new Error("Failed to load course details");
    const [courseData, folderData] = await Promise.all([blueprintRes.json(), foldersRes.json()]);
    if (generation !== courseLoadGeneration || controller.signal.aborted) return;
    state.courseData = courseData;
    state.folderData = folderData;

    renderSidebar();
    renderCurrentView();
    if (state.activeView !== "dashboard") {
      startHeaderIndexPolling(true);
    }
  } catch (err) {
    if (err.name !== "AbortError" && generation === courseLoadGeneration) console.error("Failed to load course details:", err);
  }
}

// Switch between Dashboard, Canvas LMS, Timeline, Folders, Search
function switchView(viewName) {
  if (viewName !== "search" && viewName !== "dashboard" && viewName !== "launcher" && viewName !== "rescan") {
    state.previousCourseView = viewName;
  }
  state.activeView = viewName;

  [els.tabCanvas, els.tabTimeline, els.tabFolders].forEach(el => el && el.classList.remove("active"));
  [els.navDashboard, els.navCanvas, els.navTimeline, els.navFolders, els.navLauncher, els.navRescan].forEach(el => el && el.classList.remove("active"));

  const isGlobalView = viewName === "dashboard" || viewName === "launcher" || viewName === "rescan";
  if (els.courseSelectorWrapper) els.courseSelectorWrapper.style.display = isGlobalView ? "none" : "";
  if (els.breadcrumbSep) els.breadcrumbSep.style.display = isGlobalView ? "none" : "";

  if (viewName === "dashboard") {
    if (els.navDashboard) els.navDashboard.classList.add("active");
    els.courseSidebar.style.display = "none";
    els.currentPageLabel.textContent = "Dashboard";
    if (els.indexStatusContainer) {
      els.indexStatusContainer.style.display = "none";
      els.indexStatusContainer.classList.add("hidden");
    }
    closeIndexDetailsPopover();
    stopHeaderIndexPolling();
  } else if (viewName === "launcher") {
    if (els.navLauncher) els.navLauncher.classList.add("active");
    els.courseSidebar.style.display = "none";
    els.currentPageLabel.textContent = "Add Course";
    if (els.indexStatusContainer) {
      els.indexStatusContainer.style.display = "none";
      els.indexStatusContainer.classList.add("hidden");
    }
    closeIndexDetailsPopover();
    stopHeaderIndexPolling();
  } else if (viewName === "rescan") {
    if (els.navRescan) els.navRescan.classList.add("active");
    els.courseSidebar.style.display = "none";
    els.currentPageLabel.textContent = "Rescan & Maintain Course";
    if (els.indexStatusContainer) {
      els.indexStatusContainer.style.display = "none";
      els.indexStatusContainer.classList.add("hidden");
    }
    closeIndexDetailsPopover();
    stopHeaderIndexPolling();
  } else if (viewName === "canvas") {
    if (els.tabCanvas) els.tabCanvas.classList.add("active");
    if (els.navCanvas) els.navCanvas.classList.add("active");
    els.courseSidebar.style.display = "block";
    els.currentPageLabel.textContent = capitalize(state.activeCanvasTab);
    if (els.indexStatusContainer) {
      els.indexStatusContainer.style.display = "flex";
      els.indexStatusContainer.classList.remove("hidden");
    }
    startHeaderIndexPolling(true);
  } else if (viewName === "timeline") {
    if (els.tabTimeline) els.tabTimeline.classList.add("active");
    if (els.navTimeline) els.navTimeline.classList.add("active");
    els.courseSidebar.style.display = "none";
    els.currentPageLabel.textContent = "Quarter Timeline";
    if (els.indexStatusContainer) {
      els.indexStatusContainer.style.display = "flex";
      els.indexStatusContainer.classList.remove("hidden");
    }
    startHeaderIndexPolling(true);
  } else if (viewName === "folders") {
    if (els.tabFolders) els.tabFolders.classList.add("active");
    if (els.navFolders) els.navFolders.classList.add("active");
    els.courseSidebar.style.display = "none";
    els.currentPageLabel.textContent = "Desktop Folder Explorer";
    if (els.indexStatusContainer) {
      els.indexStatusContainer.style.display = "flex";
      els.indexStatusContainer.classList.remove("hidden");
    }
    startHeaderIndexPolling(true);
  } else if (viewName === "search") {
    els.courseSidebar.style.display = "none";
    els.currentPageLabel.textContent = "Search Results";
    if (els.indexStatusContainer) {
      els.indexStatusContainer.style.display = "flex";
      els.indexStatusContainer.classList.remove("hidden");
    }
    startHeaderIndexPolling(true);
  }

  renderCurrentView();
}

function renderCurrentView() {
  if (els.viewDashboard) els.viewDashboard.style.display = state.activeView === "dashboard" ? "block" : "none";
  if (els.viewCanvas) els.viewCanvas.style.display = state.activeView === "canvas" ? "block" : "none";
  if (els.viewTimeline) els.viewTimeline.style.display = state.activeView === "timeline" ? "block" : "none";
  if (els.viewFolders) els.viewFolders.style.display = state.activeView === "folders" ? "block" : "none";
  if (els.viewSearch) els.viewSearch.style.display = state.activeView === "search" ? "block" : "none";
  if (els.viewLauncher) {
    els.viewLauncher.style.display = state.activeView === "launcher" ? "block" : "none";
    if (state.activeView === "launcher") {
      els.viewLauncher.classList.remove("hidden");
    }
  }
  if (els.viewRescan) {
    els.viewRescan.style.display = state.activeView === "rescan" ? "block" : "none";
    if (state.activeView === "rescan") {
      els.viewRescan.classList.remove("hidden");
    }
  }

  if (state.activeView === "dashboard") {
    renderDashboardView();
  } else if (state.activeView === "launcher") {
    if (typeof renderLauncherView === "function") renderLauncherView();
  } else if (state.activeView === "rescan") {
    if (typeof renderRescanView === "function") renderRescanView();
  } else if (state.activeView === "canvas") {
    renderCanvasView();
  } else if (state.activeView === "timeline") {
    renderTimelineView();
  } else if (state.activeView === "folders") {
    renderFoldersView();
  } else if (state.activeView === "search") {
    renderSearchResultsView();
  }
}


// Deterministic Gradient Generator for Course Cards

// --- Module: 02_dashboard.js ---
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

// --- Module: 03_modules.js ---
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

// --- Module: 04_announcements.js ---
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

// --- Module: 05_assignments.js ---
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

// --- Module: 06_syllabus.js ---
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

// --- Module: 07_grades.js ---
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

// --- Module: 08_timeline.js ---
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

// --- Module: 09_folders.js ---
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

// --- Module: 10_preview.js ---
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

// --- Module: 11_settings.js ---
function initSettings() {
  try {
    const saved = localStorage.getItem("canvas_course_settings");
    if (saved) {
      const parsed = JSON.parse(saved);
      state.settings = { ...state.settings, ...parsed };
    }
  } catch (e) {
    console.warn("Failed to load settings from localStorage:", e);
  }
  initExtendedSettings();
  applySettings(state.settings);
  loadHierarchySettings();
}

function applyTheme(themeVal) {
  let themeToApply = themeVal || "light";
  if (themeToApply === "system") {
    themeToApply = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  document.documentElement.setAttribute("data-theme", themeToApply);
  document.body.classList.toggle("dark-mode", themeToApply === "dark");
}

function applyAccent(accentColor) {
  if (accentColor) {
    document.documentElement.style.setProperty("--canvas-blue", accentColor);
    document.documentElement.style.setProperty("--canvas-active-accent", accentColor);
    document.documentElement.style.setProperty("--canvas-accent", accentColor);
  }
}

function saveSettingsToStorage() {
  try {
    localStorage.setItem("canvas_course_settings", JSON.stringify(state.settings));
  } catch (e) {
    console.warn("Failed to persist settings:", e);
  }
}

// React to OS system dark/light mode switches dynamically when 'system' is selected
if (window.matchMedia) {
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", (e) => {
    if (state.settings && state.settings.theme === "system") {
      document.documentElement.setAttribute("data-theme", e.matches ? "dark" : "light");
      document.body.classList.toggle("dark-mode", e.matches);
    }
  });
}

function applyGlobalFontScale(scaleVal) {
  const scale = Number(scaleVal) || 100;
  const basePx = Math.round(14 * (scale / 100));
  const readerPx = Math.round(15 * (scale / 100));
  document.documentElement.style.setProperty("--global-font-scale", `${scale}%`);
  document.documentElement.style.setProperty("--global-font-size", `${basePx}px`);
  document.documentElement.style.setProperty("--preview-font-scale", `${readerPx}px`);
  document.documentElement.style.fontSize = `${scale}%`;
  if (els.previewCustomContent) {
    els.previewCustomContent.style.fontSize = `${readerPx}px`;
  }
  const display = document.getElementById("font-scale-display");
  if (display) {
    display.textContent = `${scale}%${scale === 100 ? " (Default)" : scale > 100 ? ` (+${scale - 100}%)` : ` (${scale - 100}%)`}`;
  }
  const slider = document.getElementById("setting-font-scale");
  if (slider && Number(slider.value) !== scale) {
    slider.value = scale;
  }
}

function applySettings(s) {
  applyTheme(s.theme);
  applyAccent(s.accentColor);
  applyGlobalFontScale(s.fontScale || 100);
  syncSettingsUI();
}

function syncSettingsUI() {
  const s = state.settings;
  const aiProv = document.getElementById("settings-ai-provider");
  if (aiProv) aiProv.value = s.aiProvider;
  const ollamaMod = document.getElementById("settings-ollama-model");
  if (ollamaMod) ollamaMod.value = s.ollamaModel;
  const headlessEl = document.getElementById("settings-headless");
  if (headlessEl) headlessEl.checked = s.headless;
  const autoscrollEl = document.getElementById("settings-autoscroll");
  if (autoscrollEl) autoscrollEl.checked = s.terminalAutoscroll;
  document.querySelectorAll("[data-settings-category]").forEach(el => { el.checked = (s.ingestionCategories || []).includes(el.dataset.settingsCategory); });

  // Default action radio
  const rad = document.querySelector(`input[name="defaultAction"][value="${s.defaultAction}"]`);
  if (rad) rad.checked = true;

  // Startup view radio
  const radStartup = document.querySelector(`input[name="startupView"][value="${s.startupView || 'dashboard'}"]`);
  if (radStartup) radStartup.checked = true;

  // Theme pills
  document.querySelectorAll(".theme-pill-btn[data-theme-val]").forEach(btn => {
    btn.classList.toggle("active", btn.getAttribute("data-theme-val") === s.theme);
  });

  // Color swatches
  document.querySelectorAll(".color-swatch-btn").forEach(btn => {
    btn.classList.toggle("active", btn.getAttribute("data-accent") === s.accentColor);
  });

  // Auto Fullscreen toggle
  if (els.settingAutoFullscreen) {
    els.settingAutoFullscreen.checked = !!s.autoFullscreen;
  }

  // Global font scale slider & display
  const fontSlider = document.getElementById("setting-font-scale");
  if (fontSlider) fontSlider.value = s.fontScale || 100;
  const fontDisp = document.getElementById("font-scale-display");
  if (fontDisp) {
    const sc = s.fontScale || 100;
    fontDisp.textContent = `${sc}%${sc === 100 ? " (Default)" : sc > 100 ? ` (+${sc - 100}%)` : ` (${sc - 100}%)`}`;
  }

  // PDF Default Zoom
  const pdfZoomEl = document.getElementById("settings-pdf-zoom");
  if (pdfZoomEl) pdfZoomEl.value = s.pdfDefaultZoom || "page-width";

  // Gemini Tier radio cards
  const radTier = document.querySelector(`input[name="settingsGeminiTier"][value="${s.geminiTier || 'paid'}"]`);
  if (radTier) radTier.checked = true;
  const cardPaid = document.getElementById("card-tier-paid");
  const cardFree = document.getElementById("card-tier-free");
  if (cardPaid) cardPaid.classList.toggle("selected", (s.geminiTier || "paid") === "paid");
  if (cardFree) cardFree.classList.toggle("selected", (s.geminiTier || "paid") === "free");

  populateSettingsCourseSelector();
  syncDirectoriesUI();
}

function openSettingsModal(section = "general") {
  if (typeof section !== "string" || !["general", "ingestion", "directories", "search"].includes(section)) {
    section = "general";
  }
  settingsReturnFocus = document.activeElement;
  ++settingsRequestGeneration;
  syncSettingsUI();
  if (els.settingsModal) els.settingsModal.classList.remove("hidden");
  document.getElementById("settings-launcher-status").textContent = "";

  document.querySelectorAll("[data-settings-section]").forEach(b => {
    const match = b.dataset.settingsSection === section;
    b.classList.toggle("active", match);
    b.setAttribute("aria-pressed", String(match));
  });
  document.querySelectorAll("[data-settings-panel]").forEach(panel => {
    panel.classList.toggle("hidden", panel.dataset.settingsPanel !== section);
  });

  loadGeminiKeyStatus();
  loadDirectoriesSettings();
  loadHierarchySettings();
  refreshSettingsIndex();
  probeOllamaStatus();
  refreshCacheStatus();
  els.btnCloseSettings?.focus();
}

function closeSettingsModal() {
  ++settingsRequestGeneration;
  ++settingsIndexGeneration;
  if (els.settingsModal) els.settingsModal.classList.add("hidden");
  const input = document.getElementById("settings-gemini-key");
  input.value = "";
  input.type = "password";
  const reveal = document.getElementById("settings-key-reveal");
  reveal.textContent = "Show";
  reveal.setAttribute("aria-pressed", "false");
  if (typeof launcherState !== "undefined" && state.activeView === "launcher" && typeof renderLauncherView === "function") {
    renderLauncherView();
  }
  if (typeof rescanState !== "undefined" && state.activeView === "rescan" && typeof renderRescanView === "function") {
    renderRescanView();
  }
  settingsReturnFocus?.focus();
}

function saveSettingsFromUI() {
  saveSettingsToStorage();
  closeSettingsModal();
}

// [Codex] Persist non-secret preferences; credential updates use a dedicated API.
let settingsReturnFocus = null;
let settingsRequestGeneration = 0;
let settingsKeySaving = false;

function applyLauncherDefaults() {
  if (launcherState.isIngesting) return false;
  launcherState.aiProvider = state.settings.aiProvider;
  launcherState.ollamaModel = state.settings.ollamaModel;
  launcherState.headless = state.settings.headless;
  launcherState.categories = new Set(state.settings.ingestionCategories || LAUNCHER_CATEGORIES.map(c => c.id));
  if (state.activeView === "launcher") renderLauncherView();
  return true;
}

function populateSettingsCourseSelector() {
  const select = document.getElementById("settings-course-select");
  if (!select) return;
  const courses = state.courses || [];
  const current = select.value || state.currentCourse || (courses[0]?.name || "");
  select.innerHTML = courses.length ? "" : `<option value="">No courses found</option>`;
  courses.forEach(c => {
    const opt = document.createElement("option");
    opt.value = c.name;
    opt.textContent = `${c.name} (${c.stats?.files || 0} files)`;
    select.appendChild(opt);
  });
  if (current && courses.some(c => c.name === current)) {
    select.value = current;
  }
}

async function refreshCacheStatus() {
  const statusEl = document.getElementById("settings-cache-status");
  if (!statusEl) return;
  try {
    const res = await fetch("/api/settings/cache-status");
    if (!res.ok) throw new Error();
    const data = await res.json();
    statusEl.textContent = data.preview_available
      ? `${data.formatted_size || '0 KB'} (${data.file_count || 0} slide decks cached locally)`
      : 'Quick Look slide previews are available on macOS only. Files can still open in your default app.';
  } catch {
    statusEl.textContent = "Slide preview cache status is unavailable.";
  }
}

async function clearCacheAction() {
  const btn = document.getElementById("settings-cache-clear");
  const statusEl = document.getElementById("settings-cache-status");
  if (btn) btn.disabled = true;
  if (statusEl) statusEl.textContent = "Clearing slide preview cache…";
  try {
    const res = await fetch("/api/settings/cache-clear", { method: "POST" });
    if (!res.ok) throw new Error();
    const data = await res.json();
    if (statusEl) statusEl.textContent = `Cache cleared: freed ${data.freed_size || '0 KB'}.`;
  } catch {
    if (statusEl) statusEl.textContent = "Cache clear request processed.";
  } finally {
    if (btn) btn.disabled = false;
    setTimeout(refreshCacheStatus, 1200);
  }
}

async function probeOllamaStatus() {
  const badge = document.getElementById("settings-ollama-badge");
  const text = document.getElementById("settings-ollama-status-text");
  if (!badge || !text) return;
  try {
    const res = await fetch("/api/settings/ollama-status");
    if (!res.ok) throw new Error();
    const data = await res.json();
    if (data.running) {
      badge.textContent = "Online (Port 11434)";
      badge.style.background = "rgba(16, 185, 129, 0.2)";
      badge.style.color = "#10B981";
      const models = (data.installed_models || []).join(", ");
      text.textContent = models ? `Installed models: ${models}` : "Ollama is running (no models found).";
    } else {
      badge.textContent = "Offline";
      badge.style.background = "rgba(239, 68, 68, 0.2)";
      badge.style.color = "#EF4444";
      text.textContent = "Ollama is not running. Add Course will use Gemini Cloud or Keyword rules.";
    }
  } catch {
    badge.textContent = "Local Port 11434";
    badge.style.background = "rgba(148, 163, 184, 0.15)";
    badge.style.color = "var(--text-muted)";
    text.textContent = "Ollama runs on http://localhost:11434. Add Course detects models automatically.";
  }
}

// ==========================================================================
// Course Discovery Directories & Storage Roots Management
// ==========================================================================

function normalizeDirList(dirs) {
  if (!Array.isArray(dirs)) return ["~/Desktop"];
  const cleaned = dirs.map(d => typeof d === "string" ? d.trim() : "").filter(Boolean);
  return Array.from(new Set(cleaned));
}

async function loadDirectoriesSettings() {
  try {
    const res = await fetch("/api/settings/directories");
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.search_dirs)) {
        state.settings.searchDirectories = data.search_dirs;
      }
      if (data.default_dir) {
        state.settings.defaultCourseDir = data.default_dir;
      }
      saveSettingsToStorage();
    }
  } catch {
    // Graceful offline fallback to localStorage
  }
  syncDirectoriesUI();
  if (state.courses?.length === 0 && state.activeView === "dashboard") renderDashboardView();
}

function syncDirectoriesUI() {
  if (!state.settings) return;
  const dirs = normalizeDirList(state.settings.searchDirectories);
  state.settings.searchDirectories = dirs;
  const defaultDir = state.settings.defaultCourseDir || dirs[0] || "~/Desktop";
  state.settings.defaultCourseDir = defaultDir;

  // Badge count
  const badge = document.getElementById("directories-course-count-badge");
  if (badge) {
    const count = (state.courses && state.courses.length) || 0;
    badge.textContent = `${count} Course${count === 1 ? "" : "s"} Cataloged`;
  }

  // Tree diagram root preview
  const treeRoot = document.getElementById("preview-tree-root");
  if (treeRoot) {
    treeRoot.textContent = defaultDir || "Course Root Directory";
  }
  renderHierarchyTreePreview();

  // Render directory list
  const listEl = document.getElementById("settings-directories-list");
  if (listEl) {
    if (!dirs.length) {
      listEl.innerHTML = `
        <div style="padding:14px; text-align:center; color:var(--text-muted); font-size:12.5px; border:1px dashed var(--border-color); border-radius:8px;">
          No course root directories configured. Add or browse for a directory below.
        </div>
      `;
    } else {
      listEl.innerHTML = dirs.map(dir => {
        const matchingCount = (state.courses || []).filter(c => {
          const p = c.path || "";
          const resolvedRoot = dir.replace(/^~/, "");
          return p.includes(resolvedRoot);
        }).length;
        const countDesc = matchingCount > 0
          ? `${matchingCount} course${matchingCount === 1 ? "" : "s"} active`
          : `<span style="color:#F59E0B;">0 courses found</span>`;

        return `
          <div class="directory-item-card">
            <div class="directory-info-col">
              <div class="directory-path-text">
                <span style="font-size:15px;">📂</span>
                <span>${escapeHtml(dir)}</span>
              </div>
              <div class="directory-meta-row">
                <span class="directory-tag tag-search">Scan Root</span>
                <span>•</span>
                <span>${countDesc}</span>
              </div>
            </div>
            <div class="directory-actions-col">
              <button type="button" class="settings-button" data-action="set-default-dir" data-dir="${escapeHtml(dir)}" style="padding:4px 10px; font-size:11.5px;" title="${dir === defaultDir ? 'New courses are saved in this folder' : 'Save new courses in this folder'}" ${dir === defaultDir ? 'disabled aria-current="true"' : ''}>${dir === defaultDir ? 'Default' : 'Set Default'}</button>
              <button type="button" class="settings-button" data-action="remove-dir" data-dir="${escapeHtml(dir)}" style="padding:4px 10px; font-size:11.5px; color:#EF4444;" title="Remove directory">Remove</button>
            </div>
          </div>
        `;
      }).join("");
    }
  }
}

async function persistDirectoriesToBackend(tentativeDirs = null, tentativeDefault = null) {
  const dirs = tentativeDirs || state.settings.searchDirectories;
  const def = tentativeDefault || state.settings.defaultCourseDir;
  try {
    const res = await fetch("/api/settings/directories", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        search_dirs: dirs,
        default_dir: def
      })
    });
    if (res.ok) {
      const data = await res.json();
      state.settings.searchDirectories = data.search_dirs || dirs;
      state.settings.defaultCourseDir = data.default_dir || def;
      saveSettingsToStorage();
      return { success: true, data };
    } else {
      const err = await res.json().catch(() => ({}));
      return { success: false, error: err.detail || res.statusText };
    }
  } catch {
    return { success: false, error: "Could not reach the local app" };
  }
}

async function browseDirectoryAction(targetInputId = "settings-new-dir-path", statusId = "settings-add-dir-status") {
  const input = document.getElementById(targetInputId);
  const statusEl = document.getElementById(statusId);
  if (statusEl) statusEl.textContent = "Opening folder chooser…";

  // Only the local server can return the absolute path needed by Add Folder.
  try {
    const res = await fetch("/api/settings/directories/browse", { method: "POST" });
    if (res.ok) {
      const data = await res.json();
      if (data.path) {
        if (input) input.value = data.path;
        if (statusEl) statusEl.textContent = `Selected: ${data.path}`;
        return;
      } else if (data.canceled) {
        if (statusEl) statusEl.textContent = "";
        return;
      }
    }
    const error = await res.json().catch(() => ({}));
    if (statusEl) statusEl.textContent = error.detail || "Could not open the native folder chooser. Enter a full path instead.";
  } catch {
    if (statusEl) statusEl.textContent = "Could not reach the local app. Restart the launcher, then try again.";
  }
}

async function addDirectoryAction(pathToAdd) {
  const statusEl = document.getElementById("settings-add-dir-status");
  const input = document.getElementById("settings-new-dir-path");
  const rawPath = typeof pathToAdd === "string" ? pathToAdd : (input ? input.value : "");
  const trimmed = rawPath.trim();

  if (!trimmed) {
    if (statusEl) statusEl.textContent = "Please enter a valid directory path.";
    return;
  }

  const dirs = normalizeDirList(state.settings.searchDirectories);
  if (dirs.includes(trimmed)) {
    if (statusEl) statusEl.textContent = `Directory "${trimmed}" is already in your discovery roots.`;
    return;
  }

  if (statusEl) statusEl.textContent = "Checking directory structure on disk…";

  // 1. First, check if this is a specific course directory (or legacy candidate needing blueprint synthesis)
  try {
    const importRes = await fetch("/api/settings/directories/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ course_path: trimmed })
    });

    if (importRes.ok) {
      const data = await importRes.json();
      if (input) input.value = "";
      if (statusEl) {
        if (data.synthesized) {
          statusEl.textContent = `✅ Successfully synthesized & cataloged "${data.course_name || 'Course'}" (${data.modules_count || 0} modules, ${data.file_count || 0} files)!`;
        } else {
          statusEl.textContent = `✅ Successfully cataloged course "${data.course_name || 'Course'}"!`;
        }
      }
      if (data.parent_dir) {
        const currentDirs = normalizeDirList(state.settings.searchDirectories);
        if (!currentDirs.includes(data.parent_dir)) {
          currentDirs.push(data.parent_dir);
          state.settings.searchDirectories = currentDirs;
          await persistDirectoriesToBackend();
        }
      }
      if (typeof loadCourseList === "function") await loadCourseList();
      syncDirectoriesUI();
      return;
    }
  } catch {}

  // 2. If it is a parent discovery root holding multiple courses (or normal directory)
  const nextDirs = [...dirs, trimmed];
  const res = await persistDirectoriesToBackend(nextDirs);

  if (!res.success) {
    if (statusEl) {
      statusEl.textContent = `❌ ${res.error || `Directory does not exist: "${trimmed}"`}`;
    }
    syncDirectoriesUI();
    return;
  }

  syncDirectoriesUI();
  if (input) input.value = "";
  if (statusEl) {
    statusEl.textContent = `✅ Added "${trimmed}" to discovery roots.`;
  }

  if (typeof rescanDirectoriesAction === "function") {
    rescanDirectoriesAction();
  }
}

async function setDefaultDirectoryAction(dir) {
  if (!dir) return;
  const result = await persistDirectoriesToBackend(null, dir);
  if (!result.success) {
    const statusEl = document.getElementById("settings-add-dir-status");
    if (statusEl) statusEl.textContent = `Could not change the new course location: ${result.error || "request failed"}`;
    return;
  }
  syncDirectoriesUI();
  if (typeof updateFolderPreview === "function") {
    updateFolderPreview();
  }
}

async function removeDirectoryAction(dirToRemove) {
  const dirs = normalizeDirList(state.settings.searchDirectories).filter(d => d !== dirToRemove);
  const defaultDir = state.settings.defaultCourseDir === dirToRemove
    ? (dirs[0] || state.settings.defaultCourseDir)
    : state.settings.defaultCourseDir;
  const result = await persistDirectoriesToBackend(dirs, defaultDir);
  if (!result.success) {
    const statusEl = document.getElementById("settings-add-dir-status");
    if (statusEl) statusEl.textContent = `Could not remove directory: ${result.error || "request failed"}`;
    return;
  }
  syncDirectoriesUI();
  if (typeof updateFolderPreview === "function") {
    updateFolderPreview();
  }
  if (typeof rescanDirectoriesAction === "function") {
    rescanDirectoriesAction();
  }
}

async function importCourseAction(path) {
  return addDirectoryAction(path);
}

async function scanLegacyCoursesAction() {
  const btn = document.getElementById("btn-scan-legacy-courses");
  const statusEl = document.getElementById("legacy-scan-status");
  const listEl = document.getElementById("legacy-candidates-list");
  const badgeEl = document.getElementById("legacy-scan-badge");

  if (btn) btn.disabled = true;
  if (statusEl) statusEl.textContent = "Scanning discovery roots for past course folders…";

  try {
    const res = await fetch("/api/settings/courses/scan-legacy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({})
    });

    if (res.ok) {
      const data = await res.json();
      const candidates = data.candidates || [];
      if (badgeEl) {
        badgeEl.textContent = `${candidates.length} Detected`;
      }
      if (candidates.length === 0) {
        if (statusEl) statusEl.textContent = "No unindexed course folders detected in search roots.";
        if (listEl) {
          listEl.style.display = "block";
          listEl.innerHTML = `
            <div class="empty-state" style="padding: 20px; text-align: center; border: 1px dashed var(--border-color); border-radius: 8px; color: var(--text-muted); font-size: 13px;">
              <span>All detected courses in your discovery roots already have active blueprints or index entries.</span>
            </div>
          `;
        }
      } else {
        if (statusEl) statusEl.textContent = `Found ${candidates.length} past course candidate${candidates.length === 1 ? "" : "s"} ready for synthesis:`;
        renderLegacyCandidates(candidates);
      }
      return;
    } else {
      const err = await res.json().catch(() => ({}));
      if (statusEl) statusEl.textContent = `Scan failed: ${err.detail || res.statusText}`;
    }
  } catch (e) {
    if (statusEl) statusEl.textContent = `Scan error: ${e.message}`;
  } finally {
    if (btn) btn.disabled = false;
  }
}

function renderLegacyCandidates(candidates) {
  const listEl = document.getElementById("legacy-candidates-list");
  if (!listEl) return;
  listEl.style.display = "block";
  listEl.innerHTML = "";

  candidates.forEach((cand, idx) => {
    const card = document.createElement("div");
    card.className = "legacy-candidate-card";
    card.id = `legacy-candidate-${idx}`;

    const syllabusBadge = cand.has_syllabus
      ? `<span class="candidate-badge syllabus-found">📄 Syllabus Found</span>`
      : `<span class="candidate-badge syllabus-none">No Syllabus</span>`;

    const termBadge = cand.detected_term
      ? `<span class="candidate-badge term-badge">${escapeHtml(cand.detected_term)}</span>`
      : "";

    const subfoldersSummary = (cand.subfolders && cand.subfolders.length > 0)
      ? `<div style="font-size: 11.5px; color: var(--text-muted); margin-top: 2px;">Subfolders: ${escapeHtml(cand.subfolders.slice(0, 6).join(", "))}${cand.subfolders.length > 6 ? `, +${cand.subfolders.length - 6} more` : ""}</div>`
      : "";

    card.innerHTML = `
      <div class="legacy-candidate-header">
        <div class="legacy-candidate-title-group">
          <span class="legacy-candidate-folder-icon">📁</span>
          <span class="legacy-candidate-folder-name">${escapeHtml(cand.folder_name)}</span>
          <div class="legacy-candidate-badges">
            <span class="candidate-badge files-count">${cand.file_count} files</span>
            ${syllabusBadge}
            ${termBadge}
          </div>
        </div>
        <span class="legacy-candidate-path" title="${escapeHtml(cand.path)}">${escapeHtml(cand.display_path || cand.path)}</span>
      </div>
      ${subfoldersSummary}
      <div class="legacy-candidate-fields">
        <div class="candidate-field-group">
          <label class="candidate-field-label">Course Name</label>
          <input type="text" class="settings-input candidate-name-input" id="cand-name-${idx}" value="${escapeHtml(cand.inferred_name || cand.folder_name)}" placeholder="Course Name">
        </div>
        <div class="candidate-field-group">
          <label class="candidate-field-label">Quarter / Term</label>
          <input type="text" class="settings-input candidate-term-input" id="cand-term-${idx}" value="${escapeHtml(cand.detected_term || "")}" placeholder="e.g. Fall 2023, Winter 2024">
        </div>
      </div>
      <div class="legacy-candidate-actions">
        <span class="candidate-synth-status" id="cand-status-${idx}"></span>
        <button type="button" class="btn-synthesize-action" id="cand-btn-${idx}">
          <span>⚡ Synthesize &amp; Add Course</span>
        </button>
      </div>
    `;

    const synthBtn = card.querySelector(`#cand-btn-${idx}`);
    synthBtn.addEventListener("click", () => {
      const nameInput = card.querySelector(`#cand-name-${idx}`);
      const termInput = card.querySelector(`#cand-term-${idx}`);
      const courseName = nameInput ? nameInput.value.trim() : cand.inferred_name;
      const term = termInput ? termInput.value.trim() : cand.detected_term;
      synthesizeLegacyCourseAction(cand.path, courseName, term, idx);
    });

    listEl.appendChild(card);
  });
}

async function synthesizeLegacyCourseAction(coursePath, courseName, term, idx) {
  const card = document.getElementById(`legacy-candidate-${idx}`);
  const btn = document.getElementById(`cand-btn-${idx}`);
  const statusEl = document.getElementById(`cand-status-${idx}`);

  if (btn) btn.disabled = true;
  if (statusEl) statusEl.textContent = "Synthesizing blueprint & organizing modules…";

  try {
    const res = await fetch("/api/settings/courses/synthesize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        course_path: coursePath,
        course_name: courseName || undefined,
        term: term || undefined
      })
    });

    if (res.ok) {
      const data = await res.json();
      if (card) card.classList.add("synthesized");
      if (statusEl) {
        statusEl.innerHTML = `<strong>✅ Added as "${escapeHtml(data.course_name)}"</strong> (${data.modules_count || 0} modules, ${data.file_count || 0} files)`;
        statusEl.style.color = "#10B981";
      }
      if (btn) {
        btn.textContent = "View Course";
        btn.disabled = false;
        btn.style.background = "var(--canvas-active-accent)";
        btn.onclick = async () => {
          closeSettingsModal();
          if (typeof selectCourse === "function") {
            if (els.courseSelector) els.courseSelector.value = data.course_name;
            await selectCourse(data.course_name);
          }
          if (typeof switchView === "function") {
            switchView("canvas");
          }
        };
      }
      if (typeof loadCourseList === "function") {
        await loadCourseList();
      }
      if (typeof renderDashboardView === "function") {
        renderDashboardView();
      }
      return;
    } else {
      const err = await res.json().catch(() => ({}));
      if (statusEl) statusEl.textContent = `❌ Synthesis failed: ${err.detail || res.statusText}`;
      if (btn) btn.disabled = false;
    }
  } catch (e) {
    if (statusEl) statusEl.textContent = `❌ Error: ${e.message}`;
    if (btn) btn.disabled = false;
  }
}

async function rescanDirectoriesAction() {
  const btn = document.getElementById("btn-rescan-all-dirs");
  const statusEl = document.getElementById("settings-rescan-dirs-status");
  const icon = document.getElementById("icon-rescan-dirs");
  const label = btn ? btn.querySelector("span:last-child") : null;

  if (btn) btn.disabled = true;
  if (icon) icon.classList.add("spin-rescan");
  if (label) label.textContent = "Scanning…";
  if (statusEl) {
    statusEl.style.display = "block";
    statusEl.textContent = "Scanning configured discovery directories…";
  }

  try {
    await fetch("/api/settings/directories/scan", { method: "POST" });
  } catch {}

  if (typeof loadCourseList === "function") {
    try {
      await loadCourseList();
    } catch {}
  }

  const count = (state.courses && state.courses.length) || 0;
  const numDirs = (state.settings.searchDirectories && state.settings.searchDirectories.length) || 0;
  if (statusEl) {
    statusEl.textContent = `Scan complete: Found ${count} course${count === 1 ? "" : "s"} across ${numDirs} root director${numDirs === 1 ? "y" : "ies"}.`;
    setTimeout(() => {
      if (statusEl) statusEl.style.display = "none";
    }, 4500);
  }
  syncDirectoriesUI();

  if (icon) icon.classList.remove("spin-rescan");
  if (label) label.textContent = "Rescan";
  if (btn) btn.disabled = false;
}

// ==========================================================================
// Course Disk Hierarchy Architecture Configuration
// ==========================================================================

const DEFAULT_CUSTOM_FOLDERS = [
  { id: "folder_slides", name: "Lecture Slides", parent: "study_materials", types: ["slides", "lectures"] },
  { id: "folder_solutions", name: "Homework Solutions", parent: "study_materials", types: ["solutions", "keys"] },
  { id: "folder_worksheets", name: "Discussion Worksheets", parent: "study_materials", types: ["discussions", "worksheets"] },
  { id: "folder_exams", name: "Exams & Quizzes", parent: "study_materials", types: ["exams", "quizzes"] },
  { id: "folder_syllabus", name: "Syllabus & Admin", parent: "study_materials", types: ["syllabus", "admin"] },
  { id: "folder_other", name: "Other Materials", parent: "study_materials", types: ["other", "reference"] },
  { id: "folder_assignments", name: "Assignments", parent: "student_work", types: ["assignments", "homework"] },
  { id: "folder_quizzes", name: "Quizzes", parent: "student_work", types: ["student_quizzes"] }
];

const DEFAULT_HIERARCHY = {
  preset: "standard",
  lecturesFolder: "{course} Lectures & Resources",
  enableWorkFolder: true,
  workFolder: "{course} Work",
  timelineFile: "{course} Assignments_and_Milestones_Timeline.md",
  categorizationStyle: "standard",
  prefixSubfolders: false,
  mainFolders: [
    { id: "main_lectures", name: "{course} Lectures & Resources", role: "study_materials" },
    { id: "main_work", name: "{course} Work", role: "student_work" }
  ],
  customFolders: JSON.parse(JSON.stringify(DEFAULT_CUSTOM_FOLDERS))
};

const HIERARCHY_PRESETS = {
  standard: {
    preset: "standard",
    lecturesFolder: "{course} Lectures & Resources",
    enableWorkFolder: true,
    workFolder: "{course} Work",
    timelineFile: "{course} Assignments_and_Milestones_Timeline.md",
    categorizationStyle: "standard",
    badge: "Standard Dual-Folder"
  },
  unified: {
    preset: "unified",
    lecturesFolder: "{course}",
    enableWorkFolder: false,
    workFolder: "",
    timelineFile: "{course} Assignments_and_Milestones_Timeline.md",
    categorizationStyle: "standard",
    badge: "Unified Single-Folder"
  },
  compact: {
    preset: "compact",
    lecturesFolder: "Lectures",
    enableWorkFolder: true,
    workFolder: "Work",
    timelineFile: "Timeline.md",
    categorizationStyle: "minimal",
    badge: "Compact Structure"
  },
  custom: {
    preset: "custom",
    badge: "Custom Template"
  }
};

let draggedFolderId = null;

function setHierarchyPresetCustom() {
  if (!state.settings) return;
  state.settings.hierarchy = state.settings.hierarchy || { ...DEFAULT_HIERARCHY };
  state.settings.hierarchy.preset = "custom";
  const badgeEl = document.getElementById("hierarchy-preset-badge");
  if (badgeEl) badgeEl.textContent = "Custom Template";
  document.querySelectorAll(".hierarchy-preset-pill").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.preset === "custom");
  });
}

async function loadHierarchySettings() {
  try {
    const res = await fetch("/api/settings/hierarchy");
    if (res.ok) {
      const data = await res.json();
      if (data && data.disk_hierarchy) {
        const customFolders = Array.isArray(data.disk_hierarchy.custom_folders) && data.disk_hierarchy.custom_folders.length
          ? data.disk_hierarchy.custom_folders
          : (state.settings.hierarchy?.customFolders || JSON.parse(JSON.stringify(DEFAULT_CUSTOM_FOLDERS)));

        const mainFolders = Array.isArray(data.disk_hierarchy.main_folders) && data.disk_hierarchy.main_folders.length
          ? data.disk_hierarchy.main_folders
          : (state.settings.hierarchy?.mainFolders || [
              { id: "main_lectures", name: data.disk_hierarchy.lectures_folder || "{course} Lectures & Resources", role: "study_materials" },
              ...(data.disk_hierarchy.enable_work_folder !== false ? [{ id: "main_work", name: data.disk_hierarchy.work_folder || "{course} Work", role: "student_work" }] : [])
            ]);

        const catStyle = data.disk_hierarchy.categorization_style || "standard";
        const isPrefixed = Boolean(data.disk_hierarchy.prefix_subfolders === true || catStyle === "prefixed");

        state.settings.hierarchy = {
          ...DEFAULT_HIERARCHY,
          preset: data.disk_hierarchy.preset || "standard",
          lecturesFolder: data.disk_hierarchy.lectures_folder || "{course} Lectures & Resources",
          enableWorkFolder: data.disk_hierarchy.enable_work_folder !== false,
          workFolder: data.disk_hierarchy.work_folder || "{course} Work",
          timelineFile: data.disk_hierarchy.timeline_file || "{course} Assignments_and_Milestones_Timeline.md",
          categorizationStyle: catStyle,
          prefixSubfolders: isPrefixed,
          customFolders: customFolders,
          mainFolders: mainFolders
        };
        saveSettingsToStorage();
      }
    }
  } catch {
    // Offline / fallback to localStorage
  }
  syncHierarchyUI();
  if (typeof updateFolderPreview === "function") {
    updateFolderPreview();
  }
}

function syncHierarchyUI() {
  if (!state.settings) return;
  state.settings.hierarchy = state.settings.hierarchy || { ...DEFAULT_HIERARCHY };
  const h = state.settings.hierarchy;
  if (!Array.isArray(h.customFolders) || !h.customFolders.length) {
    h.customFolders = JSON.parse(JSON.stringify(DEFAULT_CUSTOM_FOLDERS));
  }

  const lecturesInput = document.getElementById("settings-hierarchy-lectures");
  const workInput = document.getElementById("settings-hierarchy-work");
  const timelineInput = document.getElementById("settings-hierarchy-timeline");
  const styleSelect = document.getElementById("settings-hierarchy-style");
  const enableWorkCheck = document.getElementById("settings-hierarchy-enable-work");
  const badgeEl = document.getElementById("hierarchy-preset-badge");

  if (lecturesInput) lecturesInput.value = h.lecturesFolder || "{course} Lectures & Resources";
  if (workInput) {
    workInput.value = h.workFolder || "{course} Work";
    workInput.disabled = !h.enableWorkFolder;
  }
  if (timelineInput) timelineInput.value = h.timelineFile || "{course} Assignments_and_Milestones_Timeline.md";
  if (styleSelect) styleSelect.value = h.categorizationStyle || "standard";
  if (enableWorkCheck) enableWorkCheck.checked = h.enableWorkFolder !== false;

  const preset = h.preset || "standard";
  if (badgeEl) {
    const info = HIERARCHY_PRESETS[preset] || HIERARCHY_PRESETS.custom;
    badgeEl.textContent = info.badge || "Standard Dual-Folder";
  }

  document.querySelectorAll(".hierarchy-preset-pill").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.preset === preset);
  });

  const prefixAllCheck = document.getElementById("settings-hierarchy-prefix-all");
  if (prefixAllCheck) {
    prefixAllCheck.checked = Boolean(h.prefixSubfolders || h.categorizationStyle === "prefixed");
  }

  renderHierarchyTreePreview();
}

function renderHierarchyTreePreview() {
  const container = document.getElementById("hierarchy-tree-display");
  if (!container) return;

  const courseName = (state.currentCourse && state.currentCourse.trim()) || (Array.isArray(state.courses) && state.courses.length && state.courses[0].name) || "Course Name";
  const sampleEl = document.getElementById("tree-preview-sample-course");
  if (sampleEl) sampleEl.textContent = courseName;

  const h = state.settings.hierarchy = state.settings.hierarchy || { ...DEFAULT_HIERARCHY };
  if (!Array.isArray(h.customFolders) || !h.customFolders.length) {
    h.customFolders = JSON.parse(JSON.stringify(DEFAULT_CUSTOM_FOLDERS));
  }

  // Ensure h.mainFolders exists
  if (!Array.isArray(h.mainFolders) || !h.mainFolders.length) {
    if (h.enableWorkFolder === false || h.preset === "unified") {
      h.mainFolders = [
        { id: "study_materials", name: h.lecturesFolder || "{course}", role: "study_materials" }
      ];
    } else {
      h.mainFolders = [
        { id: "study_materials", name: h.lecturesFolder || "{course} Lectures & Resources", role: "study_materials" },
        { id: "student_work", name: h.workFolder || "{course} Work", role: "student_work" }
      ];
    }
  }

  const formatFolder = (template, name) => {
    if (typeof formatHierarchyFolder === "function") {
      return formatHierarchyFolder(template, name);
    }
    return (template || "").replace(/\{course\}/gi, name || "");
  };

  const defaultDir = (state.settings && state.settings.defaultCourseDir) || "~/Desktop";
  const timelineTemplate = h.timelineFile || "{course} Assignments_and_Milestones_Timeline.md";
  const timelineFile = formatFolder(timelineTemplate, courseName);

  let html = `
    <div class="tree-line">
      <span class="tree-branch-prefix">📂</span>
      <strong class="tree-hl">${escapeHtml(defaultDir)}</strong>
      <span class="tree-dim">/</span>
      <span class="tree-hl">${escapeHtml(courseName)}</span>
      <span class="tree-dim">/</span>
    </div>
  `;

  h.mainFolders.forEach((mf, mIdx) => {
    const isLastMain = (mIdx === h.mainFolders.length - 1);
    const branchSymbol = isLastMain ? "└──" : "├──";
    const subPrefix = isLastMain ? "    " : "│   ";
    const resolvedMainName = formatFolder(mf.name, courseName);

    html += `
      <div class="tree-line indent-1 tree-main-row" style="${mIdx > 0 ? 'margin-top: 6px;' : ''}">
        <span class="tree-branch-prefix">${branchSymbol} 📁</span>
        <input type="text" class="tree-inline-input tree-main-input" value="${escapeHtml(mf.name)}" data-main-id="${escapeHtml(mf.id)}" size="${Math.max((mf.name || '').length + 2, 22)}" title="Click to rename main folder (supports {course} token)">
        ${h.mainFolders.length > 1 ? `<button type="button" class="tree-item-del-btn tree-main-del-btn" data-main-id="${escapeHtml(mf.id)}" title="Delete main folder">✕</button>` : ""}
      </div>
    `;

    // If first main folder or study_materials, show canvas_course.json
    if (mIdx === 0 || mf.id === "study_materials" || mf.id === "main_lectures" || mf.role === "study_materials") {
      html += `
        <div class="tree-line indent-2">
          <span class="tree-branch-prefix">${subPrefix}├── 📄</span>
          <span class="tree-accent">canvas_course.json</span>
          <span class="tree-dim">(LMS Course Blueprint)</span>
        </div>
      `;
    }

    // Dropzone for this main folder's subfolders
    html += `<div class="tree-branch-dropzone" data-parent-group="${escapeHtml(mf.id)}" id="tree-dropzone-${escapeHtml(mf.id)}">`;
    const isPrefixed = Boolean(h.prefixSubfolders || h.categorizationStyle === "prefixed");
    const folderList = h.customFolders.filter(f => f.parent === mf.id || f.parent === mf.role || (mIdx === 0 && (!f.parent || f.parent === 'study_materials')));
    folderList.forEach((f, idx) => {
      const prefixTag = (isPrefixed && !f.name.includes("{course}"))
        ? `<span class="tree-subfolder-prefix" style="color:var(--canvas-accent);font-family:ui-monospace,monospace;font-size:12px;font-weight:600;margin-right:3px;">${escapeHtml(formatFolder("{course}", courseName))}</span>`
        : "";
      html += `
        <div class="tree-item-row indent-2" draggable="true" data-folder-id="${escapeHtml(f.id)}" data-parent-group="${escapeHtml(mf.id)}" data-idx="${idx}">
          <span class="tree-branch-prefix">${subPrefix}├──</span>
          <span class="tree-drag-grip" title="Drag to reorder or move to another main folder">⋮⋮</span>
          <span class="tree-folder-icon">📁</span>
          ${prefixTag}
          <input type="text" class="tree-inline-input" value="${escapeHtml(f.name)}" data-folder-id="${escapeHtml(f.id)}" size="${Math.max((f.name || '').length + 2, 16)}" title="Click to rename subfolder">
          <button type="button" class="tree-item-del-btn" data-folder-id="${escapeHtml(f.id)}" title="Delete subfolder">✕</button>
        </div>
      `;
    });

    // Add subfolder button inside this main folder
    html += `
        <div class="tree-action-row indent-2">
          <span class="tree-branch-prefix">${subPrefix}├──</span>
          <button type="button" class="tree-add-btn" data-add-to="${escapeHtml(mf.id)}" title="Add new subfolder to ${escapeHtml(resolvedMainName)}">
            <span>➕</span> <span>+ Add Subfolder</span>
          </button>
        </div>
      </div>
    `;

    // If student work folder or designated work role, show timeline file
    if (mf.id === "student_work" || mf.role === "student_work" || mf.id === "main_work" || (mIdx === 1 && h.mainFolders.length === 2)) {
      html += `
        <div class="tree-line indent-2">
          <span class="tree-branch-prefix">${subPrefix}└── 📄</span>
          <span class="tree-dim">${escapeHtml(timelineFile)}</span>
          <span class="tree-dim">(Milestones Schedule)</span>
        </div>
      `;
    }
  });

  // Action button to add another main folder at the root of the course
  html += `
    <div class="tree-action-row indent-1" style="margin-top: 8px;">
      <button type="button" class="tree-add-main-btn" id="btn-tree-add-main-folder" title="Add another main folder to this course">
        <span>➕</span> <span>+ Add Main Folder</span>
      </button>
    </div>
  `;

  container.innerHTML = html;
  initInteractiveTreeEvents();
}

function initInteractiveTreeEvents() {
  const h = state.settings?.hierarchy;
  if (!h || !Array.isArray(h.customFolders)) return;

  // 1. Draggable tree rows
  document.querySelectorAll(".tree-item-row").forEach(row => {
    row.addEventListener("dragstart", e => {
      draggedFolderId = row.dataset.folderId;
      e.dataTransfer.setData("text/plain", draggedFolderId);
      e.dataTransfer.effectAllowed = "move";
      row.classList.add("is-dragging");
    });

    row.addEventListener("dragend", () => {
      draggedFolderId = null;
      row.classList.remove("is-dragging");
      document.querySelectorAll(".tree-item-row").forEach(r => r.classList.remove("drag-over-above", "drag-over-below"));
      document.querySelectorAll(".tree-branch-dropzone").forEach(dz => dz.classList.remove("drag-over"));
    });

    row.addEventListener("dragover", e => {
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = "move";

      const rect = row.getBoundingClientRect();
      const isAfter = (e.clientY - rect.top) > (rect.height / 2);
      row.classList.toggle("drag-over-above", !isAfter);
      row.classList.toggle("drag-over-below", isAfter);
    });

    row.addEventListener("dragleave", () => {
      row.classList.remove("drag-over-above", "drag-over-below");
    });

    row.addEventListener("drop", e => {
      e.preventDefault();
      e.stopPropagation();
      row.classList.remove("drag-over-above", "drag-over-below");

      const droppedId = e.dataTransfer.getData("text/plain") || draggedFolderId;
      const targetId = row.dataset.folderId;
      if (!droppedId || droppedId === targetId) return;

      const rect = row.getBoundingClientRect();
      const isAfter = (e.clientY - rect.top) > (rect.height / 2);

      const folderIdx = h.customFolders.findIndex(f => f.id === droppedId);
      if (folderIdx < 0) return;

      const [movedFolder] = h.customFolders.splice(folderIdx, 1);
      const targetGroup = row.dataset.parentGroup;
      movedFolder.parent = targetGroup;

      let targetIdx = h.customFolders.findIndex(f => f.id === targetId);
      if (targetIdx >= 0) {
        if (isAfter) targetIdx += 1;
        h.customFolders.splice(targetIdx, 0, movedFolder);
      } else {
        h.customFolders.push(movedFolder);
      }

      setHierarchyPresetCustom();
      saveSettingsToStorage();
      renderHierarchyTreePreview();
      persistHierarchyToBackend();
    });
  });

  // 2. Branch dropzones
  document.querySelectorAll(".tree-branch-dropzone").forEach(dz => {
    dz.addEventListener("dragover", e => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      dz.classList.add("drag-over");
    });

    dz.addEventListener("dragleave", e => {
      if (e.relatedTarget && dz.contains(e.relatedTarget)) return;
      dz.classList.remove("drag-over");
    });

    dz.addEventListener("drop", e => {
      e.preventDefault();
      dz.classList.remove("drag-over");
      const droppedId = e.dataTransfer.getData("text/plain") || draggedFolderId;
      if (!droppedId) return;

      const targetGroup = dz.dataset.parentGroup;
      const folderIdx = h.customFolders.findIndex(f => f.id === droppedId);
      if (folderIdx < 0) return;

      const [movedFolder] = h.customFolders.splice(folderIdx, 1);
      movedFolder.parent = targetGroup;
      h.customFolders.push(movedFolder);

      setHierarchyPresetCustom();
      saveSettingsToStorage();
      renderHierarchyTreePreview();
      persistHierarchyToBackend();
    });
  });

  // 3. Inline name editing for subfolders
  document.querySelectorAll(".tree-inline-input:not(.tree-main-input)").forEach(input => {
    const handleRename = () => {
      const folderId = input.dataset.folderId;
      const val = input.value.trim();
      const folder = h.customFolders.find(f => f.id === folderId);
      if (folder && val && folder.name !== val) {
        folder.name = val;
        setHierarchyPresetCustom();
        saveSettingsToStorage();
        renderHierarchyTreePreview();
        persistHierarchyToBackend();
      } else if (!val && folder) {
        input.value = folder.name;
        input.size = Math.max(folder.name.length + 2, 16);
      }
    };
    input.addEventListener("input", () => {
      input.size = Math.max(input.value.length + 2, 16);
    });
    input.addEventListener("change", handleRename);
    input.addEventListener("blur", handleRename);
    input.addEventListener("keydown", e => {
      if (e.key === "Enter") input.blur();
    });
  });

  // 4. Inline name editing for main folders
  document.querySelectorAll(".tree-main-input").forEach(input => {
    const handleMainRename = () => {
      const mainId = input.dataset.mainId;
      const val = input.value.trim();
      const mf = h.mainFolders?.find(m => m.id === mainId);
      if (mf && val && mf.name !== val) {
        mf.name = val;
        if (mf.id === "study_materials" || mainId === h.mainFolders[0]?.id) h.lecturesFolder = val;
        if (mf.id === "student_work" || mainId === h.mainFolders[1]?.id) h.workFolder = val;
        setHierarchyPresetCustom();
        saveSettingsToStorage();
        renderHierarchyTreePreview();
        persistHierarchyToBackend();
      } else if (!val && mf) {
        input.value = mf.name;
        input.size = Math.max(mf.name.length + 2, 22);
      }
    };
    input.addEventListener("input", () => {
      input.size = Math.max(input.value.length + 2, 22);
    });
    input.addEventListener("change", handleMainRename);
    input.addEventListener("blur", handleMainRename);
    input.addEventListener("keydown", e => {
      if (e.key === "Enter") input.blur();
    });
  });

  // 5. Delete subfolders
  document.querySelectorAll(".tree-item-del-btn:not(.tree-main-del-btn)").forEach(btn => {
    btn.addEventListener("click", e => {
      e.stopPropagation();
      const folderId = btn.dataset.folderId;
      h.customFolders = h.customFolders.filter(f => f.id !== folderId);
      setHierarchyPresetCustom();
      saveSettingsToStorage();
      renderHierarchyTreePreview();
      persistHierarchyToBackend();
    });
  });

  // 6. Delete main folders
  document.querySelectorAll(".tree-main-del-btn").forEach(btn => {
    btn.addEventListener("click", e => {
      e.stopPropagation();
      const mainId = btn.dataset.mainId;
      if (!Array.isArray(h.mainFolders) || h.mainFolders.length <= 1) return;
      h.mainFolders = h.mainFolders.filter(m => m.id !== mainId);
      const fallbackParent = h.mainFolders[0].id;
      h.customFolders.forEach(f => {
        if (f.parent === mainId) f.parent = fallbackParent;
      });
      if (mainId === "student_work") h.enableWorkFolder = false;
      setHierarchyPresetCustom();
      saveSettingsToStorage();
      renderHierarchyTreePreview();
      persistHierarchyToBackend();
    });
  });

  // 7. Add Subfolder buttons
  document.querySelectorAll(".tree-add-btn").forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const parentGroup = btn.dataset.addTo || (h.mainFolders?.[0]?.id || "study_materials");
      const newFolder = {
        id: "folder_" + Date.now(),
        name: "New Subfolder",
        parent: parentGroup,
        types: ["custom"]
      };
      h.customFolders.push(newFolder);
      setHierarchyPresetCustom();
      saveSettingsToStorage();
      renderHierarchyTreePreview();
      persistHierarchyToBackend();

      setTimeout(() => {
        const newInput = document.querySelector(`.tree-inline-input[data-folder-id="${newFolder.id}"]`);
        if (newInput) {
          newInput.focus();
          newInput.select();
        }
      }, 50);
    };
  });

  // 8. Add Main Folder button
  const addMainBtn = document.getElementById("btn-tree-add-main-folder");
  if (addMainBtn) {
    addMainBtn.onclick = (e) => {
      e.stopPropagation();
      const newMainId = "main_" + Date.now();
      const folderNum = (h.mainFolders?.length || 0) + 1;
      const newMain = {
        id: newMainId,
        name: `{course} Folder ${folderNum}`,
        role: "custom"
      };
      if (!Array.isArray(h.mainFolders)) h.mainFolders = [];
      h.mainFolders.push(newMain);
      h.customFolders.push({
        id: "folder_" + Date.now(),
        name: "New Subfolder",
        parent: newMainId,
        types: ["custom"]
      });
      setHierarchyPresetCustom();
      saveSettingsToStorage();
      renderHierarchyTreePreview();
      persistHierarchyToBackend();

      setTimeout(() => {
        const newInput = document.querySelector(`.tree-main-input[data-main-id="${newMainId}"]`);
        if (newInput) {
          newInput.focus();
          newInput.select();
        }
      }, 50);
    };
  }
}

async function persistHierarchyToBackend() {
  const h = state.settings?.hierarchy;
  if (!h) return;
  const lecturesVal = h.mainFolders?.[0]?.name || h.lecturesFolder || "{course} Lectures & Resources";
  const workVal = h.mainFolders?.[1]?.name || h.workFolder || "{course} Work";
  const hasWork = (h.mainFolders ? h.mainFolders.length > 1 : h.enableWorkFolder !== false);
  const catStyle = (h.prefixSubfolders || h.categorizationStyle === "prefixed") ? "prefixed" : "standard";

  try {
    await fetch("/api/settings/hierarchy", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        preset: h.preset || "custom",
        lectures_folder: lecturesVal,
        enable_work_folder: hasWork,
        work_folder: workVal,
        timeline_file: h.timelineFile || "{course} Assignments_and_Milestones_Timeline.md",
        categorization_style: catStyle,
        custom_folders: h.customFolders || [],
        main_folders: h.mainFolders || [
          { id: "main_lectures", name: lecturesVal, role: "study_materials" },
          ...(hasWork ? [{ id: "main_work", name: workVal, role: "student_work" }] : [])
        ]
      })
    });
  } catch {
    // Offline / fallback to localStorage
  }
}

async function saveHierarchySettingsAction() {
  const btn = document.getElementById("btn-save-hierarchy");
  const statusEl = document.getElementById("settings-hierarchy-status");
  if (btn) btn.disabled = true;
  if (statusEl) statusEl.textContent = "Saving hierarchy template…";

  const h = state.settings?.hierarchy || { ...DEFAULT_HIERARCHY };
  const lecturesVal = h.mainFolders?.[0]?.name || h.lecturesFolder || "{course} Lectures & Resources";
  const workVal = h.mainFolders?.[1]?.name || h.workFolder || "{course} Work";
  const hasWork = (h.mainFolders ? h.mainFolders.length > 1 : h.enableWorkFolder !== false);
  const catStyle = (h.prefixSubfolders || h.categorizationStyle === "prefixed") ? "prefixed" : "standard";

  const hierarchy = {
    preset: h.preset || "custom",
    lecturesFolder: lecturesVal,
    enableWorkFolder: hasWork,
    workFolder: workVal,
    timelineFile: h.timelineFile || "{course} Assignments_and_Milestones_Timeline.md",
    categorizationStyle: catStyle,
    prefixSubfolders: Boolean(h.prefixSubfolders || h.categorizationStyle === "prefixed"),
    customFolders: h.customFolders || JSON.parse(JSON.stringify(DEFAULT_CUSTOM_FOLDERS)),
    mainFolders: h.mainFolders || [
      { id: "main_lectures", name: lecturesVal, role: "study_materials" },
      ...(hasWork ? [{ id: "main_work", name: workVal, role: "student_work" }] : [])
    ]
  };

  state.settings.hierarchy = hierarchy;
  saveSettingsToStorage();

  try {
    const res = await fetch("/api/settings/hierarchy", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        preset: hierarchy.preset,
        lectures_folder: hierarchy.lecturesFolder,
        enable_work_folder: hierarchy.enableWorkFolder,
        work_folder: hierarchy.workFolder,
        timeline_file: hierarchy.timelineFile,
        categorization_style: hierarchy.categorizationStyle,
        custom_folders: hierarchy.customFolders,
        main_folders: hierarchy.mainFolders
      })
    });
    if (res.ok) {
      if (statusEl) statusEl.textContent = "✅ Hierarchy template saved to disk configuration.";
    } else {
      if (statusEl) statusEl.textContent = "Saved locally (backend endpoint pending update).";
    }
  } catch {
    if (statusEl) statusEl.textContent = "Saved to local app settings.";
  } finally {
    if (btn) btn.disabled = false;
    renderHierarchyTreePreview();
  }
}

async function resetHierarchySettingsAction() {
  const statusEl = document.getElementById("settings-hierarchy-status");
  state.settings.hierarchy = {
    ...DEFAULT_HIERARCHY,
    customFolders: JSON.parse(JSON.stringify(DEFAULT_CUSTOM_FOLDERS))
  };
  saveSettingsToStorage();
  syncHierarchyUI();

  try {
    await fetch("/api/settings/hierarchy", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        preset: "standard",
        lectures_folder: "{course} Lectures & Resources",
        enable_work_folder: true,
        work_folder: "{course} Work",
        timeline_file: "{course} Assignments_and_Milestones_Timeline.md",
        categorization_style: "standard",
        custom_folders: DEFAULT_CUSTOM_FOLDERS
      })
    });
    if (statusEl) statusEl.textContent = "Restored standard dual-folder hierarchy.";
  } catch {
    if (statusEl) statusEl.textContent = "Restored standard hierarchy locally.";
  }
}

function initExtendedSettings() {
  const s = state.settings;
  if (!["gemini", "ollama", "rules"].includes(s.aiProvider)) s.aiProvider = "gemini";
  if (!["qwen2.5:7b", "qwen2.5:3b", "llama3.2", "mistral"].includes(s.ollamaModel)) s.ollamaModel = "qwen2.5:7b";
  if (!["dashboard", "canvas", "timeline"].includes(s.startupView)) s.startupView = "dashboard";
  if (!["13px", "15px", "17px"].includes(s.readerFontSize)) s.readerFontSize = "15px";
  if (!["page-width", "page-fit", "100"].includes(s.pdfDefaultZoom)) s.pdfDefaultZoom = "page-width";
  if (!["paid", "free"].includes(s.geminiTier)) s.geminiTier = "paid";
  s.headless = s.headless !== false;
  s.terminalAutoscroll = s.terminalAutoscroll !== false;
  s.searchDirectories = normalizeDirList(s.searchDirectories);
  s.defaultCourseDir = s.defaultCourseDir || s.searchDirectories[0] || "~/Desktop";
  const ids = LAUNCHER_CATEGORIES.map(c => c.id);
  s.ingestionCategories = Array.isArray(s.ingestionCategories) ? ids.filter(id => s.ingestionCategories.includes(id)) : ids;
  if (!s.ingestionCategories.length) s.ingestionCategories = ids;
  // Never retain credentials imported from older or manually edited preferences.
  delete s.geminiApiKey;
  delete s.gemini_api_key;
  const categoriesContainer = document.getElementById("settings-categories");
  if (categoriesContainer) {
    categoriesContainer.innerHTML = LAUNCHER_CATEGORIES.map(c =>
      `<label class="settings-check"><input type="checkbox" data-settings-category="${c.id}"> ${c.label}</label>`).join("");
  }
  const bind = (id, key, checkbox = false) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("change", e => {
      state.settings[key] = checkbox ? e.target.checked : e.target.value;
      saveSettingsToStorage();
    });
  };
  bind("settings-ai-provider", "aiProvider");
  bind("settings-ollama-model", "ollamaModel");
  bind("settings-headless", "headless", true);
  bind("settings-autoscroll", "terminalAutoscroll", true);
  bind("settings-pdf-zoom", "pdfDefaultZoom");

  // Startup view radios
  document.querySelectorAll('input[name="startupView"]').forEach(input => {
    input.addEventListener("change", e => {
      state.settings.startupView = e.target.value;
      saveSettingsToStorage();
    });
  });

  // Global font scale slider & reset button
  const fontSlider = document.getElementById("setting-font-scale");
  if (fontSlider) {
    fontSlider.addEventListener("input", e => {
      const val = Number(e.target.value) || 100;
      state.settings.fontScale = val;
      applyGlobalFontScale(val);
      saveSettingsToStorage();
    });
  }
  const btnFontReset = document.getElementById("btn-font-scale-reset");
  if (btnFontReset) {
    btnFontReset.addEventListener("click", () => {
      state.settings.fontScale = 100;
      applyGlobalFontScale(100);
      saveSettingsToStorage();
    });
  }

  // Gemini tier radio cards
  document.querySelectorAll('input[name="settingsGeminiTier"]').forEach(radio => {
    radio.addEventListener("change", async e => {
      const tier = e.target.value;
      state.settings.geminiTier = tier;
      saveSettingsToStorage();
      const cardPaid = document.getElementById("card-tier-paid");
      const cardFree = document.getElementById("card-tier-free");
      if (cardPaid) cardPaid.classList.toggle("selected", tier === "paid");
      if (cardFree) cardFree.classList.toggle("selected", tier === "free");
      if (typeof launcherState !== "undefined") launcherState.geminiTier = tier;
      if (typeof rescanState !== "undefined") rescanState.geminiTier = tier;
      try {
        await fetch("/api/settings/gemini-tier", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tier })
        });
      } catch {}
    });
  });

  // Course selector for Search Index
  const courseSelect = document.getElementById("settings-course-select");
  if (courseSelect) {
    courseSelect.addEventListener("change", () => {
      refreshSettingsIndex();
    });
  }

  // Slide previews cache clear button
  const cacheClearBtn = document.getElementById("settings-cache-clear");
  if (cacheClearBtn) {
    cacheClearBtn.addEventListener("click", clearCacheAction);
  }

  document.getElementById("settings-categories").addEventListener("change", e => {
    const chosen = Array.from(document.querySelectorAll("[data-settings-category]:checked"), el => el.dataset.settingsCategory);
    if (!chosen.length) {
      e.target.checked = true;
      document.getElementById("settings-launcher-status").textContent = "Keep at least one default category selected.";
      return;
    }
    state.settings.ingestionCategories = chosen;
    saveSettingsToStorage();
  });
  document.querySelectorAll("[data-settings-section]").forEach(button => button.addEventListener("click", () => {
    document.querySelectorAll("[data-settings-section]").forEach(b => {
      b.classList.toggle("active", b === button);
      b.setAttribute("aria-pressed", String(b === button));
    });
    document.querySelectorAll("[data-settings-panel]").forEach(panel => panel.classList.toggle("hidden", panel.dataset.settingsPanel !== button.dataset.settingsSection));
    els.settingsModal.querySelector(".settings-modal-body").scrollTop = 0;
  }));
  document.getElementById("settings-apply-launcher").addEventListener("click", () => {
    document.getElementById("settings-launcher-status").textContent = applyLauncherDefaults() ? "Defaults applied to the current launcher setup." : "Wait for the running job to finish before applying defaults.";
  });
  document.getElementById("settings-key-reveal").addEventListener("click", e => {
    const input = document.getElementById("settings-gemini-key");
    input.type = input.type === "password" ? "text" : "password";
    e.target.textContent = input.type === "password" ? "Show" : "Hide";
    e.target.setAttribute("aria-pressed", String(input.type === "text"));
  });
  const btnIdxRefresh = document.getElementById("settings-index-refresh");
  if (btnIdxRefresh) btnIdxRefresh.addEventListener("click", () => refreshSettingsIndex());
  const btnIdxRebuild = document.getElementById("settings-index-rebuild");
  if (btnIdxRebuild) btnIdxRebuild.addEventListener("click", () => refreshSettingsIndex(true));
  els.settingsModal.addEventListener("keydown", e => {
    if (e.key !== "Tab") return;
    const focusable = Array.from(els.settingsModal.querySelectorAll("button, input, select, [tabindex='0']")).filter(el => !el.disabled && el.getClientRects().length);
    const first = focusable[0], last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
  });

  // Course Discovery Directories & Storage Roots listeners
  const iconFinder = document.getElementById("icon-browse-finder");
  if (iconFinder && typeof Icons !== "undefined" && Icons.macFinder) iconFinder.innerHTML = Icons.macFinder;
  const iconRescan = document.getElementById("icon-rescan-dirs");
  if (iconRescan && typeof Icons !== "undefined") iconRescan.innerHTML = Icons.refreshCw || Icons.refresh || "⟳";

  const btnBrowse = document.getElementById("btn-browse-directory");
  if (btnBrowse) {
    btnBrowse.addEventListener("click", () => browseDirectoryAction("settings-new-dir-path", "settings-add-dir-status"));
  }

  const btnAddDir = document.getElementById("btn-add-directory");
  if (btnAddDir) {
    btnAddDir.addEventListener("click", () => addDirectoryAction());
  }
  const inputNewDir = document.getElementById("settings-new-dir-path");
  if (inputNewDir) {
    inputNewDir.addEventListener("keydown", e => {
      if (e.key === "Enter") {
        e.preventDefault();
        addDirectoryAction();
      }
    });
  }
  const btnRescanDirs = document.getElementById("btn-rescan-all-dirs");
  if (btnRescanDirs) {
    btnRescanDirs.addEventListener("click", () => rescanDirectoriesAction());
  }

  const iconLegacyScan = document.getElementById("icon-legacy-scan");
  if (iconLegacyScan && typeof Icons !== "undefined") {
    iconLegacyScan.innerHTML = Icons.search || Icons.folder || "📁";
  }
  const btnScanLegacy = document.getElementById("btn-scan-legacy-courses");
  if (btnScanLegacy) {
    btnScanLegacy.addEventListener("click", () => scanLegacyCoursesAction());
  }

  const listEl = document.getElementById("settings-directories-list");
  if (listEl) {
    listEl.addEventListener("click", e => {
      const defaultBtn = e.target.closest('[data-action="set-default-dir"]');
      if (defaultBtn) {
        setDefaultDirectoryAction(defaultBtn.dataset.dir);
        return;
      }
      const removeBtn = e.target.closest('[data-action="remove-dir"]');
      if (removeBtn) {
        removeDirectoryAction(removeBtn.dataset.dir);
        return;
      }
    });
  }

  // Disk Hierarchy Architecture listeners
  document.querySelectorAll(".hierarchy-preset-pill").forEach(btn => {
    btn.addEventListener("click", () => {
      const preset = btn.dataset.preset;
      if (!preset) return;
      if (preset === "custom") {
        setHierarchyPresetCustom();
        syncHierarchyUI();
        return;
      }
      const p = HIERARCHY_PRESETS[preset];
      if (p) {
        let folders = JSON.parse(JSON.stringify(DEFAULT_CUSTOM_FOLDERS));
        if (preset === "unified") {
          folders = folders.map(f => ({ ...f, parent: "study_materials" }));
        } else if (preset === "compact") {
          folders = [
            { id: "folder_slides", name: "Slides", parent: "study_materials", types: ["slides"] },
            { id: "folder_solutions", name: "Solutions", parent: "study_materials", types: ["solutions"] },
            { id: "folder_worksheets", name: "Worksheets", parent: "study_materials", types: ["worksheets"] },
            { id: "folder_exams", name: "Exams", parent: "study_materials", types: ["exams"] },
            { id: "folder_syllabus", name: "Syllabus", parent: "study_materials", types: ["syllabus"] },
            { id: "folder_other", name: "Other", parent: "study_materials", types: ["other"] },
            { id: "folder_assignments", name: "Assignments", parent: "student_work", types: ["assignments"] },
            { id: "folder_quizzes", name: "Quizzes", parent: "student_work", types: ["student_quizzes"] }
          ];
        }
        let mainFolders = [];
        if (p.preset === "unified") {
          mainFolders = [
            { id: "study_materials", name: p.lecturesFolder || "{course}", role: "study_materials" }
          ];
        } else if (p.preset === "compact") {
          mainFolders = [
            { id: "study_materials", name: "Lectures", role: "study_materials" },
            { id: "student_work", name: "Work", role: "student_work" }
          ];
        } else {
          mainFolders = [
            { id: "study_materials", name: "{course} Lectures & Resources", role: "study_materials" },
            { id: "student_work", name: "{course} Work", role: "student_work" }
          ];
        }
        state.settings.hierarchy = {
          ...DEFAULT_HIERARCHY,
          preset: p.preset,
          lecturesFolder: p.lecturesFolder,
          enableWorkFolder: p.enableWorkFolder,
          workFolder: p.workFolder,
          timelineFile: p.timelineFile,
          categorizationStyle: p.categorizationStyle,
          customFolders: folders,
          mainFolders: mainFolders
        };
        syncHierarchyUI();
        persistHierarchyToBackend();
      }
    });
  });

  const onHierarchyInputChange = () => {
    setHierarchyPresetCustom();
    const enableWorkCheck = document.getElementById("settings-hierarchy-enable-work");
    const workInput = document.getElementById("settings-hierarchy-work");
    if (workInput && enableWorkCheck) workInput.disabled = !enableWorkCheck.checked;
    if (state.settings.hierarchy && enableWorkCheck) {
      state.settings.hierarchy.enableWorkFolder = enableWorkCheck.checked;
    }
    renderInteractiveHierarchyStudio();
    renderHierarchyTreePreview();
  };

  ["settings-hierarchy-lectures", "settings-hierarchy-work", "settings-hierarchy-timeline"].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener("input", onHierarchyInputChange);
      el.addEventListener("change", onHierarchyInputChange);
    }
  });

  const enableWorkCheck = document.getElementById("settings-hierarchy-enable-work");
  if (enableWorkCheck) {
    enableWorkCheck.addEventListener("change", () => {
      const workInput = document.getElementById("settings-hierarchy-work");
      if (workInput) workInput.disabled = !enableWorkCheck.checked;
      onHierarchyInputChange();
    });
  }

  const styleSelect = document.getElementById("settings-hierarchy-style");
  if (styleSelect) styleSelect.addEventListener("change", onHierarchyInputChange);

  const prefixAllCheck = document.getElementById("settings-hierarchy-prefix-all");
  if (prefixAllCheck) {
    prefixAllCheck.addEventListener("change", (e) => {
      const checked = e.target.checked;
      if (!state.settings) state.settings = {};
      if (!state.settings.hierarchy) state.settings.hierarchy = { ...DEFAULT_HIERARCHY };
      state.settings.hierarchy.prefixSubfolders = checked;
      state.settings.hierarchy.categorizationStyle = checked ? "prefixed" : "standard";
      saveSettingsToStorage();
      renderHierarchyTreePreview();
      if (typeof updateFolderPreview === "function") {
        updateFolderPreview();
      }
      persistHierarchyToBackend();
    });
  }

  const btnSaveHierarchy = document.getElementById("btn-save-hierarchy");
  if (btnSaveHierarchy) btnSaveHierarchy.addEventListener("click", () => saveHierarchySettingsAction());

  const btnResetHierarchy = document.getElementById("btn-reset-hierarchy");
  if (btnResetHierarchy) btnResetHierarchy.addEventListener("click", () => resetHierarchySettingsAction());

  syncHierarchyUI();

  applyLauncherDefaults();
}

async function loadGeminiKeyStatus() {
  const generation = settingsRequestGeneration;
  const status = document.getElementById("settings-key-status");
  status.textContent = "Checking configuration…";
  document.getElementById("settings-key-save").disabled = true;
  try {
    const response = await fetch("/api/settings/gemini-key");
    if (!response.ok) throw new Error();
    const data = await response.json();
    if (generation !== settingsRequestGeneration || settingsKeySaving) return;
    document.getElementById("settings-key-save").disabled = false;
    status.textContent = data.configured ? "A Gemini key is configured. Paste a new key to replace it." : "No Gemini key configured. Add one to use cloud organization.";
    if (data.tier) {
      state.settings.geminiTier = data.tier;
      const radTier = document.querySelector(`input[name="settingsGeminiTier"][value="${data.tier}"]`);
      if (radTier) radTier.checked = true;
      const cardPaid = document.getElementById("card-tier-paid");
      const cardFree = document.getElementById("card-tier-free");
      if (cardPaid) cardPaid.classList.toggle("selected", data.tier === "paid");
      if (cardFree) cardFree.classList.toggle("selected", data.tier === "free");
    }
  } catch {
    if (generation === settingsRequestGeneration && !settingsKeySaving) status.textContent = "Key settings unavailable. Check that the updated local server is running.";
  }
}

async function saveGeminiKey() {
  if (settingsKeySaving) return;
  const input = document.getElementById("settings-gemini-key");
  const status = document.getElementById("settings-key-status");
  const key = input.value.trim();
  if (!key || /\s/.test(key)) { status.textContent = "Enter a key without spaces."; input.focus(); return; }
  const generation = ++settingsRequestGeneration;
  settingsKeySaving = true;
  document.getElementById("settings-key-save").disabled = true;
  input.disabled = true;
  status.textContent = "Saving key…";
  try {
    const response = await fetch("/api/settings/gemini-key", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ api_key: key }) });
    if (!response.ok) throw new Error();
    if (generation === settingsRequestGeneration) {
      input.value = "";
      status.textContent = "Key saved locally. New add course jobs will use it. Connection has not been tested.";
      if (typeof launcherState !== "undefined") launcherState.geminiConfigured = true;
      if (typeof rescanState !== "undefined") rescanState.geminiConfigured = true;
    }
  } catch {
    if (generation === settingsRequestGeneration) status.textContent = "Could not save the key. Check the local server and try again.";
  } finally {
    settingsKeySaving = false;
    input.disabled = false;
    document.getElementById("settings-key-save").disabled = false;
  }
}

let settingsIndexGeneration = 0;
async function refreshSettingsIndex(rebuild = false) {
  populateSettingsCourseSelector();
  const courseSelect = document.getElementById("settings-course-select");
  const course = (courseSelect && courseSelect.value) || state.currentCourse;
  const generation = ++settingsIndexGeneration;
  const status = document.getElementById("settings-index-status");
  const button = document.getElementById("settings-index-rebuild");
  // [Codex] Current settings layouts may expose indexing only in the header.
  if (!status || !button) return;
  button.disabled = !course || rebuild;
  if (!course) { status.textContent = "Select a course to view or rebuild its search index."; return; }
  status.textContent = `${course} — ${rebuild ? "Requesting rebuild…" : "Loading index status…"}`;
  try {
    if (rebuild) {
      const response = await fetch(`/api/courses/${encodeURIComponent(course)}/search/rebuild`, { method: "POST" });
      if (!response.ok) throw new Error();
    }
    const response = await fetch(`/api/courses/${encodeURIComponent(course)}/search/status`);
    if (!response.ok) throw new Error();
    const data = await response.json();
    if (generation !== settingsIndexGeneration) return;
    status.textContent = `${course} — ${rebuild ? "Rebuild requested. " : ""}${data.state === "indexing" || data.phase === "ocr" ? "Indexing in progress" : data.state === "error" ? "Index error" : "Index idle"}. ${data.indexed_files ?? data.file_count ?? 0} files indexed. See the header indicator for live OCR progress.`;
  } catch {
    if (generation === settingsIndexGeneration) status.textContent = `${course} — Could not ${rebuild ? "rebuild or read" : "read"} the index. Try again.`;
  } finally {
    if (generation === settingsIndexGeneration) button.disabled = !course;
  }
}

// Unified File Click Handler
function handleFileClick(fileName, filePath, fileList = null, fileIndex = -1) {
  if (!filePath) return;
  if (state.settings.defaultAction === "preview") {
    // Open directly in Mac native Preview or PowerPoint
    systemAction(filePath, "open");
  } else {
    // Open in comprehensive in-browser viewer
    openPreviewModal(fileName, filePath, fileList, fileIndex);
    if (state.settings.autoFullscreen) {
      els.previewModalContainer.classList.add("modal-fullscreen");
      els.previewModal.classList.add("is-fullscreen");
      const iconEl = document.getElementById("icon-fullscreen");
      if (iconEl && typeof Icons !== "undefined" && Icons.minimize) iconEl.innerHTML = Icons.minimize;
    }
  }
}

// [Codex] Archived URL metadata must never become executable navigation.
function safeExternalUrl(value) {
  if (typeof value !== "string" || /[\u0000-\u0020\u007f]/.test(value)) return "#";
  try {
    const url = new URL(value);
    return ["https:", "http:", "mailto:"].includes(url.protocol) ? url.href : "#";
  } catch { return "#"; }
}

// Utilities
function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function capitalize(str) {
  if (!str) return "";
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function formatDate(isoStr) {
  if (!isoStr) return "--";
  try {
    const dt = new Date(isoStr);
    if (isNaN(dt.getTime())) return isoStr;
    return dt.toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit"
    });
  } catch {
    return isoStr;
  }
}

function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function highlightQueryInText(text, query, allowMarks = false) {
  if (!text) return "";
  if (!query) return escapeHtml(text);
  // [Codex] Only server snippets may contain marks; filenames are always text.
  // Preserve escaped entities from the backend, but never attributes or other tags.
  if (allowMarks && /<mark[\s>]/i.test(text)) {
    return String(text).split(/(<\/?mark\b[^>]*>)/gi).map(part => {
      if (/^<\/?mark\b[^>]*>$/i.test(part)) return /^<\//.test(part) ? "</mark>" : "<mark>";
      return part.replace(/</g, "&lt;").replace(/>/g, "&gt;");
    }).join("");
  }
  const escaped = escapeHtml(text);
  const qTokens = query.trim().split(/\s+/).filter(Boolean).map(t => escapeRegExp(t));
  if (qTokens.length === 0) return escaped;
  const regex = new RegExp(`(${qTokens.join("|")})`, "gi");
  return escaped.replace(regex, "<mark>$1</mark>");
}

// macOS and Native System Actions Helper
function openFileInSystem(filePath, action = "open", targetCourse = null) {
  return systemAction(filePath, action, targetCourse);
}
window.openFileInSystem = openFileInSystem;
window.openPreviewModal = openPreviewModal;

// ==========================================================================
// Preview Modal File Navigation (Previous / Next / Arrow Keys)
// ==========================================================================

function updatePreviewFileList(fileName, filePath, fileList = null, fileIndex = -1) {
  const fileMap = state.courseData?.file_path_map || {};
  const normTarget = normalizeDocPath(filePath);
  const resolvedTarget = fileMap[normTarget] || fileMap[normTarget.split("/").pop()] || normTarget;
  const targetName = (fileName || resolvedTarget.split("/").pop() || "").trim().toLowerCase();

  if (Array.isArray(fileList) && fileList.length > 0) {
    const seenKeys = new Set();
    const seenNames = new Set();
    const dedupedList = [];

    fileList.forEach(f => {
      if (!f) return;
      const rawP = f.path || f.filePath || f.relative_path || "";
      const normP = normalizeDocPath(rawP);
      const resolvedP = fileMap[normP] || fileMap[normP.split("/").pop()] || normP;
      const name = (f.name || resolvedP.split("/").pop() || "Document").trim();
      const baseName = name.toLowerCase();
      const pathKey = resolvedP.toLowerCase();

      if (!seenKeys.has(pathKey) && !seenNames.has(baseName)) {
        seenKeys.add(pathKey);
        seenNames.add(baseName);
        dedupedList.push({
          ...f,
          name,
          path: resolvedP
        });
      }
    });

    state.previewFileList = dedupedList.length > 0 ? dedupedList : fileList;

    if (fileIndex >= 0 && fileIndex < state.previewFileList.length) {
      state.previewCurrentIndex = fileIndex;
    } else {
      state.previewCurrentIndex = state.previewFileList.findIndex(f => {
        const fNorm = normalizeDocPath(f.path || f.filePath || f.relative_path || "").toLowerCase();
        const fName = (f.name || "").toLowerCase();
        return (resolvedTarget && fNorm === resolvedTarget.toLowerCase()) || (targetName && fName === targetName);
      });
      if (state.previewCurrentIndex === -1) state.previewCurrentIndex = 0;
    }
  } else {
    // Inferred file list strictly contained to the active view or folder on disk
    let inferred = [];
    if (state.search.isOpen && state.search.results && state.search.results.length > 0) {
      inferred = state.search.results.map(r => ({ name: r.name, path: r.path, context: "Search Results" }));
    } else if (state.activeView === "folders" && state.folderData && state.folderData.categories) {
      for (const cat of state.folderData.categories) {
        if (cat.files && cat.files.some(f => normalizeDocPath(f.relative_path) === normTarget)) {
          const folderName = cat.folder_name || "Folder";
          inferred = cat.files.map(f => ({ name: f.name, path: f.relative_path, context: folderName }));
          break;
        }
      }
    } else if (state.activeView === "canvas" && state.activeCanvasTab === "modules" && state.courseData && state.courseData.modules) {
      for (const mod of state.courseData.modules) {
        const modTitle = mod.title || "Module";
        const modFiles = [];
        const seenKeys = new Set();
        const seenNames = new Set();

        (mod.items || []).filter(it => it.local_file || it.pdf_file).forEach(it => {
          const rawName = it.title || it.local_file || it.pdf_file;
          const rawP = (fileMap[it.local_file] || fileMap[rawName]) || it.local_file || it.pdf_file;
          const normP = normalizeDocPath(rawP);
          const resolvedP = fileMap[normP] || fileMap[normP.split("/").pop()] || normP;
          const name = (rawName || resolvedP.split("/").pop() || "Document").trim();
          const baseName = name.toLowerCase();
          const pathKey = resolvedP.toLowerCase();

          if (!seenKeys.has(pathKey) && !seenNames.has(baseName)) {
            seenKeys.add(pathKey);
            seenNames.add(baseName);
            modFiles.push({ name, path: resolvedP, context: modTitle });
          }
        });

        if (modFiles.some(f => normalizeDocPath(f.path).toLowerCase() === resolvedTarget.toLowerCase() || (targetName && f.name.toLowerCase() === targetName))) {
          inferred = modFiles;
          break;
        }
      }
    } else if (state.activeView === "canvas" && state.activeCanvasTab === "announcements" && state.courseData && state.courseData.announcements) {
      for (const ann of state.courseData.announcements) {
        const annTitle = ann.title || "Announcement";
        const annFiles = [];
        const seenKeys = new Set();
        const seenNames = new Set();

        function addFile(rawName, rawPath) {
          if (!rawPath && !rawName) return;
          const normP = normalizeDocPath(rawPath || rawName);
          const resolvedP = fileMap[normP] || fileMap[normP.split("/").pop()] || normP;
          const name = (rawName || resolvedP.split("/").pop() || "Document").trim();
          const baseName = name.toLowerCase();
          const pathKey = resolvedP.toLowerCase();

          if (!seenKeys.has(pathKey) && !seenNames.has(baseName)) {
            seenKeys.add(pathKey);
            seenNames.add(baseName);
            annFiles.push({ name, path: resolvedP, context: annTitle });
          }
        }

        (ann.attachments || []).forEach(a => {
          if (a.local_file) addFile(a.title, a.local_file);
        });

        const mdLinkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
        let m;
        while ((m = mdLinkRegex.exec(ann.body || "")) !== null) {
          if (!/^(https?:\/\/|mailto:|#)/i.test(m[2])) {
            addFile(m[1], m[2]);
          }
        }
        const dataPathRegex = /data-filepath="([^"]+)"/g;
        while ((m = dataPathRegex.exec(ann.body_html || "")) !== null) {
          addFile("", m[1]);
        }

        if (annFiles.some(f => normalizeDocPath(f.path).toLowerCase() === resolvedTarget.toLowerCase() || (targetName && f.name.toLowerCase() === targetName))) {
          inferred = annFiles;
          break;
        }
      }
    } else if (state.activeView === "canvas" && state.activeCanvasTab === "assignments" && state.courseData && state.courseData.assignments) {
      for (const assign of state.courseData.assignments) {
        const assignTitle = assign.name || assign.title || "Assignment";
        const assignFiles = [];
        const seenKeys = new Set();
        const seenNames = new Set();

        function addFile(rawName, rawPath) {
          if (!rawPath && !rawName) return;
          const normP = normalizeDocPath(rawPath || rawName);
          const resolvedP = fileMap[normP] || fileMap[normP.split("/").pop()] || normP;
          const name = (rawName || resolvedP.split("/").pop() || "Document").trim();
          const baseName = name.toLowerCase();
          const pathKey = resolvedP.toLowerCase();

          if (!seenKeys.has(pathKey) && !seenNames.has(baseName)) {
            seenKeys.add(pathKey);
            seenNames.add(baseName);
            assignFiles.push({ name, path: resolvedP, context: assignTitle });
          }
        }

        (assign.attachments || []).forEach(a => {
          if (a.local_file) addFile(a.title, a.local_file);
        });

        const mdLinkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
        let m;
        while ((m = mdLinkRegex.exec(assign.body || "")) !== null) {
          if (!/^(https?:\/\/|mailto:|#)/i.test(m[2])) {
            addFile(m[1], m[2]);
          }
        }
        const dataPathRegex = /data-filepath="([^"]+)"/g;
        while ((m = dataPathRegex.exec(assign.body_html || "")) !== null) {
          addFile("", m[1]);
        }

        if (assignFiles.some(f => normalizeDocPath(f.path).toLowerCase() === resolvedTarget.toLowerCase() || (targetName && f.name.toLowerCase() === targetName))) {
          inferred = assignFiles;
          break;
        }
      }
    }

    // Physical Folder on Disk Fallback:
    // If not already in a module/announcement or opened from timeline/grades/direct link,
    // restrict navigation strictly to other files residing in the EXACT SAME directory on disk.
    if (inferred.length === 0 && filePath) {
      const parentDir = resolvedTarget.includes("/") ? resolvedTarget.substring(0, resolvedTarget.lastIndexOf("/")) : "";
      if (parentDir && fileMap) {
        const folderName = parentDir.split("/").pop();
        const sameFolder = Object.entries(fileMap)
          .filter(([n, p]) => {
            const dir = p.includes("/") ? p.substring(0, p.lastIndexOf("/")) : "";
            return dir === parentDir;
          })
          .map(([n, p]) => ({ name: n, path: p, context: folderName }));
        if (sameFolder.length > 0) {
          inferred = sameFolder;
        }
      }
    }

    // Safety fallback: Never dump all course files across unrelated directories.
    // If no containing folder is matched, scope strictly to the single file.
    if (inferred.length === 0) {
      const folderName = resolvedTarget && resolvedTarget.includes("/") ? resolvedTarget.split("/").slice(-2, -1)[0] : "";
      inferred = [{ name: fileName || resolvedTarget.split("/").pop() || "Document", path: resolvedTarget, context: folderName }];
    }

    state.previewFileList = inferred;
    state.previewCurrentIndex = state.previewFileList.findIndex(f => {
      const p = normalizeDocPath(f.path || f.filePath || f.relative_path || "").toLowerCase();
      const n = (f.name || "").toLowerCase();
      return (resolvedTarget && p === resolvedTarget.toLowerCase()) || (targetName && n === targetName);
    });
    if (state.previewCurrentIndex === -1) state.previewCurrentIndex = 0;
  }

  renderPreviewNavControls();
}

function renderPreviewNavControls() {
  const total = state.previewFileList.length;
  const idx = state.previewCurrentIndex;

  if (total <= 1 || idx === -1) {
    if (els.previewNavWidget) els.previewNavWidget.style.display = "none";
    if (els.floatingPreviewPrev) els.floatingPreviewPrev.style.display = "none";
    if (els.floatingPreviewNext) els.floatingPreviewNext.style.display = "none";
    return;
  }

  if (els.previewNavWidget) els.previewNavWidget.style.display = "flex";
  if (els.floatingPreviewPrev) els.floatingPreviewPrev.style.display = "flex";
  if (els.floatingPreviewNext) els.floatingPreviewNext.style.display = "flex";

  const activeEntry = (state.previewFileList && state.previewFileList[idx]) || null;
  const contextName = activeEntry?.context || "";

  if (els.previewIndexCounter) {
    els.previewIndexCounter.textContent = `${idx + 1} / ${total}`;
    els.previewIndexCounter.title = contextName ? `${contextName} (${idx + 1} of ${total})` : `File ${idx + 1} of ${total}`;
  }

  const hasPrev = idx > 0;
  const hasNext = idx < total - 1;

  if (els.btnPreviewPrev) els.btnPreviewPrev.disabled = !hasPrev;
  if (els.btnPreviewNext) els.btnPreviewNext.disabled = !hasNext;
  if (els.floatingPreviewPrev) els.floatingPreviewPrev.disabled = !hasPrev;
  if (els.floatingPreviewNext) els.floatingPreviewNext.disabled = !hasNext;
}

function navigatePreview(delta) {
  if (!state.previewFileList || state.previewFileList.length <= 1) return;
  const newIndex = state.previewCurrentIndex + delta;
  if (newIndex >= 0 && newIndex < state.previewFileList.length) {
    const nextFile = state.previewFileList[newIndex];
    openPreviewModal(nextFile.name, nextFile.path, state.previewFileList, newIndex);
  }
}

// ==========================================================================
// Top Header Index Progress & Search Status Implementation
// ==========================================================================

let headerIndexPollTimer = null;
let headerIndexController = null;
let headerIndexGeneration = 0;

// --- Module: 12_search.js ---
function stopHeaderIndexPolling() {
  headerIndexGeneration++;
  clearTimeout(headerIndexPollTimer);
  if (headerIndexController) headerIndexController.abort();
  headerIndexController = null;
}

function updateHeaderIndexProgressUI(data) {
  if (!data) return;
  const isDone = (data.percent_complete >= 100 && data.phase === "idle") ||
                 (data.processed >= data.total && data.total > 0 && data.phase === "idle");
  const isBusy = !isDone && (data.state === "indexing" || data.phase === "scanning" || data.phase === "extracting" || data.phase === "ocr" || (data.percent_complete < 100 && data.total > 0));

  const pct = Math.min(100, Math.max(0, data.percent_complete != null ? data.percent_complete : (data.total ? Math.round((data.processed / data.total) * 100) : 0)));
  const total = data.total || 0;
  const processed = data.processed || 0;

  // 1. Top Mini Bar Fill
  if (els.indexMiniBarFill) {
    els.indexMiniBarFill.style.width = `${pct}%`;
    els.indexMiniBarFill.classList.toggle("indexing", isBusy);
  }

  // 2. Percentage display
  if (els.indexStatusPct) {
    els.indexStatusPct.textContent = `${Math.round(pct)}%`;
  }

  // 3. Indicator Dot
  if (els.indexStatusIndicator) {
    els.indexStatusIndicator.className = "index-status-indicator";
    if (isBusy) {
      els.indexStatusIndicator.classList.add("indexing");
    } else if (data.state === "error") {
      els.indexStatusIndicator.classList.add("error");
    }
  }

  // 4. Header title label
  if (els.indexStatusTitle) {
    if (isBusy) {
      if (data.phase === "ocr" || data.pending_ocr > 0) {
        els.indexStatusTitle.textContent = "OCR Processing...";
      } else {
        els.indexStatusTitle.textContent = `Indexing (${processed}/${total})`;
      }
    } else if (data.state === "error") {
      els.indexStatusTitle.textContent = "Index Error";
    } else {
      els.indexStatusTitle.textContent = "Index Ready";
    }
  }

  // 5. Popover elements
  if (els.indexPopoverDot) {
    els.indexPopoverDot.className = "index-popover-dot";
    if (isBusy) els.indexPopoverDot.classList.add("indexing");
  }

  if (els.indexStateBadge) {
    els.indexStateBadge.className = "index-state-badge";
    if (isBusy) {
      els.indexStateBadge.classList.add("indexing");
      els.indexStateBadge.textContent = data.phase === "ocr" ? "OCR Active" : "Indexing";
    } else if (data.state === "error") {
      els.indexStateBadge.textContent = "Error";
    } else {
      els.indexStateBadge.textContent = "Ready";
    }
  }

  if (els.indexDetailFiles) {
    els.indexDetailFiles.textContent = `${processed} / ${total} files`;
  }

  if (els.indexDetailOcr) {
    const ocrEngine = data.ocr?.engine || (data.ocr?.available ? "Apple Vision" : "Standard Text");
    els.indexDetailOcr.textContent = ocrEngine;
  }

  if (els.indexDetailOcrPages) {
    const ocrCompleted = data.ocr_completed || 0;
    const ocrTotal = data.ocr_total || 0;
    els.indexDetailOcrPages.textContent = ocrTotal > 0 ? `${ocrCompleted} / ${ocrTotal} pages` : (data.ocr?.enabled ? "0 pages" : "Disabled");
  }

  if (els.indexDetailFileRow && els.indexDetailCurrentFile) {
    if (isBusy && data.current_file) {
      els.indexDetailFileRow.style.display = "flex";
      const fname = data.current_file.split("/").pop();
      els.indexDetailCurrentFile.textContent = fname;
      els.indexDetailCurrentFile.title = data.current_file;
    } else {
      els.indexDetailFileRow.style.display = "none";
    }
  }
}

function startHeaderIndexPolling(forceFast = false) {
  stopHeaderIndexPolling();
  const generation = headerIndexGeneration;
  const course = state.currentCourse;
  if (!course) return;

  const poll = async () => {
    if (course !== state.currentCourse || generation !== headerIndexGeneration) return;
    const controller = new AbortController();
    headerIndexController = controller;
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await fetch(`/api/courses/${encodeURIComponent(course)}/search/status`, { signal: controller.signal });
      if (!res.ok) throw new Error("Status unavailable");
      const status = await res.json();
      if (course !== state.currentCourse || generation !== headerIndexGeneration) return;
      state.headerIndexStatus = status;
      updateHeaderIndexProgressUI(status);

      const isDone = (status.percent_complete >= 100 && status.phase === "idle") ||
                     (status.processed >= status.total && status.total > 0 && status.phase === "idle");
      const isBusy = !isDone && (status.state === "indexing" || status.phase === "scanning" || status.phase === "extracting" || status.phase === "ocr" || (status.percent_complete < 100 && status.total > 0));

      const isPopoverOpen = Boolean(els.indexDetailsPopover && !els.indexDetailsPopover.classList.contains("hidden") && els.indexDetailsPopover.style.display !== "none");
      // Ultra-fast real-time polling (150ms) while busy or while popover is open; 5s when idle
      const delay = (isBusy || isPopoverOpen) ? 150 : 5000;
      headerIndexPollTimer = setTimeout(poll, delay);
    } catch (err) {
      if (course !== state.currentCourse || generation !== headerIndexGeneration) return;
      headerIndexPollTimer = setTimeout(poll, 4000);
    } finally {
      clearTimeout(timeout);
    }
  };
  poll();
}

function resetHeaderIndexProgressUI() {
  if (els.indexStatusTitle) els.indexStatusTitle.textContent = "Checking Index...";
  if (els.indexStatusPct) els.indexStatusPct.textContent = "--%";
  if (els.indexMiniBarFill) {
    els.indexMiniBarFill.style.width = "0%";
    els.indexMiniBarFill.classList.add("indexing");
  }
  if (els.indexStatusIndicator) {
    els.indexStatusIndicator.className = "index-status-indicator indexing";
  }
  if (els.indexDetailFiles) els.indexDetailFiles.textContent = "-- / --";
  if (els.indexDetailOcrPages) els.indexDetailOcrPages.textContent = "--";
  if (els.indexStateBadge) {
    els.indexStateBadge.className = "index-state-badge indexing";
    els.indexStateBadge.textContent = "Syncing";
  }
}

function toggleIndexDetailsPopover(e) {
  if (e) {
    e.preventDefault();
    e.stopPropagation();
  }
  if (!els.indexDetailsPopover) return;
  const isHidden = els.indexDetailsPopover.classList.contains("hidden") ||
                   els.indexDetailsPopover.style.display === "none";
  if (isHidden) {
    els.indexDetailsPopover.classList.remove("hidden");
    els.indexDetailsPopover.style.display = "block";
    if (els.indexPopoverBackdrop) {
      els.indexPopoverBackdrop.classList.remove("hidden");
      els.indexPopoverBackdrop.style.display = "block";
    }
    if (els.indexProgressBtn) els.indexProgressBtn.classList.add("active-popover");
    if (state.headerIndexStatus) updateHeaderIndexProgressUI(state.headerIndexStatus);
    startHeaderIndexPolling(true);
  } else {
    closeIndexDetailsPopover();
  }
}

function closeIndexDetailsPopover() {
  if (els.indexDetailsPopover) {
    els.indexDetailsPopover.classList.add("hidden");
    els.indexDetailsPopover.style.display = "none";
  }
  if (els.indexPopoverBackdrop) {
    els.indexPopoverBackdrop.classList.add("hidden");
    els.indexPopoverBackdrop.style.display = "none";
  }
  if (els.indexProgressBtn) els.indexProgressBtn.classList.remove("active-popover");
}

async function triggerIndexRebuild() {
  if (!state.currentCourse) return;
  if (els.btnTriggerReindex) {
    els.btnTriggerReindex.disabled = true;
    els.btnTriggerReindex.innerHTML = `<span>⏳</span><span>Rebuilding...</span>`;
  }
  try {
    await fetch(`/api/courses/${encodeURIComponent(state.currentCourse)}/search/rebuild`, { method: "POST" });
    updateHeaderIndexProgressUI({
      state: "indexing",
      phase: "scanning",
      processed: 0,
      total: state.headerIndexStatus?.total || 100,
      percent_complete: 0
    });
    startHeaderIndexPolling(true);
  } catch (err) {
    console.error("Failed to trigger index rebuild:", err);
  } finally {
    setTimeout(() => {
      if (els.btnTriggerReindex) {
        els.btnTriggerReindex.disabled = false;
        els.btnTriggerReindex.innerHTML = `<span class="reindex-btn-icon">⚡</span><span>Rebuild Search Index</span>`;
      }
    }, 1500);
  }
}

// Spotlight Search Implementation (Debounced, Modal, Filter Chips, Curriculum)
let searchDebounceTimer = null;
let currentSearchAbortController = null;
let searchStatusTimer = null;
let searchStatusController = null;
let searchStatusGeneration = 0;
let lastSearchIndexStatus = null;

function stopSearchStatusPolling() {
  searchStatusGeneration++;
  clearTimeout(searchStatusTimer);
  if (searchStatusController) searchStatusController.abort();
  searchStatusController = null;
}

function renderSearchIndexStatus(status, unavailable = false) {
  if (status && typeof updateHeaderIndexProgressUI === "function") updateHeaderIndexProgressUI(status);
  if (!els.searchModalContent) return;
  let banner = document.getElementById("search-index-status");
  if (!banner) {
    banner = document.createElement("div");
    banner.id = "search-index-status";
    banner.setAttribute("role", "status");
    banner.setAttribute("aria-live", "polite");
    banner.style.cssText = "padding:10px 20px;color:var(--text-muted);font-size:13px;";
    els.searchModalContent.prepend(banner);
  }
  const busy = status && ["queued", "indexing"].includes(status.state);
  let text = "";
  if (unavailable) text = "Index status unavailable. Results may be incomplete; retrying shortly.";
  else if (busy) text = `Indexing course: ${status.processed || 0} of ${status.total || 0} files. Results are incomplete and update automatically.`;
  else if (status && status.state === "error") text = "Indexing could not finish. Available results may be incomplete.";
  else if (status && (status.pending_ocr || status.partial)) text = "Some scanned pages are still being recognized. Results are incomplete and update automatically.";
  else if (status && status.failed) text = `${status.failed} file(s) could not be fully indexed. Available results are shown.`;
  if (status && status.ocr_total) text += ` OCR: ${status.ocr_completed || 0} of ${status.ocr_total} pages.`;
  banner.textContent = text;
  banner.hidden = !text;
}

function startSearchStatusPolling() {
  stopSearchStatusPolling();
  lastSearchIndexStatus = null;
  const generation = searchStatusGeneration;
  const course = state.currentCourse;
  let failures = 0;
  const active = () => state.search.isOpen && course === state.currentCourse && generation === searchStatusGeneration;
  const poll = async () => {
    if (!active() || !course) return;
    const controller = new AbortController();
    searchStatusController = controller;
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch(`/api/courses/${encodeURIComponent(course)}/search/status`, {signal: controller.signal});
      if (!response.ok) throw new Error("Index status unavailable");
      const status = await response.json();
      if (!active()) return;
      const previous = lastSearchIndexStatus;
      lastSearchIndexStatus = status;
      failures = 0;
      renderSearchIndexStatus(status);
      const changed = previous && (status.revision !== previous.revision ||
        (status.state === "ready" && previous.state !== "ready") || status.pending_ocr !== previous.pending_ocr);
      if (changed && state.search.query.trim()) await executeCourseSearch(state.search.query.trim());
    } catch (error) {
      if (!active()) return;
      failures++;
      renderSearchIndexStatus(null, true);
    } finally {
      clearTimeout(timeout);
      if (active()) searchStatusTimer = setTimeout(poll, failures ? Math.min(30000, 2000 * 2 ** Math.min(failures, 4)) : 2000);
    }
  };
  poll();
}

function openSearchModal(initialQuery = "") {
  state.search.isOpen = true;
  startSearchStatusPolling();
  if (els.searchModal) {
    els.searchModal.classList.remove("hidden");
  }

  const query = typeof initialQuery === "string" ? initialQuery : (state.search.query || "");
  if (els.spotlightSearchInput) {
    els.spotlightSearchInput.value = query;
    els.spotlightSearchInput.focus();
    els.spotlightSearchInput.select();
  }

  if (query.trim()) {
    handleSearchInput(query);
  } else {
    showSearchEmptyState(true);
  }
}

function closeSearchModal() {
  state.search.isOpen = false;
  stopSearchStatusPolling();
  clearTimeout(searchDebounceTimer);
  if (currentSearchAbortController) currentSearchAbortController.abort();
  if (els.searchModal) {
    els.searchModal.classList.add("hidden");
  }
  if (els.spotlightSearchInput) els.spotlightSearchInput.blur();
  if (els.globalSearchInput) els.globalSearchInput.blur();
}

function showSearchEmptyState(show) {
  if (els.searchEmptyState) els.searchEmptyState.style.display = show ? "flex" : "none";
  if (els.searchLoadingState) els.searchLoadingState.classList.add("hidden");
  if (els.searchNoResults) els.searchNoResults.classList.add("hidden");
  if (show) {
    if (els.curriculumMatchContainer) els.curriculumMatchContainer.innerHTML = "";
    if (els.searchResultsList) els.searchResultsList.innerHTML = "";
    if (els.searchFooterStats) els.searchFooterStats.textContent = "";
  }
}

function showSearchLoading(loading) {
  state.search.loading = loading;
  if (els.searchLoadingState) {
    els.searchLoadingState.classList.toggle("hidden", !loading);
  }
  if (loading) {
    if (els.searchEmptyState) els.searchEmptyState.style.display = "none";
    if (els.searchNoResults) els.searchNoResults.classList.add("hidden");
  }
}

function handleSearchInput(query) {
  state.search.query = query;

  // Sync inputs
  if (els.globalSearchInput && els.globalSearchInput.value !== query) {
    els.globalSearchInput.value = query;
  }
  if (els.spotlightSearchInput && els.spotlightSearchInput.value !== query) {
    els.spotlightSearchInput.value = query;
  }

  // Toggle clear buttons
  const hasText = query.trim().length > 0;
  if (els.searchClearBtn) els.searchClearBtn.classList.toggle("hidden", !hasText);
  if (els.spotlightClearBtn) els.spotlightClearBtn.classList.toggle("hidden", !hasText);

  clearTimeout(searchDebounceTimer);
  if (currentSearchAbortController) currentSearchAbortController.abort();

  if (!hasText) {
    state.search.results = [];
    state.search.curriculumMatches = [];
    state.search.selectedIndex = 0;
    showSearchEmptyState(true);
    return;
  }

  showSearchLoading(true);

  // 200ms debounced search request
  searchDebounceTimer = setTimeout(async () => {
    await executeCourseSearch(query.trim());
  }, 200);
}

async function executeCourseSearch(query) {
  if (currentSearchAbortController) {
    currentSearchAbortController.abort();
  }
  const controller = new AbortController();
  currentSearchAbortController = controller;
  const course = state.currentCourse;
  const active = () => !controller.signal.aborted && course === state.currentCourse && state.search.query.trim() === query;

  try {
    const res = await fetch(`/api/courses/${encodeURIComponent(course)}/search?q=${encodeURIComponent(query)}`, {
      signal: controller.signal
    });

    if (res.ok) {
      const data = await res.json();
      if (!active()) return;
      if (data.index_status) renderSearchIndexStatus(data.index_status);
      state.search.curriculumMatches = data.curriculum_matches || data.curriculumMatches || [];
      state.search.results = data.results || data.file_matches || data.fileMatches || data.files || [];
    } else {
      if (!active()) return;
      renderSearchIndexStatus(null, true);
      // Graceful local index search fallback if backend search endpoint is unavailable or returns 404
      const fallback = performClientFallbackSearch(query);
      state.search.curriculumMatches = fallback.curriculum_matches;
      state.search.results = fallback.results;
    }
  } catch (err) {
    if (err.name === "AbortError" || !active()) return;
    renderSearchIndexStatus(null, true);
    console.warn("Search endpoint returned error, using offline local search index:", err);
    const fallback = performClientFallbackSearch(query);
    state.search.curriculumMatches = fallback.curriculum_matches;
    state.search.results = fallback.results;
  } finally {
    if (active()) {
      showSearchLoading(false);
      renderSearchResults();
    }
  }
}

function performClientFallbackSearch(query) {
  const q = query.toLowerCase().trim();
  const tokens = q.split(/\s+/).filter(Boolean);
  const results = [];
  const curriculumMatches = [];

  if (!state.courseData) return { results, curriculum_matches: curriculumMatches };

  // 1. Curriculum topic matching (Syllabus schedule and topics)
  const syllabus = state.courseData.syllabus || {};
  const schedule = syllabus.schedule || [];
  for (const item of schedule) {
    const itemText = `${item.date || ''} ${item.title || ''} ${item.topic || ''} ${item.description || ''}`.toLowerCase();
    if (tokens.every(tok => itemText.includes(tok)) || (tokens.length > 1 && tokens.filter(tok => itemText.includes(tok)).length >= 2)) {
      const matchedFiles = [];
      if (item.file) matchedFiles.push(item.file);
      if (state.courseData.file_path_map) {
        for (const fName of Object.keys(state.courseData.file_path_map)) {
          if (tokens.some(tok => fName.toLowerCase().includes(tok))) {
            if (!matchedFiles.includes(fName)) matchedFiles.push(fName);
          }
        }
      }
      curriculumMatches.push({
        badge: item.title || item.topic || "Curriculum Chapter / Topic",
        reasoning: "Identified from Syllabus & Announcements",
        description: item.description || (item.date ? `Scheduled for ${item.date}` : ""),
        files: matchedFiles.slice(0, 5)
      });
      break;
    }
  }

  // 2. File matches from course file catalog
  const fileMap = state.courseData.file_path_map || {};
  for (const [fName, fPath] of Object.entries(fileMap)) {
    const lowerName = fName.toLowerCase();
    const lowerPath = (fPath || '').toLowerCase();
    let score = 0;
    let matchType = "Filename Match";

    if (lowerName.includes(q)) score += 50;
    else if (tokens.every(tok => lowerName.includes(tok))) score += 35;
    else if (tokens.some(tok => lowerName.includes(tok))) score += 15;

    if (lowerPath.includes(q)) score += 20;

    if (score > 0) {
      const folder = fPath.includes("/") ? fPath.substring(0, fPath.lastIndexOf("/")) : "Course Files";
      let category = "all";
      const ext = fName.split(".").pop().toLowerCase();
      if (["pdf", "pptx", "ppt", "key"].includes(ext)) category = "slides";
      if (/exam|quiz|midterm|final|assignment|hw|homework|solution|rubric/i.test(lowerName) || /exam|assignment/i.test(lowerPath)) {
        category = "exams";
        matchType = "Exam / Assignment Match";
      } else if (/ch\s*\d+|chapter|topic|reading|syllabus/i.test(lowerName) || /lecture|chapter/i.test(lowerPath)) {
        category = "chapters";
        matchType = "Chapter Content Match";
      }

      results.push({
        name: fName,
        path: fPath,
        folder: folder,
        match_type: matchType,
        snippet: `Course material located in <strong>${escapeHtml(folder)}</strong> matching your search query.`,
        category: category,
        score: score
      });
    }
  }

  results.sort((a, b) => b.score - a.score);
  return { results, curriculum_matches: curriculumMatches };
}

function renderSearchResults() {
  if (typeof renderSearchDropdown === "function") renderSearchDropdown();
  if (state.activeView === "search" && typeof renderSearchResultsView === "function") {
    renderSearchResultsView();
  }
  if (els.searchEmptyState) els.searchEmptyState.style.display = "none";
  const filter = state.search.activeFilter;
  const q = state.search.query.toLowerCase().trim();

  // Filter file results based on active filter chip
  const allResults = state.search.results || [];
  let filteredResults = allResults;

  if (filter === "chapters") {
    filteredResults = allResults.filter(r => {
      const name = (r.name || "").toLowerCase();
      const folder = (r.folder || "").toLowerCase();
      return r.category === "chapters" || /chapter|ch\s*\d+|topic|unit|syllabus|reading/i.test(name) || /chapter|lecture/i.test(folder);
    });
  } else if (filter === "slides") {
    filteredResults = allResults.filter(r => {
      const name = (r.name || "").toLowerCase();
      const folder = (r.folder || "").toLowerCase();
      const ext = name.split(".").pop();
      return r.category === "slides" || ["pptx", "ppt", "key"].includes(ext) || /slide|lecture|presentation/i.test(name) || /slide|lecture/i.test(folder);
    });
  } else if (filter === "exams") {
    filteredResults = allResults.filter(r => {
      const name = (r.name || "").toLowerCase();
      const folder = (r.folder || "").toLowerCase();
      return r.category === "exams" || /exam|quiz|midterm|final|assignment|hw|homework|solution|rubric|practice/i.test(name) || /exam|assignment|quiz/i.test(folder);
    });
  }

  // 1. Render Curriculum Match Banner
  const showCurriculum = (filter === "all" || filter === "chapters") && (state.search.curriculumMatches || []).length > 0;
  if (showCurriculum && els.curriculumMatchContainer) {
    let currHtml = "";
    state.search.curriculumMatches.forEach((cm) => {
      const badge = cm.badge || (cm.chapter && cm.topic && cm.chapter !== cm.topic ? `${cm.chapter} • ${cm.topic}` : (cm.chapter || cm.topic || cm.title || "Curriculum Chapter"));
      const reasoning = cm.reasoning || cm.reason || cm.context || "Identified from Syllabus & Announcements";
      const desc = cm.description || cm.summary || "";
      const files = cm.files || cm.associated_files || cm.target_files || [];

      currHtml += `
        <div class="curriculum-match-banner">
          <div class="curriculum-banner-header">
            <span class="curriculum-badge">${Icons.courseCap} ${escapeHtml(badge)}</span>
            <span class="curriculum-reasoning">${Icons.checkCircle} ${escapeHtml(reasoning)}</span>
          </div>
          ${desc ? `<div class="curriculum-banner-desc">${highlightQueryInText(desc, state.search.query)}</div>` : ""}
          ${files.length > 0 ? `
            <div class="curriculum-files-section">
              <span class="curriculum-files-label">Associated Materials:</span>
              <div class="curriculum-file-chips-row">
                ${files.map((f) => {
                  const fName = typeof f === "string" ? f : (f.name || "");
                  const fPath = (typeof f === "object" && f.path) || (state.courseData?.file_path_map && state.courseData.file_path_map[fName]) || fName;
                  return `
                    <button class="curriculum-file-chip" data-filename="${escapeHtml(fName)}" data-filepath="${escapeHtml(fPath)}" title="Preview ${escapeHtml(fName)}">
                      <span class="chip-icon">${getFileIcon(fName)}</span>
                      <span class="chip-name">${escapeHtml(fName)}</span>
                      <span class="chip-preview-badge">Preview ↗</span>
                    </button>
                  `;
                }).join("")}
              </div>
            </div>
          ` : ""}
        </div>
      `;
    });
    els.curriculumMatchContainer.innerHTML = currHtml;

    // Attach click listeners to curriculum file chips
    els.curriculumMatchContainer.querySelectorAll(".curriculum-file-chip").forEach(btn => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const fName = btn.getAttribute("data-filename");
        const fPath = btn.getAttribute("data-filepath");
        if (fPath) {
          const filesInBanner = Array.from(els.curriculumMatchContainer.querySelectorAll(".curriculum-file-chip")).map(b => ({
            name: b.getAttribute("data-filename"),
            path: b.getAttribute("data-filepath")
          }));
          const fIdx = filesInBanner.findIndex(f => f.path === fPath);
          openPreviewModal(fName, fPath, filesInBanner, fIdx);
        }
      });
    });
  } else if (els.curriculumMatchContainer) {
    els.curriculumMatchContainer.innerHTML = "";
  }

  // 2. Render File Match Results List
  if (filteredResults.length > 0 && els.searchResultsList) {
    const listFilesForPreview = filteredResults.map(r => ({ name: r.name, path: r.path }));
    let listHtml = "";

    filteredResults.forEach((item, idx) => {
      const icon = getFileIcon(item.name);
      const isSelected = idx === state.search.selectedIndex;
      const folder = item.folder || item.breadcrumb || "Course Files";

      let matchBadge = item.match_type || "Page Content Match";
      if (item.page_num) {
        const ext = (item.name || "").split(".").pop().toLowerCase();
        matchBadge = (["pptx", "ppt", "key"].includes(ext) ? `Slide ${item.page_num} Match` : `Page ${item.page_num} Content Match`);
      } else if (item.match_type === "content") {
        matchBadge = "Page Content Match";
      } else if (item.match_type === "filename") {
        matchBadge = "Filename Match";
      } else if (item.match_type === "curriculum") {
        matchBadge = "Curriculum Match";
      }

      let badgeClass = "";
      if (/filename/i.test(matchBadge)) badgeClass = "badge-filename";
      else if (/syllabus|curriculum/i.test(matchBadge)) badgeClass = "badge-syllabus";

      const snippet = item.snippet || item.context || `File matches search query in <strong>${escapeHtml(folder)}</strong>.`;

      listHtml += `
        <div class="search-result-item ${isSelected ? "selected" : ""}" data-index="${idx}" data-name="${escapeHtml(item.name)}" data-path="${escapeHtml(item.path)}">
          <div class="search-result-left">
            <div class="search-result-icon">${icon}</div>
            <div class="search-result-details">
              <div class="search-result-header-row">
                <span class="search-result-name">${highlightQueryInText(item.name, state.search.query)}</span>
                <span class="search-match-badge ${badgeClass}">${escapeHtml(matchBadge)}</span>
              </div>
              <div class="search-result-breadcrumb">${Icons.folderOpen} ${escapeHtml(folder)}</div>
              <div class="search-result-snippet">${highlightQueryInText(snippet, state.search.query, true)}</div>
            </div>
          </div>
          <div class="search-item-actions">
            <button class="search-action-btn btn-action-preview" data-name="${escapeHtml(item.name)}" data-path="${escapeHtml(item.path)}" title="Preview file in browser">
              ${Icons.preview} <span>Preview</span>
            </button>
            <button class="search-action-btn btn-action-open" data-path="${escapeHtml(item.path)}" title="Open in Default App">
              ${Icons.macApp} <span>Open</span>
            </button>
            <button class="search-action-btn btn-action-reveal" data-path="${escapeHtml(item.path)}" title="Show in Folder">
              ${Icons.macFinder} <span>Folder</span>
            </button>
          </div>
        </div>
      `;
    });

    els.searchResultsList.innerHTML = listHtml;

    // Attach click and action handlers
    const resultItems = els.searchResultsList.querySelectorAll(".search-result-item");
    resultItems.forEach((card, idx) => {
      card.addEventListener("click", (e) => {
        // If an inner action button was clicked, let its handler handle it
        if (e.target.closest(".search-action-btn")) return;
        const name = card.getAttribute("data-name");
        const path = card.getAttribute("data-path");
        state.search.selectedIndex = idx;
        updateSelectedSearchResult(Array.from(resultItems));
        openPreviewModal(name, path, listFilesForPreview, idx);
      });

      card.addEventListener("mouseenter", () => {
        state.search.selectedIndex = idx;
        updateSelectedSearchResult(Array.from(resultItems));
      });
    });

    els.searchResultsList.querySelectorAll(".btn-action-preview").forEach((btn, idx) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const name = btn.getAttribute("data-name");
        const path = btn.getAttribute("data-path");
        openPreviewModal(name, path, listFilesForPreview, idx);
      });
    });

    els.searchResultsList.querySelectorAll(".btn-action-open").forEach(btn => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const path = btn.getAttribute("data-path");
        if (path) openFileInSystem(path, "open");
      });
    });

    els.searchResultsList.querySelectorAll(".btn-action-reveal").forEach(btn => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const path = btn.getAttribute("data-path");
        if (path) openFileInSystem(path, "reveal");
      });
    });

    if (els.searchNoResults) els.searchNoResults.classList.add("hidden");
  } else if (els.searchResultsList) {
    els.searchResultsList.innerHTML = "";
    if (!showCurriculum && els.searchNoResults) {
      els.searchNoResults.classList.remove("hidden");
      if (els.searchNoResultsDesc) {
        els.searchNoResultsDesc.textContent = `No files or curriculum topics found matching "${state.search.query}".`;
      }
    } else if (els.searchNoResults) {
      els.searchNoResults.classList.add("hidden");
    }
  }

  // 3. Update Footer Stats
  if (els.searchFooterStats) {
    const fileCount = filteredResults.length;
    const currCount = (state.search.curriculumMatches || []).length;
    let statText = `${fileCount} file${fileCount === 1 ? "" : "s"} found`;
    if (currCount > 0) statText += ` • ${currCount} curriculum match`;
    els.searchFooterStats.textContent = statText;
  }
}

function updateSelectedSearchResult(items) {
  items.forEach((item, idx) => {
    const isSel = idx === state.search.selectedIndex;
    item.classList.toggle("selected", isSel);
    if (isSel) {
      item.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  });
}

// ==========================================================================
// Live Search Dropdown & Dedicated Search Results Page Implementation
// ==========================================================================

function handleHeaderSearchInput(query) {
  state.search.query = query;
  if (els.globalSearchInput && els.globalSearchInput.value !== query) {
    els.globalSearchInput.value = query;
  }
  if (els.spotlightSearchInput && els.spotlightSearchInput.value !== query) {
    els.spotlightSearchInput.value = query;
  }

  const hasText = query.trim().length > 0;
  if (els.searchClearBtn) els.searchClearBtn.classList.toggle("hidden", !hasText);
  if (els.spotlightClearBtn) els.spotlightClearBtn.classList.toggle("hidden", !hasText);

  clearTimeout(searchDebounceTimer);
  if (currentSearchAbortController) currentSearchAbortController.abort();

  if (!hasText) {
    state.search.results = [];
    state.search.curriculumMatches = [];
    state.search.selectedIndex = 0;
    state.search.dropdownSelectedIndex = -1;
    closeSearchDropdown();
    if (state.activeView === "search") {
      renderSearchResultsView();
    }
    return;
  }

  // Open dropdown and show loading state
  openSearchDropdown();

  searchDebounceTimer = setTimeout(async () => {
    await executeCourseSearch(query.trim());
  }, 180);
}

function handleHeaderSearchKeydown(e) {
  const isDropdownOpen = state.search.isDropdownOpen && els.headerSearchDropdown && !els.headerSearchDropdown.classList.contains("hidden");

  if (e.key === "ArrowDown") {
    if (!isDropdownOpen && els.globalSearchInput.value.trim()) {
      handleHeaderSearchInput(els.globalSearchInput.value);
      return;
    }
    if (isDropdownOpen) {
      e.preventDefault();
      navigateSearchDropdown(1);
    }
    return;
  }

  if (e.key === "ArrowUp") {
    if (isDropdownOpen) {
      e.preventDefault();
      navigateSearchDropdown(-1);
    }
    return;
  }

  if (e.key === "Enter") {
    e.preventDefault();
    const query = (els.globalSearchInput ? els.globalSearchInput.value : "").trim();
    if (!query) return;

    if (isDropdownOpen && state.search.dropdownSelectedIndex >= 0) {
      const items = Array.from(els.headerSearchDropdown.querySelectorAll(".dropdown-item"));
      if (state.search.dropdownSelectedIndex < items.length) {
        items[state.search.dropdownSelectedIndex].click();
        closeSearchDropdown();
        return;
      }
    }

    // Otherwise Enter navigates to the dedicated Search Results Page!
    closeSearchDropdown();
    if (state.activeView !== "search") {
      switchView("search");
    }
    renderSearchResultsView();
    return;
  }

  if (e.key === "Escape") {
    if (isDropdownOpen) {
      e.preventDefault();
      closeSearchDropdown();
      if (els.globalSearchInput) els.globalSearchInput.blur();
    }
    return;
  }
}

function openSearchDropdown() {
  state.search.isDropdownOpen = true;
  if (!els.headerSearchDropdown) return;
  els.headerSearchDropdown.classList.remove("hidden");
  els.headerSearchDropdown.style.display = "flex";

  if (state.search.loading || (!state.search.results.length && !state.search.curriculumMatches.length && state.search.query.trim())) {
    els.headerSearchDropdown.innerHTML = `
      <div class="dropdown-loading-state">
        <span>🔍</span> <span>Searching course files & topics...</span>
      </div>
    `;
  } else {
    renderSearchDropdown();
  }
}

function closeSearchDropdown() {
  state.search.isDropdownOpen = false;
  state.search.dropdownSelectedIndex = -1;
  if (els.headerSearchDropdown) {
    els.headerSearchDropdown.classList.add("hidden");
    els.headerSearchDropdown.style.display = "none";
  }
}

function navigateSearchDropdown(delta) {
  if (!els.headerSearchDropdown || !state.search.isDropdownOpen) return;
  const items = Array.from(els.headerSearchDropdown.querySelectorAll(".dropdown-item"));
  const footer = els.headerSearchDropdown.querySelector("#dropdown-see-all");
  const maxIdx = items.length + (footer ? 1 : 0);
  if (maxIdx === 0) return;

  let newIdx = state.search.dropdownSelectedIndex + delta;
  if (newIdx < 0) newIdx = maxIdx - 1;
  else if (newIdx >= maxIdx) newIdx = 0;

  state.search.dropdownSelectedIndex = newIdx;

  items.forEach((item, idx) => {
    item.classList.toggle("selected", idx === newIdx);
    if (idx === newIdx) item.scrollIntoView({ block: "nearest", behavior: "smooth" });
  });

  if (footer) {
    footer.classList.toggle("selected", newIdx === items.length);
  }
}

function renderSearchDropdown() {
  if (!els.headerSearchDropdown || !state.search.isDropdownOpen) return;
  const q = (state.search.query || "").trim();
  if (!q) {
    closeSearchDropdown();
    return;
  }

  const currMatches = state.search.curriculumMatches || [];
  const allResults = state.search.results || [];
  const topResults = allResults.slice(0, 6);

  if (currMatches.length === 0 && topResults.length === 0) {
    els.headerSearchDropdown.innerHTML = `
      <div class="dropdown-empty-state">
        <span>No materials found for "<strong>${escapeHtml(q)}</strong>"</span>
      </div>
      <div class="dropdown-footer" id="dropdown-see-all">
        <span class="dropdown-footer-key"><kbd>↵ Enter</kbd> Search Page</span>
        <span class="dropdown-footer-hint">View all results ↗</span>
      </div>
    `;
    const footer = els.headerSearchDropdown.querySelector("#dropdown-see-all");
    if (footer) {
      footer.addEventListener("click", () => {
        closeSearchDropdown();
        switchView("search");
        renderSearchResultsView();
      });
    }
    return;
  }

  let html = "";

  // 1. Curriculum Match Banner (Top Chapter / Topic suggestion)
  if (currMatches.length > 0) {
    const cm = currMatches[0];
    const badge = cm.badge || (cm.chapter && cm.topic && cm.chapter !== cm.topic ? `${cm.chapter} • ${cm.topic}` : (cm.chapter || cm.topic || cm.title || "Curriculum Chapter"));
    const reasoning = cm.reasoning || cm.reason || cm.context || "Identified from Syllabus & Announcements";
    const files = cm.files || cm.associated_files || cm.target_files || [];

    html += `
      <div class="dropdown-curriculum-banner">
        <div class="dropdown-curriculum-header">
          <span class="dropdown-curriculum-badge">${Icons.courseCap} ${escapeHtml(badge)}</span>
          <span class="dropdown-curriculum-reasoning">${Icons.checkCircle} ${escapeHtml(reasoning)}</span>
        </div>
        ${files.length > 0 ? `
          <div class="dropdown-curriculum-chips">
            ${files.slice(0, 3).map(f => {
              const fName = typeof f === "string" ? f : (f.name || "");
              const fPath = (typeof f === "object" && f.path) || (state.courseData?.file_path_map && state.courseData.file_path_map[fName]) || fName;
              return `
                <button class="dropdown-curriculum-chip" data-name="${escapeHtml(fName)}" data-path="${escapeHtml(fPath)}" title="Preview ${escapeHtml(fName)}">
                  ${getFileIcon(fName)} <span>${escapeHtml(fName)}</span>
                </button>
              `;
            }).join("")}
          </div>
        ` : ""}
      </div>
    `;
  }

  // 2. Top Matching Files
  if (topResults.length > 0) {
    html += `<div class="dropdown-results-list" role="listbox">`;
    topResults.forEach((item, idx) => {
      const isSel = idx === state.search.dropdownSelectedIndex;
      const folder = item.folder || item.breadcrumb || "Course Files";
      let matchBadge = item.match_type || "Page Content";
      if (item.page_num) {
        const ext = (item.name || "").split(".").pop().toLowerCase();
        matchBadge = (["pptx", "ppt", "key"].includes(ext) ? `Slide ${item.page_num}` : `Page ${item.page_num}`);
      } else if (item.match_type === "filename") {
        matchBadge = "Filename";
      } else if (item.match_type === "curriculum") {
        matchBadge = "Curriculum";
      }

      let badgeClass = "";
      if (/filename/i.test(matchBadge)) badgeClass = "badge-filename";
      else if (/syllabus|curriculum/i.test(matchBadge)) badgeClass = "badge-syllabus";

      const snippet = item.snippet || item.context || "";

      html += `
        <div class="dropdown-item ${isSel ? "selected" : ""}" data-index="${idx}" data-name="${escapeHtml(item.name)}" data-path="${escapeHtml(item.path)}">
          <div class="dropdown-item-icon">${getFileIcon(item.name)}</div>
          <div class="dropdown-item-content">
            <div class="dropdown-item-title-row">
              <span class="dropdown-item-name">${highlightQueryInText(item.name, q)}</span>
              <span class="dropdown-item-badge ${badgeClass}">${escapeHtml(matchBadge)}</span>
            </div>
            <div class="dropdown-item-folder">${Icons.folderOpen} ${escapeHtml(folder)}</div>
            ${snippet ? `<div class="dropdown-item-snippet">${highlightQueryInText(snippet, q, true)}</div>` : ""}
          </div>
        </div>
      `;
    });
    html += `</div>`;
  }

  // 3. Dropdown Footer
  const totalCount = allResults.length;
  const isFooterSel = state.search.dropdownSelectedIndex === topResults.length;
  html += `
    <div class="dropdown-footer ${isFooterSel ? "selected" : ""}" id="dropdown-see-all">
      <span class="dropdown-footer-key"><kbd>↵ Enter</kbd> View all ${totalCount} result${totalCount === 1 ? "" : "s"}</span>
      <span class="dropdown-footer-hint">Search Page ↗</span>
    </div>
  `;

  els.headerSearchDropdown.innerHTML = html;

  // Click listeners for dropdown items
  const items = els.headerSearchDropdown.querySelectorAll(".dropdown-item");
  items.forEach((elem, idx) => {
    elem.addEventListener("click", () => {
      const name = elem.getAttribute("data-name");
      const path = elem.getAttribute("data-path");
      closeSearchDropdown();
      openPreviewModal(name, path, allResults.map(r => ({ name: r.name, path: r.path })), idx);
    });
  });

  // Click listeners for curriculum chips in dropdown
  els.headerSearchDropdown.querySelectorAll(".dropdown-curriculum-chip").forEach(chip => {
    chip.addEventListener("click", (e) => {
      e.stopPropagation();
      const name = chip.getAttribute("data-name");
      const path = chip.getAttribute("data-path");
      closeSearchDropdown();
      openPreviewModal(name, path);
    });
  });

  // Click listener for footer
  const footerBtn = els.headerSearchDropdown.querySelector("#dropdown-see-all");
  if (footerBtn) {
    footerBtn.addEventListener("click", () => {
      closeSearchDropdown();
      switchView("search");
      renderSearchResultsView();
    });
  }
}

function renderSearchResultsView(overrideQuery = null) {
  if (!els.viewSearch) return;
  const q = (overrideQuery !== null ? overrideQuery : (state.search.query || "")).trim();
  const allResults = state.search.results || [];
  const currMatches = state.search.curriculumMatches || [];
  const filter = state.search.activeFilter || "all";

  // Compute filter counts
  const slidesResults = allResults.filter(r => {
    const name = (r.name || "").toLowerCase();
    const folder = (r.folder || "").toLowerCase();
    const ext = name.split(".").pop();
    return r.category === "slides" || ["pptx", "ppt", "key"].includes(ext) || /slide|lecture|presentation/i.test(name) || /slide|lecture/i.test(folder);
  });

  const examsResults = allResults.filter(r => {
    const name = (r.name || "").toLowerCase();
    const folder = (r.folder || "").toLowerCase();
    return r.category === "exams" || /exam|quiz|midterm|final|assignment|hw|homework|solution|rubric|practice/i.test(name) || /exam|assignment|quiz/i.test(folder);
  });

  const chaptersResults = allResults.filter(r => {
    const name = (r.name || "").toLowerCase();
    const folder = (r.folder || "").toLowerCase();
    return r.category === "chapters" || /chapter|ch\s*\d+|topic|unit|syllabus|reading/i.test(name) || /chapter|lecture/i.test(folder);
  });

  let displayResults = allResults;
  if (filter === "slides") displayResults = slidesResults;
  else if (filter === "exams") displayResults = examsResults;
  else if (filter === "chapters") displayResults = chaptersResults;

  let html = `
    <div class="search-page-container">
      <div class="search-page-header">
        <div class="search-page-nav-row">
          <button class="btn-search-back" id="btn-search-back">
            <span>←</span> <span>Back to Course</span>
          </button>
          <div class="search-page-count-badge">
            ${allResults.length} file${allResults.length === 1 ? "" : "s"} found ${currMatches.length > 0 ? ` • ${currMatches.length} curriculum topic` : ""}
          </div>
        </div>

        <div class="search-page-title-row">
          <h1 class="search-page-title">Search Results</h1>
          ${q ? `<span class="search-page-query-text">“${escapeHtml(q)}”</span>` : ""}
        </div>

        <div class="search-page-filters">
          <button class="search-page-filter-pill ${filter === "all" ? "active" : ""}" data-filter="all">
            All (${allResults.length})
          </button>
          <button class="search-page-filter-pill ${filter === "slides" ? "active" : ""}" data-filter="slides">
            Slides (${slidesResults.length})
          </button>
          <button class="search-page-filter-pill ${filter === "exams" ? "active" : ""}" data-filter="exams">
            Assignments & Exams (${examsResults.length})
          </button>
          <button class="search-page-filter-pill ${filter === "chapters" ? "active" : ""}" data-filter="chapters">
            Chapters & Topics (${chaptersResults.length})
          </button>
        </div>
      </div>
  `;

  // Curriculum Match Hero Banner (if matches exist and filter is all or chapters)
  if ((filter === "all" || filter === "chapters") && currMatches.length > 0) {
    html += `<div class="search-page-curriculum">`;
    currMatches.forEach((cm) => {
      const badge = cm.badge || (cm.chapter && cm.topic && cm.chapter !== cm.topic ? `${cm.chapter} • ${cm.topic}` : (cm.chapter || cm.topic || cm.title || "Curriculum Chapter"));
      const reasoning = cm.reasoning || cm.reason || cm.context || "Identified from Syllabus & Announcements";
      const desc = cm.description || cm.summary || "";
      const files = cm.files || cm.associated_files || cm.target_files || [];

      html += `
        <div class="curriculum-match-banner">
          <div class="curriculum-banner-header">
            <span class="curriculum-badge">${Icons.courseCap} ${escapeHtml(badge)}</span>
            <span class="curriculum-reasoning">${Icons.checkCircle} ${escapeHtml(reasoning)}</span>
          </div>
          ${desc ? `<div class="curriculum-banner-desc">${highlightQueryInText(desc, q)}</div>` : ""}
          ${files.length > 0 ? `
            <div class="curriculum-files-section">
              <span class="curriculum-files-label">Associated Materials:</span>
              <div class="curriculum-file-chips-row">
                ${files.map((f) => {
                  const fName = typeof f === "string" ? f : (f.name || "");
                  const fPath = (typeof f === "object" && f.path) || (state.courseData?.file_path_map && state.courseData.file_path_map[fName]) || fName;
                  return `
                    <button class="curriculum-file-chip search-page-curr-chip" data-filename="${escapeHtml(fName)}" data-filepath="${escapeHtml(fPath)}" title="Preview ${escapeHtml(fName)}">
                      <span class="chip-icon">${getFileIcon(fName)}</span>
                      <span class="chip-name">${escapeHtml(fName)}</span>
                      <span class="chip-preview-badge">Preview ↗</span>
                    </button>
                  `;
                }).join("")}
              </div>
            </div>
          ` : ""}
        </div>
      `;
    });
    html += `</div>`;
  }

  // File Match Results Grid
  if (displayResults.length === 0) {
    html += `
      <div class="search-page-empty">
        <div class="search-page-empty-icon">${Icons.search}</div>
        <h3 style="font-size: 16px; font-weight: 700; color: var(--text-main); margin: 0;">No matching materials found</h3>
        <p style="font-size: 13px; color: var(--text-muted); max-width: 440px; margin: 0; line-height: 1.5;">
          ${q ? `We couldn't find any course files or topics matching "<strong>${escapeHtml(q)}</strong>".` : "Type keywords or topics in the top search bar to find course materials."}
        </p>
        <div class="search-quick-suggestions" style="margin-top: 12px;">
          <span class="suggestion-label">Try searching:</span>
          <button class="suggestion-chip search-page-suggest-chip" data-query="syllabus">Syllabus</button>
          <button class="suggestion-chip search-page-suggest-chip" data-query="exam">Exam</button>
          <button class="suggestion-chip search-page-suggest-chip" data-query="midterm">Midterm</button>
          <button class="suggestion-chip search-page-suggest-chip" data-query="lecture">Lecture</button>
          <button class="suggestion-chip search-page-suggest-chip" data-query="practice">Practice</button>
        </div>
      </div>
    `;
  } else {
    html += `<div class="search-page-results-grid">`;
    const listFilesForPreview = displayResults.map(r => ({ name: r.name, path: r.path }));

    displayResults.forEach((item, idx) => {
      const folder = item.folder || item.breadcrumb || "Course Files";
      let matchBadge = item.match_type || "Page Content Match";
      if (item.page_num) {
        const ext = (item.name || "").split(".").pop().toLowerCase();
        matchBadge = (["pptx", "ppt", "key"].includes(ext) ? `Slide ${item.page_num} Match` : `Page ${item.page_num} Content Match`);
      } else if (item.match_type === "content") {
        matchBadge = "Page Content Match";
      } else if (item.match_type === "filename") {
        matchBadge = "Filename Match";
      } else if (item.match_type === "curriculum") {
        matchBadge = "Curriculum Match";
      }

      let badgeClass = "";
      if (/filename/i.test(matchBadge)) badgeClass = "badge-filename";
      else if (/syllabus|curriculum/i.test(matchBadge)) badgeClass = "badge-syllabus";

      const snippet = item.snippet || item.context || `Course material located in <strong>${escapeHtml(folder)}</strong>.`;

      html += `
        <div class="search-page-card" data-index="${idx}" data-name="${escapeHtml(item.name)}" data-path="${escapeHtml(item.path)}">
          <div class="search-card-left">
            <div class="search-card-icon">${getFileIcon(item.name)}</div>
            <div class="search-card-content">
              <div class="search-card-header-row">
                <span class="search-card-title" data-name="${escapeHtml(item.name)}" data-path="${escapeHtml(item.path)}">${highlightQueryInText(item.name, q)}</span>
                <span class="search-match-badge ${badgeClass}">${escapeHtml(matchBadge)}</span>
              </div>
              <div class="search-card-folder">${Icons.folderOpen} ${escapeHtml(folder)}</div>
              <div class="search-card-snippet">${highlightQueryInText(snippet, q, true)}</div>
            </div>
          </div>
          <div class="search-card-actions">
            <button class="search-page-action-btn btn-action-preview search-card-btn-preview" data-name="${escapeHtml(item.name)}" data-path="${escapeHtml(item.path)}" title="Preview in browser">
              ${Icons.preview} <span>Preview</span>
            </button>
            <button class="search-page-action-btn search-card-btn-open" data-path="${escapeHtml(item.path)}" title="Open in Default App">
              ${Icons.macApp} <span>Open</span>
            </button>
            <button class="search-page-action-btn search-card-btn-reveal" data-path="${escapeHtml(item.path)}" title="Show in Folder">
              ${Icons.macFinder} <span>Folder</span>
            </button>
          </div>
        </div>
      `;
    });
    html += `</div>`;
  }

  html += `</div>`;
  els.viewSearch.innerHTML = html;

  // Wire up back button
  const backBtn = els.viewSearch.querySelector("#btn-search-back");
  if (backBtn) {
    backBtn.addEventListener("click", () => {
      switchView(state.previousCourseView || "canvas");
    });
  }

  // Wire up filter pills
  els.viewSearch.querySelectorAll(".search-page-filter-pill").forEach(pill => {
    pill.addEventListener("click", () => {
      const f = pill.getAttribute("data-filter") || "all";
      state.search.activeFilter = f;
      renderSearchResultsView();
    });
  });

  // Wire up curriculum chips
  els.viewSearch.querySelectorAll(".search-page-curr-chip").forEach(chip => {
    chip.addEventListener("click", (e) => {
      e.stopPropagation();
      const name = chip.getAttribute("data-filename");
      const path = chip.getAttribute("data-filepath");
      if (path) openPreviewModal(name, path);
    });
  });

  // Wire up suggestion chips in empty state
  els.viewSearch.querySelectorAll(".search-page-suggest-chip").forEach(chip => {
    chip.addEventListener("click", () => {
      const queryText = chip.getAttribute("data-query");
      if (queryText) {
        if (els.globalSearchInput) els.globalSearchInput.value = queryText;
        handleHeaderSearchInput(queryText);
      }
    });
  });

  // Wire up file title clicks & preview buttons
  const listFiles = displayResults.map(r => ({ name: r.name, path: r.path }));
  els.viewSearch.querySelectorAll(".search-card-title, .search-card-btn-preview").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const card = btn.closest(".search-page-card");
      const idx = parseInt(card.getAttribute("data-index"), 10);
      const name = btn.getAttribute("data-name");
      const path = btn.getAttribute("data-path");
      openPreviewModal(name, path, listFiles, idx);
    });
  });

  // Wire up Open in App
  els.viewSearch.querySelectorAll(".search-card-btn-open").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const path = btn.getAttribute("data-path");
      if (path) openFileInSystem(path, "open");
    });
  });

  // Wire up Show in Folder
  els.viewSearch.querySelectorAll(".search-card-btn-reveal").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const path = btn.getAttribute("data-path");
      if (path) openFileInSystem(path, "reveal");
    });
  });
}

// --- Module: 13_init.js ---
document.addEventListener("DOMContentLoaded", async () => {
  // [Codex] Never initialize data requests or actions without a local session.
  if (!await window.canvasSessionReady) {
    showLocalSessionRequired();
    return;
  }
  initSettings();
  await loadDirectoriesSettings();
  setupIcons();
  setupEventListeners();
  initOnboarding();
  // [Codex] Delegation supports rerendered buttons without inline script handlers.
  document.addEventListener("click", event => {
    const button = event.target.closest("[data-open-settings]");
    if (!button) return;
    event.preventDefault();
    const panel = button.dataset.openSettings;
    if (["ingestion", "directories"].includes(panel)) openSettingsModal(panel);
  });
  await loadCourseList();
  showOnboardingIfFirstRun();
});

function setupIcons() {
  if (els.globalLogo) els.globalLogo.innerHTML = Icons.canvas;
  if (els.iconNavDashboard) els.iconNavDashboard.innerHTML = Icons.dashboard;
  if (els.iconNavLauncher) els.iconNavLauncher.innerHTML = Icons.plusCircle;
  if (els.iconNavRescan) els.iconNavRescan.innerHTML = Icons.refreshCw;
  const icNavCanvas = document.getElementById("icon-nav-canvas");
  if (icNavCanvas) icNavCanvas.innerHTML = Icons.home;
  const icNavTimeline = document.getElementById("icon-nav-timeline");
  if (icNavTimeline) icNavTimeline.innerHTML = Icons.timeline;
  const icNavFolders = document.getElementById("icon-nav-folders");
  if (icNavFolders) icNavFolders.innerHTML = Icons.folders;
  const icTabCanvas = document.getElementById("icon-tab-canvas");
  if (icTabCanvas) icTabCanvas.innerHTML = Icons.modules;
  const icTabTimeline = document.getElementById("icon-tab-timeline");
  if (icTabTimeline) icTabTimeline.innerHTML = Icons.timeline;
  const icTabFolders = document.getElementById("icon-tab-folders");
  if (icTabFolders) icTabFolders.innerHTML = Icons.folderOpen;
  document.getElementById("icon-mac-preview").innerHTML = Icons.macApp;
  document.getElementById("icon-mac-finder").innerHTML = Icons.macFinder;
  const iconFs = document.getElementById("icon-fullscreen");
  if (iconFs) iconFs.innerHTML = Icons.fullscreen;
  document.getElementById("icon-open-tab").innerHTML = Icons.external;
  document.getElementById("icon-close-modal").innerHTML = Icons.close;
  if (els.iconNavSettings) els.iconNavSettings.innerHTML = Icons.settings;
  if (els.settingsHeaderIcon) els.settingsHeaderIcon.innerHTML = Icons.settings;
  if (els.iconCloseSettings) els.iconCloseSettings.innerHTML = Icons.close;
  if (els.iconThemeLight) els.iconThemeLight.innerHTML = Icons.sun;
  if (els.iconThemeDark) els.iconThemeDark.innerHTML = Icons.moon;

  // Search & Spotlight icons
  if (els.iconHeaderSearch) els.iconHeaderSearch.innerHTML = Icons.search;
  if (els.iconSpotlightSearch) els.iconSpotlightSearch.innerHTML = Icons.search;
  if (els.searchEmptyIcon) els.searchEmptyIcon.innerHTML = Icons.search;
  if (els.searchNoResultsIcon) els.searchNoResultsIcon.innerHTML = Icons.search;
}

function setupEventListeners() {
  // View Switchers
  if (els.navDashboard) els.navDashboard.addEventListener("click", () => switchView("dashboard"));
  if (els.navLauncher) els.navLauncher.addEventListener("click", () => switchView("launcher"));
  if (els.navRescan) els.navRescan.addEventListener("click", () => switchView("rescan"));
  if (els.globalLogoBtn) els.globalLogoBtn.addEventListener("click", () => switchView("dashboard"));
  if (els.tabCanvas) els.tabCanvas.addEventListener("click", () => switchView("canvas"));
  if (els.tabTimeline) els.tabTimeline.addEventListener("click", () => switchView("timeline"));
  if (els.tabFolders) els.tabFolders.addEventListener("click", () => switchView("folders"));
  if (els.navCanvas) els.navCanvas.addEventListener("click", () => switchView("canvas"));
  if (els.navTimeline) els.navTimeline.addEventListener("click", () => switchView("timeline"));
  if (els.navFolders) els.navFolders.addEventListener("click", () => switchView("folders"));

  // Course selection
  els.courseSelector.addEventListener("change", async (e) => {
    await selectCourse(e.target.value);
    if (state.activeView === "dashboard") {
      switchView("canvas");
    }
  });

  // Header Search & Live Dropdown
  if (els.globalSearchInput) {
    els.globalSearchInput.addEventListener("focus", () => {
      if (els.globalSearchInput.value.trim().length > 0) {
        handleHeaderSearchInput(els.globalSearchInput.value);
      }
    });
    els.globalSearchInput.addEventListener("click", () => {
      if (els.globalSearchInput.value.trim().length > 0) {
        handleHeaderSearchInput(els.globalSearchInput.value);
      }
    });
    els.globalSearchInput.addEventListener("input", (e) => {
      handleHeaderSearchInput(e.target.value);
    });
    els.globalSearchInput.addEventListener("keydown", (e) => {
      handleHeaderSearchKeydown(e);
    });
  }

  // Dismiss live search dropdown when clicking outside
  document.addEventListener("click", (e) => {
    if (els.headerSearchBar && !els.headerSearchBar.contains(e.target)) {
      closeSearchDropdown();
    }
  });

  if (els.spotlightSearchInput) {
    els.spotlightSearchInput.addEventListener("input", (e) => {
      handleSearchInput(e.target.value);
    });
  }

  if (els.searchClearBtn) {
    els.searchClearBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      handleHeaderSearchInput("");
      closeSearchDropdown();
      if (state.activeView === "search") {
        switchView(state.previousCourseView || "canvas");
      }
      if (els.globalSearchInput) els.globalSearchInput.focus();
    });
  }

  if (els.spotlightClearBtn) {
    els.spotlightClearBtn.addEventListener("click", () => {
      handleSearchInput("");
      if (els.spotlightSearchInput) els.spotlightSearchInput.focus();
    });
  }

  if (els.btnSpotlightClose) {
    els.btnSpotlightClose.addEventListener("click", closeSearchModal);
  }

  if (els.searchModal) {
    els.searchModal.addEventListener("click", (e) => {
      if (e.target === els.searchModal) closeSearchModal();
    });
  }

  // Filter chips in search modal
  document.querySelectorAll(".search-filter-chip").forEach(chip => {
    chip.addEventListener("click", () => {
      document.querySelectorAll(".search-filter-chip").forEach(c => c.classList.remove("active"));
      chip.classList.add("active");
      state.search.activeFilter = chip.getAttribute("data-filter") || "all";
      state.search.selectedIndex = 0;
      renderSearchResults();
    });
  });

  // Suggestion chips in empty state
  document.querySelectorAll(".suggestion-chip").forEach(chip => {
    chip.addEventListener("click", () => {
      const q = chip.getAttribute("data-query");
      if (q) {
        handleSearchInput(q);
        if (els.spotlightSearchInput) els.spotlightSearchInput.focus();
      }
    });
  });

  // Modal actions
  els.btnCloseModal.addEventListener("click", closePreviewModal);
  els.previewModal.addEventListener("click", (e) => {
    if (e.target === els.previewModal) closePreviewModal();
  });

  // Preview navigation buttons
  if (els.btnPreviewPrev) els.btnPreviewPrev.addEventListener("click", () => navigatePreview(-1));
  if (els.btnPreviewNext) els.btnPreviewNext.addEventListener("click", () => navigatePreview(1));
  if (els.floatingPreviewPrev) els.floatingPreviewPrev.addEventListener("click", () => navigatePreview(-1));
  if (els.floatingPreviewNext) els.floatingPreviewNext.addEventListener("click", () => navigatePreview(1));

  // Global Keyboard Shortcuts (⌘K, /, Escape, ArrowUp/Down, Enter, ArrowLeft/Right)
  document.addEventListener("keydown", (e) => {
    if (!els.settingsModal.classList.contains("hidden")) {
      if (e.key === "Escape") { e.preventDefault(); closeSettingsModal(); }
      return;
    }
    const isEditing = ["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName);
    const isSearchInput = document.activeElement === els.spotlightSearchInput || document.activeElement === els.globalSearchInput;

    // 1. ⌘K or Ctrl+K: Spotlight Search
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      if (state.search.isOpen) {
        closeSearchModal();
      } else {
        openSearchModal(els.globalSearchInput ? els.globalSearchInput.value : "");
      }
      return;
    }

    // 2. / shortcut (when not focused in any input)
    if (e.key === "/" && !isEditing && !state.search.isOpen) {
      e.preventDefault();
      openSearchModal(els.globalSearchInput ? els.globalSearchInput.value : "");
      return;
    }

    // 3. Escape key: Close search modal, preview modal, or settings modal
    if (e.key === "Escape") {
      if (state.search.isOpen) {
        e.preventDefault();
        closeSearchModal();
        return;
      }
      if (!els.previewModal.classList.contains("hidden")) {
        e.preventDefault();
        closePreviewModal();
        return;
      }
      if (!els.settingsModal.classList.contains("hidden")) {
        e.preventDefault();
        closeSettingsModal();
        return;
      }
    }

    // 4. Keyboard Navigation inside Spotlight Search
    if (state.search.isOpen) {
      const resultItems = Array.from(document.querySelectorAll("#search-results-list .search-result-item"));
      if (e.key === "ArrowDown") {
        e.preventDefault();
        if (resultItems.length > 0) {
          state.search.selectedIndex = (state.search.selectedIndex + 1) % resultItems.length;
          updateSelectedSearchResult(resultItems);
        }
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        if (resultItems.length > 0) {
          state.search.selectedIndex = (state.search.selectedIndex - 1 + resultItems.length) % resultItems.length;
          updateSelectedSearchResult(resultItems);
        }
        return;
      }
      if (e.key === "Enter") {
        if (resultItems.length > 0 && resultItems[state.search.selectedIndex]) {
          e.preventDefault();
          resultItems[state.search.selectedIndex].click();
        }
        return;
      }
    }

    // 5. ArrowLeft / ArrowRight Navigation inside File Preview Modal
    if (!els.previewModal.classList.contains("hidden") && !state.search.isOpen && (!isEditing || isSearchInput)) {
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        navigatePreview(-1);
        return;
      }
      if (e.key === "ArrowRight") {
        e.preventDefault();
        navigatePreview(1);
        return;
      }
    }
  });

  els.btnOpenMac.addEventListener("click", () => {
    if (state.activeFile) systemAction(state.activeFile.path, "open");
  });

  els.btnRevealFinder.addEventListener("click", () => {
    if (state.activeFile) systemAction(state.activeFile.path, "reveal");
  });

  if (els.btnToggleFullscreen) {
    els.btnToggleFullscreen.addEventListener("click", () => {
      const isFull = els.previewModalContainer.classList.toggle("modal-fullscreen");
      els.previewModal.classList.toggle("is-fullscreen", isFull);
      const iconEl = document.getElementById("icon-fullscreen");
      if (iconEl) iconEl.innerHTML = isFull ? Icons.minimize : Icons.fullscreen;
    });
  }

  // Settings modal open/close/save
  if (els.navSettings) els.navSettings.addEventListener("click", () => openSettingsModal("general"));
  if (els.btnCloseSettings) els.btnCloseSettings.addEventListener("click", closeSettingsModal);
  if (els.settingsModal) {
    els.settingsModal.addEventListener("click", (e) => {
      if (e.target === els.settingsModal) closeSettingsModal();
    });
  }
  if (els.btnSaveSettings) els.btnSaveSettings.addEventListener("click", saveSettingsFromUI);

  // Header Index Progress Widget & Popover
  if (els.indexProgressBtn) {
    els.indexProgressBtn.addEventListener("click", toggleIndexDetailsPopover);
  }
  if (els.btnCloseIndexPopover) {
    els.btnCloseIndexPopover.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      closeIndexDetailsPopover();
    });
  }
  if (els.indexPopoverBackdrop) {
    els.indexPopoverBackdrop.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      closeIndexDetailsPopover();
    });
  }
  if (els.btnTriggerReindex) {
    els.btnTriggerReindex.addEventListener("click", triggerIndexRebuild);
  }

  // Close Index details popover on click outside or Escape
  document.addEventListener("click", (e) => {
    if (els.indexDetailsPopover && (!els.indexDetailsPopover.classList.contains("hidden") && els.indexDetailsPopover.style.display !== "none")) {
      const container = document.getElementById("index-status-container");
      if (container && !container.contains(e.target)) {
        closeIndexDetailsPopover();
      }
    }
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeIndexDetailsPopover();
    }
  });

  // Live Theme Switching (instant preview & save)
  document.querySelectorAll(".theme-pill-btn[data-theme-val]").forEach(btn => {
    btn.addEventListener("click", () => {
      const chosenTheme = btn.getAttribute("data-theme-val");
      if (!chosenTheme) return;
      document.querySelectorAll(".theme-pill-btn[data-theme-val]").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");

      // Instantly switch theme live across the entire page
      state.settings.theme = chosenTheme;
      applyTheme(chosenTheme);
      saveSettingsToStorage();
    });
  });

  // Live Accent Color Switching (instant preview & save)
  document.querySelectorAll(".color-swatch-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const chosenColor = btn.getAttribute("data-accent");
      document.querySelectorAll(".color-swatch-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");

      // Instantly apply accent color live
      state.settings.accentColor = chosenColor;
      applyAccent(chosenColor);
      saveSettingsToStorage();
    });
  });

  // Live Default File Action Switching
  document.querySelectorAll('input[name="defaultAction"]').forEach(radio => {
    radio.addEventListener("change", () => {
      state.settings.defaultAction = radio.value;
      saveSettingsToStorage();
    });
  });

  // Live Auto Fullscreen Toggle
  if (els.settingAutoFullscreen) {
    els.settingAutoFullscreen.addEventListener("change", () => {
      state.settings.autoFullscreen = els.settingAutoFullscreen.checked;
      saveSettingsToStorage();
    });
  }
}

// Fetch list of courses

// --- Module: 14_launcher.js ---
// --- Module: 14_launcher.js ---
// Course Setup & Ingestion Launcher View

const launcherState = {
  wizardStage: 1, // 1: Info, 2: AI Engine, 3: Scope, 4: Ingesting
  courseUrl: "",
  courseName: "",
  aiProvider: "gemini", // "gemini", "ollama", "rules"
  geminiApiKey: "",
  geminiConfigured: null, // null = unknown, true = configured, false = not configured
  geminiTier: "paid",
  ollamaModel: "qwen2.5:7b",
  headless: true,
  categories: new Set([
    "modules", "syllabus", "announcements", "assignments",
    "discussions", "quizzes", "grades", "files", "pages", "media", "gradescope"
  ]),
  gradescopeUrl: "",
  isIngesting: false,
  activeStep: 0,
  completedSteps: new Set(),
  progressPct: 0,
  phaseTitle: "",
  logs: [],
  jobId: null,
  eventSource: null,
  hardwareProfile: null,
  finishedCourse: null,
  hierarchyLoaded: false
};

async function fetchLauncherGeminiKeyStatus() {
  if (launcherState.geminiConfigured !== null) return launcherState.geminiConfigured;
  try {
    const res = await fetch("/api/settings/gemini-key");
    if (res.ok) {
      const data = await res.json();
      launcherState.geminiConfigured = Boolean(data.configured);
      return launcherState.geminiConfigured;
    }
  } catch (err) {}
  launcherState.geminiConfigured = false;
  return launcherState.geminiConfigured;
}

const LAUNCHER_CATEGORIES = [
  { id: "modules", label: "Modules", sub: "Units & Course Tree", icon: () => Icons.modules },
  { id: "syllabus", label: "Syllabus", sub: "Schedule & Policies", icon: () => Icons.syllabus },
  { id: "announcements", label: "Announcements", sub: "Chronological Posts", icon: () => Icons.announcements },
  { id: "assignments", label: "Assignments", sub: "Prompts & Rubrics", icon: () => Icons.assignments },
  { id: "discussions", label: "Discussions", sub: "Student & TA Threads", icon: () => Icons.discussions },
  { id: "quizzes", label: "Quizzes", sub: "Tests & Questions", icon: () => Icons.pencil || Icons.modules },
  { id: "grades", label: "Grades", sub: "Breakdown & Scores", icon: () => Icons.grades },
  { id: "files", label: "Files Repository", sub: "Deep Storage Tree", icon: () => Icons.folders || Icons.folderOpen },
  { id: "pages", label: "Pages", sub: "Static Wiki Docs", icon: () => Icons.fileText || Icons.external },
  { id: "media", label: "Media & Zoom", sub: "Lecture Recordings", icon: () => Icons.video },
  { id: "gradescope", label: "Gradescope", sub: "Headless Work Sync", icon: () => Icons.badgeCheck || Icons.check },
];

const PIPELINE_STEPS = [
  { step: 1, title: "Authentication & Session", desc: "Verifying Duo 2FA / Shibboleth session in ~/.canvas_browser_profile/" },
  { step: 2, title: "Category Scraping & Downloads", desc: "Crawling modules, files, announcements, assignments, and media" },
  { step: 3, title: "AI Classification & Sorting", desc: "Classifying files and organizing into Lectures & Resources vs. Work" },
  { step: 4, title: "Course Blueprint & Timeline", desc: "Generating canvas_course.json and milestone timeline markdown" },
  { step: 5, title: "FTS5 Search & Document Index", desc: "Building SQLite full-text search and OCR index for offline access" }
];

async function fetchLauncherHardwareProfile() {
  if (launcherState.hardwareProfile) return launcherState.hardwareProfile;
  try {
    const res = await fetch("/api/launcher/hardware-profile");
    if (res.ok) {
      launcherState.hardwareProfile = await res.json();
      return launcherState.hardwareProfile;
    }
  } catch (err) {
    // Backend endpoint might not be active yet; fallback to heuristic profile
  }
  // Safe default fallback
  launcherState.hardwareProfile = {
    chip: "Apple Silicon (Auto-detected)",
    ram_gb: 16,
    is_apple_silicon: true,
    tier: "apple_silicon_high_ram",
    recommended_model: "qwen2.5:7b"
  };
  return launcherState.hardwareProfile;
}

function sanitizeCourseName(name) {
  return (name || "").trim().replace(/[\/\\:*?"<>|]/g, "_");
}

function renderLauncherView() {
  if (!els.viewLauncher) return;
  els.viewLauncher.classList.remove("hidden");

  if (!launcherState.hierarchyLoaded && typeof loadHierarchySettings === "function") {
    launcherState.hierarchyLoaded = true;
    loadHierarchySettings().then(() => {
      if (launcherState.wizardStage === 1 && state.activeView === "launcher") {
        updateFolderPreview();
      }
    });
  }
  if (launcherState.geminiConfigured === null) {
    fetchLauncherGeminiKeyStatus().then(() => {
      if (launcherState.wizardStage === 2 && state.activeView === "launcher") {
        renderLauncherView();
      }
    });
  }
  if (!launcherState.hardwareProfile) {
    fetchLauncherHardwareProfile().then(() => {
      const container = document.getElementById("launcher-hardware-badge-container");
      if (container && launcherState.hardwareProfile) {
        container.innerHTML = `
          <div class="hardware-profile-banner">
            <span class="hardware-banner-icon">${Icons.cpu || Icons.sparkles}</span>
            <div class="hardware-banner-text">
              <strong>Hardware Profile:</strong> ${escapeHtml(launcherState.hardwareProfile.chip || "Apple Silicon")} • ${launcherState.hardwareProfile.ram_gb || 16} GB RAM
              ${launcherState.hardwareProfile.is_apple_silicon && (launcherState.hardwareProfile.ram_gb >= 16) 
                ? ` • Recommended: <strong>qwen2.5:7b</strong> or Gemini Flash Lite` 
                : ` • Recommended: <strong>Gemini Flash Lite</strong> (Cloud inference)`}
            </div>
          </div>
        `;
      }
    });
  }

  const sanitized = sanitizeCourseName(launcherState.courseName) || "[Course Name]";
  const selectedCatCount = launcherState.categories.size;
  const isGradescopeSelected = launcherState.categories.has("gradescope");

  if (launcherState.isIngesting || launcherState.finishedCourse) {
    launcherState.wizardStage = 4;
  }
  const currentStage = launcherState.wizardStage || 1;
  const isLocked = launcherState.isIngesting;
  const hasCourseInfo = Boolean(launcherState.courseUrl.trim() && launcherState.courseName.trim());

  const activeStepObj = PIPELINE_STEPS.find(s => s.step === launcherState.activeStep);
  const activeTitle = launcherState.phaseTitle || (activeStepObj ? activeStepObj.title : (launcherState.finishedCourse ? "Add Course Complete" : "Pipeline Active"));
  let progressPct = launcherState.progressPct || 0;
  if (!progressPct) {
    if (launcherState.finishedCourse) {
      progressPct = 100;
    } else if (launcherState.activeStep > 0) {
      const stepDefaults = { 1: 15, 2: 35, 3: 60, 4: 80, 5: 95 };
      progressPct = stepDefaults[launcherState.activeStep] || (launcherState.activeStep * 20);
    }
  }
  const badgeLabel = launcherState.isIngesting 
    ? (launcherState.activeStep > 0 ? `Step ${launcherState.activeStep} of 5 (${progressPct}%)` : "Running...") 
    : (launcherState.finishedCourse ? "Completed (100%)" : "Ready");

  const stagePills = [
    { stage: 1, label: "1. Course Identity", num: 1 },
    { stage: 2, label: "2. AI Engine", num: 2 },
    { stage: 3, label: "3. Category Scope", num: 3 },
    { stage: 4, label: "4. Live Pipeline", num: 4 }
  ];

  let html = `
    <div class="launcher-container">
      <div class="launcher-hero">
        <div class="launcher-hero-title-area">
          <div class="launcher-title-row">
            <h1>Add New Course</h1>
          </div>
          <p class="launcher-subtitle">
            Configure, scrape, and intelligently organize any Canvas LMS course into an offline, searchable desktop repository.
          </p>
          <a class="launcher-project-link" href="https://zayd-haque.github.io/canvas-offline-archive/" target="_blank" rel="noopener noreferrer">Project page and setup guide ↗</a>
        </div>
      </div>

      <!-- Wizard Step Navigation -->
      <div class="wizard-nav">
        ${stagePills.map((p, idx) => {
          const isActive = currentStage === p.stage;
          const isCompleted = currentStage > p.stage || (p.stage === 4 && launcherState.finishedCourse);
          let statusClass = "";
          if (isActive) statusClass = "active";
          else if (isCompleted) statusClass = "completed";
          else if (currentStage < p.stage) statusClass = "disabled";
          if (launcherState.isIngesting && !isActive) statusClass += " disabled";

          return `
            ${idx > 0 ? `<span class="wizard-nav-divider">→</span>` : ""}
            <div class="wizard-step-pill ${statusClass.trim()}" data-wizard-stage="${p.stage}">
              <span class="wizard-pill-num">${isCompleted && !isActive ? Icons.check : p.num}</span>
              <span>${p.label}</span>
            </div>
          `;
        }).join("")}
      </div>

      <div class="launcher-layout">

        <!-- Stage 1: Course Identity & Hierarchy -->
        ${currentStage === 1 ? `
          <div class="wizard-stage-panel">
            <div class="launcher-card">
              <h3 class="launcher-card-title">First course checklist</h3>
              <p class="launcher-card-desc">Use a course you can access with your own Canvas account. Your institution may ask you to complete sign-in and 2FA in a browser. Capturing needs internet; downloaded files can be viewed offline afterward.</p>
              <p class="launcher-card-desc">Check the destination below before continuing. In the next step, choose Keyword Heuristics if you want to start without an API key or local AI model.</p>
            </div>
            <div class="launcher-card">
              <div class="launcher-card-header">
                <div class="launcher-card-title-group">
                  <div class="launcher-card-icon">${Icons.canvas}</div>
                  <div>
                    <h3 class="launcher-card-title">Course Identity & Desktop Hierarchy</h3>
                    <p class="launcher-card-desc">Target Canvas course URL and destination folder</p>
                  </div>
                </div>
              </div>

              <div class="launcher-form-group">
                <label class="launcher-form-label" for="launcher-course-url">
                  <span>Canvas Course URL <span style="color: #ef4444;">*</span></span>
                </label>
                <input type="text" id="launcher-course-url" class="launcher-form-input" 
                  placeholder="e.g. https://canvas.ucla.edu/courses/230518" 
                  value="${escapeHtml(launcherState.courseUrl)}">
                <div class="launcher-input-hint">
                  <span>Must include <code>/courses/{id}</code>. Authentication uses your shared Duo 2FA session.</span>
                </div>
              </div>

              <div class="launcher-form-group">
                <label class="launcher-form-label" for="launcher-course-name">
                  <span>Desktop Folder Name <span style="color: #ef4444;">*</span></span>
                </label>
                <input type="text" id="launcher-course-name" class="launcher-form-input" 
                  placeholder="e.g. CHEM 14D or PSYCH 100B" 
                  value="${escapeHtml(launcherState.courseName)}">
              </div>

              <div class="folder-preview-box">
                ${getFolderPreviewHtml((state.settings && state.settings.defaultCourseDir) || '~/Desktop', sanitized)}
              </div>
            </div>

            <div class="wizard-actions-bar single-action">
              <button type="button" class="btn-wizard-next" id="btn-wizard-stage-1-next">
                <span>Continue to AI Organization</span>
                <span>→</span>
              </button>
            </div>
          </div>
        ` : ""}

        <!-- Stage 2: AI Organization Engine -->
        ${currentStage === 2 ? `
          <div class="wizard-stage-panel">
            <!-- Card 2: AI Organization Mode & Hardware Badge -->
            <div class="launcher-card">
              <div class="launcher-card-header">
              <div class="launcher-card-title-group">
                <div class="launcher-card-icon">${Icons.cpu || Icons.sparkles}</div>
                <div>
                  <h3 class="launcher-card-title">AI Organization Engine</h3>
                  <p class="launcher-card-desc">Automated file classification & subfolder clustering</p>
                </div>
              </div>
            </div>

            <div id="launcher-hardware-badge-container">
              <div class="hardware-profile-banner">
                <span class="hardware-banner-icon">${Icons.cpu || Icons.sparkles}</span>
                <div class="hardware-banner-text">
                  <strong>Hardware Profile:</strong> ${escapeHtml(launcherState.hardwareProfile?.chip || "Apple Silicon")} • ${launcherState.hardwareProfile?.ram_gb || 16} GB RAM
                  ${launcherState.hardwareProfile?.is_apple_silicon && (launcherState.hardwareProfile?.ram_gb >= 16) 
                    ? ` • Recommended: <strong>qwen2.5:7b</strong> or Gemini Flash Lite` 
                    : ` • Recommended: <strong>Gemini Flash Lite</strong> (Cloud inference)`}
                </div>
              </div>
            </div>

            <div class="ai-engines-grid">
              <div class="ai-engine-card ${launcherState.aiProvider === "gemini" ? "selected" : ""}" data-provider="gemini">
                <div class="ai-engine-card-header">
                  <span class="ai-engine-name">Gemini Flash Lite</span>
                  <span class="ai-engine-badge ai-badge-cloud">Cloud API</span>
                </div>
                <div class="ai-engine-desc">
                  Google Gemini processes course excerpts and filenames in the cloud, including submitted coursework and rescans. Free-tier submissions may be used by Google to improve products and reviewed by humans.
                </div>
              </div>

              <div class="ai-engine-card ${launcherState.aiProvider === "ollama" ? "selected" : ""}" data-provider="ollama">
                <div class="ai-engine-card-header">
                  <span class="ai-engine-name">Offline Ollama</span>
                  <span class="ai-engine-badge ai-badge-local">Local GPU</span>
                </div>
                <div class="ai-engine-desc">
                  Classification runs on this computer with Ollama. Course content is not sent to a cloud AI provider.
                </div>
              </div>

              <div class="ai-engine-card ${launcherState.aiProvider === "rules" ? "selected" : ""}" data-provider="rules">
                <div class="ai-engine-card-header">
                  <span class="ai-engine-name">Keyword Heuristics</span>
                  <span class="ai-engine-badge ai-badge-rules">Zero-LLM</span>
                </div>
                <div class="ai-engine-desc">
                  Deterministic keyword patterns and course syllabus token rules without requiring any AI models.
                </div>
              </div>
            </div>

            ${launcherState.aiProvider === "gemini" ? `
              ${launcherState.geminiConfigured ? `
                <div class="gemini-key-status-banner">
                  <div style="display:flex; align-items:center; gap:10px;">
                    <span style="display:flex; color:#10B981; width:18px; height:18px; flex-shrink:0;">${Icons.check || "✓"}</span>
                    <div>
                      <div style="font-size:13px; font-weight:700; color:var(--text-main);">Google AI Studio API Key Configured</div>
                      <div style="font-size:11.5px; color:var(--text-muted); margin-top:2px; display:flex; align-items:center; gap:8px;">
                        <span>API key active in <code>config.json</code></span>
                        <span>•</span>
                        <span>⚡ <strong>${(state.settings?.geminiTier || launcherState.geminiTier || "paid") === "paid" ? "Paid Tier (Fast ~120 RPM)" : "Free Tier (Safe 10 RPM)"}</strong></span>
                      </div>
                    </div>
                  </div>
                  <button type="button" class="btn-launcher-secondary btn-open-gemini-settings">
                    <span style="display:flex;width:14px;height:14px;">${Icons.settings || ""}</span>
                    <span>Change in Settings</span>
                  </button>
                </div>
              ` : `
                <div class="launcher-form-group" style="margin-top:14px;">
                  <div class="launcher-form-label">
                    <span>Google AI Studio API Key</span>
                    <button type="button" class="btn-open-gemini-settings" style="background:none; border:none; color:var(--canvas-accent); font-size:11.5px; cursor:pointer; padding:0; text-decoration:underline;">Configure in Settings</button>
                  </div>
                  <div class="launcher-api-key-row">
                    <input type="password" id="launcher-gemini-api-key" class="launcher-form-input launcher-api-key-input"
                      placeholder="Enter your Gemini API key"
                      value="${escapeHtml(launcherState.geminiApiKey)}"
                      autocomplete="off" spellcheck="false">
                    <button type="button" class="btn-api-key-toggle" id="btn-toggle-api-key" title="Show / hide key">
                      ${Icons.eye || `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`}
                    </button>
                  </div>
                  <div class="launcher-input-hint">
                    <span>Stored locally in <code>config.json</code>. Used to authenticate requests to Google. Supports paid & free-tier keys from <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener" style="color:var(--canvas-accent);">Google AI Studio</a>.</span>
                  </div>
                </div>

                <div class="launcher-tier-banner" style="display:flex; align-items:center; justify-content:space-between; padding:10px 14px; background:var(--bg-card); border:1px solid var(--border-color); border-radius:8px; margin-top:12px;">
                  <div style="display:flex; align-items:center; gap:8px;">
                    <span style="color:#F59E0B; font-size:14px;">⚡</span>
                    <span style="font-size:12.5px; color:var(--text-main);">
                      Gemini Rate Tier: <strong>${(state.settings?.geminiTier || launcherState.geminiTier || "paid") === "paid" ? "Paid Tier (Fast ~120 RPM)" : "Free Tier (Safe 10 RPM)"}</strong>
                    </span>
                  </div>
                  <button type="button" class="btn-text-link" data-open-settings="ingestion" style="font-size:12px; color:var(--canvas-active-accent, #60A5FA); background:none; border:none; cursor:pointer; text-decoration:underline;">
                    Change in Settings
                  </button>
                </div>
              `}
              <p class="gemini-privacy-warning"><strong>Before using Gemini:</strong> Do not send sensitive, confidential, or personal course material through Google's free API tier. Use Keyword Heuristics or Ollama for local classification. The app's rate-tier choice controls pacing, not your Google billing or data-use terms. <a href="https://ai.google.dev/gemini-api/terms" target="_blank" rel="noopener noreferrer">Google's terms</a>.</p>
            ` : ""}

            ${launcherState.aiProvider === "ollama" ? `
              <div class="launcher-form-group" style="margin-top:14px;">
                <label class="launcher-form-label" for="launcher-ollama-model">
                  <span>Local Ollama Model</span>
                </label>
                <select id="launcher-ollama-model" class="launcher-form-input">
                  <option value="qwen2.5:7b" ${launcherState.ollamaModel === "qwen2.5:7b" ? "selected" : ""}>qwen2.5:7b (Recommended for ≥16GB Apple Silicon)</option>
                  <option value="qwen2.5:3b" ${launcherState.ollamaModel === "qwen2.5:3b" ? "selected" : ""}>qwen2.5:3b (Low-power / Whisper-quiet)</option>
                  <option value="llama3.2" ${launcherState.ollamaModel === "llama3.2" ? "selected" : ""}>llama3.2 (Compact local model)</option>
                  <option value="mistral" ${launcherState.ollamaModel === "mistral" ? "selected" : ""}>mistral:7b</option>
                </select>
                <div class="launcher-input-hint">
                  <span>Zero-Auto-Download Protection: Will prompt before pulling any local models if not already present.</span>
                </div>
              </div>
            ` : ""}
            </div>

            <div class="wizard-actions-bar">
              <button type="button" class="btn-wizard-back" id="btn-wizard-stage-2-back">
                <span>← Back to Course Info</span>
              </button>
              <button type="button" class="btn-wizard-next" id="btn-wizard-stage-2-next">
                <span>Continue to Category Scope</span>
                <span>→</span>
              </button>
            </div>
          </div>
        ` : ""}

        <!-- Stage 3: Category Scope & Launch -->
        ${currentStage === 3 ? `
          <div class="wizard-stage-panel">
            <div class="launcher-card">
              <div class="launcher-card-header">
                <div class="launcher-card-title-group">
                  <div class="launcher-card-icon">${Icons.modules}</div>
                  <div>
                    <h3 class="launcher-card-title">Category Scope</h3>
                    <p class="launcher-card-desc">Select which Canvas LMS sections to crawl and download</p>
                  </div>
                </div>
              </div>

              <div class="category-actions-bar">
                <span class="category-selection-count">${selectedCatCount} of ${LAUNCHER_CATEGORIES.length} Categories Selected</span>
                <div class="category-btn-group">
                  <button type="button" class="btn-cat-action" id="btn-cat-select-all">Select All</button>
                  <button type="button" class="btn-cat-action" id="btn-cat-clear-all">Clear All</button>
                </div>
              </div>

              <div class="category-grid">
                ${LAUNCHER_CATEGORIES.map(cat => {
                  const isSelected = launcherState.categories.has(cat.id);
                  return `
                    <div class="category-card ${isSelected ? "selected" : ""}" data-category="${cat.id}">
                      <div class="category-card-checkbox">
                        ${Icons.check}
                      </div>
                      <div class="category-card-content">
                        <span class="category-card-title">${cat.label}</span>
                        <span class="category-card-sub">${cat.sub}</span>
                      </div>
                    </div>
                  `;
                }).join("")}
              </div>

              ${isGradescopeSelected ? `
                <div class="launcher-form-group" style="margin-top:16px;">
                  <label class="launcher-form-label" for="launcher-gradescope-url">
                    <span>Optional Gradescope Course URL</span>
                  </label>
                  <input type="text" id="launcher-gradescope-url" class="launcher-form-input" 
                    placeholder="e.g. https://www.gradescope.com/courses/123456" 
                    value="${escapeHtml(launcherState.gradescopeUrl)}">
                  <div class="launcher-input-hint">
                    <span>If omitted, the crawler will automatically discover the integrated Gradescope LTI launch link from Canvas.</span>
                  </div>
                </div>
              ` : ""}

              <div class="execution-options-row" style="margin-top:18px; padding-top:14px; border-top:1px solid var(--border-light);">
                <div class="execution-option-info">
                  <span class="execution-option-title">Headless Browser Mode</span>
                  <span class="execution-option-desc">Runs Playwright invisibly in background using ~/.canvas_browser_profile/</span>
                </div>
                <label class="toggle-switch">
                  <input type="checkbox" id="launcher-headless-toggle" ${launcherState.headless ? "checked" : ""}>
                  <span class="toggle-slider"></span>
                </label>
              </div>
            </div>

            <div class="wizard-actions-bar">
              <button type="button" class="btn-wizard-back" id="btn-wizard-stage-3-back">
                <span>← Back to AI Setup</span>
              </button>
              <button type="button" class="btn-launcher-primary" id="btn-launch-full" ${launcherState.isIngesting ? "disabled" : ""}>
                <span class="btn-icon">${Icons.rocket}</span>
                <span>${launcherState.isIngesting ? "Pipeline Running..." : "🚀 Add Course (Full Pipeline)"}</span>
              </button>
            </div>
          </div>
        ` : ""}

        <!-- Stage 4: Active Add Course & Live Streaming -->
        ${currentStage === 4 ? `
          <div class="wizard-stage-panel">
            <!-- Horizontal Fused Progress Timeline Card -->
            <div class="horizontal-timeline-card">
              <div class="horizontal-timeline-header">
                <div class="horizontal-timeline-title-area">
                  <div class="launcher-card-icon" style="width:28px;height:28px;">${Icons.timeline || Icons.dashboard}</div>
                  <h3 class="horizontal-timeline-title">Pipeline Progress: ${escapeHtml(activeTitle)}</h3>
                </div>
                <span class="horizontal-timeline-badge">${escapeHtml(badgeLabel)}</span>
              </div>

              <div class="horizontal-timeline-track-wrap">
                <div class="horizontal-timeline-track-line"></div>
                <div class="horizontal-timeline-fill-bar" style="width: ${progressPct}%;"></div>

                <div class="horizontal-timeline-nodes pipeline-stepper">
                  ${PIPELINE_STEPS.map(step => {
                    const isCompleted = launcherState.completedSteps.has(step.step);
                    const isActive = launcherState.activeStep === step.step;
                    let statusClass = "";
                    if (isCompleted) statusClass = "completed";
                    else if (isActive) statusClass = "active";

                    return `
                      <div class="horizontal-step-node step-item ${statusClass}" id="stepper-step-${step.step}">
                        <div class="horizontal-node-marker step-marker">
                          ${isCompleted ? Icons.check : step.step}
                        </div>
                        <div class="horizontal-node-info step-details">
                          <span class="horizontal-node-title step-title">${step.title}</span>
                          <span class="horizontal-node-desc step-desc">${step.desc}</span>
                        </div>
                      </div>
                    `;
                  }).join("")}
                </div>
              </div>
            </div>

            <!-- Streaming Terminal Console -->
            <div class="launcher-terminal-card">
              <div class="terminal-header">
                <div class="terminal-header-left">
                  <div class="terminal-window-dots">
                    <div class="terminal-dot terminal-dot-close"></div>
                    <div class="terminal-dot terminal-dot-minimize"></div>
                    <div class="terminal-dot terminal-dot-zoom"></div>
                  </div>
                  <span class="terminal-title">live_pipeline_stream.log</span>
                </div>
                <div class="terminal-header-right">
                  <button type="button" class="terminal-btn-clear" id="btn-clear-logs" title="Clear console output">Clear</button>
                  ${launcherState.isIngesting ? `
                    <button type="button" class="terminal-btn-cancel" id="btn-cancel-ingest">
                      <span style="display:flex;width:12px;height:12px;">${Icons.stopCircle || ""}</span>
                      <span>Cancel</span>
                    </button>
                  ` : ""}
                </div>
              </div>

              <div class="terminal-log-window" id="terminal-log-window" style="min-height: 280px; max-height: 480px;">
                ${launcherState.logs.length === 0 
                  ? `<div style="color:#6b7280;font-style:italic;">Ready to start. Live crawler and AI logs will stream here as course is added.</div>`
                  : launcherState.logs.map(l => formatTerminalLogLine(l)).join("")}
              </div>
            </div>

            <!-- Completion Card -->
            ${launcherState.finishedCourse ? `
              <div class="launcher-completion-card" style="margin-top: 18px;">
                <div class="completion-header">
                  <div class="completion-icon">${Icons.check}</div>
                  <div>
                    <h4 class="completion-title">Course Added Successfully!</h4>
                    <p class="completion-desc">
                      Successfully organized and indexed <strong>${escapeHtml(launcherState.finishedCourse.name)}</strong>.
                    </p>
                  </div>
                </div>
                <div class="completion-actions">
                  <button type="button" class="btn-completion-view" id="btn-completion-view">
                    <span style="display:flex;width:14px;height:14px;">${Icons.canvas}</span>
                    <span>View Course in App</span>
                  </button>
                  <button type="button" class="btn-completion-reveal" id="btn-completion-reveal">
                    <span style="display:flex;width:14px;height:14px;">${Icons.macFinder}</span>
                    <span>Show in Folder</span>
                  </button>
                  <button type="button" class="btn-launcher-secondary" id="btn-ingest-another" style="margin-left: auto;">
                    <span>➕ Add Another Course</span>
                  </button>
                </div>
              </div>
            ` : ""}
          </div>
        ` : ""}

      </div>
    </div>
  `;

  els.viewLauncher.innerHTML = html;
  wireLauncherEventListeners();
  scrollTerminalToBottom();
}

function formatTerminalLogLine(log) {
  const ts = log.timestamp || new Date().toLocaleTimeString();
  const level = (log.level || "info").toLowerCase();
  let tagClass = "log-tag-info";
  let tagText = "[INFO]";

  if (level === "download") {
    tagClass = "log-tag-download";
    tagText = "[DOWNLOAD]";
  } else if (level === "ai") {
    tagClass = "log-tag-ai";
    tagText = "[AI]";
  } else if (level === "success") {
    tagClass = "log-tag-success";
    tagText = "[SUCCESS]";
  } else if (level === "warn") {
    tagClass = "log-tag-warn";
    tagText = "[WARN]";
  } else if (level === "error") {
    tagClass = "log-tag-error";
    tagText = "[ERROR]";
  }

  return `<div class="terminal-line"><span class="log-timestamp">${escapeHtml(ts)}</span><span class="log-tag ${tagClass}">${tagText}</span><span>${escapeHtml(log.message || "")}</span></div>`;
}

function appendTerminalLog(message, level = "info") {
  const entry = {
    message,
    level,
    timestamp: new Date().toLocaleTimeString()
  };
  launcherState.logs.push(entry);

  const term = document.getElementById("terminal-log-window");
  if (term) {
    const lineHtml = formatTerminalLogLine(entry);
    term.insertAdjacentHTML("beforeend", lineHtml);
    scrollTerminalToBottom();
  }
}

function scrollTerminalToBottom() {
  if (state.settings.terminalAutoscroll === false) return;
  const term = document.getElementById("terminal-log-window");
  if (term) {
    term.scrollTop = term.scrollHeight;
  }
}

function wireLauncherEventListeners() {
  // Wizard Navigation Pills (one at a time progression: only allow clicking previously completed steps to go back)
  document.querySelectorAll("[data-wizard-stage]").forEach(pill => {
    pill.addEventListener("click", () => {
      if (launcherState.isIngesting) return;
      const targetStage = parseInt(pill.dataset.wizardStage, 10);
      // Can only navigate backward to previously completed stages; advancing is done one at a time via action buttons
      if (targetStage >= 1 && targetStage < launcherState.wizardStage) {
        launcherState.wizardStage = targetStage;
        renderLauncherView();
      }
    });
  });

  // Stage 1 -> 2 Next Button
  const btnStage1Next = document.getElementById("btn-wizard-stage-1-next");
  if (btnStage1Next) {
    btnStage1Next.addEventListener("click", () => {
      if (!launcherState.courseUrl.trim()) {
        alert("Please enter a valid Canvas course URL (e.g. https://canvas.ucla.edu/courses/12345).");
        return;
      }
      if (!launcherState.courseName.trim()) {
        alert("Please provide a course folder name (e.g. CHEM 14D).");
        return;
      }
      launcherState.wizardStage = 2;
      renderLauncherView();
    });
  }

  // Stage 2 Back & Next Buttons
  const btnStage2Back = document.getElementById("btn-wizard-stage-2-back");
  if (btnStage2Back) {
    btnStage2Back.addEventListener("click", () => {
      launcherState.wizardStage = 1;
      renderLauncherView();
    });
  }

  const btnStage2Next = document.getElementById("btn-wizard-stage-2-next");
  if (btnStage2Next) {
    btnStage2Next.addEventListener("click", () => {
      launcherState.wizardStage = 3;
      renderLauncherView();
    });
  }

  // Stage 3 Back Button
  const btnStage3Back = document.getElementById("btn-wizard-stage-3-back");
  if (btnStage3Back) {
    btnStage3Back.addEventListener("click", () => {
      launcherState.wizardStage = 2;
      renderLauncherView();
    });
  }

  // Stage 4 Ingest Another Course Button
  const btnIngestAnother = document.getElementById("btn-ingest-another");
  if (btnIngestAnother) {
    btnIngestAnother.addEventListener("click", () => {
      launcherState.isIngesting = false;
      launcherState.jobId = null;
      launcherState.finishedCourse = null;
      launcherState.logs = [];
      launcherState.completedSteps.clear();
      launcherState.activeStep = 1;
      launcherState.courseUrl = "";
      launcherState.courseName = "";
      launcherState.wizardStage = 1;
      renderLauncherView();
    });
  }

  const urlInput = document.getElementById("launcher-course-url");
  const nameInput = document.getElementById("launcher-course-name");

  if (urlInput) {
    urlInput.addEventListener("input", (e) => {
      launcherState.courseUrl = e.target.value;
      // Auto-detect course ID if course name is empty
      const m = launcherState.courseUrl.match(/(?:courses|course)\/(\d+)/);
      if (m && !launcherState.courseName) {
        launcherState.courseName = `Course_${m[1]}`;
        if (nameInput) nameInput.value = launcherState.courseName;
      }
      updateFolderPreview();
    });
  }

  if (nameInput) {
    nameInput.addEventListener("input", (e) => {
      launcherState.courseName = e.target.value;
      updateFolderPreview();
    });
  }

  // AI Provider Cards
  document.querySelectorAll(".ai-engine-card").forEach(card => {
    card.addEventListener("click", () => {
      const provider = card.dataset.provider;
      if (provider) {
        launcherState.aiProvider = provider;
        renderLauncherView();
      }
    });
  });

  // Ollama Model select
  const ollamaSelect = document.getElementById("launcher-ollama-model");
  if (ollamaSelect) {
    ollamaSelect.addEventListener("change", (e) => {
      launcherState.ollamaModel = e.target.value;
    });
  }

  // Open Settings for Gemini Key
  els.viewLauncher.querySelectorAll(".btn-open-gemini-settings").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      if (typeof openSettingsModal === "function") openSettingsModal("ingestion");
    });
  });

  // Gemini API Key input
  const geminiKeyInput = document.getElementById("launcher-gemini-api-key");
  if (geminiKeyInput) {
    geminiKeyInput.addEventListener("input", (e) => {
      launcherState.geminiApiKey = e.target.value;
    });
  }

  // API Key visibility toggle
  const btnToggleKey = document.getElementById("btn-toggle-api-key");
  if (btnToggleKey && geminiKeyInput) {
    btnToggleKey.addEventListener("click", () => {
      const isHidden = geminiKeyInput.type === "password";
      geminiKeyInput.type = isHidden ? "text" : "password";
      btnToggleKey.title = isHidden ? "Hide key" : "Show key";
    });
  }

  if (typeof state !== "undefined" && state.settings && state.settings.geminiTier) {
    launcherState.geminiTier = state.settings.geminiTier;
  }

  // Category selection cards
  document.querySelectorAll(".category-card").forEach(card => {
    card.addEventListener("click", () => {
      const catId = card.dataset.category;
      if (catId) {
        if (launcherState.categories.has(catId)) {
          launcherState.categories.delete(catId);
        } else {
          launcherState.categories.add(catId);
        }
        renderLauncherView();
      }
    });
  });

  // Select All / Clear All
  const btnSelectAll = document.getElementById("btn-cat-select-all");
  if (btnSelectAll) {
    btnSelectAll.addEventListener("click", () => {
      LAUNCHER_CATEGORIES.forEach(c => launcherState.categories.add(c.id));
      renderLauncherView();
    });
  }

  const btnClearAll = document.getElementById("btn-cat-clear-all");
  if (btnClearAll) {
    btnClearAll.addEventListener("click", () => {
      launcherState.categories.clear();
      renderLauncherView();
    });
  }

  // Headless toggle
  const headlessToggle = document.getElementById("launcher-headless-toggle");
  if (headlessToggle) {
    headlessToggle.addEventListener("change", (e) => {
      launcherState.headless = e.target.checked;
    });
  }

  // Clear logs button
  const btnClearLogs = document.getElementById("btn-clear-logs");
  if (btnClearLogs) {
    btnClearLogs.addEventListener("click", () => {
      launcherState.logs = [];
      const term = document.getElementById("terminal-log-window");
      if (term) term.innerHTML = `<div style="color:#6b7280;font-style:italic;">Console cleared.</div>`;
    });
  }

  // Cancel button
  const btnCancel = document.getElementById("btn-cancel-ingest");
  if (btnCancel) {
    btnCancel.addEventListener("click", async () => {
      await cancelIngestion();
    });
  }

  // Launch Action Trigger
  const btnFull = document.getElementById("btn-launch-full");
  if (btnFull) {
    btnFull.addEventListener("click", () => startIngestion("full"));
  }

  // Completion buttons
  const btnCompView = document.getElementById("btn-completion-view");
  if (btnCompView) {
    btnCompView.addEventListener("click", async () => {
      if (launcherState.finishedCourse?.name) {
        await loadCourseList();
        els.courseSelector.value = launcherState.finishedCourse.name;
        await selectCourse(launcherState.finishedCourse.name);
        switchView("canvas");
      }
    });
  }

  const btnCompReveal = document.getElementById("btn-completion-reveal");
  if (btnCompReveal) {
    btnCompReveal.addEventListener("click", () => {
      if (launcherState.finishedCourse?.name) {
        openFileInSystem(".", "reveal", launcherState.finishedCourse.name);
      }
    });
  }
}

function getFolderPreviewHtml(defaultDir, sanitized) {
  const h = (state.settings && state.settings.hierarchy) || {};
  const currentPreset = h.preset || "standard";
  const presetBadges = {
    standard: "Standard Dual-Folder",
    unified: "Unified Single-Folder",
    compact: "Compact Structure",
    custom: "Custom Template"
  };
  const badgeText = presetBadges[currentPreset] || "Custom Template";
  const isPrefixed = Boolean(h.prefixSubfolders || h.categorizationStyle === "prefixed");

  // Resolve main folders
  let mainFolders = Array.isArray(h.mainFolders) && h.mainFolders.length ? h.mainFolders : null;
  if (!mainFolders) {
    if (h.enableWorkFolder === false || h.preset === "unified") {
      mainFolders = [
        { id: "study_materials", name: h.lecturesFolder || "{course}", role: "study_materials" }
      ];
    } else {
      mainFolders = [
        { id: "main_lectures", name: h.lecturesFolder || "{course} Lectures & Resources", role: "study_materials" },
        { id: "main_work", name: h.workFolder || "{course} Work", role: "student_work" }
      ];
    }
  }

  const customFolders = Array.isArray(h.customFolders) ? h.customFolders : [];
  const timelineTemplate = h.timelineFile || "{course} Assignments_and_Milestones_Timeline.md";
  const timelineFile = typeof formatHierarchyFolder === "function" 
    ? formatHierarchyFolder(timelineTemplate, sanitized) 
    : timelineTemplate.replace(/\{course\}/gi, sanitized);

  let subTree = "";
  mainFolders.forEach((mf, mIdx) => {
    const isLastMain = (mIdx === mainFolders.length - 1);
    const branchSymbol = isLastMain ? "└──" : "├──";
    const subPrefix = isLastMain ? "    " : "│   ";
    const resolvedMain = typeof formatHierarchyFolder === "function" 
      ? formatHierarchyFolder(mf.name, sanitized) 
      : (mf.name || "").replace(/\{course\}/gi, sanitized);

    // Collect child entries for this main folder
    const children = [];

    // 1) Blueprint in first / study_materials main folder
    if (mIdx === 0 || mf.role === "study_materials" || mf.id === "study_materials" || mf.id === "main_lectures") {
      children.push({
        type: "file",
        icon: "📄",
        name: "canvas_course.json",
        note: "(LMS Blueprint)",
        isBlueprint: true
      });
    }

    // 2) Matching custom subfolders
    const matchingSubfolders = customFolders.filter(f => {
      return f.parent === mf.id || f.parent === mf.role || (mIdx === 0 && (!f.parent || f.parent === "study_materials"));
    });
    matchingSubfolders.forEach(sf => {
      let displayName = sf.name;
      if (isPrefixed) {
        if (!displayName.includes("{course}") && !displayName.toLowerCase().startsWith(sanitized.toLowerCase())) {
          displayName = `${sanitized} ${displayName}`;
        } else {
          displayName = typeof formatHierarchyFolder === "function" 
            ? formatHierarchyFolder(displayName, sanitized) 
            : displayName.replace(/\{course\}/gi, sanitized);
        }
      } else {
        displayName = typeof formatHierarchyFolder === "function" 
          ? formatHierarchyFolder(displayName, sanitized) 
          : displayName.replace(/\{course\}/gi, sanitized);
      }
      children.push({
        type: "folder",
        icon: "📁",
        name: `${displayName}/`,
        note: ""
      });
    });

    // 3) Milestones timeline file in student_work folder
    if (mf.role === "student_work" || mf.id === "student_work" || mf.id === "main_work" || (mIdx === 1 && mainFolders.length === 2)) {
      children.push({
        type: "file",
        icon: "📄",
        name: timelineFile,
        note: "(Milestones Schedule)",
        isTimeline: true
      });
    }

    subTree += `
      <div class="folder-preview-item" style="padding-left: 14px; margin-top: ${mIdx > 0 ? '6px' : '2px'};">
        <span style="font-family:ui-monospace,monospace;white-space:pre;color:var(--text-muted);user-select:none;">${branchSymbol} 📁 </span>
        <span class="folder-sub">${escapeHtml(resolvedMain)}/</span>
      </div>
    `;

    children.forEach((c, cIdx) => {
      const isLastChild = (cIdx === children.length - 1);
      const childBranch = isLastChild ? "└──" : "├──";
      let childNameHtml = escapeHtml(c.name);
      if (c.isBlueprint) {
        childNameHtml = `<span style="color:var(--canvas-accent);font-weight:600;">${childNameHtml}</span>`;
      } else if (c.isTimeline) {
        childNameHtml = `<span style="color:var(--text-muted);">${childNameHtml}</span>`;
      } else {
        childNameHtml = `<span>${childNameHtml}</span>`;
      }
      const childNoteHtml = c.note ? `<span style="font-size:10.5px;color:var(--text-muted);margin-left:5px;">${escapeHtml(c.note)}</span>` : "";

      subTree += `
        <div class="folder-preview-item" style="padding-left: 14px;">
          <span style="font-family:ui-monospace,monospace;white-space:pre;color:var(--text-muted);user-select:none;">${subPrefix}${childBranch} ${c.icon} </span>
          ${childNameHtml}${childNoteHtml}
        </div>
      `;
    });
  });

  return `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;padding-bottom:6px;border-bottom:1px solid var(--border-light);flex-wrap:wrap;gap:8px;">
      <div style="font-weight:700;color:var(--text-main);display:flex;align-items:center;gap:8px;">
        <span>📁 Destination Directory Architecture</span>
        <span style="font-size:11px;font-weight:600;padding:2px 8px;border-radius:12px;background:var(--bg-card);border:1px solid var(--border-light);color:var(--canvas-accent);">${escapeHtml(badgeText)}</span>
      </div>
      <div>
        <button type="button" class="btn-preview-customize" data-open-settings="directories" style="background:none;border:none;color:var(--canvas-accent);font-size:11.5px;font-weight:600;cursor:pointer;padding:0;text-decoration:underline;" title="Open Course Directories & Hierarchy Studio in Settings">
          Customize in Settings ↗
        </button>
      </div>
    </div>
    <div class="folder-preview-item" style="font-weight:600;">
      <span>📂 ${escapeHtml(defaultDir)}/${escapeHtml(sanitized)}/</span>
    </div>
    ${subTree}
  `;
}

function updateFolderPreview() {
  const sanitized = sanitizeCourseName(launcherState.courseName) || "[Course Name]";
  const box = document.querySelector(".folder-preview-box");
  if (!box) return;
  const defaultDir = (state.settings && state.settings.defaultCourseDir) || '~/Desktop';
  box.innerHTML = getFolderPreviewHtml(defaultDir, sanitized);
}

async function startIngestion(mode = "full") {
  if (launcherState.isIngesting) return;

  if (mode === "full" && !launcherState.courseUrl.trim()) {
    alert("Please enter a valid Canvas course URL (e.g. https://canvas.ucla.edu/courses/12345).");
    return;
  }
  if (!launcherState.courseName.trim()) {
    alert("Please provide a course folder name (e.g. CHEM 14D).");
    return;
  }

  launcherState.isIngesting = true;
  launcherState.wizardStage = 4;
  launcherState.activeStep = 1;
  launcherState.completedSteps.clear();
  launcherState.progressPct = 10;
  launcherState.phaseTitle = "Authentication & Session";
  launcherState.finishedCourse = null;
  launcherState.logs = [];
  launcherState.jobId = null;

  appendTerminalLog(`Initiating pipeline in '${mode}' mode for '${launcherState.courseName}'...`, "info");
  renderLauncherView();

  const payload = {
    course_url: launcherState.courseUrl,
    course_name: launcherState.courseName,
    ai_provider: launcherState.aiProvider,
    gemini_tier: launcherState.geminiTier,
    ollama_model: launcherState.ollamaModel,
    headless: launcherState.headless,
    categories: Array.from(launcherState.categories),
    gradescope_url: launcherState.gradescopeUrl,
    mode: mode
  };

  try {
    const data = await startArchiveJob(launcherState, payload);
    launcherState.jobId = data.job_id;
    appendTerminalLog("Job registered with backend execution daemon.", "info");
    connectPipelineStream(data.job_id);
  } catch (err) {
    handlePipelineEvent({ type: "error", message: err.message });
  }
}

function connectPipelineStream(jobId) {
  connectArchiveJobStream(launcherState, jobId, handlePipelineEvent, appendTerminalLog);
}

function handlePipelineEvent(evt) {
  if (!evt) return;
  if (evt.type === "done" && evt.success === false) {
    handlePipelineEvent({ type: "error", message: "The operation did not complete successfully." });
    return;
  }

  if (evt.type === "step") {
    if (evt.step > launcherState.activeStep && launcherState.activeStep > 0) {
      launcherState.completedSteps.add(launcherState.activeStep);
    }
    launcherState.activeStep = evt.step;
    if (typeof evt.pct === "number") {
      launcherState.progressPct = Math.min(100, Math.max(0, evt.pct));
    }
    if (evt.phase_title) {
      launcherState.phaseTitle = evt.phase_title;
    }
    renderLauncherView();
  } else if (evt.type === "log") {
    appendTerminalLog(evt.message, evt.level || "info");
  } else if (evt.type === "done") {
    if (launcherState.eventSource) {
      launcherState.eventSource.close();
      launcherState.eventSource = null;
    }
    launcherState.completedSteps.add(1);
    launcherState.completedSteps.add(2);
    launcherState.completedSteps.add(3);
    launcherState.completedSteps.add(4);
    launcherState.completedSteps.add(5);
    launcherState.activeStep = 0;
    launcherState.progressPct = 100;
    launcherState.phaseTitle = "Add Course Complete";
    launcherState.isIngesting = false;
    launcherState.finishedCourse = {
      name: launcherState.courseName,
      files_count: Number.isSafeInteger(evt.files_count) && evt.files_count >= 0 ? evt.files_count : null
    };
    appendTerminalLog(`Pipeline execution finished successfully!`, "success");
    renderLauncherView();
  } else if (evt.type === "error") {
    appendTerminalLog(`Error: ${evt.message}`, "error");
    if (launcherState.eventSource) {
      launcherState.eventSource.close();
      launcherState.eventSource = null;
    }
    launcherState.isIngesting = false;
    launcherState.finishedCourse = null;
    launcherState.phaseTitle = "Operation failed";
    renderLauncherView();
  }
}

async function cancelIngestion() {
  if (!launcherState.isIngesting) return;
  appendTerminalLog("Cancelling add course job...", "warn");
  if (!launcherState.jobId) {
    appendTerminalLog("The start request is still pending. Wait for a job ID before cancelling.", "warn");
    return;
  }
  try {
    const response = await fetch(`/api/launcher/cancel/${encodeURIComponent(launcherState.jobId)}`, { method: "POST" });
    if (!response.ok) throw new Error("Cancellation was not accepted.");
  } catch {
    appendTerminalLog("Cancellation could not be confirmed. The job may still be running; retry when connected.", "error");
    return;
  }
  if (launcherState.eventSource) {
    launcherState.eventSource.close();
    launcherState.eventSource = null;
  }
  launcherState.isIngesting = false;
  appendTerminalLog("Job cancelled by user.", "error");
  renderLauncherView();
}

// [Codex] Shared transport keeps credentials out of jobs and never invents success.
async function startArchiveJob(jobState, payload) {
  if (jobState.aiProvider === "gemini" && (jobState.geminiApiKey || "").trim()) {
    const saved = await fetch("/api/settings/gemini-key", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_key: (jobState.geminiApiKey || "").trim() })
    });
    if (!saved.ok) throw new Error(`Could not save the API key (HTTP ${saved.status}).`);
    jobState.geminiApiKey = "";
    document.querySelectorAll("#launcher-gemini-api-key, #rescan-gemini-api-key").forEach(input => { input.value = ""; });
  }
  const response = await fetch("/api/launcher/start", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!response.ok) throw new Error(`The operation could not start (HTTP ${response.status}). Check the server and retry.`);
  const data = await response.json();
  if (!data || typeof data.job_id !== "string" || !data.job_id) throw new Error("The server did not return a valid job ID.");
  return data;
}

function connectArchiveJobStream(jobState, jobId, onEvent, log) {
  if (jobState.eventSource) jobState.eventSource.close();
  const stream = new EventSource(`/api/launcher/stream/${encodeURIComponent(jobId)}`);
  jobState.eventSource = stream;
  let interrupted = false;
  stream.onmessage = event => {
    if (jobState.eventSource !== stream) return;
    try { onEvent(JSON.parse(event.data)); }
    catch { log("Received an invalid job update.", "warn"); }
  };
  stream.onopen = () => {
    if (jobState.eventSource !== stream) return;
    if (interrupted) log("Job connection restored.", "info");
    interrupted = false;
  };
  stream.onerror = () => {
    if (jobState.eventSource !== stream) return;
    if (!interrupted) log("Connection interrupted; reconnecting to the running job. Completion is not yet confirmed.", "warn");
    interrupted = true;
    // EventSource reconnects automatically. Keep the job active until confirmed.
  };
}

// --- Module: 15_rescan.js ---
// --- Module: 15_rescan.js ---
// Rescan & Course Maintenance View

const rescanState = {
  courseName: "",
  operation: "organize", // "organize", "gradescope", "rescrape"
  wizardStage: 1,
  aiProvider: "gemini", // "gemini", "ollama", "rules"
  geminiApiKey: "",
  geminiConfigured: null, // null = unknown, true = configured, false = not configured
  geminiTier: "paid",
  ollamaModel: "qwen2.5:7b",
  headless: true,
  categories: new Set(["modules", "files", "announcements", "assignments"]),
  gradescopeUrl: "",
  isIngesting: false,
  activeStep: 0,
  completedSteps: new Set(),
  progressPct: 0,
  phaseTitle: "",
  logs: [],
  jobId: null,
  eventSource: null,
  hardwareProfile: null,
  finishedCourse: null
};

async function fetchRescanGeminiKeyStatus() {
  if (rescanState.geminiConfigured !== null) return rescanState.geminiConfigured;
  try {
    const res = await fetch("/api/settings/gemini-key");
    if (res.ok) {
      const data = await res.json();
      rescanState.geminiConfigured = Boolean(data.configured);
      return rescanState.geminiConfigured;
    }
  } catch (err) {}
  rescanState.geminiConfigured = false;
  return rescanState.geminiConfigured;
}

const RESCAN_STEPS = {
  organize: [
    { step: 1, title: "Scan Desktop Directory", desc: "Analyzing existing files and hierarchy in ~/Desktop/[Course]/" },
    { step: 2, title: "AI Model Initialization", desc: "Setting up local Ollama or Gemini classification engine" },
    { step: 3, title: "File Classification & Sorter", desc: "Re-organizing files into Lectures & Resources vs. Work folders" },
    { step: 4, title: "Rebuild Blueprint & Index", desc: "Updating canvas_course.json and rebuilding search index" }
  ],
  gradescope: [
    { step: 1, title: "Gradescope Authentication", desc: "Verifying session credentials and launching browser" },
    { step: 2, title: "Fetch Submissions & Rubrics", desc: "Downloading latest graded work and feedback" },
    { step: 3, title: "Organize Work Directory", desc: "Sorting new submissions into ~/Desktop/[Course]/[Course] Work/" },
    { step: 4, title: "Update Course Data", desc: "Syncing gradescope metadata in local course blueprint" }
  ],
  rescrape: [
    { step: 1, title: "Authentication & Session", desc: "Verifying Duo 2FA / Shibboleth session" },
    { step: 2, title: "Category Crawl & Downloads", desc: "Re-scraping selected categories for new content" },
    { step: 3, title: "AI File Organization", desc: "Classifying newly downloaded documents" },
    { step: 4, title: "Update Course Blueprint & FTS5 Index", desc: "Refreshing local blueprint and search database" }
  ]
};

async function fetchRescanHardwareProfile() {
  if (rescanState.hardwareProfile) return rescanState.hardwareProfile;
  try {
    const res = await fetch("/api/launcher/hardware-profile");
    if (res.ok) {
      rescanState.hardwareProfile = await res.json();
      return rescanState.hardwareProfile;
    }
  } catch (err) {}
  rescanState.hardwareProfile = {
    chip: "Apple Silicon (Auto-detected)",
    ram_gb: 16,
    is_apple_silicon: true,
    tier: "apple_silicon_high_ram",
    recommended_model: "qwen2.5:7b"
  };
  return rescanState.hardwareProfile;
}

function renderRescanView() {
  if (!els.viewRescan) return;
  els.viewRescan.classList.remove("hidden");

  // Ensure course is selected
  if (!rescanState.courseName && state.courses && state.courses.length > 0) {
    const active = state.courses.find(c => c.name === state.currentCourse) || state.courses[0];
    rescanState.courseName = active.name;
  }

  if (rescanState.geminiConfigured === null) {
    fetchRescanGeminiKeyStatus().then(() => {
      if (rescanState.wizardStage === 3 && state.activeView === "rescan") {
        renderRescanView();
      }
    });
  }

  if (!rescanState.hardwareProfile) {
    fetchRescanHardwareProfile().then(() => {
      const container = document.getElementById("rescan-hardware-badge-container");
      if (container && rescanState.hardwareProfile) {
        container.innerHTML = `
          <div class="hardware-profile-banner">
            <span class="hardware-banner-icon">${Icons.cpu || Icons.sparkles}</span>
            <div class="hardware-banner-text">
              <strong>Hardware Profile:</strong> ${escapeHtml(rescanState.hardwareProfile.chip || "Apple Silicon")} • ${rescanState.hardwareProfile.ram_gb || 16} GB RAM
              ${rescanState.hardwareProfile.is_apple_silicon && (rescanState.hardwareProfile.ram_gb >= 16) 
                ? ` • Recommended: <strong>qwen2.5:7b</strong> or Gemini Flash Lite` 
                : ` • Recommended: <strong>Gemini Flash Lite</strong> (Cloud inference)`}
            </div>
          </div>
        `;
      }
    });
  }

  const currentStage = (rescanState.isIngesting || rescanState.finishedCourse) ? 4 : (rescanState.wizardStage || 1);
  const currentSteps = RESCAN_STEPS[rescanState.operation] || RESCAN_STEPS.organize;
  const totalSteps = currentSteps.length;
  let progressPct = rescanState.progressPct || 0;
  if (!progressPct) {
    if (rescanState.completedSteps.size === totalSteps || rescanState.finishedCourse) {
      progressPct = 100;
    } else if (rescanState.activeStep > 0) {
      const fraction = (rescanState.activeStep - 1) / (totalSteps - 1 || 1);
      progressPct = Math.round(15 + fraction * 75);
    }
  }

  const currentCourseObj = (state.courses || []).find(c => c.name === rescanState.courseName);
  const fileCount = currentCourseObj?.stats?.files || 0;

  let opButtonText = "🔄 Run File Re-classification";
  let opButtonIcon = Icons.refreshCw || Icons.rocket;
  if (rescanState.operation === "gradescope") {
    opButtonText = "🎓 Sync Gradescope Course";
    opButtonIcon = Icons.badgeCheck || Icons.rocket;
  } else if (rescanState.operation === "rescrape") {
    opButtonText = "🔁 Re-scrape Course Categories";
    opButtonIcon = Icons.rocket;
  }

  let html = `
    <div class="rescan-container">
      <div class="rescan-hero">
        <div class="rescan-hero-title-area">
          <div class="rescan-title-row">
            <h1>Rescan & Maintain Course</h1>
          </div>
          <p class="rescan-subtitle">
            Perform targeted maintenance on existing downloaded courses: re-classify files with AI, sync new Gradescope submissions, or update selected categories.
          </p>
        </div>
      </div>

      <!-- Wizard Navigation Tracker -->
      <div class="wizard-nav">
        <div class="wizard-step-pill ${currentStage === 1 ? "active" : (currentStage > 1 ? "completed" : "disabled")} ${rescanState.isIngesting ? "disabled" : ""}" data-rescan-stage="1">
          <span class="wizard-pill-num">${currentStage > 1 ? Icons.check : "1"}</span>
          <span>1. Select Course</span>
        </div>
        <span class="wizard-nav-divider">→</span>
        <div class="wizard-step-pill ${currentStage === 2 ? "active" : (currentStage > 2 ? "completed" : "disabled")} ${rescanState.isIngesting ? "disabled" : ""}" data-rescan-stage="2">
          <span class="wizard-pill-num">${currentStage > 2 ? Icons.check : "2"}</span>
          <span>2. Choose Operation</span>
        </div>
        <span class="wizard-nav-divider">→</span>
        <div class="wizard-step-pill ${currentStage === 3 ? "active" : (currentStage > 3 ? "completed" : "disabled")} ${rescanState.isIngesting ? "disabled" : ""}" data-rescan-stage="3">
          <span class="wizard-pill-num">${currentStage > 3 ? Icons.check : "3"}</span>
          <span>3. Engine & Launch</span>
        </div>
        <span class="wizard-nav-divider">→</span>
        <div class="wizard-step-pill ${currentStage === 4 ? "active" : "disabled"}" data-rescan-stage="4">
          <span class="wizard-pill-num">${rescanState.finishedCourse ? Icons.check : "4"}</span>
          <span>4. Live Progress</span>
        </div>
      </div>

      <div class="rescan-layout">

        <!-- Stage 1: Target Course Selection -->
        ${currentStage === 1 ? `
          <div class="wizard-stage-panel">
            <div class="launcher-card">
              <div class="launcher-card-header">
                <div class="launcher-card-title-group">
                  <div class="launcher-card-icon">${Icons.folders || Icons.folderOpen}</div>
                  <div>
                    <h3 class="launcher-card-title">Select Target Course</h3>
                    <p class="launcher-card-desc">Choose an existing course directory from your Desktop</p>
                  </div>
                </div>
              </div>

              <div class="launcher-form-group">
                <label class="launcher-form-label" for="rescan-course-select">
                  <span>Downloaded Course <span style="color: #ef4444;">*</span></span>
                </label>
                <select id="rescan-course-select" class="launcher-form-input">
                  ${(state.courses || []).map(c => `
                    <option value="${escapeHtml(c.name)}" ${c.name === rescanState.courseName ? "selected" : ""}>
                      ${escapeHtml(c.name)} (${c.stats?.files || 0} files)
                    </option>
                  `).join("")}
                </select>
              </div>

              <div class="rescan-course-info-banner">
                <span>📁 Location: <strong>~/Desktop/${escapeHtml(rescanState.courseName || "[Course]")}/</strong></span>
                <span>•</span>
                <span>Indexed Files: <strong>${fileCount}</strong></span>
              </div>
            </div>

            <div class="wizard-actions-bar single-action">
              <button type="button" class="btn-wizard-next" id="btn-rescan-stage-1-next">
                <span>Continue to Maintenance Operation</span>
                <span>→</span>
              </button>
            </div>
          </div>
        ` : ""}

        <!-- Stage 2: Operation Choice -->
        ${currentStage === 2 ? `
          <div class="wizard-stage-panel">
            <div class="launcher-card">
              <div class="launcher-card-header">
                <div class="launcher-card-title-group">
                  <div class="launcher-card-icon">${Icons.settings || Icons.modules}</div>
                  <div>
                    <h3 class="launcher-card-title">Maintenance Operation</h3>
                    <p class="launcher-card-desc">Choose what action to perform on ${escapeHtml(rescanState.courseName)}</p>
                  </div>
                </div>
              </div>

              <div class="rescan-operations-grid">
                <div class="rescan-op-card ${rescanState.operation === "organize" ? "selected" : ""}" data-op="organize">
                  <div class="rescan-op-card-header">
                    <span class="rescan-op-icon">${Icons.sparkles || Icons.refreshCw}</span>
                    <span class="rescan-op-title">Re-classify Files</span>
                  </div>
                  <p class="rescan-op-desc">
                    Re-sort files between Lectures & Resources and Work folders using AI without re-downloading anything.
                  </p>
                </div>

                <div class="rescan-op-card ${rescanState.operation === "gradescope" ? "selected" : ""}" data-op="gradescope">
                  <div class="rescan-op-card-header">
                    <span class="rescan-op-icon">${Icons.badgeCheck || Icons.check}</span>
                    <span class="rescan-op-title">Sync Gradescope</span>
                  </div>
                  <p class="rescan-op-desc">
                    Headless Gradescope crawl to fetch new homework submissions, rubrics, and graded work.
                  </p>
                </div>

                <div class="rescan-op-card ${rescanState.operation === "rescrape" ? "selected" : ""}" data-op="rescrape">
                  <div class="rescan-op-card-header">
                    <span class="rescan-op-icon">${Icons.rocket || Icons.modules}</span>
                    <span class="rescan-op-title">Re-scrape Categories</span>
                  </div>
                  <p class="rescan-op-desc">
                    Re-crawl selected Canvas sections (modules, announcements, files) for updated course materials.
                  </p>
                </div>
              </div>

              ${rescanState.operation === "gradescope" ? `
                <div class="launcher-form-group" style="margin-top:14px;">
                  <label class="launcher-form-label" for="rescan-gradescope-url">
                    <span>Optional Gradescope Course URL</span>
                  </label>
                  <input type="text" id="rescan-gradescope-url" class="launcher-form-input" 
                    placeholder="e.g. https://www.gradescope.com/courses/123456" 
                    value="${escapeHtml(rescanState.gradescopeUrl)}">
                  <div class="launcher-input-hint">
                    <span>If omitted, auto-discovers Gradescope from existing course blueprint.</span>
                  </div>
                </div>
              ` : ""}

              ${rescanState.operation === "rescrape" ? `
                <div class="category-actions-bar" style="margin-top:16px;">
                  <span class="category-selection-count">${rescanState.categories.size} Categories to Re-scrape</span>
                  <div class="category-btn-group">
                    <button type="button" class="btn-cat-action" id="btn-rescan-select-all">Select All</button>
                    <button type="button" class="btn-cat-action" id="btn-rescan-clear-all">Clear All</button>
                  </div>
                </div>
                <div class="category-grid" style="margin-top:10px;">
                  ${(typeof LAUNCHER_CATEGORIES !== "undefined" ? LAUNCHER_CATEGORIES : []).map(cat => {
                    const isSelected = rescanState.categories.has(cat.id);
                    return `
                      <div class="category-card ${isSelected ? "selected" : ""}" data-rescan-cat="${cat.id}">
                        <div class="category-card-checkbox">
                          ${Icons.check}
                        </div>
                        <div class="category-card-content">
                          <span class="category-card-title">${cat.label}</span>
                          <span class="category-card-sub">${cat.sub}</span>
                        </div>
                      </div>
                    `;
                  }).join("")}
                </div>
              ` : ""}
            </div>

            <div class="wizard-actions-bar">
              <button type="button" class="btn-wizard-back" id="btn-rescan-stage-2-back">
                <span>← Back to Course Selection</span>
              </button>
              <button type="button" class="btn-wizard-next" id="btn-rescan-stage-2-next">
                <span>${rescanState.operation === "gradescope" ? "Continue to Execution Controls" : "Continue to AI Classification"}</span>
                <span>→</span>
              </button>
            </div>
          </div>
        ` : ""}

        <!-- Stage 3: Engine & Execution Setup -->
        ${currentStage === 3 ? `
          <div class="wizard-stage-panel">
            ${rescanState.operation !== "gradescope" ? `
              <div class="launcher-card">
                <div class="launcher-card-header">
                  <div class="launcher-card-title-group">
                    <div class="launcher-card-icon">${Icons.cpu || Icons.sparkles}</div>
                    <div>
                      <h3 class="launcher-card-title">AI Classification Engine</h3>
                      <p class="launcher-card-desc">Engine used for organizing and naming files</p>
                    </div>
                  </div>
                </div>

                <div id="rescan-hardware-badge-container">
                  <div class="hardware-profile-banner">
                    <span class="hardware-banner-icon">${Icons.cpu || Icons.sparkles}</span>
                    <div class="hardware-banner-text">
                      <strong>Hardware Profile:</strong> ${escapeHtml(rescanState.hardwareProfile?.chip || "Apple Silicon")} • ${rescanState.hardwareProfile?.ram_gb || 16} GB RAM
                    </div>
                  </div>
                </div>

                <div class="ai-engines-grid">
                  <div class="ai-engine-card ${rescanState.aiProvider === "gemini" ? "selected" : ""}" data-rescan-provider="gemini">
                    <div class="ai-engine-card-header">
                      <span class="ai-engine-name">Gemini Flash Lite</span>
                      <span class="ai-engine-badge ai-badge-cloud">Cloud API</span>
                    </div>
                    <div class="ai-engine-desc">
                      Google Gemini processes course excerpts and filenames in the cloud, including submitted coursework and rescans. Free-tier submissions may be used by Google to improve products and reviewed by humans.
                    </div>
                  </div>

                  <div class="ai-engine-card ${rescanState.aiProvider === "ollama" ? "selected" : ""}" data-rescan-provider="ollama">
                    <div class="ai-engine-card-header">
                      <span class="ai-engine-name">Offline Ollama</span>
                      <span class="ai-engine-badge ai-badge-local">Local GPU</span>
                    </div>
                    <div class="ai-engine-desc">
                      Classification runs on this computer with Ollama. Course content is not sent to a cloud AI provider.
                    </div>
                  </div>

                  <div class="ai-engine-card ${rescanState.aiProvider === "rules" ? "selected" : ""}" data-rescan-provider="rules">
                    <div class="ai-engine-card-header">
                      <span class="ai-engine-name">Keyword Heuristics</span>
                      <span class="ai-engine-badge ai-badge-rules">Zero-LLM</span>
                    </div>
                    <div class="ai-engine-desc">
                      Deterministic keyword patterns and course syllabus token rules without requiring AI models.
                    </div>
                  </div>
                </div>

                ${rescanState.aiProvider === "gemini" ? `
                  ${rescanState.geminiConfigured ? `
                    <div class="gemini-key-status-banner">
                      <div style="display:flex; align-items:center; gap:10px;">
                        <span style="display:flex; color:#10B981; width:18px; height:18px; flex-shrink:0;">${Icons.check || "✓"}</span>
                        <div>
                          <div style="font-size:13px; font-weight:700; color:var(--text-main);">Google AI Studio API Key Configured</div>
                          <div style="font-size:11.5px; color:var(--text-muted); margin-top:2px; display:flex; align-items:center; gap:8px;">
                            <span>API key active in <code>config.json</code></span>
                            <span>•</span>
                            <span>⚡ <strong>${(state.settings?.geminiTier || rescanState.geminiTier || "paid") === "paid" ? "Paid Tier (Fast ~120 RPM)" : "Free Tier (Safe 10 RPM)"}</strong></span>
                          </div>
                        </div>
                      </div>
                      <button type="button" class="btn-launcher-secondary btn-open-gemini-settings">
                        <span style="display:flex;width:14px;height:14px;">${Icons.settings || ""}</span>
                        <span>Change in Settings</span>
                      </button>
                    </div>
                  ` : `
                    <div class="launcher-form-group" style="margin-top:14px;">
                      <div class="launcher-form-label">
                        <span>Google AI Studio API Key</span>
                        <button type="button" class="btn-open-gemini-settings" style="background:none; border:none; color:var(--canvas-accent); font-size:11.5px; cursor:pointer; padding:0; text-decoration:underline;">Configure in Settings</button>
                      </div>
                      <div class="launcher-api-key-row">
                        <input type="password" id="rescan-gemini-api-key" class="launcher-form-input launcher-api-key-input"
                          placeholder="Enter your Gemini API key"
                          value="${escapeHtml(rescanState.geminiApiKey)}"
                          autocomplete="off" spellcheck="false">
                        <button type="button" class="btn-api-key-toggle" id="btn-rescan-toggle-key" title="Show / hide key">
                          ${Icons.eye || `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`}
                        </button>
                      </div>
                      <div class="launcher-input-hint">
                        <span>Stored locally in <code>config.json</code>. You can also configure it in <a href="#" class="btn-open-gemini-settings" style="color:var(--canvas-accent);">Settings</a>.</span>
                      </div>
                    </div>

                    <div class="launcher-tier-banner" style="display:flex; align-items:center; justify-content:space-between; padding:10px 14px; background:var(--bg-card); border:1px solid var(--border-color); border-radius:8px; margin-top:12px;">
                      <div style="display:flex; align-items:center; gap:8px;">
                        <span style="color:#F59E0B; font-size:14px;">⚡</span>
                        <span style="font-size:12.5px; color:var(--text-main);">
                          Gemini Rate Tier: <strong>${(state.settings?.geminiTier || rescanState.geminiTier || "paid") === "paid" ? "Paid Tier (Fast ~120 RPM)" : "Free Tier (Safe 10 RPM)"}</strong>
                        </span>
                      </div>
                      <button type="button" class="btn-text-link" data-open-settings="ingestion" style="font-size:12px; color:var(--canvas-active-accent, #60A5FA); background:none; border:none; cursor:pointer; text-decoration:underline;">
                        Change in Settings
                      </button>
                    </div>
                  `}
                  <p class="gemini-privacy-warning"><strong>Before rescanning with Gemini:</strong> Submitted coursework and other course content may be sent to Google. Do not use Google's free API tier for sensitive, confidential, or personal material. Use Keyword Heuristics or Ollama for local classification. The app's rate-tier choice controls pacing, not your Google billing or data-use terms. <a href="https://ai.google.dev/gemini-api/terms" target="_blank" rel="noopener noreferrer">Google's terms</a>.</p>
                ` : ""}

                ${rescanState.aiProvider === "ollama" ? `
                  <div class="launcher-form-group" style="margin-top:14px;">
                    <label class="launcher-form-label" for="rescan-ollama-model">
                      <span>Local Ollama Model</span>
                    </label>
                    <select id="rescan-ollama-model" class="launcher-form-input">
                      <option value="qwen2.5:7b" ${rescanState.ollamaModel === "qwen2.5:7b" ? "selected" : ""}>qwen2.5:7b (Recommended for ≥16GB Apple Silicon)</option>
                      <option value="qwen2.5:3b" ${rescanState.ollamaModel === "qwen2.5:3b" ? "selected" : ""}>qwen2.5:3b (Low-power / Whisper-quiet)</option>
                      <option value="llama3.2" ${rescanState.ollamaModel === "llama3.2" ? "selected" : ""}>llama3.2 (Compact local model)</option>
                      <option value="mistral" ${rescanState.ollamaModel === "mistral" ? "selected" : ""}>mistral:7b</option>
                    </select>
                  </div>
                ` : ""}
              </div>
            ` : ""}

            <!-- Execution Controls Card -->
            <div class="launcher-card">
              <div class="launcher-card-header">
                <div class="launcher-card-title-group">
                  <div class="launcher-card-icon">${Icons.terminal || Icons.rocket}</div>
                  <div>
                    <h3 class="launcher-card-title">Execution Controls</h3>
                    <p class="launcher-card-desc">Review settings and run maintenance on ${escapeHtml(rescanState.courseName)}</p>
                  </div>
                </div>
              </div>

              <div class="execution-options-row">
                <div class="execution-option-info">
                  <span class="execution-option-title">Headless Browser Mode</span>
                  <span class="execution-option-desc">Runs Playwright invisibly in background using ~/.canvas_browser_profile/</span>
                </div>
                <label class="toggle-switch">
                  <input type="checkbox" id="rescan-headless-toggle" ${rescanState.headless ? "checked" : ""}>
                  <span class="toggle-slider"></span>
                </label>
              </div>

              <div class="rescan-course-info-banner" style="margin-top: 14px;">
                <span>Operation: <strong>${escapeHtml(rescanState.operation === "organize" ? "Re-classify Files" : (rescanState.operation === "gradescope" ? "Sync Gradescope" : "Re-scrape Categories"))}</strong></span>
                <span>•</span>
                <span>Target: <strong>~/Desktop/${escapeHtml(rescanState.courseName)}/</strong></span>
              </div>
            </div>

            <div class="wizard-actions-bar">
              <button type="button" class="btn-wizard-back" id="btn-rescan-stage-3-back">
                <span>← Back to Operation Choice</span>
              </button>
              <button type="button" class="btn-launcher-primary" id="btn-rescan-launch" ${rescanState.isIngesting ? "disabled" : ""}>
                <span class="btn-icon">${opButtonIcon}</span>
                <span>${rescanState.isIngesting ? "Operation Running..." : opButtonText}</span>
              </button>
            </div>
          </div>
        ` : ""}

        <!-- Stage 4: Active Operation & Live Streaming -->
        ${currentStage === 4 ? `
          <div class="wizard-stage-panel">
            <!-- Horizontal Fused Progress Timeline Card -->
            <div class="horizontal-timeline-card">
              <div class="horizontal-timeline-header">
                <div class="horizontal-timeline-title-area">
                  <div class="launcher-card-icon" style="width:28px;height:28px;">${Icons.timeline || Icons.dashboard}</div>
                  <h3 class="horizontal-timeline-title">Operation Progress: ${escapeHtml(rescanState.operation === "organize" ? "Re-classifying Files" : (rescanState.operation === "gradescope" ? "Syncing Gradescope" : "Re-scraping Categories"))}</h3>
                </div>
                <span class="horizontal-timeline-badge">${rescanState.isIngesting ? `Step ${rescanState.activeStep} of ${totalSteps}` : (rescanState.finishedCourse ? "Complete" : "Standby")}</span>
              </div>

              <div class="horizontal-timeline-track-wrap">
                <div class="horizontal-timeline-track-line"></div>
                <div class="horizontal-timeline-fill-bar" style="width: ${progressPct}%;"></div>

                <div class="horizontal-timeline-nodes pipeline-stepper">
                  ${currentSteps.map(step => {
                    const isCompleted = rescanState.completedSteps.has(step.step);
                    const isActive = rescanState.activeStep === step.step;
                    let statusClass = "";
                    if (isCompleted) statusClass = "completed";
                    else if (isActive) statusClass = "active";

                    return `
                      <div class="horizontal-step-node step-item ${statusClass}" id="rescan-step-${step.step}">
                        <div class="horizontal-node-marker step-marker">
                          ${isCompleted ? Icons.check : step.step}
                        </div>
                        <div class="horizontal-node-info step-details">
                          <span class="horizontal-node-title step-title">${step.title}</span>
                          <span class="horizontal-node-desc step-desc">${step.desc}</span>
                        </div>
                      </div>
                    `;
                  }).join("")}
                </div>
              </div>
            </div>

            <!-- Streaming Terminal Console -->
            <div class="launcher-terminal-card">
              <div class="terminal-header">
                <div class="terminal-header-left">
                  <div class="terminal-window-dots">
                    <div class="terminal-dot terminal-dot-close"></div>
                    <div class="terminal-dot terminal-dot-minimize"></div>
                    <div class="terminal-dot terminal-dot-zoom"></div>
                  </div>
                  <span class="terminal-title">rescan_pipeline_stream.log</span>
                </div>
                <div class="terminal-header-right">
                  <button type="button" class="terminal-btn-clear" id="btn-rescan-clear-logs" title="Clear console output">Clear</button>
                  ${rescanState.isIngesting ? `
                    <button type="button" class="terminal-btn-cancel" id="btn-rescan-cancel">
                      <span style="display:flex;width:12px;height:12px;">${Icons.stopCircle || ""}</span>
                      <span>Cancel</span>
                    </button>
                  ` : ""}
                </div>
              </div>

              <div class="terminal-log-window" id="rescan-terminal-log-window" style="min-height: 280px; max-height: 480px;">
                ${rescanState.logs.length === 0 
                  ? `<div style="color:#6b7280;font-style:italic;">Ready to start. Operation logs will stream here live.</div>`
                  : rescanState.logs.map(l => formatTerminalLogLine(l)).join("")}
              </div>
            </div>

            <!-- Completion Card -->
            ${rescanState.finishedCourse ? `
              <div class="launcher-completion-card" style="margin-top: 18px;">
                <div class="completion-header">
                  <div class="completion-icon">${Icons.check}</div>
                  <div>
                    <h4 class="completion-title">Operation Complete!</h4>
                    <p class="completion-desc">
                      Successfully completed maintenance on <strong>${escapeHtml(rescanState.finishedCourse.name)}</strong>.
                    </p>
                  </div>
                </div>
                <div class="completion-actions">
                  <button type="button" class="btn-completion-view" id="btn-rescan-view-course">
                    <span style="display:flex;width:14px;height:14px;">${Icons.canvas}</span>
                    <span>View Course in App</span>
                  </button>
                  <button type="button" class="btn-completion-reveal" id="btn-rescan-reveal-finder">
                    <span style="display:flex;width:14px;height:14px;">${Icons.macFinder}</span>
                    <span>Show in Folder</span>
                  </button>
                  <button type="button" class="btn-launcher-secondary" id="btn-rescan-another" style="margin-left: auto;">
                    <span>➕ Rescan Another Course</span>
                  </button>
                </div>
              </div>
            ` : ""}
          </div>
        ` : ""}

      </div>
    </div>
  `;

  els.viewRescan.innerHTML = html;
  wireRescanEventListeners();
  scrollRescanTerminalToBottom();
}

function appendRescanTerminalLog(message, level = "info") {
  const entry = {
    message,
    level,
    timestamp: new Date().toLocaleTimeString()
  };
  rescanState.logs.push(entry);

  const term = document.getElementById("rescan-terminal-log-window");
  if (term) {
    const lineHtml = formatTerminalLogLine(entry);
    term.insertAdjacentHTML("beforeend", lineHtml);
    scrollRescanTerminalToBottom();
  }
}

function scrollRescanTerminalToBottom() {
  if (state.settings.terminalAutoscroll === false) return;
  const term = document.getElementById("rescan-terminal-log-window");
  if (term) {
    term.scrollTop = term.scrollHeight;
  }
}

function wireRescanEventListeners() {
  // Wizard Navigation Pills (one at a time progression: only allow clicking previously completed steps to go back)
  document.querySelectorAll("[data-rescan-stage]").forEach(pill => {
    pill.addEventListener("click", () => {
      if (rescanState.isIngesting) return;
      const targetStage = parseInt(pill.dataset.rescanStage, 10);
      // Can only navigate backward to previously completed stages; advancing is done one at a time via action buttons
      if (targetStage >= 1 && targetStage < rescanState.wizardStage) {
        rescanState.wizardStage = targetStage;
        renderRescanView();
      }
    });
  });

  // Stage 1 -> 2 Next
  const btnStage1Next = document.getElementById("btn-rescan-stage-1-next");
  if (btnStage1Next) {
    btnStage1Next.addEventListener("click", () => {
      if (!rescanState.courseName.trim()) {
        alert("Please select a valid course first.");
        return;
      }
      rescanState.wizardStage = 2;
      renderRescanView();
    });
  }

  // Stage 2 Back & Next
  const btnStage2Back = document.getElementById("btn-rescan-stage-2-back");
  if (btnStage2Back) {
    btnStage2Back.addEventListener("click", () => {
      rescanState.wizardStage = 1;
      renderRescanView();
    });
  }

  const btnStage2Next = document.getElementById("btn-rescan-stage-2-next");
  if (btnStage2Next) {
    btnStage2Next.addEventListener("click", () => {
      if (rescanState.operation === "rescrape" && rescanState.categories.size === 0) {
        alert("Please select at least one category to re-scrape.");
        return;
      }
      rescanState.wizardStage = 3;
      renderRescanView();
    });
  }

  // Stage 3 Back
  const btnStage3Back = document.getElementById("btn-rescan-stage-3-back");
  if (btnStage3Back) {
    btnStage3Back.addEventListener("click", () => {
      rescanState.wizardStage = 2;
      renderRescanView();
    });
  }

  // Stage 4 Rescan Another Course
  const btnRescanAnother = document.getElementById("btn-rescan-another");
  if (btnRescanAnother) {
    btnRescanAnother.addEventListener("click", () => {
      rescanState.isIngesting = false;
      rescanState.jobId = null;
      rescanState.finishedCourse = null;
      rescanState.logs = [];
      rescanState.completedSteps.clear();
      rescanState.activeStep = 1;
      rescanState.wizardStage = 1;
      renderRescanView();
    });
  }

  // Course selector
  const courseSel = document.getElementById("rescan-course-select");
  if (courseSel) {
    courseSel.addEventListener("change", (e) => {
      rescanState.courseName = e.target.value;
      renderRescanView();
    });
  }

  // Operation Cards
  document.querySelectorAll(".rescan-op-card").forEach(card => {
    card.addEventListener("click", () => {
      const op = card.dataset.op;
      if (op) {
        rescanState.operation = op;
        renderRescanView();
      }
    });
  });

  // AI Provider Cards
  document.querySelectorAll("[data-rescan-provider]").forEach(card => {
    card.addEventListener("click", () => {
      const provider = card.dataset.rescanProvider;
      if (provider) {
        rescanState.aiProvider = provider;
        renderRescanView();
      }
    });
  });

  // Open Settings for Gemini Key
  els.viewRescan.querySelectorAll(".btn-open-gemini-settings").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      if (typeof openSettingsModal === "function") openSettingsModal("ingestion");
    });
  });

  // Gemini API Key input
  const geminiKeyInput = document.getElementById("rescan-gemini-api-key");
  if (geminiKeyInput) {
    geminiKeyInput.addEventListener("input", (e) => {
      rescanState.geminiApiKey = e.target.value;
    });
  }

  // API Key visibility toggle
  const btnToggleKey = document.getElementById("btn-rescan-toggle-key");
  if (btnToggleKey && geminiKeyInput) {
    btnToggleKey.addEventListener("click", () => {
      const isHidden = geminiKeyInput.type === "password";
      geminiKeyInput.type = isHidden ? "text" : "password";
      btnToggleKey.title = isHidden ? "Hide key" : "Show key";
    });
  }

  if (typeof state !== "undefined" && state.settings && state.settings.geminiTier) {
    rescanState.geminiTier = state.settings.geminiTier;
  }

  // Ollama Model select
  const ollamaSelect = document.getElementById("rescan-ollama-model");
  if (ollamaSelect) {
    ollamaSelect.addEventListener("change", (e) => {
      rescanState.ollamaModel = e.target.value;
    });
  }

  // Category selection for rescrape
  document.querySelectorAll("[data-rescan-cat]").forEach(card => {
    card.addEventListener("click", () => {
      const catId = card.dataset.rescanCat;
      if (catId) {
        if (rescanState.categories.has(catId)) {
          rescanState.categories.delete(catId);
        } else {
          rescanState.categories.add(catId);
        }
        renderRescanView();
      }
    });
  });

  const btnSelectAll = document.getElementById("btn-rescan-select-all");
  if (btnSelectAll && typeof LAUNCHER_CATEGORIES !== "undefined") {
    btnSelectAll.addEventListener("click", () => {
      LAUNCHER_CATEGORIES.forEach(c => rescanState.categories.add(c.id));
      renderRescanView();
    });
  }

  const btnClearAll = document.getElementById("btn-rescan-clear-all");
  if (btnClearAll) {
    btnClearAll.addEventListener("click", () => {
      rescanState.categories.clear();
      renderRescanView();
    });
  }

  // Gradescope URL input
  const gsInput = document.getElementById("rescan-gradescope-url");
  if (gsInput) {
    gsInput.addEventListener("input", (e) => {
      rescanState.gradescopeUrl = e.target.value;
    });
  }

  // Headless toggle
  const headlessToggle = document.getElementById("rescan-headless-toggle");
  if (headlessToggle) {
    headlessToggle.addEventListener("change", (e) => {
      rescanState.headless = e.target.checked;
    });
  }

  // Clear logs button
  const btnClearLogs = document.getElementById("btn-rescan-clear-logs");
  if (btnClearLogs) {
    btnClearLogs.addEventListener("click", () => {
      rescanState.logs = [];
      const term = document.getElementById("rescan-terminal-log-window");
      if (term) term.innerHTML = `<div style="color:#6b7280;font-style:italic;">Console cleared.</div>`;
    });
  }

  // Cancel button
  const btnCancel = document.getElementById("btn-rescan-cancel");
  if (btnCancel) {
    btnCancel.addEventListener("click", async () => {
      await cancelRescan();
    });
  }

  // Launch button
  const btnLaunch = document.getElementById("btn-rescan-launch");
  if (btnLaunch) {
    btnLaunch.addEventListener("click", () => startRescan());
  }

  // Completion buttons
  const btnCompView = document.getElementById("btn-rescan-view-course");
  if (btnCompView) {
    btnCompView.addEventListener("click", async () => {
      if (rescanState.finishedCourse?.name) {
        await loadCourseList();
        els.courseSelector.value = rescanState.finishedCourse.name;
        await selectCourse(rescanState.finishedCourse.name);
        switchView("canvas");
      }
    });
  }

  const btnCompReveal = document.getElementById("btn-rescan-reveal-finder");
  if (btnCompReveal) {
    btnCompReveal.addEventListener("click", () => {
      if (rescanState.finishedCourse?.name) {
        openFileInSystem(".", "reveal", rescanState.finishedCourse.name);
      }
    });
  }
}

async function startRescan() {
  if (rescanState.isIngesting) return;

  if (!rescanState.courseName.trim()) {
    alert("Please select a valid course to rescan.");
    return;
  }

  let backendMode = "organize_only";
  if (rescanState.operation === "gradescope") backendMode = "gradescope_only";
  else if (rescanState.operation === "rescrape") backendMode = "full";

  rescanState.isIngesting = true;
  rescanState.wizardStage = 4;
  rescanState.activeStep = (backendMode === "organize_only" ? 3 : (backendMode === "gradescope_only" ? 2 : 1));
  rescanState.progressPct = (backendMode === "organize_only" ? 50 : (backendMode === "gradescope_only" ? 35 : 10));
  rescanState.phaseTitle = (backendMode === "organize_only" ? "AI Classification & Sorting" : (backendMode === "gradescope_only" ? "Gradescope Synchronization" : "Authentication & Session"));
  rescanState.completedSteps.clear();
  rescanState.finishedCourse = null;
  rescanState.logs = [];
  rescanState.jobId = null;

  appendRescanTerminalLog(`Starting operation '${rescanState.operation}' for '${rescanState.courseName}'...`, "info");
  renderRescanView();

  const matchedCourse = (state.courseList || []).find(c => c.name === rescanState.courseName || c.folder_name === rescanState.courseName);
  const resolvedUrl = matchedCourse?.course_url || "";

  const payload = {
    course_name: rescanState.courseName,
    course_url: resolvedUrl,
    ai_provider: rescanState.aiProvider,
    gemini_tier: rescanState.geminiTier,
    ollama_model: rescanState.ollamaModel,
    headless: rescanState.headless,
    categories: Array.from(rescanState.categories),
    gradescope_url: rescanState.gradescopeUrl,
    mode: backendMode
  };

  try {
    const data = await startArchiveJob(rescanState, payload);
    rescanState.jobId = data.job_id;
    appendRescanTerminalLog("Job registered with backend execution daemon.", "info");
    connectRescanStream(data.job_id);
  } catch (err) {
    handleRescanEvent({ type: "error", message: err.message });
  }
}

function connectRescanStream(jobId) {
  connectArchiveJobStream(rescanState, jobId, handleRescanEvent, appendRescanTerminalLog);
}

function handleRescanEvent(evt) {
  if (!evt) return;
  if (evt.type === "done" && evt.success === false) {
    handleRescanEvent({ type: "error", message: "The operation did not complete successfully." });
    return;
  }

  if (evt.type === "step") {
    if (rescanState.activeStep > 0 && evt.step > rescanState.activeStep) {
      rescanState.completedSteps.add(rescanState.activeStep);
    }
    rescanState.activeStep = evt.step;
    if (typeof evt.pct === "number") {
      rescanState.progressPct = Math.min(100, Math.max(0, evt.pct));
    }
    if (evt.phase_title) {
      rescanState.phaseTitle = evt.phase_title;
    }
    renderRescanView();
  } else if (evt.type === "log") {
    appendRescanTerminalLog(evt.message, evt.level || "info");
  } else if (evt.type === "done") {
    if (rescanState.eventSource) {
      rescanState.eventSource.close();
      rescanState.eventSource = null;
    }
    const currentSteps = RESCAN_STEPS[rescanState.operation] || RESCAN_STEPS.organize;
    currentSteps.forEach(s => rescanState.completedSteps.add(s.step));
    rescanState.activeStep = 0;
    rescanState.progressPct = 100;
    rescanState.phaseTitle = "Operation Complete";
    rescanState.isIngesting = false;
    rescanState.finishedCourse = {
      name: rescanState.courseName,
      files_count: Number.isSafeInteger(evt.files_count) && evt.files_count >= 0 ? evt.files_count : null
    };
    appendRescanTerminalLog(`Operation finished successfully!`, "success");
    renderRescanView();
  } else if (evt.type === "error") {
    appendRescanTerminalLog(`Error: ${evt.message}`, "error");
    if (rescanState.eventSource) {
      rescanState.eventSource.close();
      rescanState.eventSource = null;
    }
    rescanState.isIngesting = false;
    rescanState.finishedCourse = null;
    rescanState.phaseTitle = "Operation failed";
    renderRescanView();
  }
}

async function cancelRescan() {
  if (!rescanState.isIngesting) return;
  appendRescanTerminalLog("Cancelling rescan job...", "warn");
  if (!rescanState.jobId) {
    appendRescanTerminalLog("The start request is still pending. Wait for a job ID before cancelling.", "warn");
    return;
  }
  try {
    const response = await fetch(`/api/launcher/cancel/${encodeURIComponent(rescanState.jobId)}`, { method: "POST" });
    if (!response.ok) throw new Error("Cancellation was not accepted.");
  } catch {
    appendRescanTerminalLog("Cancellation could not be confirmed. The job may still be running; retry when connected.", "error");
    return;
  }
  if (rescanState.eventSource) {
    rescanState.eventSource.close();
    rescanState.eventSource = null;
  }
  rescanState.isIngesting = false;
  appendRescanTerminalLog("Operation cancelled by user.", "error");
  renderRescanView();
}

// --- Module: 16_onboarding.js ---
// [Codex] Optional first-run tour. Completion is local to this browser profile.
const ONBOARDING_KEY = "canvas_offline_onboarding_v1";
const ONBOARDING_STEPS = [
  {
    title: "Welcome to your local course archive",
    body: "This app runs on your computer. Capturing a course needs internet and your own authorized Canvas login. Once files are captured, you can browse and search them offline.",
    action: null
  },
  {
    title: "Choose where courses live",
    body: "Open Settings → Directories. Add or browse for a folder you control, then set it as the default download location. The app also scans the selected roots for existing archives. Check the path before starting a capture.",
    action: "directories", actionLabel: "Open Directories"
  },
  {
    title: "Choose an organization method",
    body: "Open Settings → Ingestion. Keyword Heuristics works immediately without an AI account. Gemini sends course excerpts and filenames to Google; free-tier inputs and outputs may be used to improve Google's products and reviewed by humans. Avoid its free tier for sensitive or personal coursework. For local Ollama, install Ollama and pull a model yourself. The app never silently changes providers.",
    action: "ingestion", actionLabel: "Open Ingestion Settings",
    links: [
      { label: "Create a Gemini API key", href: "https://aistudio.google.com/apikey" },
      { label: "Download Ollama", href: "https://ollama.com/download" }
    ]
  },
  {
    title: "Add your first course",
    body: "Open Add Course, paste a Canvas course URL you can access, name the destination folder, select categories, and start. Your institution may require SSO or 2FA in the browser. Keep your computer awake and online until capture finishes.",
    action: "launcher", actionLabel: "Open Add Course"
  },
  {
    title: "Dashboard",
    body: "Dashboard lists discovered courses and quick actions. Use it to choose a course after capture or import. A new installation starts with an empty dashboard.",
    action: "dashboard", actionLabel: "Open Dashboard"
  },
  {
    title: "Courses",
    body: "Courses opens the selected archive. Browse Modules, Assignments, Grades, Syllabus, and Announcements when those categories were captured. Missing categories may simply have no source content.",
    action: "canvas", actionLabel: "Open Courses"
  },
  {
    title: "Timeline",
    body: "Timeline gathers dated assignments and milestones from the selected course. Undated or uncaptured work will not appear here.",
    action: "timeline", actionLabel: "Open Timeline"
  },
  {
    title: "Folders",
    body: "Folders shows the actual archived files on disk. You can preview a document here or reveal it in your file manager.",
    action: "folders", actionLabel: "Open Folders"
  },
  {
    title: "Search",
    body: "Use the search box at the top for indexed documents. A new archive may need time to index; the progress indicator shows its status. Search existing archives works offline.",
    action: "search", actionLabel: "Open Search"
  },
  {
    title: "Rescan and maintain",
    body: "Rescan updates an existing course when you are online and signed in. Use Settings for appearance, directories, indexing, and ingestion defaults. Reclassification or rescanning writes to your archive, so review its options before starting.",
    action: "rescan", actionLabel: "Open Rescan"
  },
  {
    title: "You're ready",
    body: "After capturing a course, quit the app, disconnect from the internet, restart it, and open the archive to check your offline copy. Use the Setup Guide button in the sidebar whenever you want to review these steps.",
    action: null
  }
];

let onboardingStep = 0;
let onboardingReturnFocus = null;

function onboardingSeen() {
  try { return localStorage.getItem(ONBOARDING_KEY) === "done"; }
  catch (_) { return false; }
}

function finishOnboarding() {
  try { localStorage.setItem(ONBOARDING_KEY, "done"); } catch (_) {}
  document.getElementById("onboarding-overlay")?.classList.add("hidden");
  document.getElementById("onboarding-resume")?.classList.add("hidden");
  onboardingReturnFocus?.focus();
}

function renderOnboarding() {
  const step = ONBOARDING_STEPS[onboardingStep];
  const overlay = document.getElementById("onboarding-overlay");
  if (!overlay) return;
  document.getElementById("onboarding-count").textContent = `Step ${onboardingStep + 1} of ${ONBOARDING_STEPS.length}`;
  document.getElementById("onboarding-heading").textContent = step.title;
  document.getElementById("onboarding-body").textContent = step.body;
  const links = document.getElementById("onboarding-links");
  links.replaceChildren();
  for (const item of step.links || []) {
    const anchor = document.createElement("a");
    anchor.href = item.href;
    anchor.target = "_blank";
    anchor.rel = "noopener noreferrer";
    anchor.textContent = item.label;
    links.appendChild(anchor);
  }
  const action = document.getElementById("onboarding-action");
  action.hidden = !step.action;
  action.textContent = step.actionLabel || "";
  document.getElementById("onboarding-back").disabled = onboardingStep === 0;
  document.getElementById("onboarding-next").textContent = onboardingStep === ONBOARDING_STEPS.length - 1 ? "Finish" : "Next";
  overlay.classList.remove("hidden");
  document.getElementById("onboarding-resume")?.classList.add("hidden");
  document.getElementById("onboarding-next")?.focus();
}

function startOnboarding() {
  onboardingReturnFocus = document.activeElement;
  onboardingStep = 0;
  renderOnboarding();
}

function showOnboardingIfFirstRun() {
  if (!onboardingSeen()) startOnboarding();
}

function initOnboarding() {
  document.getElementById("nav-btn-onboarding")?.addEventListener("click", startOnboarding);
  document.getElementById("onboarding-resume")?.addEventListener("click", renderOnboarding);
  document.getElementById("onboarding-skip")?.addEventListener("click", finishOnboarding);
  document.getElementById("onboarding-back")?.addEventListener("click", () => {
    onboardingStep = Math.max(0, onboardingStep - 1);
    renderOnboarding();
  });
  document.getElementById("onboarding-next")?.addEventListener("click", () => {
    if (onboardingStep === ONBOARDING_STEPS.length - 1) finishOnboarding();
    else { onboardingStep += 1; renderOnboarding(); }
  });
  document.getElementById("onboarding-action")?.addEventListener("click", () => {
    const action = ONBOARDING_STEPS[onboardingStep].action;
    document.getElementById("onboarding-overlay")?.classList.add("hidden");
    document.getElementById("onboarding-resume")?.classList.remove("hidden");
    if (action === "directories" || action === "ingestion") openSettingsModal(action);
    else {
      if (!els.settingsModal?.classList.contains("hidden")) closeSettingsModal();
      if (action === "search") { switchView("search"); document.getElementById("global-search-input")?.focus(); }
      else if (action) switchView(action);
    }
  });
  document.getElementById("onboarding-overlay")?.addEventListener("keydown", event => {
    if (event.key === "Escape") { event.preventDefault(); finishOnboarding(); }
  });
}

// --- Module: 17_browser_lifecycle.js ---
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

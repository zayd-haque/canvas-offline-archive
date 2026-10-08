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

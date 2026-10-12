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

// ==========================================================================
// Universal In-UI Custom Dropdown Engine
// Upgrades native <select> elements into accessible in-DOM theme-styled dropdowns.
// ==========================================================================

function upgradeSelectToCustomDropdown(select) {
  if (!select || !(select instanceof HTMLElement)) return null;
  if (select.dataset.customDropdownEnhanced === "true") {
    syncCustomSelect(select);
    return select._customDropdownContainer || null;
  }

  // Mark as enhanced and hide native select visually
  select.classList.add("custom-select-native");
  select.setAttribute("tabindex", "-1");
  select.setAttribute("aria-hidden", "true");
  select.dataset.customDropdownEnhanced = "true";

  // Create wrapper container
  const container = document.createElement("div");
  container.className = "custom-select-container";

  // Transfer flex/sizing styles if explicitly set
  if (select.style.flex) container.style.flex = select.style.flex;
  if (select.style.width) container.style.width = select.style.width;
  if (select.style.maxWidth) container.style.maxWidth = select.style.maxWidth;
  if (select.style.minWidth) container.style.minWidth = select.style.minWidth;

  // Insert container before select and nest select inside
  select.parentNode.insertBefore(container, select);
  container.appendChild(select);

  // Trigger button
  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "custom-select-trigger";
  trigger.setAttribute("aria-haspopup", "listbox");
  trigger.setAttribute("aria-expanded", "false");

  const labelSpan = document.createElement("span");
  labelSpan.className = "custom-select-label";

  const chevronSpan = document.createElement("span");
  chevronSpan.className = "custom-select-chevron";
  chevronSpan.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>`;

  trigger.appendChild(labelSpan);
  trigger.appendChild(chevronSpan);
  container.appendChild(trigger);

  // Dropdown menu
  const menu = document.createElement("div");
  menu.className = "custom-select-menu hidden";
  menu.setAttribute("role", "listbox");
  container.appendChild(menu);

  // Bind internal references
  select._customDropdownContainer = container;
  select._customDropdownTrigger = trigger;
  select._customDropdownLabel = labelSpan;
  select._customDropdownMenu = menu;

  function toggleMenu(open) {
    const isCurrentlyOpen = container.classList.contains("open");
    const shouldOpen = typeof open === "boolean" ? open : !isCurrentlyOpen;

    if (shouldOpen) {
      // Close any other open dropdowns
      document.querySelectorAll(".custom-select-container.open").forEach(c => {
        if (c !== container) {
          c.classList.remove("open", "open-upward");
          const m = c.querySelector(".custom-select-menu");
          if (m) m.classList.add("hidden");
          const t = c.querySelector(".custom-select-trigger");
          if (t) t.setAttribute("aria-expanded", "false");
        }
      });

      syncCustomSelect(select);
      menu.classList.remove("hidden");
      container.classList.add("open");
      trigger.setAttribute("aria-expanded", "true");

      // Auto-detect upward opening if near bottom of viewport or modal
      const rect = trigger.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      const modalBody = trigger.closest(".settings-modal-body, .launcher-content, .rescan-content");
      let modalSpaceBelow = spaceBelow;
      if (modalBody) {
        const modalRect = modalBody.getBoundingClientRect();
        modalSpaceBelow = modalRect.bottom - rect.bottom;
      }
      const menuHeight = 220;
      if ((spaceBelow < menuHeight || modalSpaceBelow < 120) && rect.top > menuHeight) {
        container.classList.add("open-upward");
      } else {
        container.classList.remove("open-upward");
      }

      // Scroll selected option into view
      const selectedOpt = menu.querySelector(".custom-select-option.selected");
      if (selectedOpt) {
        selectedOpt.scrollIntoView({ block: "nearest" });
      }
    } else {
      container.classList.remove("open", "open-upward");
      menu.classList.add("hidden");
      trigger.setAttribute("aria-expanded", "false");
    }
  }

  trigger.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (select.disabled) return;
    toggleMenu();
  });

  // Keyboard navigation on trigger
  trigger.addEventListener("keydown", (e) => {
    if (select.disabled) return;
    if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!container.classList.contains("open")) {
        toggleMenu(true);
      } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        const options = Array.from(menu.querySelectorAll(".custom-select-option:not(.disabled)"));
        if (!options.length) return;
        const currentIdx = options.findIndex(o => o.classList.contains("focused") || o.classList.contains("selected"));
        let nextIdx = e.key === "ArrowDown" ? currentIdx + 1 : currentIdx - 1;
        if (nextIdx < 0) nextIdx = 0;
        if (nextIdx >= options.length) nextIdx = options.length - 1;
        options.forEach(o => o.classList.remove("focused"));
        options[nextIdx].classList.add("focused");
        options[nextIdx].scrollIntoView({ block: "nearest" });
      } else if (e.key === "Enter" || e.key === " ") {
        const focused = menu.querySelector(".custom-select-option.focused") || menu.querySelector(".custom-select-option.selected");
        if (focused && !focused.classList.contains("disabled")) {
          focused.click();
        }
      }
    } else if (e.key === "Escape") {
      toggleMenu(false);
    }
  });

  // Observe programmatic DOM changes to <option> elements
  const observer = new MutationObserver(() => {
    syncCustomSelect(select);
  });
  observer.observe(select, { childList: true, subtree: true, attributes: true });

  // Hook value setter on select instance for automatic sync
  const origDescriptor = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value");
  try {
    Object.defineProperty(select, "value", {
      get: function() {
        return origDescriptor.get.call(this);
      },
      set: function(newVal) {
        origDescriptor.set.call(this, newVal);
        syncCustomSelect(this);
      },
      configurable: true
    });
  } catch (e) {}

  select.addEventListener("change", () => {
    syncCustomSelect(select);
  });

  syncCustomSelect(select);
  return container;
}

function syncCustomSelect(select) {
  if (!select || !select._customDropdownMenu) return;
  const menu = select._customDropdownMenu;
  const labelSpan = select._customDropdownLabel;
  const trigger = select._customDropdownTrigger;
  const container = select._customDropdownContainer;

  if (select.disabled) {
    trigger.disabled = true;
    container.classList.add("disabled");
  } else {
    trigger.disabled = false;
    container.classList.remove("disabled");
  }

  const options = Array.from(select.options);
  const selectedIndex = select.selectedIndex;
  const selectedOption = selectedIndex >= 0 ? options[selectedIndex] : null;

  if (selectedOption) {
    labelSpan.textContent = selectedOption.textContent || selectedOption.label || "";
    if (selectedOption.disabled || selectedOption.value === "") {
      labelSpan.classList.add("is-placeholder");
    } else {
      labelSpan.classList.remove("is-placeholder");
    }
  } else {
    labelSpan.textContent = select.getAttribute("placeholder") || "Select…";
    labelSpan.classList.add("is-placeholder");
  }

  menu.innerHTML = "";
  options.forEach((opt, idx) => {
    const isSelected = idx === selectedIndex;
    const isDisabled = opt.disabled;

    const optDiv = document.createElement("div");
    optDiv.className = `custom-select-option ${isSelected ? "selected" : ""} ${isDisabled ? "disabled" : ""}`;
    optDiv.setAttribute("role", "option");
    optDiv.setAttribute("aria-selected", String(isSelected));
    optDiv.dataset.value = opt.value;
    optDiv.dataset.index = idx;

    const textSpan = document.createElement("span");
    textSpan.className = "custom-select-option-text";
    textSpan.textContent = opt.textContent || opt.label || "";

    const checkSpan = document.createElement("span");
    checkSpan.className = "custom-select-option-check";
    checkSpan.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;

    optDiv.appendChild(textSpan);
    optDiv.appendChild(checkSpan);

    optDiv.addEventListener("click", (e) => {
      e.stopPropagation();
      if (isDisabled) return;
      select.value = opt.value;
      select.dispatchEvent(new Event("change", { bubbles: true }));
      select.dispatchEvent(new Event("input", { bubbles: true }));
      syncCustomSelect(select);

      container.classList.remove("open", "open-upward");
      menu.classList.add("hidden");
      trigger.setAttribute("aria-expanded", "false");
      trigger.focus();
    });

    menu.appendChild(optDiv);
  });
}

function initAllCustomDropdowns(root = document) {
  if (!root || !root.querySelectorAll) return;
  const selects = root.querySelectorAll("select:not(.custom-select-native)");
  selects.forEach(sel => {
    upgradeSelectToCustomDropdown(sel);
  });
}

// Global outside click and Escape listener to dismiss open custom dropdowns
document.addEventListener("click", (e) => {
  if (!e.target.closest(".custom-select-container")) {
    document.querySelectorAll(".custom-select-container.open").forEach(c => {
      c.classList.remove("open", "open-upward");
      const m = c.querySelector(".custom-select-menu");
      if (m) m.classList.add("hidden");
      const t = c.querySelector(".custom-select-trigger");
      if (t) t.setAttribute("aria-expanded", "false");
    });
  }
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    document.querySelectorAll(".custom-select-container.open").forEach(c => {
      c.classList.remove("open", "open-upward");
      const m = c.querySelector(".custom-select-menu");
      if (m) m.classList.add("hidden");
      const t = c.querySelector(".custom-select-trigger");
      if (t) t.setAttribute("aria-expanded", "false");
    });
  }
});

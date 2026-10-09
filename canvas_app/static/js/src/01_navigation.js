async function loadCourseList({ preserveView = false } = {}) {
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

    if (preserveView) return;
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

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

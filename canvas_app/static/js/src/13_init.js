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

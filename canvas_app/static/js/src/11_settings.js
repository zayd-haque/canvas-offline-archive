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

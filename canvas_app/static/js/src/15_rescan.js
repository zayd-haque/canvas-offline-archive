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

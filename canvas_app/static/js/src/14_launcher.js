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

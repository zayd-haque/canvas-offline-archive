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

const state = {
  foundations: [],
  programs: [],
  deadlines: [],
  programEligibility: [],
  programApplicants: [],
  programExclusions: [],
  callScanResults: [],
  opportunities: [],
  filtered: [],
  selectedId: null,
  favorites: new Set(),
  alertSettings: {
    email: "",
    deadlineSoon: true,
    newFoundation: true,
    newCall: true,
    favoriteUpdate: true,
  },
  alerts: [],
  scanReviewOverrides: {},
  activeTab: "fonde",
  loading: false,
  approvedScrapeFields: [],
  projects: [],
  teamMembers: [],
  projectFolders: [],
  workflowStatuses: [],
  selectedProjectId: null,
  auth: { authenticated: false, setupRequired: false, user: null },
  selectedTeamMemberId: null,
  expandedTaskId: null,
  subtaskComposerTaskId: null,
  newTaskComposerProjectId: null,
  collapsedTaskIds: new Set(),
  projectPage: "dashboard",
  projectLoadError: null,
  deletedProject: null,
};

const els = {
  tabButtons: document.querySelectorAll("[data-tab]"),
  tabPanels: document.querySelectorAll("[data-panel]"),
  totalCount: document.querySelector("#totalCount"),
  programCount: document.querySelector("#programCount"),
  openCount: document.querySelector("#openCount"),
  verifyCount: document.querySelector("#verifyCount"),
  visibleCount: document.querySelector("#visibleCount"),
  checkedMeter: document.querySelector("#checkedMeter"),
  verifyMeter: document.querySelector("#verifyMeter"),
  areaChart: document.querySelector("#areaChart"),
  rows: document.querySelector("#programRows"),
  detailEmpty: document.querySelector("#detailEmpty"),
  detailContent: document.querySelector("#detailContent"),
  favoriteCount: document.querySelector("#favoriteCount"),
  emailInput: document.querySelector("#emailInput"),
  deadlineAlertToggle: document.querySelector("#deadlineAlertToggle"),
  newFoundationAlertToggle: document.querySelector("#newFoundationAlertToggle"),
  newCallAlertToggle: document.querySelector("#newCallAlertToggle"),
  favoriteUpdateAlertToggle: document.querySelector("#favoriteUpdateAlertToggle"),
  emailDigestButton: document.querySelector("#emailDigestButton"),
  alertList: document.querySelector("#alertList"),
  favoriteList: document.querySelector("#favoriteList"),
  scanHealthText: document.querySelector("#scanHealthText"),
  dataHealthList: document.querySelector("#dataHealthList"),
  reviewNewCount: document.querySelector("#reviewNewCount"),
  reviewHighCount: document.querySelector("#reviewHighCount"),
  reviewIgnoredCount: document.querySelector("#reviewIgnoredCount"),
  reviewStatusFilter: document.querySelector("#reviewStatusFilter"),
  reviewQualityFilter: document.querySelector("#reviewQualityFilter"),
  reviewList: document.querySelector("#reviewList"),
  searchInput: document.querySelector("#searchInput"),
  areaFilter: document.querySelector("#areaFilter"),
  applicantFilter: document.querySelector("#applicantFilter"),
  deadlineFilter: document.querySelector("#deadlineFilter"),
  statusFilter: document.querySelector("#statusFilter"),
  updateButton: document.querySelector("#updateButton"),
  updateStatus: document.querySelector("#updateStatus"),
  scrapeRunButton: document.querySelector("#scrapeRunButton"),
  scrapeTestButton: document.querySelector("#scrapeTestButton"),
  scrapeStatus: document.querySelector("#scrapeStatus"),
  scrapeChangeRows: document.querySelector("#scrapeChangeRows"),
  scrapeApprovedRows: document.querySelector("#scrapeApprovedRows"),
  scrapeApprovedCount: document.querySelector("#scrapeApprovedCount"),
  actionToast: document.querySelector("#actionToast"),
  projectCreateForm: document.querySelector("#projectCreateForm"),
  projectCount: document.querySelector("#projectCount"),
  projectList: document.querySelector("#projectList"),
  projectDetail: document.querySelector("#projectDetail"),
  projectDashboard: document.querySelector("#projectDashboard"),
  projectServerNotice: document.querySelector("#projectServerNotice"),
  projectServerNoticeHelp: document.querySelector("#projectServerNoticeHelp"),
  projectAuthPanel: document.querySelector("#projectAuthPanel"),
  projectConfigPanel: document.querySelector(".project-config-panel"),
  portfolioEditDialog: document.querySelector("#portfolioEditDialog"),
  portfolioEditForm: document.querySelector("#portfolioEditForm"),
};

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"' && inQuotes && next === '"') {
      field += '"';
      index += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      row.push(field);
      field = "";
    } else if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(field);
      if (row.some(Boolean)) rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }

  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

function csvToObjects(text) {
  const rows = parseCsv(text);
  const headers = rows.shift();
  return rows.map((row) =>
    Object.fromEntries(headers.map((header, index) => [header, row[index] || ""])),
  );
}

function splitList(value) {
  return String(value || "")
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean);
}

function statusLabel(status) {
  return {
    source_checked: "Kilde-tjekket",
    to_verify: "Skal verificeres",
    needs_update: "Skal opdateres",
  }[status] || status;
}

function deadlineLabel(deadline) {
  if (!deadline) return "Skal tjekkes";
  if (deadline.status === "open") return "Løbende åben";
  if (deadline.deadline_type === "call") return "Opslag/call";
  if (deadline.deadline_type === "annual") return "Årligt opslag";
  if (deadline.deadline_type === "invitation") return "Invitation/opslag";
  if (deadline.deadline_type === "area_specific") return "Afhænger af område";
  return deadline.summary || "Skal tjekkes";
}

function applicationActionLabel(program) {
  const status = String(program.application_status || "").toLocaleLowerCase("da");
  if (status.includes("dialog")) return "Kom i dialog";
  if (status.includes("forespørg")) return "Start forespørgsel";
  if (status.includes("invitation")) return "Læs om processen";
  if (status.includes("opslag") || status.includes("call")) return "Se aktuelle opslag";
  return "Se ansøgningsside";
}

function cvrRequirementLabel(requirement) {
  return {
    required: "CVR påkrævet",
    not_required: "CVR ikke påkrævet",
    conditional: "CVR afhænger af ansøgerformen",
    unknown: "CVR-krav skal verificeres",
  }[requirement] || "CVR-krav skal verificeres";
}

function structuredGeographyLabel(profile, fallback) {
  if (!profile) return fallback || "Skal verificeres";
  return [profile.local_area, profile.municipality, profile.region, profile.country_code === "DK" ? "Danmark" : profile.country_code]
    .filter(Boolean)
    .filter((value, index, values) => values.indexOf(value) === index)
    .join(" · ") || fallback || "Skal verificeres";
}

function structuredAmountLabel(profile, fallback) {
  if (!profile) return fallback || "Varierer";
  const format = (value) => new Intl.NumberFormat("da-DK", { maximumFractionDigits: 0 }).format(Number(value));
  const currency = profile.amount_currency || "DKK";
  if (profile.amount_min && profile.amount_max) return `${format(profile.amount_min)}–${format(profile.amount_max)} ${currency}`;
  if (profile.amount_min) return `Fra ${format(profile.amount_min)} ${currency}`;
  if (profile.amount_max) {
    const prefix = profile.amount_model === "project_budget_cap" ? "Projektbudget under" : "Op til";
    return `${prefix} ${format(profile.amount_max)} ${currency}`;
  }
  return fallback || "Varierer";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function decodeHtmlEntities(value) {
  const textarea = document.createElement("textarea");
  textarea.innerHTML = String(value ?? "");
  return textarea.value;
}

function displayScrapedText(value) {
  return escapeHtml(decodeHtmlEntities(value));
}

function fieldLabel(fieldName) {
  return ({
    deadlines: "Ansøgningsfrister",
    funding_amounts: "Beløbsrammer",
    contact_info: "Kontaktoplysninger",
    purpose_criteria: "Formål og kriterier",
  })[fieldName] || fieldName;
}

function isFilePreview() {
  return window.location.protocol === "file:";
}

function setupFilePreviewLauncher() {
  if (!isFilePreview()) return;
  els.projectServerNotice.hidden = false;
  const localAppLink = els.projectServerNotice.querySelector("a[href]");
  const localAppUrl = new URL(localAppLink.href);
  async function openRunningApp() {
    els.projectServerNoticeHelp.textContent = "Tjekker om appen kører…";
    try {
      const response = await fetch(new URL("/api/health", localAppUrl), { cache: "no-store", signal: AbortSignal.timeout(2500) });
      const health = await response.json();
      if (!response.ok || health.app !== "dansk-fondsdatabase") throw new Error("Forkert lokal server");
      window.location.replace(localAppUrl.href);
    } catch {
      els.projectServerNoticeHelp.textContent = "Appen kører ikke. Dobbeltklik ‘Start fondsdatabase.command’ i projektmappen for at starte den.";
    }
  }
  localAppLink.addEventListener("click", (event) => {
    event.preventDefault();
    void openRunningApp();
  });
  void openRunningApp();
}

function setPageLoading(isLoading) {
  state.loading = isLoading;
  document.body.classList.toggle("is-loading", isLoading);
}

function setUpdateStatus(message, isError = false) {
  els.updateStatus.hidden = false;
  els.updateStatus.classList.toggle("error", isError);
  els.updateStatus.textContent = message;
}

function setScrapeStatus(message, isError = false) {
  els.scrapeStatus.textContent = message;
  els.scrapeStatus.classList.toggle("error", isError);
}

let actionToastTimer;
function showActionToast(message, isError = false) {
  window.clearTimeout(actionToastTimer);
  els.actionToast.hidden = false;
  els.actionToast.classList.toggle("error", isError);
  els.actionToast.textContent = message;
  actionToastTimer = window.setTimeout(() => {
    els.actionToast.hidden = true;
  }, 5000);
}

function linkOrHash(value) {
  return value || "#";
}

function loadJson(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
}

function saveJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function parseDate(value) {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function daysUntil(value) {
  const date = parseDate(value);
  if (!date) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.ceil((date - today) / 86400000);
}

function foundationSignature(foundation) {
  const programCount = state.programs.filter((program) => program.foundation_id === foundation.foundation_id).length;
  return [foundation.last_checked, foundation.verification_status, foundation.source_url, programCount].join("|");
}

function isFavorite(foundationId) {
  return state.favorites.has(foundationId);
}

function effectiveReviewStatus(scan) {
  return state.scanReviewOverrides[scan.scan_result_id] || scan.review_status || "new";
}

function scanQuality(scan) {
  const text = `${scan.discovered_title} ${scan.excerpt} ${scan.discovered_url}`.toLocaleLowerCase("da");
  let score = 0;

  if (scan.match_type === "crawler_open_call") score += 45;
  if (scan.match_type === "page_text") score += 22;
  if (scan.match_type === "call_link") score += 16;
  if (scan.scan_status === "found") score += 12;
  if (/deadline|frist|ansøgningsfrist|ansøg senest|apply by|\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|202\d/.test(text)) score += 28;
  if (/open call|call for proposals|pulje|opslag|ansøg om støtte|søg støtte|start ansøgning/.test(text)) score += 16;
  if (/crawler status: open|løbende frist|rolling/.test(text)) score += 18;
  if (/støtter vi ikke|stoetter vi ikke|stotter vi ikke|bevillingsmodtagere|skriv en god ansøgning|how-to-apply|sådan søger du/.test(text)) score -= 16;
  if (/mail|@|nyhedsbrev|cookie|login/.test(text)) score -= 12;
  if (effectiveReviewStatus(scan) === "reviewed") score += 6;
  if (effectiveReviewStatus(scan) === "ignored") score -= 35;

  return Math.max(0, Math.min(100, score));
}

function qualityLevel(score) {
  if (score >= 70) return "high";
  if (score >= 40) return "medium";
  return "low";
}

function qualityLabel(level) {
  return {
    high: "Høj",
    medium: "Middel",
    low: "Lav",
  }[level] || level;
}

function qualityReason(scan, score) {
  if (scan.match_type === "crawler_open_call") return "Crawleren har fundet et konkret åbent call.";
  if (score >= 70) return "Fundet har stærke signaler om frist, opslag eller ansøgning.";
  if (score >= 40) return "Fundet er relevant, men bør tjekkes manuelt.";
  return "Lavt signal. Gem kun hvis kilden faktisk viser en aktiv mulighed.";
}

function actionableScans() {
  return state.callScanResults
    .filter((scan) => scan.scan_status === "found")
    .map((scan) => ({
      ...scan,
      effective_status: effectiveReviewStatus(scan),
      quality_score: scanQuality(scan),
    }))
    .sort((a, b) => b.quality_score - a.quality_score || a.foundation_name.localeCompare(b.foundation_name, "da"));
}

function countBy(items, getter) {
  return items.reduce((counts, item) => {
    const key = getter(item) || "Ukendt";
    counts.set(key, (counts.get(key) || 0) + 1);
    return counts;
  }, new Map());
}

function topEntries(map, limit = 8) {
  return [...map.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "da")).slice(0, limit);
}

function renderSummary() {
  const statusCounts = countBy(state.programs, (program) => program.verification_status);
  const openCount = state.deadlines.filter((deadline) => deadline.status === "open").length;

  els.totalCount.textContent = state.foundations.length;
  els.programCount.textContent = state.programs.length;
  els.openCount.textContent = openCount;
  els.verifyCount.textContent = statusCounts.get("to_verify") || 0;
  els.favoriteCount.textContent = `${state.favorites.size} ${state.favorites.size === 1 ? "favorit" : "favoritter"}`;
}

function switchTab(tabName) {
  const availableTabs = [...els.tabButtons].map((button) => button.dataset.tab);
  const nextTab = availableTabs.includes(tabName) ? tabName : "fonde";
  state.activeTab = nextTab;
  document.body.classList.toggle("is-project-workspace", nextTab === "projekter");
  if (nextTab === "projekter" && els.projectDashboard) {
    state.projectPage = "dashboard";
    els.projectDashboard.hidden = !state.auth.authenticated;
    document.querySelector(".projects-workspace").hidden = true;
    if (state.auth.authenticated) {
      if (state.projectLoadError) renderProjectLoadError(state.projectLoadError, { notify: false });
      else void renderProjectDashboard();
    }
  }
  saveJson("fondsdb.activeTab", nextTab);

  els.tabButtons.forEach((button) => {
    const isActive = button.dataset.tab === nextTab;
    button.classList.toggle("active", isActive);
    button.removeAttribute("aria-selected");
  });

  els.tabPanels.forEach((panel) => {
    const isActive = panel.dataset.panel === nextTab;
    panel.classList.toggle("active", isActive);
    panel.hidden = !isActive;
  });
  window.WorkspaceShell?.syncTab(nextTab);
}

function appendOptions(select, values) {
  values.forEach((value) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    select.append(option);
  });
}

function renderFilterOptions() {
  const areas = new Set();
  const applicants = new Set();

  state.programs.forEach((program) => {
    splitList(program.support_areas).forEach((area) => areas.add(area));
    splitList(program.applicant_types).forEach((applicant) => applicants.add(applicant));
  });
  state.programApplicants
    .filter((applicant) => applicant.eligibility_status !== "ineligible")
    .forEach((applicant) => applicants.add(applicant.label));

  appendOptions(els.areaFilter, [...areas].sort((a, b) => a.localeCompare(b, "da")));
  appendOptions(els.applicantFilter, [...applicants].sort((a, b) => a.localeCompare(b, "da")));
}

function renderChart() {
  const areaCounts = new Map();
  state.filtered.forEach((opportunity) => {
    splitList(opportunity.program.support_areas).forEach((area) => {
      areaCounts.set(area, (areaCounts.get(area) || 0) + 1);
    });
  });

  const entries = topEntries(areaCounts, 7);
  const max = Math.max(...entries.map((entry) => entry[1]), 1);
  els.areaChart.replaceChildren();

  entries.forEach(([area, count]) => {
    const row = document.createElement("div");
    row.className = "bar-row";
    row.innerHTML = `
      <div class="bar-meta"><span>${area}</span><strong>${count}</strong></div>
      <div class="bar-track"><div class="bar-fill" style="width: ${(count / max) * 100}%"></div></div>
    `;
    els.areaChart.append(row);
  });

  const statusCounts = countBy(state.filtered, (opportunity) => opportunity.program.verification_status);
  const total = Math.max(state.filtered.length, 1);
  els.checkedMeter.value = ((statusCounts.get("source_checked") || 0) / total) * 100;
  els.verifyMeter.value = ((statusCounts.get("to_verify") || 0) / total) * 100;
  els.visibleCount.textContent = `${state.filtered.length} muligheder`;
}

function renderRows() {
  els.rows.replaceChildren();
  if (!state.filtered.length) {
    els.rows.innerHTML = `<tr class="empty-results-row"><td colspan="5"><div class="empty-state">Ingen muligheder matcher dine filtre. Prøv et andet søgeord eller færre filtre.</div></td></tr>`;
    return;
  }

  state.filtered.forEach((opportunity) => {
    const { foundation, program, deadline } = opportunity;
    const tr = document.createElement("tr");
    tr.tabIndex = 0;
    tr.className = program.program_id === state.selectedId ? "active" : "";
    tr.dataset.id = program.program_id;

    const areas = splitList(program.support_areas)
      .slice(0, 3)
      .map((area) => `<span class="pill">${escapeHtml(area)}</span>`)
      .join("");
    const applicants = splitList(program.applicant_types)
      .slice(0, 2)
      .map((applicant) => `<span class="pill muted-pill">${escapeHtml(applicant)}</span>`)
      .join("");
    const deadlineClass = deadline?.status === "open" ? "open" : "to_verify";

    tr.innerHTML = `
      <td class="opportunity-cell" data-label="Mulighed">
        <div class="name-cell">
          <button class="favorite-button ${isFavorite(foundation.foundation_id) ? "active" : ""}" type="button" data-favorite-id="${escapeHtml(foundation.foundation_id)}" aria-label="Favorit ${escapeHtml(foundation.name)}" aria-pressed="${isFavorite(foundation.foundation_id)}"><img src="frontend/icons/star.svg" alt="" /></button>
          <span class="opportunity-name">
            <strong>${escapeHtml(program.program_name)}</strong>
            <span>${escapeHtml(foundation.name)} · ${escapeHtml(program.geography || foundation.city || "Danmark")}</span>
          </span>
        </div>
      </td>
      <td data-label="Støtteområder"><div class="pill-list">${areas}</div></td>
      <td class="applicant-column" data-label="Ansøgere"><div class="pill-list">${applicants}</div></td>
      <td data-label="Frist"><span class="deadline ${deadlineClass}">${escapeHtml(deadlineLabel(deadline))}</span></td>
      <td data-label="Status"><span class="status ${escapeHtml(program.verification_status)}">${escapeHtml(statusLabel(program.verification_status))}</span></td>
    `;

    els.rows.append(tr);
  });
}

function renderDetail() {
  const opportunity = state.opportunities.find((item) => item.program.program_id === state.selectedId);

  if (!opportunity) {
    els.detailEmpty.hidden = false;
    els.detailContent.hidden = true;
    return;
  }

  const { foundation, program, deadline } = opportunity;
  const foundationSummary = foundation.support_areas
    ? `${foundation.name} støtter initiativer inden for ${splitList(foundation.support_areas).join(", ")}.`
    : `${foundation.name} er en ${foundation.legal_type || "fond"}, der støtter almennyttige formål.`;
  const foundationSelfDescription = foundation.notes || "";
  const eligibility = state.programEligibility.find((item) => item.program_id === program.program_id);
  const applicants = state.programApplicants.filter((item) => item.program_id === program.program_id && item.eligibility_status !== "ineligible");
  const exclusions = state.programExclusions.filter((item) => item.program_id === program.program_id);
  els.detailEmpty.hidden = true;
  els.detailContent.hidden = false;
  els.detailContent.innerHTML = `
    <div class="detail-title">
      <div class="detail-favorite-toolbar">
        <button class="favorite-button detail-favorite ${isFavorite(foundation.foundation_id) ? "active" : ""}" type="button" data-favorite-id="${escapeHtml(foundation.foundation_id)}" aria-label="Favorit ${escapeHtml(foundation.name)}" aria-pressed="${isFavorite(foundation.foundation_id)}"><img src="frontend/icons/star.svg" alt="" /><span>${isFavorite(foundation.foundation_id) ? "Gemt som favorit" : "Gem som favorit"}</span></button>
      </div>
      <h2>${escapeHtml(program.program_name)}</h2>
      <p>${escapeHtml(foundation.name)} · ${escapeHtml(program.program_type || foundation.legal_type || "Fond")}</p>
    </div>
    <p class="detail-summary">${escapeHtml(foundationSummary)}</p>
    <dl class="detail-facts">
      <div><dt>Status</dt><dd><span class="status ${escapeHtml(program.verification_status)}">${escapeHtml(statusLabel(program.verification_status))}</span></dd></div>
      <div><dt>Støtteområder</dt><dd>${escapeHtml(splitList(program.support_areas).join(" · ") || "Skal verificeres")}</dd></div>
      <div><dt>Ansøgere</dt><dd>${escapeHtml(splitList(program.applicant_types).join(" · ") || "Se vilkår")}</dd></div>
      <div><dt>Frist</dt><dd><span class="deadline ${deadline?.status === "open" ? "open" : "to_verify"}">${escapeHtml(deadlineLabel(deadline))}</span></dd></div>
      <div><dt>Geografi</dt><dd>${escapeHtml(structuredGeographyLabel(eligibility, program.geography))}</dd></div>
    </dl>
    <div class="detail-links">
      <a class="button-link detail-primary-action" href="${escapeHtml(linkOrHash(program.application_url || foundation.application_url))}" target="_blank" rel="noreferrer"><img src="frontend/icons/external-link.svg" alt="" />${escapeHtml(applicationActionLabel(program))}</a>
      <a class="detail-source-link" href="${escapeHtml(linkOrHash(program.source_url || foundation.source_url))}" target="_blank" rel="noreferrer"><img src="frontend/icons/link.svg" alt="" />Kilde</a>
    </div>
    <details class="detail-more">
      <summary>Vilkår og flere oplysninger</summary>
      <div class="detail-more-content">
        <div class="detail-block foundation-overview">
          <h3>Om fonden</h3>
          <p>${escapeHtml(foundationSummary)}</p>
          ${foundationSelfDescription ? `<div class="foundation-overview-part foundation-self-description"><strong>Fondens egen beskrivelse</strong><p>${escapeHtml(foundationSelfDescription)}</p></div>` : ""}
          <small>${escapeHtml(foundation.country || "Danmark")}${foundation.city ? ` · ${escapeHtml(foundation.city)}` : ""}</small>
          <a href="${escapeHtml(linkOrHash(foundation.website))}" target="_blank" rel="noreferrer">Besøg fondens website</a>
        </div>
        <div class="detail-block">
          <h3>Frist og ansøgningsproces</h3>
          <p><strong>${escapeHtml(deadlineLabel(deadline))}</strong></p>
          <p>${escapeHtml(deadline?.summary || program.deadline_summary || "Fristen skal verificeres hos fonden.")}</p>
        </div>
        <div class="detail-block">
          <h3>Hvem kan søge?</h3>
          <p>${escapeHtml(eligibility?.eligibility_summary || program.applicant_types || "-")}</p>
          <div class="pill-list eligibility-list">${applicants.map((item) => `<span class="pill ${item.eligibility_status === "conditional" ? "muted-pill" : ""}" title="${escapeHtml(item.conditions || "")}">${escapeHtml(item.label)}</span>`).join("")}</div>
        </div>
        <div class="detail-block">
          <h3>Geografi og CVR</h3>
          <p><strong>${escapeHtml(structuredGeographyLabel(eligibility, program.geography))}</strong><br>${escapeHtml(cvrRequirementLabel(eligibility?.cvr_requirement))}</p>
          <small>${escapeHtml(eligibility?.cvr_notes || "")}</small>
        </div>
        <div class="detail-block">
          <h3>Beløb</h3>
          <p><strong>${escapeHtml(structuredAmountLabel(eligibility, program.amount_range))}</strong><br>${escapeHtml(eligibility?.amount_notes || program.amount_range || "Varierer")}</p>
        </div>
        ${exclusions.length ? `<div class="detail-block exclusions-block"><h3>Udelukkelser</h3><ul>${exclusions.map((item) => `<li>${escapeHtml(item.description)}</li>`).join("")}</ul></div>` : ""}
        <div class="detail-block"><h3>Datastatus</h3><p>${escapeHtml(statusLabel(program.verification_status))} · tjekket ${escapeHtml(program.last_checked || "-")}</p></div>
        <div class="detail-block"><h3>Note</h3><p>${escapeHtml(program.notes || "-")}</p></div>
      </div>
    </details>
  `;
}

function buildAlerts() {
  const alerts = [];

  if (state.alertSettings.deadlineSoon) {
    state.opportunities.forEach((opportunity) => {
      const remainingDays = daysUntil(opportunity.deadline?.closes_on);
      if (remainingDays !== null && remainingDays >= 0 && remainingDays <= 14) {
        alerts.push({
          type: "deadline",
          title: `${opportunity.program.program_name} lukker om ${remainingDays} dage`,
          body: `${opportunity.foundation.name} har frist ${opportunity.deadline.closes_on}.`,
          programId: opportunity.program.program_id,
        });
      }
    });
  }

  if (state.alertSettings.newFoundation) {
    const knownIds = loadJson("fondsdb.knownFoundationIds", null);
    if (Array.isArray(knownIds)) {
      const knownSet = new Set(knownIds);
      state.foundations
        .filter((foundation) => !knownSet.has(foundation.foundation_id))
        .forEach((foundation) => {
          alerts.push({
            type: "new",
            title: `Ny fond: ${foundation.name}`,
            body: `${foundation.city || "Danmark"} · ${foundation.support_areas || "Støtteområder skal tjekkes"}`,
            foundationId: foundation.foundation_id,
          });
        });
    }
  }

  if (state.alertSettings.newCall) {
    actionableScans()
      .filter((scan) => scan.effective_status !== "ignored")
      .filter((scan) => scan.quality_score >= 40)
      .forEach((scan) => {
        const level = qualityLevel(scan.quality_score);
        alerts.push({
          type: "call",
          title: `${qualityLabel(level)} fund: ${scan.discovered_title}`,
          body: `${scan.foundation_name} · ${scan.excerpt || scan.scan_url}`,
          programId: scan.program_id,
          url: scan.discovered_url || scan.scan_url,
          qualityScore: scan.quality_score,
        });
      });
  }

  if (state.alertSettings.favoriteUpdate) {
    const previousSignatures = loadJson("fondsdb.foundationSignatures", {});
    state.foundations
      .filter((foundation) => isFavorite(foundation.foundation_id))
      .forEach((foundation) => {
        const signature = foundationSignature(foundation);
        if (previousSignatures[foundation.foundation_id] && previousSignatures[foundation.foundation_id] !== signature) {
          alerts.push({
            type: "favorite",
            title: `Favorit opdateret: ${foundation.name}`,
            body: `Data eller puljer er ændret siden sidst.`,
            foundationId: foundation.foundation_id,
          });
        }
      });
  }

  state.alerts = alerts;
}

function renderReview() {
  const scans = actionableScans();
  const statusFilter = els.reviewStatusFilter.value;
  const qualityFilter = els.reviewQualityFilter.value;
  const filtered = scans.filter((scan) => {
    const level = qualityLevel(scan.quality_score);
    return (!statusFilter || scan.effective_status === statusFilter) && (!qualityFilter || level === qualityFilter);
  });

  els.reviewNewCount.textContent = scans.filter((scan) => scan.effective_status === "new").length;
  els.reviewHighCount.textContent = scans.filter((scan) => qualityLevel(scan.quality_score) === "high" && scan.effective_status !== "ignored").length;
  els.reviewIgnoredCount.textContent = scans.filter((scan) => scan.effective_status === "ignored").length;
  els.reviewList.replaceChildren();

  if (!filtered.length) {
    const empty = document.createElement("div");
    empty.className = "review-empty";
    empty.textContent = "Ingen fund matcher filtrene.";
    els.reviewList.append(empty);
    return;
  }

  filtered.slice(0, 12).forEach((scan) => {
    const level = qualityLevel(scan.quality_score);
    const item = document.createElement("article");
    item.className = `review-item ${level}`;
    item.innerHTML = `
      <div class="review-main">
        <div class="review-title-row">
          <strong>${escapeHtml(scan.discovered_title || "Ukendt fund")}</strong>
          <span class="quality-badge ${level}">${escapeHtml(qualityLabel(level))} · ${scan.quality_score}</span>
        </div>
        <p>${escapeHtml(scan.foundation_name || "Ukendt fond")} · ${escapeHtml(scan.match_type || "-")}</p>
        <small>${escapeHtml(qualityReason(scan, scan.quality_score))}</small>
        <span>${escapeHtml(scan.excerpt || scan.scan_url || "-")}</span>
      </div>
      <div class="review-actions">
        <a class="button-link secondary" href="${escapeHtml(linkOrHash(scan.discovered_url || scan.scan_url))}" target="_blank" rel="noreferrer">Kilde</a>
        <button class="button-link secondary" type="button" data-review-id="${escapeHtml(scan.scan_result_id)}" data-review-status="reviewed">Reviewed</button>
        <button class="button-link secondary danger" type="button" data-review-id="${escapeHtml(scan.scan_result_id)}" data-review-status="ignored">Ignorér</button>
      </div>
    `;
    els.reviewList.append(item);
  });
}

function renderAlerts() {
  els.emailInput.value = state.alertSettings.email;
  els.deadlineAlertToggle.checked = state.alertSettings.deadlineSoon;
  els.newFoundationAlertToggle.checked = state.alertSettings.newFoundation;
  els.newCallAlertToggle.checked = state.alertSettings.newCall;
  els.favoriteUpdateAlertToggle.checked = state.alertSettings.favoriteUpdate;
  els.alertList.replaceChildren();

  if (!state.alerts.length) {
    const empty = document.createElement("div");
    empty.className = "alert-empty";
    empty.textContent = "Ingen aktuelle alerts. Når der kommer datofrister, nye fonde eller ændringer på favoritter, vises de her.";
    els.alertList.append(empty);
    return;
  }

  state.alerts.slice(0, 6).forEach((alert) => {
    const item = document.createElement("button");
    item.className = `alert-item ${alert.type}`;
    item.type = "button";
    item.dataset.programId = alert.programId || "";
    item.dataset.foundationId = alert.foundationId || "";
    item.dataset.url = alert.url || "";
    item.innerHTML = `<strong>${escapeHtml(alert.title)}</strong><span>${escapeHtml(alert.body)}</span>`;
    els.alertList.append(item);
  });
}

function renderFavoriteList() {
  els.favoriteList.replaceChildren();
  const favoriteOpportunities = state.opportunities.filter((opportunity) => isFavorite(opportunity.foundation.foundation_id));

  if (!favoriteOpportunities.length) {
    const empty = document.createElement("div");
    empty.className = "favorite-empty";
    empty.textContent = "Ingen favoritter endnu. Markér en fond med stjernen i fondelisten, så samles de her.";
    els.favoriteList.append(empty);
    return;
  }

  favoriteOpportunities.forEach((opportunity) => {
    const { foundation, program, deadline } = opportunity;
    const scans = actionableScans().filter((scan) => scan.foundation_id === foundation.foundation_id && scan.effective_status !== "ignored");
    const bestScan = scans[0];
    const item = document.createElement("article");
    item.className = "favorite-item";
    item.innerHTML = `
      <div>
        <strong>${escapeHtml(foundation.name)}</strong>
        <p>${escapeHtml(program.program_name)} · ${escapeHtml(deadlineLabel(deadline))}</p>
        ${bestScan ? `<span>${escapeHtml(qualityLabel(qualityLevel(bestScan.quality_score)))} fund: ${escapeHtml(bestScan.discovered_title)}</span>` : "<span>Ingen aktuelle call-fund på favoritten.</span>"}
      </div>
      <div class="favorite-actions">
        <button class="button-link secondary" type="button" data-open-program-id="${escapeHtml(program.program_id)}">Åbn</button>
        <button class="favorite-button active" type="button" data-favorite-id="${escapeHtml(foundation.foundation_id)}" aria-label="Fjern favorit ${escapeHtml(foundation.name)}" aria-pressed="true"><img src="frontend/icons/star.svg" alt="" /></button>
      </div>
    `;
    els.favoriteList.append(item);
  });
}

function renderDataHealth() {
  const foundScans = state.callScanResults.filter((scan) => scan.scan_status === "found").length;
  const errorScans = state.callScanResults.filter((scan) => scan.scan_status === "error").length;
  const crawlerScans = state.callScanResults.filter((scan) => scan.match_type?.startsWith("crawler_")).length;
  const reviewedScans = actionableScans().filter((scan) => scan.effective_status === "reviewed").length;
  const ignoredScans = actionableScans().filter((scan) => scan.effective_status === "ignored").length;

  els.scanHealthText.textContent = `${foundScans} fund · ${errorScans} fejl · ${crawlerScans} crawler-rækker`;
  els.dataHealthList.innerHTML = `
    <article>
      <span>Scannerfund</span>
      <strong>${foundScans}</strong>
      <p>Mulige calls/opslag fra hurtig scanning og deep crawler.</p>
    </article>
    <article>
      <span>Fetch-fejl</span>
      <strong>${errorScans}</strong>
      <p>Sider der blokerede, time-outede eller kræver mere avanceret crawling.</p>
    </article>
    <article>
      <span>Review</span>
      <strong>${reviewedScans}/${ignoredScans}</strong>
      <p>Reviewed/ignoreret og gemt centralt i databasen.</p>
    </article>
    <article>
      <span>Downloads</span>
      <strong>CSV/XLS</strong>
      <p><a href="data/call_scan_results.csv" download>Scan CSV</a> · <a href="outputs/dansk_fonds_database.xlsx" download>Excel</a></p>
    </article>
  `;
}

function persistAlertSettings() {
  state.alertSettings = {
    email: els.emailInput.value.trim(),
    deadlineSoon: els.deadlineAlertToggle.checked,
    newFoundation: els.newFoundationAlertToggle.checked,
    newCall: els.newCallAlertToggle.checked,
    favoriteUpdate: els.favoriteUpdateAlertToggle.checked,
  };
  saveJson("fondsdb.alertSettings", state.alertSettings);
  buildAlerts();
  renderAlerts();
  renderReview();
  renderDataHealth();
}

function persistKnownState() {
  saveJson("fondsdb.knownFoundationIds", state.foundations.map((foundation) => foundation.foundation_id));
  saveJson(
    "fondsdb.foundationSignatures",
    Object.fromEntries(state.foundations.map((foundation) => [foundation.foundation_id, foundationSignature(foundation)])),
  );
}

function toggleFavorite(foundationId) {
  if (state.favorites.has(foundationId)) {
    state.favorites.delete(foundationId);
  } else {
    state.favorites.add(foundationId);
  }
  saveJson("fondsdb.favorites", [...state.favorites]);
  buildAlerts();
  renderSummary();
  renderAlerts();
  renderFavoriteList();
  renderRows();
  renderDetail();
}

function updateScanReview(scanResultId, status) {
  return persistScanReview(scanResultId, status).catch((error) => {
    showActionToast(`Review kunne ikke gemmes: ${error.message}`, true);
  });
}

async function persistScanReview(scanResultId, status, { silent = false } = {}) {
  if (isFilePreview()) throw new Error("Start appen via LocalHost for at gemme review");
  const response = await fetch("/api/call-reviews", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ scan_result_id: scanResultId, review_status: status }),
  });
  const payload = await response.json();
  if (!response.ok || !payload.ok) throw new Error(payload.message || "Review kunne ikke gemmes");
  state.scanReviewOverrides[scanResultId] = payload.review.review_status;
  buildAlerts();
  renderAlerts();
  renderReview();
  renderFavoriteList();
  renderDataHealth();
  if (!silent) showActionToast("Review er gemt i databasen.");
}

async function loadScanReviews() {
  if (isFilePreview()) return;
  const legacyOverrides = loadJson("fondsdb.scanReviewOverrides", {});
  const knownScanIds = new Set(state.callScanResults.map((scan) => scan.scan_result_id));
  const legacyEntries = Object.entries(legacyOverrides).filter(([scanResultId]) => knownScanIds.has(scanResultId));
  if (legacyEntries.length > 0) {
    for (const [scanResultId, status] of legacyEntries) {
      await persistScanReview(scanResultId, status, { silent: true });
    }
    localStorage.removeItem("fondsdb.scanReviewOverrides");
  }

  const response = await fetch("/api/call-reviews");
  const payload = await response.json();
  if (!response.ok || !payload.ok) throw new Error(payload.message || "Reviewstatus kunne ikke hentes");
  state.scanReviewOverrides = Object.fromEntries(
    payload.reviews.map((review) => [review.scan_result_id, review.review_status]),
  );
}

function openEmailDigest() {
  const email = state.alertSettings.email;
  const lines = state.alerts.length
    ? state.alerts.map((alert) => `- ${alert.title}: ${alert.body}${alert.url ? ` (${alert.url})` : ""}`)
    : ["Der er ingen aktuelle alerts lige nu."];
  const subject = encodeURIComponent("Dansk Fondsdatabase alerts");
  const body = encodeURIComponent(lines.join("\n"));
  const recipient = encodeURIComponent(email);
  window.location.href = `mailto:${recipient}?subject=${subject}&body=${body}`;
}

function applyFilters() {
  const query = els.searchInput.value.trim().toLocaleLowerCase("da");
  const area = els.areaFilter.value;
  const applicant = els.applicantFilter.value;
  const deadlineValue = els.deadlineFilter.value;
  const status = els.statusFilter.value;

  state.filtered = state.opportunities.filter((opportunity) => {
    const { foundation, program, deadline } = opportunity;
    const eligibility = state.programEligibility.find((item) => item.program_id === program.program_id);
    const structuredApplicants = state.programApplicants.filter((item) => item.program_id === program.program_id && item.eligibility_status !== "ineligible");
    const exclusions = state.programExclusions.filter((item) => item.program_id === program.program_id);
    const haystack = [
      foundation.name,
      foundation.city,
      program.program_name,
      program.program_type,
      program.support_areas,
      program.applicant_types,
      program.geography,
      program.deadline_summary,
      foundation.notes,
      program.notes,
      eligibility?.eligibility_summary,
      eligibility?.cvr_notes,
      structuredGeographyLabel(eligibility, ""),
      structuredApplicants.map((item) => `${item.label} ${item.conditions || ""}`).join(" "),
      exclusions.map((item) => item.description).join(" "),
    ]
      .join(" ")
      .toLocaleLowerCase("da");

    const matchesQuery = !query || haystack.includes(query);
    const matchesArea = !area || splitList(program.support_areas).includes(area);
    const matchesApplicant = !applicant || structuredApplicants.some((item) => item.label === applicant) || splitList(program.applicant_types).includes(applicant);
    const matchesDeadline =
      !deadlineValue ||
      deadline?.status === deadlineValue ||
      deadline?.deadline_type === deadlineValue;
    const matchesStatus = !status || program.verification_status === status;
    return matchesQuery && matchesArea && matchesApplicant && matchesDeadline && matchesStatus;
  });

  if (!state.filtered.some((opportunity) => opportunity.program.program_id === state.selectedId)) {
    state.selectedId = state.filtered[0]?.program.program_id || null;
  }

  renderChart();
  renderRows();
  renderDetail();
  window.WorkspaceShell?.syncFilters();
}

function selectProgram(id) {
  state.selectedId = id;
  renderRows();
  renderDetail();
  window.WorkspaceShell?.showFundDetail();
}

function rebuildOpportunities() {
  state.opportunities = state.programs.map((program) => ({
    program,
    foundation: state.foundations.find((foundation) => foundation.foundation_id === program.foundation_id) || {},
    deadline: state.deadlines.find((deadline) => deadline.program_id === program.program_id) || null,
  }));
  state.filtered = [...state.opportunities];
  if (!state.opportunities.some(({ program }) => program.program_id === state.selectedId)) {
    state.selectedId = state.opportunities[0]?.program.program_id || null;
  }
}

async function reloadFoundationData() {
  const response = await fetch(`data/fonde_seed.csv?ts=${Date.now()}`);
  if (!response.ok) throw new Error("Kunne ikke genindlæse fondsdata");
  state.foundations = csvToObjects(await response.text());
  rebuildOpportunities();
  renderSummary();
  buildAlerts();
  applyFilters();
  renderAlerts();
  renderReview();
  renderFavoriteList();
  renderDataHealth();
}

async function loadScrapeChanges() {
  if (isFilePreview()) {
    els.scrapeChangeRows.innerHTML = `<tr><td colspan="5">Start appen via LocalHost for at bruge webscraperen.</td></tr>`;
    return;
  }

  const response = await fetch("/api/scrape/changes");
  const payload = await response.json();
  if (!response.ok || !payload.ok) throw new Error(payload.message || "Kunne ikke hente ændringer");

  els.scrapeChangeRows.replaceChildren();
  if (!payload.changes.length) {
    els.scrapeChangeRows.innerHTML = `<tr><td colspan="5">Ingen ændringer til manuel gennemgang.</td></tr>`;
    return;
  }

  payload.changes.forEach((change) => {
    const row = document.createElement("tr");
    row.dataset.changeId = change.change_id;
    row.innerHTML = `
      <td><strong>${escapeHtml(change.foundation_name)}</strong><br><small>${escapeHtml(change.detected_at)}</small></td>
      <td>${escapeHtml(fieldLabel(change.field_name))}</td>
      <td>
        <div class="compare-values">
          <div><span>Før</span><div class="value-preview muted">${displayScrapedText(change.old_value || "Ingen tidligere værdi")}</div></div>
          <div><span>Nu</span><div class="value-preview">${displayScrapedText(change.new_value)}</div></div>
        </div>
      </td>
      <td><span class="status ${change.significance === "high" ? "needs_update" : "to_verify"}">${escapeHtml(change.significance)} · ${Math.round(change.confidence * 100)}%</span></td>
      <td>
        <div class="review-actions">
          <textarea class="review-note" rows="2" placeholder="Kort note"></textarea>
          <button class="mini-button approve" type="button" data-action="approve">Godkend</button>
          <button class="mini-button reject" type="button" data-action="reject">Afvis</button>
        </div>
      </td>`;
    els.scrapeChangeRows.append(row);
  });
}

async function loadApprovedScrapeFields() {
  if (isFilePreview()) {
    els.scrapeApprovedRows.innerHTML = `<tr><td colspan="5">Start appen via LocalHost for at se gemte scraperfelter.</td></tr>`;
    return;
  }

  const response = await fetch("/api/foundations/extracted-fields");
  const payload = await response.json();
  if (!response.ok || !payload.ok) throw new Error(payload.message || "Kunne ikke hente godkendte felter");

  state.approvedScrapeFields = payload.fields;
  els.scrapeApprovedCount.textContent = `${payload.fields.length} gemte felter`;
  els.scrapeApprovedRows.replaceChildren();
  if (!payload.fields.length) {
    els.scrapeApprovedRows.innerHTML = `<tr><td colspan="5">Ingen godkendte scraperfelter endnu.</td></tr>`;
    return;
  }

  payload.fields.forEach((field) => {
    const row = document.createElement("tr");
    const approvalLabel = field.validation_status === "approved_manual" ? "Manuelt godkendt" : "Auto-godkendt";
    const source = /^https?:\/\//i.test(field.source_url || "")
      ? `<a href="${escapeHtml(field.source_url)}" target="_blank" rel="noreferrer">Åbn kilde</a>`
      : "Ingen kilde";
    row.innerHTML = `
      <td><strong>${escapeHtml(field.foundation_name)}</strong><br><small>${escapeHtml(field.foundation_id)}</small></td>
      <td>${escapeHtml(fieldLabel(field.field_name))}</td>
      <td><div class="value-preview">${displayScrapedText(field.field_value)}</div></td>
      <td><span class="status source_checked">${approvalLabel} · ${Math.round(field.confidence * 100)}%</span><br><small>${escapeHtml(field.decision_note || "")}</small></td>
      <td>${source}<br><small>${escapeHtml(field.decided_at || field.updated_at)}</small></td>`;
    els.scrapeApprovedRows.append(row);
  });
}

async function runScraper({ limit = 0 } = {}) {
  if (isFilePreview()) {
    window.location.href = "http://127.0.0.1:8000/";
    return;
  }

  els.scrapeRunButton.disabled = true;
  els.scrapeTestButton.disabled = true;
  setPageLoading(true);
  setScrapeStatus(limit ? "Tester scraper på 5 fonde..." : "Kører scraper på alle fonde...");

  try {
    const response = await fetch("/api/scrape/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ limit }),
    });
    const payload = await response.json();
    if (!response.ok || !payload.ok) throw new Error(payload.message || "Scraper-kørsel fejlede");
    const report = payload.report;
    setScrapeStatus(`Scraper færdig. ${report.targets_checked} fonde tjekket, ${report.changes_detected} mulige ændringer, ${report.manual_review} kræver gennemgang.`);
    await Promise.all([loadScrapeChanges(), loadApprovedScrapeFields()]);
    renderDataHealth();
  } catch (error) {
    setScrapeStatus(`Scraper fejlede: ${error.message}`, true);
  } finally {
    setPageLoading(false);
    els.scrapeRunButton.disabled = false;
    els.scrapeTestButton.disabled = false;
  }
}

async function updateSources() {
  if (isFilePreview()) {
    window.location.href = "http://127.0.0.1:8000/";
    return;
  }

  els.updateButton.disabled = true;
  setPageLoading(true);
  setUpdateStatus("Opdaterer kilder og database...");
  try {
    const response = await fetch("/api/update-sources", { method: "POST" });
    const payload = await response.json();
    if (!response.ok || !payload.ok) throw new Error(payload.message || "Opdatering fejlede");
    await reloadFoundationData();
    setUpdateStatus(`Opdateret. ${payload.report.total_foundations} fonde tjekket, ${payload.report.failed_foundations} kræver gennemgang.`);
    showActionToast("Kilder og database er opdateret.");
  } catch (error) {
    setUpdateStatus(`Opdatering fejlede: ${error.message}`, true);
    showActionToast("Kildeopdateringen fejlede.", true);
  } finally {
    setPageLoading(false);
    els.updateButton.disabled = false;
  }
}

function projectStatusLabel(status) {
  return ({
    idea: "Idea",
    planning: "Ansøgningsfase",
    active: "Development",
    completed: "Afsluttet",
    cancelled: "Annulleret",
  })[status] || status;
}

function projectRoleLabel(role) {
  return ({ owner: "Projektejer", lead: "Projektleder", contributor: "Partner", reviewer: "Reviewer" })[role] || role;
}

function documentTypeLabel(type) {
  return ({ google_doc: "Google Docs", google_sheet: "Google Sheets", google_slide: "Google Slides", other: "Link" })[type] || "Dokument";
}

function applicationStatusLabel(status) {
  return ({
    candidate: "Kandidat",
    planned: "Planlagt",
    drafting: "Under udarbejdelse",
    submitted: "Indsendt",
    awarded: "Bevilget",
    rejected: "Afvist",
    withdrawn: "Trukket tilbage",
  })[status] || status;
}

function taskStatusLabel(status) {
  return ({ todo: "Started", in_progress: "In progress", blocked: "Stuck", done: "Done" })[status] || status;
}

function formatAmount(value, currency = "DKK") {
  if (value === null || value === undefined || value === "") return "–";
  return new Intl.NumberFormat("da-DK", { style: "currency", currency, maximumFractionDigits: 0 }).format(Number(value));
}

function statusesFor(entityType) {
  const defaultProjectIds = new Set(["project-status-idea","project-status-planning","project-status-active","project-status-submitted"]);
  return state.workflowStatuses.filter(status => status.entity_type === entityType &&
    (entityType !== "project" || !Number(status.is_system) || defaultProjectIds.has(status.status_id)));
}

function workflowStatusOptions(entityType, selectedId, fallbackBase) {
  const statuses = statusesFor(entityType);
  const legacy = state.workflowStatuses.find(status => status.entity_type === entityType &&
    (status.status_id === selectedId || (!selectedId && status.base_status === fallbackBase)));
  if (legacy && !statuses.some(status=>status.status_id===legacy.status_id)) statuses.push(legacy);
  const chosen = selectedId || statuses.find(status => status.base_status === fallbackBase)?.status_id;
  return statuses.map(status => `<option value="${escapeHtml(status.status_id)}" ${status.status_id === chosen ? "selected" : ""}>${escapeHtml(status.label)}</option>`).join("");
}

function applyWorkflowStatus(values, entityType) {
  const status = state.workflowStatuses.find((item) => item.status_id === values.workflow_status_id && item.entity_type === entityType);
  if (status) values.status = status.base_status;
  return values;
}

function populateProjectCreateOptions() {
  const statusSelect = els.projectCreateForm.elements.workflow_status_id;
  const folderSelect = els.projectCreateForm.elements.folder_id;
  const ownerSelect = els.projectCreateForm.elements.owner_member_id;
  const programSelect = els.projectCreateForm.elements.program_id;
  statusSelect.innerHTML = workflowStatusOptions("project", null, "idea");
  folderSelect.innerHTML = `<option value="">Ingen mappe</option>${state.projectFolders.map((folder) => `<option value="${escapeHtml(folder.folder_id)}">${escapeHtml(folder.name)}</option>`).join("")}`;
  ownerSelect.innerHTML = `<option value="">Ingen ansvarlig</option>${state.teamMembers.map((member) => `<option value="${escapeHtml(member.member_id)}">${escapeHtml(member.display_name)}</option>`).join("")}`;
  programSelect.innerHTML = `<option value="">Tilføj senere</option>${[...state.programs].sort((a,b)=>a.program_name.localeCompare(b.program_name,"da")).map((program)=>{
    const foundation = state.foundations.find((item)=>item.foundation_id===program.foundation_id);
    return `<option value="${escapeHtml(program.program_id)}">${escapeHtml(foundation?.name || program.foundation_id)} — ${escapeHtml(program.program_name)}</option>`;
  }).join("")}`;
  els.projectCreateForm.elements.application_workflow_status_id.innerHTML = workflowStatusOptions("application", null, "candidate");
  updateApplicationDeadlineOptions(els.projectCreateForm);
}

function updateStatusBaseOptions(form) {
  const choices = {
    project: [["idea", "Idé"], ["planning", "Planlægning"], ["active", "Aktiv"], ["completed", "Afsluttet"], ["cancelled", "Annulleret"]],
    application: [["candidate", "Kandidat"], ["planned", "Planlagt"], ["drafting", "Under udarbejdelse"], ["submitted", "Indsendt"], ["awarded", "Bevilget"], ["rejected", "Afvist"]],
    task: [["todo", "Ikke startet"], ["in_progress", "I gang"], ["blocked", "Blokeret"], ["done", "Færdig"]],
  }[form.elements.entity_type.value];
  form.elements.base_status.innerHTML = choices.map(([value, label]) => `<option value="${value}">${label}</option>`).join("");
}

async function projectApi(pathname, options = {}) {
  if (isFilePreview()) {
    throw new Error("Start appen med ‘Start fondsdatabase.command’ for at gemme projekter.");
  }
  let response;
  try {
    response = await fetch(pathname, {
      ...options,
      headers: { "content-type": "application/json", ...(options.headers || {}) },
    });
  } catch {
    throw new Error("Forbindelsen til den lokale database blev afbrudt. Start eller genstart ‘Start fondsdatabase.command’.");
  }
  const payload = await response.json();
  if (!response.ok || !payload.ok) throw new Error(payload.message || "Projektdata kunne ikke gemmes");
  return payload;
}

function renderAuthPanel() {
  window.WorkspaceShell?.syncAuth(state.auth);
  const setup = state.auth.setupRequired;
  els.projectAuthPanel.hidden = false;
  els.projectAuthPanel.innerHTML = `<div class="project-auth-card"><div><p class="section-kicker">Projektstyring</p><h3>${setup ? "Opret første konto" : "Log ind"}</h3><p>${setup ? "Opret administratoren, der skal have adgang til projekter og teamdata." : "Log ind for at se projekter, opgaver og kommentarer."}</p></div><form data-auth-form="${setup ? "setup" : "login"}"><input name="email" type="email" required placeholder="E-mail" aria-label="E-mail" autocomplete="email" /><input name="display_name" type="${setup ? "text" : "hidden"}" ${setup ? "required" : ""} placeholder="Navn" aria-label="Navn" autocomplete="name" /><input name="password" type="password" required minlength="10" placeholder="Adgangskode (min. 10 tegn)" aria-label="Adgangskode (min. 10 tegn)" autocomplete="${setup ? "new-password" : "current-password"}" /><button class="button-link" type="submit">${setup ? "Opret konto" : "Log ind"}</button></form><p class="project-auth-error" data-auth-error hidden></p></div>`;
}

async function loadAuthStatus() {
  const response = await fetch("/api/auth/status");
  const payload = await response.json();
  state.auth = { authenticated: payload.authenticated, setupRequired: payload.setupRequired, user: payload.user || null };
  if (!state.auth.authenticated) { renderAuthPanel(); return false; }
  window.WorkspaceShell?.syncAuth(state.auth);
  els.projectAuthPanel.hidden = false;
  els.projectAuthPanel.innerHTML = `<div class="project-auth-user"><span>Logget ind som <strong>${escapeHtml(state.auth.user?.display_name || state.auth.user?.email || "bruger")}</strong></span><button class="mini-button" type="button" data-auth-logout>Log ud</button></div>`;
  return true;
}

async function loadProjects({ selectNewest = false } = {}) {
  if (isFilePreview()) {
    els.projectList.innerHTML = `<div class="empty-state">Start appen med <strong>Start fondsdatabase.command</strong> for at bruge projektstyring.</div>`;
    return;
  }
  if (!(await loadAuthStatus())) { els.projectList.innerHTML = `<div class="empty-state">Log ind for at se projektporteføljen.</div>`; return; }
  const [payload, teamPayload, configPayload] = await Promise.all([
    projectApi("/api/projects"),
    projectApi("/api/team-members"),
    projectApi("/api/project-config"),
  ]);
  state.projectLoadError = null;
  state.projects = payload.projects;
  state.teamMembers = teamPayload.members;
  state.projectFolders = configPayload.folders;
  state.workflowStatuses = configPayload.statuses;
  populateProjectCreateOptions();
  if (selectNewest && state.projects[0]) state.selectedProjectId = state.projects[0].project_id;
  if (state.selectedProjectId && !state.projects.some((project) => project.project_id === state.selectedProjectId)) {
    state.selectedProjectId = state.projects[0]?.project_id || null;
  }
  renderProjectList();
  if (state.projectPage === "dashboard") {
    await renderProjectDashboard();
    document.querySelector(".projects-workspace").hidden = true;
    els.projectDashboard.hidden = false;
  } else if (state.selectedProjectId) await selectProject(state.selectedProjectId);
}

function renderProjectLoadError(error, { notify = true } = {}) {
  state.projectLoadError = error?.message || String(error || "Projektdata kunne ikke indlæses.");
  state.projectPage = "dashboard";
  document.querySelector(".projects-header").hidden = true;
  els.projectConfigPanel.hidden = true;
  document.querySelector(".projects-workspace").hidden = true;
  els.projectDashboard.hidden = false;
  els.projectDashboard.innerHTML = `<section class="project-dashboard-loading" role="alert"><h3>Projektdata kunne ikke indlæses</h3><p>Du er stadig logget ind. Prøv at hente projekterne igen.</p><p>${escapeHtml(state.projectLoadError)}</p><button class="button-link" type="button" data-retry-projects>Prøv igen</button></section>`;
  els.projectDashboard.querySelector("[data-retry-projects]").addEventListener("click", async (event) => {
    event.currentTarget.disabled = true;
    event.currentTarget.textContent = "Indlæser…";
    try {
      await loadProjects();
    } catch (loadError) {
      renderProjectLoadError(loadError);
    }
  });
  if (notify) showActionToast("Projektdata kunne ikke indlæses. Du er stadig logget ind. Prøv igen under Projekter.", true);
}

async function renderProjectDashboard() {
  document.querySelector(".projects-header").hidden = false;
  els.projectConfigPanel.hidden = false;
  const dashboard = els.projectDashboard;
  if (!dashboard) return;
  const restoreNotice = state.deletedProject ? `<div class="project-restore-notice" role="status"><span>“${escapeHtml(state.deletedProject.name)}” er slettet fra oversigten.</span><button type="button" class="mini-button" data-restore-project>Fortryd</button></div>` : "";
  const trashMarkup = `<details class="project-trash"><summary>Papirkurv</summary><div data-trash-list>Indlæser…</div></details>`;
  const bindTrash = () => {
    const trash = dashboard.querySelector(".project-trash");
    trash?.addEventListener("toggle", async () => {
      if (!trash.open) return;
      const list = trash.querySelector("[data-trash-list]");
      try {
        const { projects } = await projectApi("/api/projects/deleted");
        list.innerHTML = projects.length ? projects.map(project=>`<div class="trash-row"><span>${escapeHtml(project.name)}</span><button class="mini-button" type="button" data-restore-id="${escapeHtml(project.project_id)}">Gendan</button></div>`).join("") : "Papirkurven er tom.";
        list.querySelectorAll("[data-restore-id]").forEach(button=>button.addEventListener("click",async()=>{
          button.disabled = true;
          try { await projectApi(`/api/projects/${encodeURIComponent(button.dataset.restoreId)}/restore`,{method:"POST"}); state.deletedProject=null; await loadProjects(); }
          catch(error) { button.disabled=false; showActionToast(error.message,true); }
        }));
      } catch(error) { list.textContent=error.message; }
    });
  };
  const bindRestore = () => dashboard.querySelector("[data-restore-project]")?.addEventListener("click", async event => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      await projectApi(`/api/projects/${encodeURIComponent(state.deletedProject.project_id)}/restore`,{method:"POST"});
      state.deletedProject = null;
      await loadProjects();
    } catch(error) { button.disabled = false; showActionToast(error.message,true); }
  });
  if (!state.projects.length) {
    dashboard.innerHTML = restoreNotice + `<section class="project-dashboard-welcome"><p class="section-kicker">Projektstyring</p><h2>Få overblik over arbejdet</h2><p>Opret et projekt for at følge opgaver, ansøgninger og teamets arbejdsbyrde.</p></section>`;
    dashboard.insertAdjacentHTML("beforeend",trashMarkup);
    bindTrash();
    bindRestore();
    return;
  }
  dashboard.innerHTML = `<div class="project-dashboard-loading">Henter projekt- og opgaveoverblik…</div>`;
  let details;
  try {
    details = await Promise.all(state.projects.map(async project =>
      (await projectApi(`/api/projects/${encodeURIComponent(project.project_id)}`)).project,
    ));
  } catch {
    dashboard.innerHTML = `<section class="dashboard-section"><h3>Overblikket kunne ikke indlæses</h3><p class="dashboard-muted">Projektdata kunne ikke hentes. Kontrollér forbindelsen, og prøv igen.</p><button class="button-link" type="button" data-dashboard-action="retry">Prøv igen</button></section>`;
    dashboard.querySelector("[data-dashboard-action='retry']")?.addEventListener("click", () => void renderProjectDashboard());
    return;
  }
  const tasks = details.flatMap(project => (project.tasks || []).map(task => ({ ...task, project_name: project.name })));
  const openTasks = tasks.filter(task => task.status !== "done");
  const now = new Date();
  const today = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, "0"), String(now.getDate()).padStart(2, "0")].join("-");
  const deadlineTasks = openTasks.filter(task => task.due_on).sort((a,b)=>a.due_on.localeCompare(b.due_on)).slice(0,5);
  const workload = new Map();
  openTasks.forEach(task => { const name = task.assignee_name || "Ikke tildelt"; workload.set(name,(workload.get(name)||0)+1); });
  const workloadRows = [...workload].sort((a,b)=>b[1]-a[1]).slice(0,6);
  const maximumLoad = Math.max(1,...workloadRows.map(([, count])=>count));
  const projectCards = state.projects.map(project => `<button class="dashboard-project-card" type="button" data-dashboard-project="${escapeHtml(project.project_id)}">
    <span class="dashboard-project-status"><i class="status-dot color-${escapeHtml(project.workflow_status_color || "gray")}"></i>${escapeHtml(project.workflow_status_label || projectStatusLabel(project.status))}</span>
    <strong>${escapeHtml(project.name)}</strong><span>${escapeHtml(project.folder_name || project.focus_area || "Projekt")} · ${escapeHtml(project.owner_name || "Ingen ansvarlig")}</span>
    <small>${Number(project.application_count || 0)} ansøgninger · ${Number(project.open_task_count || 0)} åbne opgaver</small>
    ${project.next_task_due_on ? `<small>Næste opgavefrist ${escapeHtml(project.next_task_due_on)}</small>` : ""}</button>`).join("");
  const taskRows = deadlineTasks.length ? deadlineTasks.map(task => {
    const overdue = task.due_on < today;
    const dueDate = new Date(`${task.due_on}T12:00:00`).toLocaleDateString("da-DK", { day: "numeric", month: "short", year: "numeric" });
    return `<button class="dashboard-task-row${overdue ? " is-overdue" : ""}" type="button" data-dashboard-project="${escapeHtml(task.project_id)}"><span><strong>${escapeHtml(task.title)}</strong><small>${escapeHtml(task.project_name)}${task.assignee_name ? ` · ${escapeHtml(task.assignee_name)}` : " · Ikke tildelt"}</small></span><time>${overdue ? "Overskredet · " : ""}${escapeHtml(dueDate)}</time></button>`;
  }).join("") : `<p class="dashboard-muted">Ingen åbne opgaver med en frist endnu.</p>`;
  dashboard.innerHTML = restoreNotice + `<header class="dashboard-heading"><div><h2>Jeres projekter</h2><p>Fælles overblik. Mere tid til det, der gør en forskel.</p></div></header>
    <section class="dashboard-metrics" aria-label="Nøgletal"><article><span>Projekter</span><strong>${state.projects.length}</strong></article><article><span>Åbne opgaver</span><strong>${openTasks.length}</strong></article><article><span>Ansøgninger</span><strong>${state.projects.reduce((sum,p)=>sum+Number(p.application_count||0),0)}</strong></article><article><span>Uden ansvarlig</span><strong>${workload.get("Ikke tildelt")||0}</strong></article></section>
    <section class="dashboard-section"><div class="section-heading"><div><h3>Projektportefølje</h3><p>Vælg et projekt for at åbne arbejdsområdet.</p></div></div><div class="dashboard-project-grid">${projectCards}</div></section>
    <div class="dashboard-lower-grid"><section class="dashboard-section"><div class="section-heading"><div><h3>Arbejdsbyrde</h3><p>Åbne opgaver fordelt på ansvarlig.</p></div></div>${workloadRows.length ? `<div class="workload-list">${workloadRows.map(([name,count])=>`<div class="workload-row"><span>${escapeHtml(name)}</span><div class="workload-track"><i style="width:${Math.max(6,Math.round(count/maximumLoad*100))}%"></i></div><strong>${count}</strong></div>`).join("")}</div>` : `<p class="dashboard-muted">Opret opgaver og tildel dem til teamet for at se arbejdsbyrden.</p>`}</section>
    <section class="dashboard-section"><div class="section-heading"><div><h3>Frister, der kræver opmærksomhed</h3><p>Forfaldne og kommende opgaver.</p></div></div><div class="dashboard-task-list">${taskRows}</div></section></div>`;
  dashboard.insertAdjacentHTML("beforeend",trashMarkup);
  bindTrash();
  bindRestore();
  dashboard.querySelectorAll("[data-dashboard-project]").forEach(button => button.addEventListener("click", () => selectProject(button.dataset.dashboardProject)));
  dashboard.querySelector("[data-dashboard-action='new-project']")?.addEventListener("click", () => {
    const disclosure = document.querySelector(".project-create-disclosure");
    disclosure.open = true;
    disclosure.scrollIntoView({ behavior: "smooth", block: "center" });
    disclosure.querySelector("input[name='name']")?.focus();
  });
}

function renderProjectList() {
  els.projectCount.textContent = `${state.projects.length} ${state.projects.length === 1 ? "projekt" : "projekter"}`;
  els.projectList.replaceChildren();
  if (!state.projects.length) {
    els.projectList.innerHTML = `<div class="empty-state">Ingen projekter endnu. Opret det første ovenfor.</div>`;
    return;
  }

  const renderProjectButton = (project) => {
    const entry = document.createElement("div");
    entry.className = `project-list-item${project.project_id === state.selectedProjectId ? " active" : ""}`;
    entry.innerHTML = `
      <button type="button" class="project-list-open" data-project-id="${escapeHtml(project.project_id)}" title="Åbn ${escapeHtml(project.name)}">
      <span class="project-list-title"><strong>${escapeHtml(project.name)}</strong><span class="project-status color-${escapeHtml(project.workflow_status_color)}">${escapeHtml(project.workflow_status_id ? project.workflow_status_label : projectStatusLabel(project.status))}</span></span>
      <span>${escapeHtml(project.focus_area || "Intet indsatsområde")} · ${Number(project.application_count)} ansøgninger · ${Number(project.open_task_count)} åbne opgaver</span>
      <small>${project.next_task_due_on ? `Næste frist ${escapeHtml(project.next_task_due_on)}` : "Ingen kommende opgavefrist"}</small>
      </button><button type="button" class="project-list-edit" data-edit-project-id="${escapeHtml(project.project_id)}" title="Rediger projekt" aria-label="Rediger ${escapeHtml(project.name)}">✎</button>`;
    return entry;
  };

  const projectsByFolder = new Map();
  state.projects.forEach((project) => {
    const folderId = project.folder_id || "__none__";
    if (!projectsByFolder.has(folderId)) projectsByFolder.set(folderId, []);
    projectsByFolder.get(folderId).push(project);
  });

  const folders = [...state.projectFolders].sort((a, b) => (Number(a.sort_order) - Number(b.sort_order)) || a.name.localeCompare(b.name, "da"));
  folders.forEach((folder) => {
    const projects = projectsByFolder.get(folder.folder_id) || [];
    const group = document.createElement("section");
    group.className = "project-folder-group";
    group.innerHTML = `<div class="project-folder-heading"><button type="button" class="project-folder-edit" data-edit-folder-id="${escapeHtml(folder.folder_id)}" title="Rediger mappe" aria-label="Rediger mappen ${escapeHtml(folder.name)}"><i class="project-folder-color color-${escapeHtml(folder.color || "gray")}" aria-hidden="true"></i>📁 ${escapeHtml(folder.name)}</button><small>${projects.length} ${projects.length === 1 ? "projekt" : "projekter"}</small></div>`;
    const projectList = document.createElement("div");
    projectList.className = "project-folder-projects";
    if (projects.length) {
      projects.forEach((project) => projectList.append(renderProjectButton(project)));
    } else {
      projectList.innerHTML = `<div class="project-folder-empty">Ingen projekter i mappen endnu.</div>`;
    }
    group.append(projectList);
    els.projectList.append(group);
    projectsByFolder.delete(folder.folder_id);
  });

  const withoutFolder = projectsByFolder.get("__none__") || [];
  if (withoutFolder.length) {
    const group = document.createElement("section");
    group.className = "project-folder-group project-folder-group-unassigned";
    group.innerHTML = `<div class="project-folder-heading"><span>Uden mappe</span><small>${withoutFolder.length} ${withoutFolder.length === 1 ? "projekt" : "projekter"}</small></div>`;
    const projectList = document.createElement("div");
    projectList.className = "project-folder-projects";
    withoutFolder.forEach((project) => projectList.append(renderProjectButton(project)));
    group.append(projectList);
    els.projectList.append(group);
  }
}

function openPortfolioProjectEditor(projectId) {
  const project = state.projects.find((item) => item.project_id === projectId);
  if (!project || !els.portfolioEditDialog) return;
  const form = els.portfolioEditForm;
  form.dataset.editType = "project";
  form.dataset.projectId = project.project_id;
  form.querySelector("#portfolioEditTitle").textContent = "Rediger projekt";
  form.querySelector("[data-open-project]").hidden = false;
  form.querySelector("[data-portfolio-edit-fields]").innerHTML = `
    <label><span>Projektnavn</span><input name="name" required maxlength="160" value="${escapeHtml(project.name)}" /></label>
    <label><span>Status</span><select name="workflow_status_id">${workflowStatusOptions("project", project.workflow_status_id, project.status)}</select></label>
    <label><span>Indsatsområde</span><select name="focus_area"><option value="">Vælg område</option>${["Unge og fællesskaber","Grøn omstilling","Demokratisk deltagelse"].map(area => `<option value="${escapeHtml(area)}" ${project.focus_area === area ? "selected" : ""}>${escapeHtml(area)}</option>`).join("")}</select></label>
    <label><span>Mappe</span><select name="folder_id"><option value="">Uden mappe</option>${state.projectFolders.map(folder => `<option value="${escapeHtml(folder.folder_id)}" ${project.folder_id === folder.folder_id ? "selected" : ""}>${escapeHtml(folder.name)}</option>`).join("")}</select></label>
    <label><span>Ansvarlig</span><select name="owner_member_id"><option value="">Ingen ansvarlig</option>${state.teamMembers.map(member => `<option value="${escapeHtml(member.member_id)}" ${project.owner_member_id === member.member_id ? "selected" : ""}>${escapeHtml(member.display_name)}</option>`).join("")}</select></label>
    <label><span>Budget (DKK)</span><input name="estimated_budget" type="number" min="0" step="1000" value="${escapeHtml(project.estimated_budget ?? "")}" /></label>
    <label><span>Tidsbudget (timer)</span><input name="estimated_hours" type="number" min="0" step="0.5" value="${escapeHtml(project.estimated_hours ?? "")}" /></label>
    <label><span>Start</span><input name="starts_on" type="date" value="${escapeHtml(project.starts_on || "")}" /></label>
    <label><span>Slut</span><input name="ends_on" type="date" value="${escapeHtml(project.ends_on || "")}" /></label>
    <label class="portfolio-edit-description"><span>Beskrivelse</span><textarea name="description" maxlength="5000" rows="3">${escapeHtml(project.description || "")}</textarea></label>`;
  form.querySelector(".portfolio-edit-error").hidden = true;
  els.portfolioEditDialog.showModal();
  form.elements.name.focus();
}

function openPortfolioFolderEditor(folderId) {
  const folder = state.projectFolders.find((item) => item.folder_id === folderId);
  if (!folder || !els.portfolioEditDialog) return;
  const form = els.portfolioEditForm;
  form.dataset.editType = "folder";
  form.dataset.folderId = folder.folder_id;
  form.querySelector("#portfolioEditTitle").textContent = "Rediger mappe";
  form.querySelector("[data-open-project]").hidden = true;
  form.querySelector("[data-portfolio-edit-fields]").innerHTML = `
    <label class="portfolio-edit-full"><span>Mappenavn</span><input name="name" required maxlength="120" value="${escapeHtml(folder.name)}" /></label>
    <input type="hidden" name="parent_folder_id" value="${escapeHtml(folder.parent_folder_id || "")}" />
    <label><span>Farve</span><select name="color">${[["gray","Grå"],["blue","Blå"],["green","Grøn"],["yellow","Gul"],["red","Rød"],["purple","Lilla"]].map(([value,label]) => `<option value="${value}" ${folder.color === value ? "selected" : ""}>${label}</option>`).join("")}</select></label>`;
  form.querySelector(".portfolio-edit-error").hidden = true;
  els.portfolioEditDialog.showModal();
  form.elements.name.focus();
}

async function submitPortfolioEdit(form) {
  const values = Object.fromEntries(new FormData(form));
  const submit = form.querySelector("button[type='submit']");
  const error = form.querySelector(".portfolio-edit-error");
  submit.disabled = true;
  error.hidden = true;
  try {
    if (form.dataset.editType === "project") {
      applyWorkflowStatus(values, "project");
      values.currency = state.projects.find(project => project.project_id === form.dataset.projectId)?.currency || "DKK";
      await projectApi(`/api/projects/${encodeURIComponent(form.dataset.projectId)}`, { method: "PATCH", body: JSON.stringify(values) });
    } else {
      await projectApi(`/api/project-folders/${encodeURIComponent(form.dataset.folderId)}`, { method: "PATCH", body: JSON.stringify(values) });
    }
    els.portfolioEditDialog.close();
    await loadProjects();
    showActionToast(form.dataset.editType === "project" ? "Projektet blev opdateret." : "Mappen blev opdateret.");
  } catch (submitError) {
    error.textContent = submitError.message;
    error.hidden = false;
  } finally {
    submit.disabled = false;
  }
}

function captureProjectTaskFocus(active = document.activeElement) {
  if (!els.projectDetail.contains(active)) return null;
  const node = active.closest("[data-task-node]");
  if (node) return {
    projectId: state.selectedProjectId,
    taskId: node.dataset.taskNode,
    control: active.dataset.taskFocus || (active.matches("button[type='submit']") ? "submit" : null),
    formType: active.form?.dataset.form,
    fieldName: active.name,
  };
  if (active.closest(".task-create-disclosure")) return {
    projectId: state.selectedProjectId,
    createTask: true,
    control: active.matches("button[type='submit']") ? "submit" : null,
    fieldName: active.name,
  };
  return null;
}

function restoreProjectTaskFocus(focus) {
  if (!focus || focus.projectId !== state.selectedProjectId) return;
  const visible = element => {
    if (!element || element.disabled || element.closest("[hidden]") || !element.getClientRects().length) return false;
    for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
      if (ancestor.tagName === "DETAILS" && !ancestor.open && !ancestor.querySelector(":scope > summary")?.contains(element)) return false;
    }
    return true;
  };
  if (focus.createTask) {
    const disclosure = els.projectDetail.querySelector(".task-create-disclosure");
    const form = disclosure?.querySelector("form");
    const field = form?.elements.namedItem(focus.fieldName || "");
    const submit = focus.control === "submit" ? form?.querySelector("button[type='submit']") : null;
    [field, submit, disclosure?.querySelector("summary")].find(visible)?.focus({ preventScroll: true });
    return;
  }
  const node = [...els.projectDetail.querySelectorAll("[data-task-node]")].find(item => item.dataset.taskNode === focus.taskId);
  if (!node) return;
  const controls = [...node.querySelectorAll("[data-task-focus]")].filter(item => item.closest("[data-task-node]") === node);
  const form = [...node.querySelectorAll("form")].find(item => item.dataset.form === focus.formType && item.closest("[data-task-node]") === node);
  const field = focus.fieldName ? form?.elements.namedItem(focus.fieldName) : null;
  const submit = focus.control === "submit" ? form?.querySelector("button[type='submit']") : null;
  const inlineAdd = focus.formType === "subtask" ? [...node.querySelectorAll(".task-inline-add")].find(item => item.dataset.addSubtask === focus.taskId) : null;
  const target = [field, submit, controls.find(item => item.dataset.taskFocus === focus.control && visible(item)), inlineAdd, controls.find(item => item.dataset.taskFocus === "menu"), controls.find(item => item.dataset.taskFocus === "title")].find(visible);
  target?.focus({ preventScroll: true });
}

async function selectProject(projectId) {
  const taskFocus = state.selectedProjectId === projectId ? captureProjectTaskFocus() : null;
  if (state.selectedProjectId !== projectId) state.selectedTeamMemberId = null;
  state.selectedProjectId = projectId;
  state.projectPage = "project";
  document.querySelector(".projects-header").hidden = true;
  els.projectConfigPanel.hidden = true;
  els.projectDashboard.hidden = true;
  document.querySelector(".projects-workspace").hidden = false;
  renderProjectList();
  els.projectDetail.innerHTML = `<div class="empty-state">Indlæser projekt…</div>`;
  try {
    const { project } = await projectApi(`/api/projects/${encodeURIComponent(projectId)}`);
    renderProjectDetail(project);
    restoreProjectTaskFocus(taskFocus);
  } catch (error) {
    els.projectDetail.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
  }
}

function renderProjectDetail(project) {
  const programOptions = [...state.programs]
    .sort((a, b) => `${a.foundation_id} ${a.program_name}`.localeCompare(`${b.foundation_id} ${b.program_name}`, "da"))
    .map((program) => {
      const foundation = state.foundations.find((item) => item.foundation_id === program.foundation_id);
      return `<option value="${escapeHtml(program.program_id)}">${escapeHtml(foundation?.name || program.foundation_id)} — ${escapeHtml(program.program_name)}</option>`;
    }).join("");
  const memberOptions = state.teamMembers
    .map((member) => `<option value="${escapeHtml(member.member_id)}">${escapeHtml(member.display_name)}</option>`)
    .join("");
  const ownerOptions = state.teamMembers
    .map((member) => `<option value="${escapeHtml(member.member_id)}" ${project.owner_member_id === member.member_id ? "selected" : ""}>${escapeHtml(member.display_name)}</option>`)
    .join("");
  const selectedTeamMember = project.members.find((member) => member.member_id === state.selectedTeamMemberId);
  const teamMembers = project.members.length
    ? project.members.map((member) => `<button type="button" class="team-chip team-member-card${selectedTeamMember?.member_id === member.member_id ? " selected" : ""}" data-team-member-id="${escapeHtml(member.member_id)}" data-member-name="${escapeHtml(member.display_name)}" data-member-role="${escapeHtml(projectRoleLabel(member.role))}" data-member-email="${escapeHtml(member.email || "Ingen email registreret")}">
        <strong>${escapeHtml(member.display_name)}</strong>
        <small>${escapeHtml(projectRoleLabel(member.role))}</small>
        <span>${escapeHtml(member.email || "Se detaljer")}</span>
      </button>`).join("")
    : `<span class="team-empty">Intet team tilknyttet</span>`;
  const selectedTeamMemberDetails = selectedTeamMember
    ? `<div class="team-member-detail"><strong>${escapeHtml(selectedTeamMember.display_name)}</strong><span>${escapeHtml(projectRoleLabel(selectedTeamMember.role))}</span><small>${escapeHtml(selectedTeamMember.email || "Ingen email registreret")}</small></div>`
    : `<div class="team-member-detail empty">Klik på et teamkort for at se detaljer.</div>`;
  const folderOptions = state.projectFolders.map((folder) => `<option value="${escapeHtml(folder.folder_id)}" ${folder.folder_id === project.folder_id ? "selected" : ""}>${escapeHtml(folder.name)}</option>`).join("");
  const applications = project.applications.length
    ? project.applications.map((application) => {
        const deadlineOptions = state.deadlines
          .filter((deadline) => deadline.program_id === application.program_id)
          .map((deadline) => `<option value="${escapeHtml(deadline.deadline_id)}" ${deadline.deadline_id === application.deadline_id ? "selected" : ""}>${escapeHtml(deadline.closes_on || deadline.summary || "Løbende/ukendt frist")}</option>`)
          .join("");
        return `
        <form class="application-card application-edit-form" data-form="application-edit" data-application-id="${escapeHtml(application.application_id)}">
          <div class="application-identity"><strong>${escapeHtml(application.foundation_name)}</strong><span>${escapeHtml(application.program_name)}</span></div>
          <label><span>Status</span><select name="workflow_status_id">
            ${workflowStatusOptions("application", application.workflow_status_id, application.status)}
          </select></label>
          <label><span>Deadline</span><select name="deadline_id"><option value="">Ingen konkret frist</option>${deadlineOptions}</select></label>
          <label><span>Ansøgt</span><input name="requested_amount" type="number" min="0" step="1000" value="${escapeHtml(application.requested_amount ?? "")}" /></label>
          <label><span>Bevilget</span><input name="awarded_amount" type="number" min="0" step="1000" value="${escapeHtml(application.awarded_amount ?? "")}" /></label>
          <label><span>Indsendt</span><input name="submitted_on" type="date" value="${escapeHtml(application.submitted_on || "")}" /></label>
          <label><span>Forventet svar</span><input name="decision_expected_on" type="date" value="${escapeHtml(application.decision_expected_on || "")}" /></label>
          <button class="mini-button approve" type="submit">Gem</button>
        </form>`;
      }).join("")
    : `<div class="empty-state compact">Ingen puljer tilknyttet endnu.</div>`;
  const tasksByParent = new Map();
  project.tasks.forEach((task) => {
    const parentId = task.parent_task_id || "root";
    if (!tasksByParent.has(parentId)) tasksByParent.set(parentId, []);
    tasksByParent.get(parentId).push(task);
  });
  const assigneeOptions = (selectedId) => `<option value="">Ingen ansvarlig</option>${state.teamMembers.map((member) =>
    `<option value="${escapeHtml(member.member_id)}" ${selectedId === member.member_id ? "selected" : ""}>${escapeHtml(member.display_name)}</option>`).join("")}`;
  const renderTask = (task, depth = 0) => {
    const children = tasksByParent.get(task.task_id) || [];
    const completedChildren = children.filter((child) => child.status === "done").length;
    const expanded = state.expandedTaskId === task.task_id;
    const composerOpen = state.subtaskComposerTaskId === task.task_id;
    const childrenExpanded = !state.collapsedTaskIds.has(task.task_id);
    const taskId = escapeHtml(task.task_id);
    const taskTitle = escapeHtml(task.title);
    const icon = name => `<img src="frontend/icons/${name}.svg" alt="" aria-hidden="true" />`;
    return `<div class="project-task-node depth-${Math.min(depth, 4)}" data-task-node="${taskId}" style="--task-depth:${Math.min(depth, 4)}">
      <article class="project-task status-${escapeHtml(task.status)} ${task.status === "done" ? "done" : ""}" aria-label="${depth ? "Underopgave" : "Opgave"}: ${taskTitle}">
        <div class="task-cell task-cell-check">
          <button type="button" class="task-complete-button ${task.status === "done" ? "is-complete" : ""}" data-task-focus="complete" data-task-status-id="${taskId}" data-next-status="${task.status === "done" ? "todo" : "done"}" aria-pressed="${task.status === "done"}" aria-label="${task.status === "done" ? "Genåbn" : "Færdigmeld"} ${taskTitle}" title="${task.status === "done" ? "Genåbn" : "Markér færdig"}"><span aria-hidden="true">${icon("check")}</span></button>
        </div>
        <div class="task-cell task-cell-name">
          ${children.length ? `<button type="button" class="task-children-toggle" data-task-focus="children" data-task-children-toggle="${taskId}" aria-expanded="${childrenExpanded}" aria-controls="task-children-${taskId}" aria-label="${childrenExpanded ? "Skjul" : "Vis"} underopgaver til ${taskTitle}">${icon("chevron-right")}</button>` : `<span class="task-toggle-spacer" aria-hidden="true"></span>`}
          <button class="project-task-title" type="button" data-task-focus="title" data-task-toggle-id="${taskId}" aria-expanded="${expanded}" aria-controls="task-details-${taskId}" title="Åbn og rediger opgaven">
            <span class="task-title-copy"><strong>${taskTitle}</strong>${children.length ? `<span class="task-progress-summary"><progress value="${completedChildren}" max="${children.length}" aria-label="Færdige underopgaver til ${taskTitle}"></progress><span class="task-subcount">${completedChildren} af ${children.length} færdige</span></span>` : ""}</span>
          </button>
        </div>
        <div class="task-cell task-cell-person"><span class="task-mobile-label">Ansvarlig</span><span class="task-avatar ${task.assignee_name ? "" : "is-unassigned"}" aria-hidden="true">${task.assignee_name ? escapeHtml(task.assignee_name.trim().split(/\s+/).slice(0,2).map(part=>part[0]).join("").toUpperCase()) : "—"}</span><select class="task-person-select" data-task-focus="assignee" data-task-assignee-id="${taskId}" aria-label="Ansvarlig for ${taskTitle}">${assigneeOptions(task.assigned_to)}</select></div>
        <div class="task-cell task-cell-status"><span class="task-mobile-label">Status</span><select class="task-status-select status-${escapeHtml(task.status)}" data-task-focus="status" data-task-workflow-id="${taskId}" aria-label="Status for ${taskTitle}">${workflowStatusOptions("task", task.workflow_status_id, task.status)}</select></div>
        <div class="task-cell task-cell-date"><span class="task-mobile-label">Frist</span><button type="button" class="task-date-button" data-task-focus="date" data-task-edit-date="${taskId}" aria-label="Rediger frist for ${taskTitle}" title="${escapeHtml(task.due_on || "Tilføj frist")}">${icon("calendar")}<span class="task-due-label">${task.due_on ? escapeHtml(new Date(task.due_on + "T12:00:00").toLocaleDateString("da-DK",{day:"numeric",month:"short"})) : "Ingen frist"}</span></button></div>
        <div class="task-cell task-cell-actions"><details class="task-row-menu"><summary data-task-focus="menu" aria-label="Flere handlinger for ${taskTitle}" title="Flere handlinger">${icon("more-vertical")}</summary><div class="task-row-menu-items"><button type="button" data-task-toggle-id="${taskId}" aria-controls="task-details-${taskId}" aria-expanded="${expanded}">Rediger opgave</button><button type="button" data-add-subtask="${taskId}" aria-expanded="${composerOpen}" aria-controls="task-subtask-${taskId}">Tilføj underopgave</button></div></details></div>
      </article>
      <div id="task-details-${escapeHtml(task.task_id)}" class="task-details ${expanded ? "is-open" : ""}" ${expanded ? "" : "hidden"}>
        <form data-form="task-edit" data-task-id="${escapeHtml(task.task_id)}" class="task-edit-form">
          <label>Opgave<input name="title" required maxlength="240" value="${escapeHtml(task.title)}" /></label>
          <label>Beskrivelse<textarea name="description" maxlength="5000" rows="3" placeholder="Hvad skal laves?">${escapeHtml(task.description || "")}</textarea></label>
          <label>Frist<input name="due_on" type="date" value="${escapeHtml(task.due_on || "")}" /></label>
          <button class="mini-button approve" type="submit">Gem opgave</button>
        </form>
      </div>
      <div id="task-subtask-${escapeHtml(task.task_id)}" class="task-subtask-composer" ${composerOpen ? "" : "hidden"}>
        <form class="subtask-form" data-form="subtask">
          <input type="hidden" name="parent_task_id" value="${escapeHtml(task.task_id)}" />
          <div class="task-subtask-composer-heading"><strong>Ny underopgave</strong><span>Under: ${escapeHtml(task.title)}</span></div>
          <div class="task-quick-add-row">
            <input name="title" data-subtask-title required maxlength="240" placeholder="Hvad skal gøres?" aria-label="Underopgavens navn" />
            <select name="assigned_to" aria-label="Ansvarlig for underopgaven">${assigneeOptions("")}</select>
            <button class="mini-button approve" type="submit">Tilføj underopgave</button>
          </div>
          <details class="task-extra-options"><summary>Beskrivelse og flere valg</summary><div><label class="task-description-input">Beskrivelse<textarea name="description" maxlength="5000" rows="2" placeholder="Hvad skal laves?"></textarea></label>
            <select name="workflow_status_id" aria-label="Underopgavens status">${workflowStatusOptions("task", null, "todo")}</select>
            <select name="priority" aria-label="Underopgavens prioritet"><option value="medium">Mellem prioritet</option><option value="high">Høj prioritet</option><option value="urgent">Haster</option><option value="low">Lav prioritet</option></select>
            <label><span>Frist</span><input name="due_on" type="date" /></label>
          </div></details>
        </form>
      </div>
      ${children.length ? `<div class="task-children" id="task-children-${taskId}" ${childrenExpanded ? "" : "hidden"}>${children.map(child=>renderTask(child,depth+1)).join("")}<button type="button" class="task-inline-add" data-add-subtask="${taskId}" aria-expanded="${composerOpen}" aria-controls="task-subtask-${taskId}">${icon("plus")}<span>Tilføj underopgave</span></button></div>` : ""}
    </div>`;

  };
  const tasks = project.tasks.length
    ? (tasksByParent.get("root") || []).map((task) => renderTask(task)).join("")
    : `<p class="task-empty-hint">Ingen opgaver endnu. Opret den første med “Ny opgave”.</p>`;
  const documents = project.documents?.length
    ? project.documents.map((document) => `<a class="project-document" href="${escapeHtml(document.document_url)}" target="_blank" rel="noopener noreferrer"><span>${escapeHtml(documentTypeLabel(document.document_type))}</span><strong>${escapeHtml(document.title)}</strong><small>Åbn dokument ↗</small></a>`).join("")
    : `<div class="empty-state compact">Ingen dokumentlinks endnu.</div>`;
  const mentionMembers = project.members.map((member) => `<button type="button" data-mention-member="${escapeHtml(member.member_id)}" data-mention-name="${escapeHtml(member.display_name)}">@${escapeHtml(member.display_name)}</button>`).join("");
  const comments = project.comments?.length
    ? project.comments.map((comment) => `<article class="project-comment"><div class="project-comment-meta"><strong>${escapeHtml(comment.author_name || "Ukendt afsender")}</strong><time>${comment.created_at ? escapeHtml(new Date(comment.created_at.replace(" ","T") + "Z").toLocaleString("da-DK",{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit",timeZone:"Europe/Copenhagen"})) : ""}</time></div><p>${escapeHtml(comment.body).replace(/\n/g, "<br>")}</p>${comment.mentions?.length ? `<small>Nævnt: ${comment.mentions.map((mention) => "@" + escapeHtml(mention.display_name)).join(", ")}</small>` : ""}</article>`).join("")
    : `<div class="empty-state compact">Ingen kommentarer endnu.</div>`;

  const doneCount = project.tasks.filter(task => task.status === "done").length;
  const progress = project.tasks.length ? Math.round(doneCount / project.tasks.length * 100) : 0;
  const dateLabel = value => value ? new Date(value + "T12:00:00").toLocaleDateString("da-DK", { day:"numeric", month:"short", year:"numeric" }) : "Ikke angivet";
  const fundNames = [...new Set(project.applications.map(application => application.foundation_name))];
  els.projectDetail.innerHTML = `
    <div class="project-detail-topline"><button type="button" class="project-back-link" data-project-dashboard-back>← Alle projekter</button><span class="project-workspace-label">Jeres fælles arbejdsrum</span></div>
    <header class="project-detail-header">
      <div class="project-title-group" data-project-initial="${escapeHtml(project.name.slice(0,1).toUpperCase())}"><p class="section-kicker">${escapeHtml(project.focus_area || "Projekt")}</p><h2>${escapeHtml(project.name)}</h2>${project.description ? `<p>${escapeHtml(project.description)}</p>` : ""}</div>
      <div class="project-header-actions">
        <select data-project-workflow-id="${escapeHtml(project.project_id)}" aria-label="Projektstatus">${workflowStatusOptions("project",project.workflow_status_id,project.status)}</select>
        <button class="button-link" type="button" data-project-open-section="comments">+ Opdatering</button>
        <details class="project-actions-menu"><summary aria-label="Flere projekthandlinger">•••</summary><div><button type="button" aria-label="Rediger projekt" data-project-edit>Rediger projekt</button><button type="button" aria-label="Slet projekt" data-project-delete>Slet projekt</button></div></details>
      </div>
    </header>
    <div class="project-facts">
      <div><span>Periode</span><strong>${project.starts_on || project.ends_on ? `${escapeHtml(dateLabel(project.starts_on))} – ${escapeHtml(dateLabel(project.ends_on))}` : "Ikke planlagt"}</strong></div>
      <div><span>Budget</span><strong>${formatAmount(project.estimated_budget, project.currency)}${project.estimated_hours != null ? ` <small>· ${Number(project.estimated_hours)} timer</small>` : ""}</strong></div>
      <div><span>Team · ${project.members.length}</span><strong>${escapeHtml(project.members.map(member=>member.display_name).join(", ") || project.owner_name || "Tilføj team")}</strong></div>
      <div><span>Fond</span><strong>${escapeHtml(fundNames.join(", ") || "Vælg fond")}</strong></div>
    </div>
    <div class="project-progress"><progress value="${doneCount}" max="${project.tasks.length || 1}" aria-label="Færdige opgaver"></progress><span>${doneCount} af ${project.tasks.length} opgaver færdige · ${progress}%</span></div>
    <div class="project-delete-confirm" hidden><strong>Slet dette projekt?</strong><p>Projektet fjernes fra oversigten. Du kan gendanne det via “Fortryd”.</p><button class="mini-button" type="button" data-project-delete-cancel>Annuller</button><button class="mini-button danger-button" type="button" data-project-delete-confirm>Slet projekt</button></div>
    <form class="project-settings-form" data-form="project-settings">
      <label><span>Navn</span><input name="name" required maxlength="160" value="${escapeHtml(project.name)}" /></label>
      <label><span>Status</span><select name="workflow_status_id">
        ${workflowStatusOptions("project", project.workflow_status_id, project.status)}
      </select></label>
      <label><span>Indsatsområde</span><select name="focus_area"><option value="">Vælg område</option>${["Unge og fællesskaber","Grøn omstilling","Demokratisk deltagelse"].map(area=>`<option value="${escapeHtml(area)}" ${project.focus_area===area?"selected":""}>${escapeHtml(area)}</option>`).join("")}</select></label>
      <label><span>Mappe</span><select name="folder_id"><option value="">Ingen mappe</option>${folderOptions}</select></label>
      <label><span>Ansvarlig</span><select name="owner_member_id"><option value="">Ingen ansvarlig</option>${ownerOptions}</select></label>
      <label><span>Budget (DKK)</span><input name="estimated_budget" type="number" min="0" step="1000" value="${escapeHtml(project.estimated_budget ?? "")}" /></label>
      <label><span>Tidsbudget (timer)</span><input name="estimated_hours" type="number" min="0" step="0.5" value="${escapeHtml(project.estimated_hours ?? "")}" /></label>
      <label><span>Start</span><input name="starts_on" type="date" value="${escapeHtml(project.starts_on || "")}" /></label>
      <label><span>Slut</span><input name="ends_on" type="date" value="${escapeHtml(project.ends_on || "")}" /></label>
      <label class="project-settings-description"><span>Beskrivelse</span><input name="description" maxlength="5000" value="${escapeHtml(project.description || "")}" /></label>
      <button class="mini-button approve" type="submit">Gem projekt</button>
    </form>
    <section class="project-team-panel">
      <div class="team-summary"><strong>Team</strong><div class="team-chips">${teamMembers}</div>${selectedTeamMemberDetails}</div>
      <form class="team-inline-form" data-form="team-create">
        <input name="display_name" required maxlength="160" placeholder="Nyt teammedlem" />
        <input name="email" type="email" placeholder="Email (valgfri)" />
        <select name="role"><option value="contributor">Partner</option><option value="lead">Projektleder</option><option value="marketing">Marketing</option><option value="project_manager">Projektmanager</option><option value="reviewer">Reviewer</option><option value="custom">Anden rolle</option></select>
        <input name="custom_role" maxlength="80" placeholder="Egen rolle (valgfri)" />
        <button class="mini-button" type="submit">Opret og tilføj</button>
      </form>
      <form class="team-inline-form" data-form="team-add">
        <select name="member_id" required><option value="">Tilføj eksisterende</option>${memberOptions}</select>
        <select name="role"><option value="contributor">Partner</option><option value="lead">Projektleder</option><option value="marketing">Marketing</option><option value="project_manager">Projektmanager</option><option value="reviewer">Reviewer</option><option value="custom">Anden rolle</option></select>
        <input name="custom_role" maxlength="80" placeholder="Egen rolle (valgfri)" />
        <button class="mini-button" type="submit">Tilføj</button>
      </form>
    </section>
    <div class="project-columns">
      <section>
        <div class="section-heading"><h3>Fondsansøgninger</h3><span>${project.applications.length}</span></div>
        <div class="application-list">${applications}</div>
        <form class="inline-project-form" data-form="application">
          <select name="program_id" required><option value="">Vælg pulje</option>${programOptions}</select>
          <select name="deadline_id" disabled><option value="">Vælg først pulje</option></select>
          <select name="workflow_status_id">${workflowStatusOptions("application", null, "candidate")}</select>
          <input name="requested_amount" type="number" min="0" step="1000" placeholder="Ansøgt beløb" />
          <button class="mini-button approve" type="submit">Tilknyt pulje</button>
        </form>
      </section>
      <section>
        <div class="section-heading task-section-heading"><div><h3>Opgaver</h3><p class="task-list-hint">Et klart overblik over hvem, hvad og hvornår.</p></div><div class="task-section-actions"><span>${project.tasks.filter((task) => task.status !== "done").length} åbne</span></div></div>
        <div class="task-board task-groups" role="region" aria-label="Projektets opgaver" tabindex="0">
          <div class="project-task-list">${tasks}</div>
        </div>
        <form class="task-main-add-form" data-form="task">
          <div class="task-main-add-heading"><strong>Ny opgave</strong></div>
          <div class="task-quick-add-row">
            <input name="title" required maxlength="240" placeholder="Hvad skal gøres?" aria-label="Navn på hovedopgave" />
            <select name="assigned_to" aria-label="Ansvarlig for hovedopgaven"><option value="">Ingen ansvarlig</option>${memberOptions}</select>
            <button class="mini-button approve" type="submit">Tilføj opgave</button>
          </div>
          <details class="task-extra-options"><summary>Beskrivelse og flere valg</summary><div><label class="task-description-input">Beskrivelse<textarea name="description" maxlength="5000" rows="2" placeholder="Hvad skal laves?"></textarea></label>
            <select name="workflow_status_id" aria-label="Hovedopgavens status">${workflowStatusOptions("task", null, "todo")}</select>
            <select name="priority" aria-label="Hovedopgavens prioritet"><option value="medium">Mellem prioritet</option><option value="high">Høj prioritet</option><option value="urgent">Haster</option><option value="low">Lav prioritet</option></select>
            <label><span>Frist</span><input name="due_on" type="date" /></label>
          </div></details>
        </form>
      </section>
    </div>
    <section class="project-documents-panel">
      <div class="section-heading"><h3>Dokumenter</h3><span>${project.documents?.length || 0}</span></div>
      <div class="project-document-list">${documents}</div>
      <form class="inline-project-form document-form" data-form="document">
        <input name="title" required maxlength="240" placeholder="Dokumentets titel" />
        <input name="document_url" type="url" required placeholder="https://docs.google.com/…" />
        <select name="document_type"><option value="google_doc">Google Docs</option><option value="google_sheet">Google Sheets</option><option value="google_slide">Google Slides</option><option value="other">Andet link</option></select>
        <button class="mini-button approve" type="submit">Tilknyt dokument</button>
      </form>
    </section>
    <section class="project-comments-panel">
      <div class="section-heading"><h3>Opdateringer</h3><span>${project.comments?.length || 0}</span></div>
      <div class="project-comment-list">${comments}</div>
      <form class="project-comment-form" data-form="comment">
        <textarea name="body" data-mention-input required maxlength="4000" rows="3" aria-label="Opdatering til teamet" placeholder="Del nyt med teamet. Skriv @ for at nævne en person…"></textarea>
        <div class="project-comment-form-row">
          <select name="author_member_id" required><option value="">Vælg afsender</option>${memberOptions}</select>
          <button class="mini-button approve" type="submit">Del opdatering</button>
        </div>
        <div class="mention-suggestions" data-mention-suggestions hidden>${mentionMembers}</div>
        <small>Skriv @ for at nævne en person fra projektets team.</small>
      </form>
    </section>`;
  const sender = state.teamMembers.find(member => member.email && member.email.toLowerCase() === state.auth.user?.email?.toLowerCase());
  if (sender) {
    const author = els.projectDetail.querySelector('[name="author_member_id"]');
    author.value = sender.member_id;
  }
  simplifyProjectWorkspace(project);
}

function simplifyProjectWorkspace(project) {
  const root = els.projectDetail;
  const wrapForm = (form, label) => {
    if (!form) return;
    const details = document.createElement("details");
    details.className = "project-disclosure";
    const summary = document.createElement("summary");
    summary.textContent = label;
    form.before(details);
    details.append(summary, form);
  };
  const settings = root.querySelector(".project-settings-form");
  const overview = document.createElement("section");
  overview.innerHTML = `<div class="section-heading"><h3>Om projektet</h3><span>Detaljer, finansiering og team</span></div>`;
  overview.append(settings);
  wrapForm(settings, "Rediger projektoplysninger");
  const columns = root.querySelector(".project-columns");
  overview.append(columns.children[0], root.querySelector(".project-team-panel"), root.querySelector(".project-documents-panel"));
  const sections = [
    ["tasks", "Opgaver", columns.children[0]],
    ["overview", "Om projektet", overview],
    ["comments", "Opdateringer", root.querySelector(".project-comments-panel")],
  ];
  const nav = document.createElement("div");
  nav.className = "project-section-tabs";
  nav.setAttribute("role", "tablist");
  nav.setAttribute("aria-label", "Projektets sektioner");
  root.querySelector(".project-progress").after(nav);
  const activeKey = state.projectSectionProjectId === project.project_id ? state.projectSection || "tasks" : "tasks";
  const activate = (key) => {
    state.projectSection = key;
    state.projectSectionProjectId = project.project_id;
    sections.forEach(([id, , panel]) => {
      panel.hidden = id !== key;
      const button = nav.querySelector(`[data-section="${id}"]`);
      button.setAttribute("aria-selected", String(id === key));
      button.tabIndex = id === key ? 0 : -1;
    });
  };
  sections.forEach(([id, label, panel]) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.dataset.section = id;
    button.id = `project-tab-${id}`;
    button.setAttribute("role", "tab");
    button.setAttribute("aria-controls", `project-panel-${id}`);
    panel.id = `project-panel-${id}`;
    panel.classList.add("project-section-panel");
    panel.setAttribute("role", "tabpanel");
    panel.setAttribute("aria-labelledby", button.id);
    nav.append(button);
    root.append(panel);
    button.addEventListener("click", () => activate(id));
  });
  nav.addEventListener("keydown", (event) => {
    const buttons = [...nav.children];
    let index = buttons.indexOf(document.activeElement);
    if (index < 0 || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    index = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + buttons.length) % buttons.length;
    buttons[index].click();
    buttons[index].focus();
  });
  columns.remove();
  for (const [type, label] of [["application", "+ Tilknyt pulje"], ["team-create", "+ Opret teammedlem"], ["team-add", "+ Tilføj eksisterende medlem"], ["document", "+ Tilknyt dokument"]]) {
    wrapForm(root.querySelector(`[data-form="${type}"]`), label);
  }
  root.querySelectorAll(".application-edit-form").forEach(form => {
    const identity = form.querySelector(".application-identity");
    wrapForm(form, "");
    const summary = form.parentElement.querySelector("summary");
    summary.append(identity);
    const hint = document.createElement("small");
    hint.textContent = "Se og rediger ansøgning";
    summary.append(hint);
  });
  root.querySelectorAll("[data-project-open-section]").forEach(button => button.addEventListener("click", () => {
    activate(button.dataset.projectOpenSection);
    root.querySelector("[data-mention-input]")?.focus();
  }));
  root.querySelector("[data-project-edit]").addEventListener("click", () => {
    activate("overview");
    settings.parentElement.open = true;
    settings.elements.name.focus();
  });
  const taskForm = root.querySelector(".task-main-add-form");
  const taskCreate = document.createElement("details");
  taskCreate.className = "task-create-disclosure";
  taskCreate.open = state.newTaskComposerProjectId === project.project_id;
  taskCreate.innerHTML = `<summary><img src="frontend/icons/plus.svg" alt="" aria-hidden="true" /><span>Ny opgave</span></summary>`;
  root.querySelector(".task-section-actions").append(taskCreate);
  taskCreate.append(taskForm);
  taskCreate.addEventListener("toggle", () => {
    if (taskCreate.open) state.newTaskComposerProjectId = project.project_id;
    else if (state.newTaskComposerProjectId === project.project_id) state.newTaskComposerProjectId = null;
  });
  taskCreate.querySelector("summary").addEventListener("click", () => {
    requestAnimationFrame(() => {
      if (taskCreate.open) taskForm.elements.title.focus();
    });
  });
  activate(sections.some(([id]) => id === activeKey) ? activeKey : "tasks");
}

async function submitProjectForm(form) {
  const values = applyWorkflowStatus(Object.fromEntries(new FormData(form)), "project");
  const application = {
    program_id: values.program_id,
    deadline_id: values.deadline_id,
    workflow_status_id: values.application_workflow_status_id,
    requested_amount: values.requested_amount,
    awarded_amount: values.awarded_amount,
    submitted_on: values.submitted_on,
  };
  if (application.program_id) {
    applyWorkflowStatus(application, "application");
    values.initial_application = application;
  } else if (application.requested_amount || application.awarded_amount || application.submitted_on) {
    throw new Error("Vælg fond og pulje for at gemme ansøgningsoplysninger.");
  }
  for (const field of ["program_id","deadline_id","application_workflow_status_id","requested_amount","awarded_amount","submitted_on"]) delete values[field];
  const payload = await projectApi("/api/projects", { method: "POST", body: JSON.stringify(values) });
  form.reset();
  state.selectedProjectId = payload.project.project_id;
  state.projectPage = "project";
  await loadProjects();
  showActionToast("Projektet blev oprettet.");
}

async function submitProjectDetailForm(form) {
  const values = Object.fromEntries(new FormData(form));
  values.project_id = state.selectedProjectId;
  const formType = form.dataset.form;
  let message = "Ændringerne blev gemt.";
  if (formType === "task-edit") {
    await projectApi(`/api/tasks/${encodeURIComponent(form.dataset.taskId)}`, { method: "PATCH", body: JSON.stringify(values) });
    message = "Opgaven blev gemt.";
  } else if (formType === "project-settings") {
    applyWorkflowStatus(values, "project");
    await projectApi(`/api/projects/${encodeURIComponent(state.selectedProjectId)}`, { method: "PATCH", body: JSON.stringify(values) });
    message = "Projektet blev opdateret.";
  } else if (formType === "team-create") {
    const role = values.role === "custom" ? values.custom_role?.trim() : values.role;
    delete values.custom_role;
    values.role = role || "contributor";
    const { member } = await projectApi("/api/team-members", { method: "POST", body: JSON.stringify(values) });
    await projectApi(`/api/projects/${encodeURIComponent(state.selectedProjectId)}/members`, {
      method: "POST",
      body: JSON.stringify({ member_id: member.member_id, role: values.role }),
    });
    message = "Teammedlemmet blev oprettet og tilføjet.";
  } else if (formType === "team-add") {
    values.role = values.role === "custom" ? values.custom_role?.trim() : values.role;
    delete values.custom_role;
    await projectApi(`/api/projects/${encodeURIComponent(state.selectedProjectId)}/members`, { method: "POST", body: JSON.stringify(values) });
    message = "Teammedlemmet blev tilføjet.";
  } else if (formType === "application-edit") {
    applyWorkflowStatus(values, "application");
    await projectApi(`/api/applications/${encodeURIComponent(form.dataset.applicationId)}`, { method: "PATCH", body: JSON.stringify(values) });
    message = "Ansøgningen blev opdateret.";
  } else if (formType === "application") {
    applyWorkflowStatus(values, "application");
    await projectApi("/api/applications", { method: "POST", body: JSON.stringify(values) });
    message = "Puljen blev tilknyttet projektet.";
  } else if (formType === "document") {
    await projectApi("/api/project-documents", { method: "POST", body: JSON.stringify(values) });
    message = "Dokumentet blev tilknyttet.";
  } else if (formType === "comment") {
    values.mentioned_member_ids = [...form.querySelectorAll("[data-mention-member]")].filter((button) => values.body.includes("@" + button.dataset.mentionName)).map((button) => button.dataset.mentionMember);
    await projectApi("/api/project-comments", { method: "POST", body: JSON.stringify(values) });
    message = "Kommentaren blev tilføjet.";
  } else {
    applyWorkflowStatus(values, "task");
    await projectApi("/api/tasks", { method: "POST", body: JSON.stringify(values) });
    if (formType === "subtask") { state.subtaskComposerTaskId = null; state.collapsedTaskIds.delete(values.parent_task_id); }
    else if (formType === "task") state.newTaskComposerProjectId = null;
    message = formType === "subtask" ? "Underopgaven blev tilføjet." : "Hovedopgaven blev tilføjet.";
  }
  await loadProjects();
  showActionToast(message);
}

function updateApplicationDeadlineOptions(form) {
  const programId = form.elements.program_id.value;
  const select = form.elements.deadline_id;
  const deadlines = state.deadlines.filter((deadline) => deadline.program_id === programId);
  select.disabled = !programId;
  select.innerHTML = `<option value="">${programId ? "Ingen konkret frist" : "Vælg først pulje"}</option>`;
  deadlines.forEach((deadline) => {
    const option = document.createElement("option");
    option.value = deadline.deadline_id;
    option.textContent = deadline.closes_on || deadline.summary || "Løbende/ukendt frist";
    select.append(option);
  });
}

async function decideScrapeChange(row, button) {
  const note = row.querySelector(".review-note")?.value?.trim() || "";
  button.disabled = true;
  setPageLoading(true);
  try {
    const response = await fetch("/api/scrape/changes/decide", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ change_id: row.dataset.changeId, decision: button.dataset.action, note }),
    });
    const payload = await response.json();
    if (!response.ok || !payload.ok) throw new Error(payload.message || "Beslutning fejlede");
    await Promise.all([loadScrapeChanges(), loadApprovedScrapeFields()]);
    setScrapeStatus(button.dataset.action === "approve"
      ? "Ændringen blev godkendt og gemt som et kildebelagt scraperfelt."
      : "Ændringen blev afvist.");
  } catch (error) {
    setScrapeStatus(`Beslutning fejlede: ${error.message}`, true);
    button.disabled = false;
  } finally {
    setPageLoading(false);
  }
}

async function init() {
  window.WorkspaceShell?.init(state.auth);
  setupFilePreviewLauncher();
  state.activeTab = loadJson("fondsdb.activeTab", "fonde");
  state.favorites = new Set(loadJson("fondsdb.favorites", []));
  state.alertSettings = {
    ...state.alertSettings,
    ...loadJson("fondsdb.alertSettings", {}),
  };

  const [foundationResponse, programResponse, eligibilityResponse, applicantResponse, exclusionResponse, deadlineResponse, scanResponse] = await Promise.all([
    fetch("data/fonde_seed.csv"),
    fetch("data/programs_seed.csv"),
    fetch("data/program_eligibility_seed.csv"),
    fetch("data/program_applicants_seed.csv"),
    fetch("data/program_exclusions_seed.csv"),
    fetch("data/deadlines_seed.csv"),
    fetch("data/call_scan_results.csv"),
  ]);

  state.foundations = csvToObjects(await foundationResponse.text());
  state.programs = csvToObjects(await programResponse.text());
  state.programEligibility = csvToObjects(await eligibilityResponse.text());
  state.programApplicants = csvToObjects(await applicantResponse.text());
  state.programExclusions = csvToObjects(await exclusionResponse.text());
  state.deadlines = csvToObjects(await deadlineResponse.text());
  state.callScanResults = scanResponse.ok ? csvToObjects(await scanResponse.text()) : [];
  await loadScanReviews().catch((error) => {
    console.warn(error);
    showActionToast("Reviewstatus kunne ikke hentes fra databasen.", true);
  });
  await loadProjects().catch((error) => {
    console.warn(error);
    if (state.auth.authenticated) renderProjectLoadError(error);
    else {
      renderAuthPanel();
      els.projectList.innerHTML = `<div class="empty-state">Projektmodulet kunne ikke indlæses.</div>`;
    }
  });
  rebuildOpportunities();
  state.selectedId = state.opportunities[0]?.program.program_id || null;

  renderSummary();
  renderFilterOptions();
  buildAlerts();
  applyFilters();
  renderAlerts();
  renderReview();
  renderFavoriteList();
  renderDataHealth();
  switchTab(state.activeTab);
  persistKnownState();

  els.tabButtons.forEach((button) => {
    button.addEventListener("click", () => switchTab(button.dataset.tab));
  });

  [els.searchInput, els.areaFilter, els.applicantFilter, els.deadlineFilter, els.statusFilter].forEach((control) => {
    control.addEventListener("input", applyFilters);
  });

  [els.emailInput, els.deadlineAlertToggle, els.newFoundationAlertToggle, els.newCallAlertToggle, els.favoriteUpdateAlertToggle].forEach((control) => {
    control.addEventListener("input", persistAlertSettings);
  });

  [els.reviewStatusFilter, els.reviewQualityFilter].forEach((control) => {
    control.addEventListener("input", renderReview);
  });

  els.emailDigestButton.addEventListener("click", openEmailDigest);

  els.projectAuthPanel.addEventListener("click", async (event) => {
    const logout = event.target.closest("[data-auth-logout]"); if (!logout) return;
    await fetch("/api/auth/logout", { method: "POST" });
    state.auth = { authenticated: false, setupRequired: false, user: null };
    renderAuthPanel();
    els.projectList.innerHTML = `<div class="empty-state">Log ind for at se projektporteføljen.</div>`;
  });

  els.projectAuthPanel.addEventListener("submit", async (event) => {
    const form = event.target.closest("[data-auth-form]"); if (!form) return;
    event.preventDefault(); const error = form.closest(".project-auth-card").querySelector("[data-auth-error]");
    try {
      const response = await fetch(`/api/auth/${form.dataset.authForm}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(Object.fromEntries(new FormData(form))) });
      const payload = await response.json(); if (!response.ok || !payload.ok) throw new Error(payload.message || "Login fejlede");
      state.auth = { authenticated: true, setupRequired: false, user: payload.user };
    } catch (errorValue) { error.hidden = false; error.textContent = errorValue.message; return; }
    window.WorkspaceShell?.syncAuth(state.auth);
    window.WorkspaceShell?.closeAccount();
    try {
      await loadProjects();
      showActionToast("Du er logget ind.");
    } catch (loadError) {
      renderProjectLoadError(loadError);
    }
  });

  els.projectCreateForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = event.currentTarget.querySelector("button[type='submit']");
    button.disabled = true;
    try {
      await submitProjectForm(event.currentTarget);
    } catch (error) {
      showActionToast(error.message, true);
    } finally {
      button.disabled = false;
    }
  });
  els.projectCreateForm.elements.program_id.addEventListener("change", () => updateApplicationDeadlineOptions(els.projectCreateForm));

  els.projectList.addEventListener("click", (event) => {
    const projectEditButton = event.target.closest("[data-edit-project-id]");
    if (projectEditButton) {
      openPortfolioProjectEditor(projectEditButton.dataset.editProjectId);
      return;
    }
    const folderButton = event.target.closest("[data-edit-folder-id]");
    if (folderButton) {
      openPortfolioFolderEditor(folderButton.dataset.editFolderId);
      return;
    }
    const button = event.target.closest("[data-project-id]");
    if (button) void selectProject(button.dataset.projectId);
  });

  els.portfolioEditForm.addEventListener("submit", (event) => {
    event.preventDefault();
    void submitPortfolioEdit(event.currentTarget);
  });
  els.portfolioEditForm.addEventListener("click", (event) => {
    if (event.target.closest("[data-close-portfolio-edit]")) els.portfolioEditDialog.close();
    if (event.target.closest("[data-open-project]")) {
      const projectId = els.portfolioEditForm.dataset.projectId;
      els.portfolioEditDialog.close();
      void selectProject(projectId);
    }
  });
  els.portfolioEditDialog.addEventListener("click", (event) => {
    if (event.target === els.portfolioEditDialog) els.portfolioEditDialog.close();
  });

  els.projectDetail.addEventListener("submit", async (event) => {
    const form = event.target.closest("[data-form]");
    if (!form) return;
    event.preventDefault();
    const button = event.submitter || form.querySelector("button[type='submit']");
    const taskFocus = captureProjectTaskFocus(button);
    button.disabled = true;
    try {
      await submitProjectDetailForm(form);
      restoreProjectTaskFocus(taskFocus);
    } catch (error) {
      showActionToast(error.message, true);
      button.disabled = false;
      restoreProjectTaskFocus(taskFocus);
    }
  });

  els.projectDetail.addEventListener("toggle", event => {
    if (!event.target.matches(".task-row-menu[open]")) return;
    els.projectDetail.querySelectorAll(".task-row-menu[open]").forEach(menu => {
      if (menu !== event.target) menu.open = false;
    });
  }, true);

  els.projectDetail.addEventListener("keydown", event => {
    if (event.key === "Escape") {
      const editor = event.target.closest(".task-details:not([hidden]), .task-subtask-composer:not([hidden])");
      if (editor) {
        const node = editor.closest("[data-task-node]");
        const taskId = node.dataset.taskNode;
        const isSubtask = editor.classList.contains("task-subtask-composer");
        editor.hidden = true;
        editor.classList.remove("is-open");
        if (isSubtask) state.subtaskComposerTaskId = null;
        else state.expandedTaskId = null;
        node.querySelectorAll(isSubtask ? "[data-add-subtask]" : "[data-task-toggle-id]").forEach(button => {
          if ((button.dataset.addSubtask || button.dataset.taskToggleId) === taskId) button.setAttribute("aria-expanded", "false");
        });
        node.querySelector(isSubtask ? ".task-row-menu > summary" : ".project-task-title")?.focus();
        event.preventDefault();
        return;
      }
      const menu = event.target.closest(".task-row-menu[open], .task-create-disclosure[open]");
      if (menu) {
        menu.open = false;
        menu.querySelector("summary").focus();
        event.preventDefault();
        return;
      }
    }
    const textarea = event.target.closest("[data-mention-input]");
    if (!textarea) return;
    const menu = textarea.form.querySelector("[data-mention-suggestions]");
    if (!menu || menu.hidden) return;
    const options = [...menu.querySelectorAll("button:not([hidden])")];
    if (event.key === "Escape") { menu.hidden = true; event.preventDefault(); return; }
    if (!["ArrowDown","ArrowUp","Enter"].includes(event.key) || !options.length) return;
    event.preventDefault();
    const current = options.findIndex(button=>button.classList.contains("mention-active"));
    if (event.key === "Enter") { (options[current] || options[0]).click(); return; }
    const next = (current + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length;
    options.forEach((button,index)=>button.classList.toggle("mention-active", index===next));
  });

  els.projectDetail.addEventListener("input", (event) => {
    const textarea = event.target.closest("[data-mention-input]");
    if (!textarea) return;
    const suggestions = textarea.form.querySelector("[data-mention-suggestions]");
    if (!suggestions) return;
    const token = textarea.value.slice(0, textarea.selectionStart).match(/@([^@\s]*)$/);
    const query = token ? token[1].toLowerCase() : "";
    suggestions.querySelectorAll("[data-mention-member]").forEach((button) => {
      button.hidden = !!query && !button.dataset.mentionName.toLowerCase().includes(query);
    });
    suggestions.hidden = !token || !suggestions.querySelector("[data-mention-member]:not([hidden])");
  });

  els.projectDetail.addEventListener("click", (event) => {
    const mentionButton = event.target.closest("[data-mention-member]");
    if (!mentionButton) return;
    const form = mentionButton.closest("form");
    const textarea = form?.querySelector("[data-mention-input]");
    if (!textarea) return;
    const cursor = textarea.selectionStart;
    const before = textarea.value.slice(0, cursor);
    const match = before.match(/@([^@\s]*)$/);
    if (match) {
      const mentionText = "@" + mentionButton.dataset.mentionName + " ";
      textarea.value = before.slice(0, match.index) + mentionText + textarea.value.slice(cursor);
      textarea.focus();
      textarea.selectionStart = textarea.selectionEnd = match.index + mentionText.length;
    }
    mentionButton.closest("[data-mention-suggestions]").hidden = true;
  });

  els.projectDetail.addEventListener("change", (event) => {
    const projectStatus = event.target.closest("[data-project-workflow-id]");
    if (projectStatus) void projectApi(`/api/projects/${encodeURIComponent(projectStatus.dataset.projectWorkflowId)}/status`, {
      method:"PATCH", body:JSON.stringify({workflow_status_id:projectStatus.value}),
    }).then(()=>loadProjects()).catch(error=>showActionToast(error.message,true));
    const form = event.target.closest("form[data-form='application']");
    if (form && event.target.name === "program_id") updateApplicationDeadlineOptions(form);
    const taskSelect = event.target.closest("[data-task-workflow-id]");
    if (taskSelect) {
      const workflow = state.workflowStatuses.find((status) => status.status_id === taskSelect.value);
      if (workflow) void projectApi(`/api/tasks/${encodeURIComponent(taskSelect.dataset.taskWorkflowId)}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status: workflow.base_status, workflow_status_id: workflow.status_id }),
      }).then(() => loadProjects()).catch((error) => showActionToast(error.message, true));
    }
    const assigneeSelect = event.target.closest("[data-task-assignee-id]");
    if (assigneeSelect) void projectApi(`/api/tasks/${encodeURIComponent(assigneeSelect.dataset.taskAssigneeId)}/assignee`, {
      method: "PATCH",
      body: JSON.stringify({ assigned_to: assigneeSelect.value }),
    }).then(() => loadProjects()).catch((error) => showActionToast(error.message, true));
  });

  els.projectConfigPanel.addEventListener("change", (event) => {
    const form = event.target.closest("form[data-config-form='status']");
    if (form && event.target.name === "entity_type") updateStatusBaseOptions(form);
  });

  els.projectConfigPanel.addEventListener("submit", async (event) => {
    const form = event.target.closest("[data-config-form]");
    if (!form) return;
    event.preventDefault();
    const values = Object.fromEntries(new FormData(form));
    try {
      await projectApi(form.dataset.configForm === "folder" ? "/api/project-folders" : "/api/workflow-statuses", {
        method: "POST", body: JSON.stringify(values),
      });
      form.reset();
      if (form.dataset.configForm === "status") updateStatusBaseOptions(form);
      await loadProjects();
      showActionToast(form.dataset.configForm === "folder" ? "Mappen blev oprettet." : "Statussen blev oprettet.");
    } catch (error) {
      showActionToast(error.message, true);
    }
  });

  els.projectDetail.addEventListener("click", async (event) => {
    els.projectDetail.querySelectorAll(".task-row-menu[open]").forEach(menu => {
      if (!menu.contains(event.target)) menu.open = false;
    });
    if (event.target.closest("[data-project-dashboard-back]")) {
      state.projectPage = "dashboard";
      document.querySelector(".projects-workspace").hidden = true;
      els.projectDashboard.hidden = false;
      await renderProjectDashboard();
      window.scrollTo({ top: document.querySelector(".projects-header").offsetTop, behavior: "smooth" });
      return;
    }
    if (event.target.closest("[data-project-delete]")) {
      els.projectDetail.querySelector(".project-delete-confirm").hidden = false;
      els.projectDetail.querySelector(".project-actions-menu").open = false;
      return;
    }
    if (event.target.closest("[data-project-delete-cancel]")) {
      els.projectDetail.querySelector(".project-delete-confirm").hidden = true;
      return;
    }
    const deleteButton = event.target.closest("[data-project-delete-confirm]");
    if (deleteButton) {
      deleteButton.disabled = true;
      try {
        const project = state.projects.find(item=>item.project_id===state.selectedProjectId);
        await projectApi(`/api/projects/${encodeURIComponent(state.selectedProjectId)}`,{method:"DELETE"});
        state.deletedProject = project;
        state.selectedProjectId = null;
        state.projectPage = "dashboard";
        await loadProjects();
        showActionToast("Projektet er slettet fra oversigten.");
      } catch(error) { deleteButton.disabled = false; showActionToast(error.message,true); }
      return;
    }
    const memberCard = event.target.closest("[data-team-member-id]");
    if (memberCard) {
      state.selectedTeamMemberId = memberCard.dataset.teamMemberId;
      els.projectDetail.querySelectorAll("[data-team-member-id]").forEach((card) => card.classList.toggle("selected", card === memberCard));
      const detail = els.projectDetail.querySelector(".team-member-detail");
      if (detail) {
        detail.classList.remove("empty");
        detail.innerHTML = `<strong>${escapeHtml(memberCard.dataset.memberName)}</strong><span>${escapeHtml(memberCard.dataset.memberRole)}</span><small>${escapeHtml(memberCard.dataset.memberEmail)}</small>`;
      }
      return;
    }
    const childrenToggle = event.target.closest("[data-task-children-toggle]");
    if (childrenToggle) {
      const taskId = childrenToggle.dataset.taskChildrenToggle;
      const collapsed = !state.collapsedTaskIds.has(taskId);
      if (collapsed) state.collapsedTaskIds.add(taskId); else state.collapsedTaskIds.delete(taskId);
      childrenToggle.setAttribute("aria-expanded", String(!collapsed));
      const title = childrenToggle.closest("[data-task-node]").querySelector(".project-task-title strong").textContent;
      childrenToggle.setAttribute("aria-label", `${collapsed ? "Vis" : "Skjul"} underopgaver til ${title}`);
      document.getElementById(`task-children-${taskId}`).hidden = collapsed;
      return;
    }
    const toggle = event.target.closest("[data-task-toggle-id], [data-task-edit-date]");
    if (toggle) {
      const taskId = toggle.dataset.taskToggleId || toggle.dataset.taskEditDate;
      const opening = toggle.hasAttribute("data-task-edit-date") || state.expandedTaskId !== taskId;
      state.expandedTaskId = opening ? taskId : null;
      els.projectDetail.querySelectorAll(".task-details").forEach(panel => {
        const open = opening && panel.id === `task-details-${taskId}`;
        panel.hidden = !open;
        panel.classList.toggle("is-open", open);
      });
      els.projectDetail.querySelectorAll("[data-task-toggle-id]").forEach(button => button.setAttribute("aria-expanded", String(opening && button.dataset.taskToggleId === taskId)));
      toggle.closest(".task-row-menu")?.removeAttribute("open");
      if (opening) {
        const form = document.getElementById(`task-details-${taskId}`)?.querySelector("form");
        form?.elements[toggle.hasAttribute("data-task-edit-date") ? "due_on" : "title"]?.focus();
      } else {
        toggle.closest("[data-task-node]")?.querySelector(".project-task-title")?.focus();
      }
      return;
    }
    const addSubtask = event.target.closest("[data-add-subtask]");
    if (addSubtask) {
      const taskId = addSubtask.dataset.addSubtask;
      const opening = state.subtaskComposerTaskId !== taskId;
      state.subtaskComposerTaskId = opening ? taskId : null;
      els.projectDetail.querySelectorAll(".task-subtask-composer").forEach(panel => { panel.hidden = !opening || panel.id !== `task-subtask-${taskId}`; });
      els.projectDetail.querySelectorAll("[data-add-subtask]").forEach(button => button.setAttribute("aria-expanded", String(opening && button.dataset.addSubtask === taskId)));
      addSubtask.closest(".task-row-menu")?.removeAttribute("open");
      if (opening) {
        document.getElementById(`task-subtask-${taskId}`)?.querySelector("[data-subtask-title]")?.focus();
      } else {
        addSubtask.closest("[data-task-node]")?.querySelector(".task-row-menu > summary")?.focus();
      }
      return;
    }
    const button = event.target.closest("[data-task-status-id]");
    if (!button) return;
    const taskFocus = captureProjectTaskFocus(button);
    button.disabled = true;
    try {
      await projectApi(`/api/tasks/${encodeURIComponent(button.dataset.taskStatusId)}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status: button.dataset.nextStatus }),
      });
      await loadProjects();
      restoreProjectTaskFocus(taskFocus);
    } catch (error) {
      showActionToast(error.message, true);
      button.disabled = false;
      restoreProjectTaskFocus(taskFocus);
    }
  });

  els.reviewList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-review-id]");
    if (!button) return;
    void updateScanReview(button.dataset.reviewId, button.dataset.reviewStatus);
  });

  els.favoriteList.addEventListener("click", (event) => {
    const favoriteButton = event.target.closest("[data-favorite-id]");
    if (favoriteButton) {
      toggleFavorite(favoriteButton.dataset.favoriteId);
      return;
    }

    const openButton = event.target.closest("[data-open-program-id]");
    if (openButton) {
      selectProgram(openButton.dataset.openProgramId);
      switchTab("fonde");
    }
  });

  els.rows.addEventListener("click", (event) => {
    const favoriteButton = event.target.closest("[data-favorite-id]");
    if (favoriteButton) {
      event.stopPropagation();
      toggleFavorite(favoriteButton.dataset.favoriteId);
      return;
    }

    const row = event.target.closest("tr[data-id]");
    if (row) selectProgram(row.dataset.id);
  });

  els.detailContent.addEventListener("click", (event) => {
    const favoriteButton = event.target.closest("[data-favorite-id]");
    if (favoriteButton) toggleFavorite(favoriteButton.dataset.favoriteId);
  });

  els.alertList.addEventListener("click", (event) => {
    const item = event.target.closest(".alert-item");
    if (!item) return;
    const programId = item.dataset.programId;
    if (programId) {
      selectProgram(programId);
      switchTab("fonde");
    }
  });

  els.rows.addEventListener("keydown", (event) => {
    if (event.target.closest("button, a, input, select, textarea")) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    const row = event.target.closest("tr[data-id]");
    if (row) {
      event.preventDefault();
      selectProgram(row.dataset.id);
    }
  });

  els.updateButton.addEventListener("click", updateSources);
  els.scrapeRunButton.addEventListener("click", () => runScraper());
  els.scrapeTestButton.addEventListener("click", () => runScraper({ limit: 5 }));
  els.scrapeChangeRows.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-action]");
    const row = event.target.closest("tr[data-change-id]");
    if (button && row) decideScrapeChange(row, button);
  });

  if (isFilePreview()) {
    els.updateButton.textContent = "Åbn LocalHost";
    els.scrapeTestButton.textContent = "Åbn LocalHost";
    els.scrapeRunButton.disabled = true;
    els.projectCreateForm.querySelector("button[type='submit']").textContent = "Start appen for at oprette";
  }
  loadScrapeChanges().catch(() => {
    els.scrapeChangeRows.innerHTML = `<tr><td colspan="5">Scraping-tabellerne er ikke initialiseret endnu.</td></tr>`;
  });
  loadApprovedScrapeFields().catch(() => {
    els.scrapeApprovedRows.innerHTML = `<tr><td colspan="5">Godkendte scraperfelter kunne ikke indlæses.</td></tr>`;
  });
}

init().catch((error) => {
  console.error(error);
  els.rows.innerHTML = `<tr><td colspan="5">Data kunne ikke indlæses.</td></tr>`;
});

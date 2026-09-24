const state = {
  foundations: [],
  programs: [],
  deadlines: [],
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
  activeTab: "fund",
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
  projectServerNotice: document.querySelector("#projectServerNotice"),
  projectAuthPanel: document.querySelector("#projectAuthPanel"),
  projectConfigPanel: document.querySelector(".project-config-panel"),
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
  return "Ansøgning";
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
  const nextTab = availableTabs.includes(tabName) ? tabName : "fund";
  state.activeTab = nextTab;
  saveJson("fondsdb.activeTab", nextTab);

  els.tabButtons.forEach((button) => {
    const isActive = button.dataset.tab === nextTab;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-selected", String(isActive));
  });

  els.tabPanels.forEach((panel) => {
    const isActive = panel.dataset.panel === nextTab;
    panel.classList.toggle("active", isActive);
    panel.hidden = !isActive;
  });
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
          <button class="favorite-button ${isFavorite(foundation.foundation_id) ? "active" : ""}" type="button" data-favorite-id="${escapeHtml(foundation.foundation_id)}" aria-label="Favorit ${escapeHtml(foundation.name)}">${isFavorite(foundation.foundation_id) ? "★" : "☆"}</button>
          <span class="opportunity-name">
            <strong>${escapeHtml(program.program_name)}</strong>
            <span>${escapeHtml(foundation.name)} · ${escapeHtml(program.geography || foundation.city || "Danmark")}</span>
          </span>
        </div>
      </td>
      <td data-label="Støtteområder"><div class="pill-list">${areas}</div></td>
      <td data-label="Ansøgere"><div class="pill-list">${applicants}</div></td>
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
    ? `${foundation.name} støtter overordnet initiativer inden for ${foundation.support_areas}.`
    : `${foundation.name} er en ${foundation.legal_type || "fond"}, der støtter almennyttige formål.`;
  const foundationSelfDescription = foundation.notes || "";
  els.detailEmpty.hidden = true;
  els.detailContent.hidden = false;
  els.detailContent.innerHTML = `
    <div class="detail-title">
      <div class="detail-title-row">
        <h2>${escapeHtml(program.program_name)}</h2>
        <button class="favorite-button detail-favorite ${isFavorite(foundation.foundation_id) ? "active" : ""}" type="button" data-favorite-id="${escapeHtml(foundation.foundation_id)}" aria-label="Favorit ${escapeHtml(foundation.name)}">${isFavorite(foundation.foundation_id) ? "★" : "☆"}</button>
      </div>
      <p>${escapeHtml(foundation.name)} · ${escapeHtml(program.program_type || foundation.legal_type || "Fond")}</p>
    </div>
    <div class="pill-list">
      ${splitList(program.support_areas).map((area) => `<span class="pill">${escapeHtml(area)}</span>`).join("")}
    </div>
    <div class="detail-block foundation-overview">
      <h3>Om fonden</h3>
      <div class="foundation-overview-part">
        <strong>Overordnet</strong>
        <p>${escapeHtml(foundationSummary)}</p>
      </div>
      ${foundationSelfDescription ? `<div class="foundation-overview-part foundation-self-description">
        <strong>Fondens egen beskrivelse</strong>
        <p>${escapeHtml(foundationSelfDescription)}</p>
      </div>` : ""}
      <small>${escapeHtml(foundation.country || "Danmark")}${foundation.city ? ` · ${escapeHtml(foundation.city)}` : ""}</small>
    </div>
    <div class="deadline-card ${deadline?.status === "open" ? "open" : ""}">
      <span>Friststatus</span>
      <strong>${escapeHtml(deadlineLabel(deadline))}</strong>
      <p>${escapeHtml(deadline?.summary || program.deadline_summary || "-")}</p>
    </div>
    <div class="detail-block">
      <h3>Ansøgere</h3>
      <p>${escapeHtml(program.applicant_types || "-")}</p>
    </div>
    <div class="detail-block">
      <h3>Geografi og brug</h3>
      <p>${escapeHtml(program.geography || "-")} · ${escapeHtml(program.funding_use || "-")}</p>
    </div>
    <div class="detail-block">
      <h3>Beløb</h3>
      <p>${escapeHtml(program.amount_range || "Varierer")}</p>
    </div>
    <div class="detail-block">
      <h3>Datastatus</h3>
      <p>${escapeHtml(statusLabel(program.verification_status))} · tjekket ${escapeHtml(program.last_checked || "-")}</p>
    </div>
    <div class="detail-block">
      <h3>Note</h3>
      <p>${escapeHtml(program.notes || "-")}</p>
    </div>
    <div class="detail-links">
      <a class="button-link" href="${escapeHtml(linkOrHash(program.application_url || foundation.application_url))}" target="_blank" rel="noreferrer">${escapeHtml(applicationActionLabel(program))}</a>
      <a class="button-link secondary" href="${escapeHtml(linkOrHash(foundation.website))}" target="_blank" rel="noreferrer">Website</a>
      <a class="button-link secondary" href="${escapeHtml(linkOrHash(program.source_url || foundation.source_url))}" target="_blank" rel="noreferrer">Kilde</a>
    </div>
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
        <button class="favorite-button active" type="button" data-favorite-id="${escapeHtml(foundation.foundation_id)}" aria-label="Fjern favorit ${escapeHtml(foundation.name)}">★</button>
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
    ]
      .join(" ")
      .toLocaleLowerCase("da");

    const matchesQuery = !query || haystack.includes(query);
    const matchesArea = !area || splitList(program.support_areas).includes(area);
    const matchesApplicant = !applicant || splitList(program.applicant_types).includes(applicant);
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
}

function selectProgram(id) {
  state.selectedId = id;
  renderRows();
  renderDetail();
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
    idea: "Idé",
    planning: "Planlægning",
    active: "Aktivt",
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
  return ({ todo: "Ikke startet", in_progress: "I gang", blocked: "Blokeret", done: "Færdig" })[status] || status;
}

function formatAmount(value, currency = "DKK") {
  if (value === null || value === undefined || value === "") return "–";
  return new Intl.NumberFormat("da-DK", { style: "currency", currency, maximumFractionDigits: 0 }).format(Number(value));
}

function statusesFor(entityType) {
  return state.workflowStatuses.filter((status) => status.entity_type === entityType);
}

function workflowStatusOptions(entityType, selectedId, fallbackBase) {
  return statusesFor(entityType).map((status) =>
    `<option value="${escapeHtml(status.status_id)}" ${status.status_id === selectedId || (!selectedId && status.base_status === fallbackBase) ? "selected" : ""}>${escapeHtml(status.label)}</option>`,
  ).join("");
}

function applyWorkflowStatus(values, entityType) {
  const status = state.workflowStatuses.find((item) => item.status_id === values.workflow_status_id && item.entity_type === entityType);
  if (status) values.status = status.base_status;
  return values;
}

function populateProjectCreateOptions() {
  const statusSelect = els.projectCreateForm.elements.workflow_status_id;
  const folderSelect = els.projectCreateForm.elements.folder_id;
  statusSelect.innerHTML = workflowStatusOptions("project", null, "idea");
  folderSelect.innerHTML = `<option value="">Ingen mappe</option>${state.projectFolders.map((folder) => `<option value="${escapeHtml(folder.folder_id)}">${escapeHtml(folder.name)}</option>`).join("")}`;
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
  const setup = state.auth.setupRequired;
  els.projectAuthPanel.hidden = false;
  els.projectAuthPanel.innerHTML = `<div class="project-auth-card"><div><p class="section-kicker">Projektstyring</p><h3>${setup ? "Opret første konto" : "Log ind"}</h3><p>${setup ? "Opret administratoren, der skal have adgang til projekter og teamdata." : "Log ind for at se projekter, opgaver og kommentarer."}</p></div><form data-auth-form="${setup ? "setup" : "login"}"><input name="email" type="email" required placeholder="Email" autocomplete="email" /><input name="display_name" type="${setup ? "text" : "hidden"}" ${setup ? "required" : ""} placeholder="Navn" autocomplete="name" /><input name="password" type="password" required minlength="10" placeholder="Adgangskode (min. 10 tegn)" autocomplete="${setup ? "new-password" : "current-password"}" /><button class="button-link" type="submit">${setup ? "Opret konto" : "Log ind"}</button></form><p class="project-auth-error" data-auth-error hidden></p></div>`;
}

async function loadAuthStatus() {
  const response = await fetch("/api/auth/status");
  const payload = await response.json();
  state.auth = { authenticated: payload.authenticated, setupRequired: payload.setupRequired, user: payload.user || null };
  if (!state.auth.authenticated) { renderAuthPanel(); return false; }
  els.projectAuthPanel.hidden = false;
  els.projectAuthPanel.innerHTML = `<div class="project-auth-user"><span>Logget ind som <strong>${escapeHtml(state.auth.user?.display_name || state.auth.user?.email || "bruger")}</strong></span><button class="mini-button" type="button" data-auth-logout>Log ud</button></div>`;
  return true;
}

async function loadProjects({ selectNewest = false } = {}) {
  if (isFilePreview()) {
    els.projectList.innerHTML = `<div class="empty-state">Start appen med <strong>Start fondsdatabase.command</strong> for at bruge projektstyring.</div>`;
    return;
  }
  if (!(await loadAuthStatus())) { els.projectList.innerHTML = `<div class="empty-state">Log ind ovenfor for at se projektporteføljen.</div>`; return; }
  const [payload, teamPayload, configPayload] = await Promise.all([
    projectApi("/api/projects"),
    projectApi("/api/team-members"),
    projectApi("/api/project-config"),
  ]);
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
  if (state.selectedProjectId) await selectProject(state.selectedProjectId);
}

function renderProjectList() {
  els.projectCount.textContent = `${state.projects.length} ${state.projects.length === 1 ? "projekt" : "projekter"}`;
  els.projectList.replaceChildren();
  if (!state.projects.length) {
    els.projectList.innerHTML = `<div class="empty-state">Ingen projekter endnu. Opret det første ovenfor.</div>`;
    return;
  }

  const renderProjectButton = (project) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `project-list-item${project.project_id === state.selectedProjectId ? " active" : ""}`;
    button.dataset.projectId = project.project_id;
    button.innerHTML = `
      <span class="project-list-title"><strong>${escapeHtml(project.name)}</strong><span class="project-status color-${escapeHtml(project.workflow_status_color)}">${escapeHtml(project.workflow_status_id ? project.workflow_status_label : projectStatusLabel(project.status))}</span></span>
      <span>${Number(project.application_count)} ansøgninger · ${Number(project.open_task_count)} åbne opgaver</span>
      <small>${project.next_task_due_on ? `Næste frist ${escapeHtml(project.next_task_due_on)}` : "Ingen kommende opgavefrist"}</small>`;
    return button;
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
    group.innerHTML = `<div class="project-folder-heading"><span>📁 ${escapeHtml(folder.name)}</span><small>${projects.length} ${projects.length === 1 ? "projekt" : "projekter"}</small></div>`;
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

async function selectProject(projectId) {
  if (state.selectedProjectId !== projectId) state.selectedTeamMemberId = null;
  state.selectedProjectId = projectId;
  renderProjectList();
  els.projectDetail.innerHTML = `<div class="empty-state">Indlæser projekt…</div>`;
  try {
    const { project } = await projectApi(`/api/projects/${encodeURIComponent(projectId)}`);
    renderProjectDetail(project);
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
    const expanded = state.expandedTaskId === task.task_id;
    return `<div class="project-task-node depth-${Math.min(depth, 4)}" style="--task-depth:${Math.min(depth, 4)}">
      <article class="project-task ${task.status === "done" ? "done" : ""}">
        <button type="button" data-task-status-id="${escapeHtml(task.task_id)}" data-next-status="${task.status === "done" ? "todo" : "done"}" aria-label="Skift opgavestatus">${task.status === "done" ? "✓" : "○"}</button>
        <button class="project-task-title" type="button" data-task-toggle-id="${escapeHtml(task.task_id)}" aria-expanded="${expanded}">
          <strong>${escapeHtml(task.title)}</strong><span>${children.length} underopgaver · ${escapeHtml(task.priority)}</span>
        </button>
        <small>${task.assignee_name ? escapeHtml(task.assignee_name) : "Ikke tildelt"}<br>${task.due_on ? escapeHtml(task.due_on) : "Ingen frist"}</small>
      </article>
      <div class="task-details ${expanded ? "is-open" : ""}" aria-hidden="${!expanded}">
        <label><span>Status</span><select data-task-workflow-id="${escapeHtml(task.task_id)}">${workflowStatusOptions("task", task.workflow_status_id, task.status)}</select></label>
        <label><span>Ansvarlig</span><select data-task-assignee-id="${escapeHtml(task.task_id)}">${assigneeOptions(task.assigned_to)}</select></label>
        <form class="subtask-form" data-form="subtask">
          <input type="hidden" name="parent_task_id" value="${escapeHtml(task.task_id)}" />
          <input name="title" required maxlength="240" placeholder="Tilføj underopgave…" />
          <select name="assigned_to">${assigneeOptions("")}</select>
          <select name="workflow_status_id">${workflowStatusOptions("task", null, "todo")}</select>
          <select name="priority"><option value="medium">Mellem</option><option value="high">Høj</option><option value="urgent">Haster</option><option value="low">Lav</option></select>
          <input name="due_on" type="date" />
          <button class="mini-button approve" type="submit">Tilføj underopgave</button>
        </form>
      </div>
      ${children.map((child) => renderTask(child, depth + 1)).join("")}
    </div>`;

  };
  const tasks = project.tasks.length
    ? (tasksByParent.get("root") || []).map((task) => renderTask(task)).join("")
    : `<div class="empty-state compact">Ingen opgaver endnu.</div>`;
  const documents = project.documents?.length
    ? project.documents.map((document) => `<a class="project-document" href="${escapeHtml(document.document_url)}" target="_blank" rel="noopener noreferrer"><span>${escapeHtml(documentTypeLabel(document.document_type))}</span><strong>${escapeHtml(document.title)}</strong><small>Åbn dokument ↗</small></a>`).join("")
    : `<div class="empty-state compact">Ingen dokumentlinks endnu.</div>`;
  const mentionMembers = project.members.map((member) => `<button type="button" data-mention-member="${escapeHtml(member.member_id)}" data-mention-name="${escapeHtml(member.display_name)}">@${escapeHtml(member.display_name)}</button>`).join("");
  const comments = project.comments?.length
    ? project.comments.map((comment) => `<article class="project-comment"><div class="project-comment-meta"><strong>${escapeHtml(comment.author_name || "Ukendt afsender")}</strong><time>${escapeHtml(comment.created_at || "")}</time></div><p>${escapeHtml(comment.body).replace(/\n/g, "<br>")}</p>${comment.mentions?.length ? `<small>Nævnt: ${comment.mentions.map((mention) => "@" + escapeHtml(mention.display_name)).join(", ")}</small>` : ""}</article>`).join("")
    : `<div class="empty-state compact">Ingen kommentarer endnu.</div>`;

  els.projectDetail.innerHTML = `
    <header class="project-detail-header">
      <div><p class="section-kicker">${escapeHtml(project.workflow_status_id ? project.workflow_status_label : projectStatusLabel(project.status))}${project.folder_name ? ` · ${escapeHtml(project.folder_name)}` : ""}</p><h2>${escapeHtml(project.name)}</h2><p>${escapeHtml(project.description || "Ingen beskrivelse endnu.")}</p></div>
      <div class="project-budget"><span>Budget</span><strong>${formatAmount(project.estimated_budget, project.currency)}</strong><small>${escapeHtml(project.starts_on || "?")} – ${escapeHtml(project.ends_on || "?")}</small></div>
    </header>
    <form class="project-settings-form" data-form="project-settings">
      <label><span>Navn</span><input name="name" required maxlength="160" value="${escapeHtml(project.name)}" /></label>
      <label><span>Status</span><select name="workflow_status_id">
        ${workflowStatusOptions("project", project.workflow_status_id, project.status)}
      </select></label>
      <label><span>Mappe</span><select name="folder_id"><option value="">Ingen mappe</option>${folderOptions}</select></label>
      <label><span>Ansvarlig</span><select name="owner_member_id"><option value="">Ingen ansvarlig</option>${ownerOptions}</select></label>
      <label><span>Budget</span><input name="estimated_budget" type="number" min="0" step="1000" value="${escapeHtml(project.estimated_budget ?? "")}" /></label>
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
        <div class="section-heading"><h3>Opgaver</h3><span>${project.tasks.filter((task) => task.status !== "done").length} åbne</span></div>
        <div class="project-task-list">${tasks}</div>
        <form class="inline-project-form" data-form="task">
          <input name="title" required maxlength="240" placeholder="Ny opgave" />
          <select name="priority"><option value="medium">Mellem</option><option value="high">Høj</option><option value="urgent">Haster</option><option value="low">Lav</option></select>
          <select name="workflow_status_id">${workflowStatusOptions("task", null, "todo")}</select>
          <select name="assigned_to"><option value="">Ingen ansvarlig</option>${memberOptions}</select>
          <input name="due_on" type="date" />
          <button class="mini-button approve" type="submit">Tilføj opgave</button>
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
      <div class="section-heading"><h3>Kommentarer</h3><span>${project.comments?.length || 0}</span></div>
      <div class="project-comment-list">${comments}</div>
      <form class="project-comment-form" data-form="comment">
        <textarea name="body" data-mention-input required maxlength="4000" rows="3" placeholder="Skriv en opdatering til projektet…"></textarea>
        <div class="project-comment-form-row">
          <select name="author_member_id" required><option value="">Vælg afsender</option>${memberOptions}</select>
          <button class="mini-button approve" type="submit">Tilføj kommentar</button>
        </div>
        <div class="mention-suggestions" data-mention-suggestions hidden>${mentionMembers}</div>
        <small>Skriv @ for at nævne en person fra projektets team.</small>
      </form>
    </section>`;
}

async function submitProjectForm(form) {
  const values = applyWorkflowStatus(Object.fromEntries(new FormData(form)), "project");
  const payload = await projectApi("/api/projects", { method: "POST", body: JSON.stringify(values) });
  form.reset();
  state.selectedProjectId = payload.project.project_id;
  await loadProjects();
  showActionToast("Projektet blev oprettet.");
}

async function submitProjectDetailForm(form) {
  const values = Object.fromEntries(new FormData(form));
  values.project_id = state.selectedProjectId;
  const formType = form.dataset.form;
  let message = "Ændringerne blev gemt.";
  if (formType === "project-settings") {
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
    message = "Opgaven blev oprettet.";
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
  state.activeTab = loadJson("fondsdb.activeTab", "fund");
  state.favorites = new Set(loadJson("fondsdb.favorites", []));
  state.alertSettings = {
    ...state.alertSettings,
    ...loadJson("fondsdb.alertSettings", {}),
  };

  const [foundationResponse, programResponse, deadlineResponse, scanResponse] = await Promise.all([
    fetch("data/fonde_seed.csv"),
    fetch("data/programs_seed.csv"),
    fetch("data/deadlines_seed.csv"),
    fetch("data/call_scan_results.csv"),
  ]);

  state.foundations = csvToObjects(await foundationResponse.text());
  state.programs = csvToObjects(await programResponse.text());
  state.deadlines = csvToObjects(await deadlineResponse.text());
  state.callScanResults = scanResponse.ok ? csvToObjects(await scanResponse.text()) : [];
  await loadScanReviews().catch((error) => {
    console.warn(error);
    showActionToast("Reviewstatus kunne ikke hentes fra databasen.", true);
  });
  await loadProjects().catch((error) => {
    console.warn(error);
    els.projectList.innerHTML = `<div class="empty-state">Projektmodulet kunne ikke indlæses.</div>`;
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
    els.projectList.innerHTML = `<div class="empty-state">Log ind ovenfor for at se projektporteføljen.</div>`;
  });

  els.projectAuthPanel.addEventListener("submit", async (event) => {
    const form = event.target.closest("[data-auth-form]"); if (!form) return;
    event.preventDefault(); const error = form.closest(".project-auth-card").querySelector("[data-auth-error]");
    try {
      const response = await fetch(`/api/auth/${form.dataset.authForm}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(Object.fromEntries(new FormData(form))) });
      const payload = await response.json(); if (!response.ok || !payload.ok) throw new Error(payload.message || "Login fejlede");
      state.auth = { authenticated: true, setupRequired: false, user: payload.user }; await loadProjects(); showActionToast("Du er logget ind.");
    } catch (errorValue) { error.hidden = false; error.textContent = errorValue.message; }
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

  els.projectList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-project-id]");
    if (button) void selectProject(button.dataset.projectId);
  });

  els.projectDetail.addEventListener("submit", async (event) => {
    const form = event.target.closest("[data-form]");
    if (!form) return;
    event.preventDefault();
    const button = form.querySelector("button[type='submit']");
    button.disabled = true;
    try {
      await submitProjectDetailForm(form);
    } catch (error) {
      showActionToast(error.message, true);
      button.disabled = false;
    }
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
    const toggle = event.target.closest("[data-task-toggle-id]");
    if (toggle) {
      state.expandedTaskId = state.expandedTaskId === toggle.dataset.taskToggleId ? null : toggle.dataset.taskToggleId;
      await selectProject(state.selectedProjectId);
      return;
    }
    const button = event.target.closest("[data-task-status-id]");
    if (!button) return;
    button.disabled = true;
    try {
      await projectApi(`/api/tasks/${encodeURIComponent(button.dataset.taskStatusId)}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status: button.dataset.nextStatus }),
      });
      await loadProjects();
    } catch (error) {
      showActionToast(error.message, true);
      button.disabled = false;
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
    els.projectServerNotice.hidden = false;
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

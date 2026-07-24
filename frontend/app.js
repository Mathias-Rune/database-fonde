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
  actionToast: document.querySelector("#actionToast"),
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
      <td class="name-cell">
        <button class="favorite-button ${isFavorite(foundation.foundation_id) ? "active" : ""}" type="button" data-favorite-id="${escapeHtml(foundation.foundation_id)}" aria-label="Favorit ${escapeHtml(foundation.name)}">${isFavorite(foundation.foundation_id) ? "★" : "☆"}</button>
        <span><strong>${escapeHtml(program.program_name)}</strong><span>${escapeHtml(foundation.name)} · ${escapeHtml(program.geography || foundation.city || "Danmark")}</span></span>
      </td>
      <td><div class="pill-list">${areas}</div></td>
      <td><div class="pill-list">${applicants}</div></td>
      <td><span class="deadline ${deadlineClass}">${escapeHtml(deadlineLabel(deadline))}</span></td>
      <td><span class="status ${escapeHtml(program.verification_status)}">${escapeHtml(statusLabel(program.verification_status))}</span></td>
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
      <p>${escapeHtml(program.notes || foundation.notes || "-")}</p>
    </div>
    <div class="detail-links">
      <a class="button-link" href="${escapeHtml(linkOrHash(program.application_url || foundation.application_url))}" target="_blank" rel="noreferrer">Ansøgning</a>
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
      <p>Lokalt markeret som reviewed/ignoreret i denne browser.</p>
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
  state.scanReviewOverrides[scanResultId] = status;
  saveJson("fondsdb.scanReviewOverrides", state.scanReviewOverrides);
  buildAlerts();
  renderAlerts();
  renderReview();
  renderFavoriteList();
  renderDataHealth();
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

async function runScraper({ limit = 0 } = {}) {
  if (isFilePreview()) {
    window.location.href = "http://127.0.0.1:8010/";
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
    await loadScrapeChanges();
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
    window.location.href = "http://127.0.0.1:8010/";
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
    await loadScrapeChanges();
    setScrapeStatus(button.dataset.action === "approve" ? "Ændringen blev godkendt." : "Ændringen blev afvist.");
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
  state.scanReviewOverrides = loadJson("fondsdb.scanReviewOverrides", {});
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

  els.reviewList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-review-id]");
    if (!button) return;
    updateScanReview(button.dataset.reviewId, button.dataset.reviewStatus);
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
  }
  loadScrapeChanges().catch(() => {
    els.scrapeChangeRows.innerHTML = `<tr><td colspan="5">Scraping-tabellerne er ikke initialiseret endnu.</td></tr>`;
  });
}

init().catch((error) => {
  console.error(error);
  els.rows.innerHTML = `<tr><td colspan="5">Data kunne ikke indlæses.</td></tr>`;
});

const state = {
  foundations: [],
  filtered: [],
  extractedFields: new Map(),
  selectedId: null,
  quickFilter: "",
};

const els = {
  totalCount: document.querySelector("#totalCount"),
  checkedCount: document.querySelector("#checkedCount"),
  verifyCount: document.querySelector("#verifyCount"),
  qualityCount: document.querySelector("#qualityCount"),
  topCity: document.querySelector("#topCity"),
  visibleCount: document.querySelector("#visibleCount"),
  checkedMeter: document.querySelector("#checkedMeter"),
  verifyMeter: document.querySelector("#verifyMeter"),
  areaChart: document.querySelector("#areaChart"),
  rows: document.querySelector("#foundationRows"),
  detailEmpty: document.querySelector("#detailEmpty"),
  detailContent: document.querySelector("#detailContent"),
  searchInput: document.querySelector("#searchInput"),
  locationFilter: document.querySelector("#locationFilter"),
  categoryFilter: document.querySelector("#categoryFilter"),
  amountFilter: document.querySelector("#amountFilter"),
  amountMinInput: document.querySelector("#amountMinInput"),
  amountMaxInput: document.querySelector("#amountMaxInput"),
  statusFilter: document.querySelector("#statusFilter"),
  updateButton: document.querySelector("#updateButton"),
  updateStatus: document.querySelector("#updateStatus"),
  scrapeRunButton: document.querySelector("#scrapeRunButton"),
  scrapeTestButton: document.querySelector("#scrapeTestButton"),
  scrapeStatus: document.querySelector("#scrapeStatus"),
  scrapeChangeRows: document.querySelector("#scrapeChangeRows"),
  resultsHint: document.querySelector("#resultsHint"),
  exportFilteredButton: document.querySelector("#exportFilteredButton"),
  quickFilterButtons: document.querySelectorAll("[data-quick-filter]"),
  actionToast: document.querySelector("#actionToast"),
};

const locationMap = {
  Aalborg: { municipality: "Aalborg Kommune", region: "Region Nordjylland" },
  Billund: { municipality: "Billund Kommune", region: "Region Syddanmark" },
  Hellerup: { municipality: "Gentofte Kommune", region: "Region Hovedstaden" },
  "Kgs. Lyngby": { municipality: "Lyngby-Taarbæk Kommune", region: "Region Hovedstaden" },
  København: { municipality: "Københavns Kommune", region: "Region Hovedstaden" },
  Smørum: { municipality: "Egedal Kommune", region: "Region Hovedstaden" },
  Søborg: { municipality: "Gladsaxe Kommune", region: "Region Hovedstaden" },
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
  return value
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean);
}

function locationForFoundation(foundation) {
  const mapped = locationMap[foundation.city] || {};
  return {
    city: foundation.city || "Ukendt by",
    municipality: mapped.municipality || foundation.city || "Ukendt kommune",
    region: mapped.region || "Ukendt region",
  };
}

function formatDkk(value) {
  if (!Number.isFinite(value)) return "Ukendt";
  return `${Math.round(value).toLocaleString("da-DK")} kr.`;
}

function parseDkkAmounts(value) {
  const text = String(value || "").toLocaleLowerCase("da");
  const matches = [...text.matchAll(/(\d+(?:[.,]\d+)?)\s*(mio\.?|million(?:er)?|kr\.?|kroner)/g)];
  return matches
    .map((match) => {
      const number = Number(match[1].replace(",", "."));
      if (!Number.isFinite(number)) return null;
      const unit = match[2];
      return unit.startsWith("mio") || unit.startsWith("million") ? number * 1000000 : number;
    })
    .filter((amount) => Number.isFinite(amount) && amount > 0);
}

function amountProfile(foundation) {
  const extracted = state.extractedFields.get(foundation.foundation_id) || {};
  const amountText = [
    foundation.average_amount_dkk,
    foundation.amount_dkk,
    foundation.funding_amounts,
    foundation.funding_amount_text,
    foundation.notes,
    extracted.funding_amounts,
  ]
    .filter(Boolean)
    .join(" ");

  const explicitAmount = Number(foundation.average_amount_dkk || foundation.amount_dkk);
  const amounts = Number.isFinite(explicitAmount) && explicitAmount > 0 ? [explicitAmount] : parseDkkAmounts(amountText);
  if (!amounts.length) return { average: null, label: "Ukendt", source: extracted.funding_amounts ? "scraped" : "none" };
  const average = amounts.reduce((sum, amount) => sum + amount, 0) / amounts.length;
  return { average, label: formatDkk(average), source: extracted.funding_amounts ? "scraped" : "parsed" };
}

function daysSince(dateValue) {
  if (!dateValue) return Infinity;
  const date = new Date(`${dateValue}T00:00:00`);
  if (Number.isNaN(date.getTime())) return Infinity;
  return Math.max(0, Math.floor((Date.now() - date.getTime()) / 86400000));
}

function qualityProfile(foundation) {
  const issues = [];
  const amount = amountProfile(foundation);
  let score = 100;

  if (foundation.verification_status === "needs_update") {
    score -= 35;
    issues.push("Kræver kildeopdatering");
  } else if (foundation.verification_status === "to_verify") {
    score -= 18;
    issues.push("Mangler manuel verificering");
  }

  const age = daysSince(foundation.last_checked);
  if (!Number.isFinite(age)) {
    score -= 24;
    issues.push("Mangler tjekdato");
  } else if (age > 365) {
    score -= 28;
    issues.push("Tjekket for over 1 år siden");
  } else if (age > 180) {
    score -= 16;
    issues.push("Tjekket for over 6 måneder siden");
  }

  [
    ["website", "Website mangler"],
    ["application_url", "Ansøgningslink mangler"],
    ["source_url", "Kildelink mangler"],
  ].forEach(([field, issue]) => {
    if (!foundation[field]) {
      score -= 10;
      issues.push(issue);
    }
  });

  if (!splitList(foundation.support_areas).length) {
    score -= 12;
    issues.push("Støtteområder mangler");
  }
  if (!foundation.deadline_model) {
    score -= 8;
    issues.push("Fristmodel mangler");
  }
  if (!Number.isFinite(amount.average)) {
    score -= 6;
    issues.push("Beløb ukendt");
  }
  if (foundation.notes?.toLocaleLowerCase("da").includes("bør valideres")) {
    score -= 10;
    issues.push("Note kræver validering");
  }

  const finalScore = Math.max(0, Math.min(100, Math.round(score)));
  const level = finalScore >= 80 ? "good" : finalScore >= 60 ? "warn" : "risk";
  return {
    score: finalScore,
    level,
    label: finalScore >= 80 ? "Høj" : finalScore >= 60 ? "Middel" : "Lav",
    issues: issues.length ? issues : ["Ingen tydelige dataproblemer"],
    stale: !Number.isFinite(age) || age > 180,
  };
}

function matchesAmountRange(average, selectedRange, minValue, maxValue) {
  if (!selectedRange && !minValue && !maxValue) return true;
  if (!Number.isFinite(average)) return false;

  const ranges = {
    "under-100000": [0, 100000],
    "100000-500000": [100000, 500000],
    "500000-1000000": [500000, 1000000],
    "over-1000000": [1000000, Infinity],
  };

  const [rangeMin, rangeMax] = ranges[selectedRange] || [0, Infinity];
  const finalMin = Math.max(rangeMin, minValue || 0);
  const finalMax = Math.min(rangeMax, maxValue || Infinity);
  return average >= finalMin && average <= finalMax;
}

function statusLabel(status) {
  return {
    source_checked: "Kilde-tjekket",
    to_verify: "Skal verificeres",
    needs_update: "Skal opdateres",
  }[status] || status;
}

function verificationChecklist(foundation) {
  if (foundation.verification_status === "source_checked") {
    return ["Ingen aktive tjekpunkter. Fonden er markeret som kilde-tjekket."];
  }

  const tasks = [];
  if (foundation.verification_status === "needs_update") {
    tasks.push("Kildelink eller ansøgningsside skal åbnes og kontrolleres, fordi seneste kildetjek fandt et problem.");
  }

  if (!foundation.source_url) {
    tasks.push("Tilføj eller bekræft en kilde-URL.");
  } else {
    tasks.push("Åbn kilde-linket og bekræft at data stadig matcher fondens egen side.");
  }

  if (foundation.regulator === "To verify" || foundation.legal_type?.includes("fondslignende")) {
    tasks.push("Bekræft juridisk type og registrering.");
  }

  if (foundation.notes?.toLocaleLowerCase("da").includes("bør valideres")) {
    tasks.push(foundation.notes);
  } else {
    tasks.push("Tjek støtteområder, ansøgertyper og fristmodel.");
  }

  return [...new Set(tasks)];
}

function fieldLabel(fieldName) {
  return {
    deadlines: "Ansøgningsfrister",
    funding_amounts: "Beløbsrammer",
    contact_info: "Kontakt",
    purpose_criteria: "Formål og kriterier",
  }[fieldName] || fieldName;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function decodeHtmlEntities(value) {
  const textarea = document.createElement("textarea");
  textarea.innerHTML = String(value ?? "");
  return textarea.value;
}

function displayScrapedText(value) {
  return escapeHtml(decodeHtmlEntities(value));
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
  const statusCounts = countBy(state.foundations, (foundation) => foundation.verification_status);
  const cityCounts = countBy(state.foundations, (foundation) => foundation.city);
  const [city, cityCount] = topEntries(cityCounts, 1)[0] || ["-", 0];
  const qualityScores = state.foundations.map((foundation) => qualityProfile(foundation).score);
  const averageQuality = qualityScores.length
    ? Math.round(qualityScores.reduce((sum, score) => sum + score, 0) / qualityScores.length)
    : 0;

  els.totalCount.textContent = state.foundations.length;
  els.checkedCount.textContent = statusCounts.get("source_checked") || 0;
  els.verifyCount.textContent = statusCounts.get("to_verify") || 0;
  els.qualityCount.textContent = `${averageQuality}%`;
  els.topCity.textContent = cityCount ? `${city} (${cityCount})` : "-";
}

function setUpdateStatus(message, isError = false) {
  els.updateStatus.hidden = false;
  els.updateStatus.classList.toggle("error", isError);
  els.updateStatus.textContent = message;
}

function setScrapeStatus(message, isError = false) {
  els.scrapeStatus.textContent = message;
  els.scrapeStatus.classList.toggle("error", isError);
  els.scrapeStatus.style.color = isError ? "var(--danger)" : "var(--muted)";
}

let actionToastTimer;
function showActionToast(message, isError = false) {
  if (!els.actionToast) return;
  window.clearTimeout(actionToastTimer);
  els.actionToast.hidden = false;
  els.actionToast.classList.toggle("error", isError);
  els.actionToast.textContent = message;
  actionToastTimer = window.setTimeout(() => {
    els.actionToast.hidden = true;
  }, 5000);
}

function qualityBadge(profile) {
  return `
    <div class="quality-badge ${profile.level}" title="${escapeHtml(profile.issues.join(". "))}">
      <span>${profile.score}%</span>
      <meter min="0" max="100" value="${profile.score}" aria-label="Datakvalitet ${profile.score} procent"></meter>
    </div>
  `;
}

function csvEscape(value) {
  const stringValue = String(value ?? "");
  if (/[",\n\r]/.test(stringValue)) {
    return `"${stringValue.replaceAll('"', '""')}"`;
  }
  return stringValue;
}

function exportFilteredCsv() {
  const headers = [
    "foundation_id",
    "name",
    "legal_type",
    "municipality",
    "region",
    "support_areas",
    "applicant_types",
    "deadline_model",
    "amount",
    "verification_status",
    "last_checked",
    "data_quality_score",
    "data_quality_issues",
    "application_url",
    "website",
    "source_url",
  ];
  const rows = state.filtered.map((foundation) => {
    const location = locationForFoundation(foundation);
    const amount = amountProfile(foundation);
    const quality = qualityProfile(foundation);
    return {
      foundation_id: foundation.foundation_id,
      name: foundation.name,
      legal_type: foundation.legal_type,
      municipality: location.municipality,
      region: location.region,
      support_areas: foundation.support_areas,
      applicant_types: foundation.applicant_types,
      deadline_model: foundation.deadline_model,
      amount: amount.label,
      verification_status: statusLabel(foundation.verification_status),
      last_checked: foundation.last_checked,
      data_quality_score: quality.score,
      data_quality_issues: quality.issues.join("; "),
      application_url: foundation.application_url,
      website: foundation.website,
      source_url: foundation.source_url,
    };
  });
  const csv = [headers.join(","), ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(","))].join("\n");
  const blob = new Blob([`${csv}\n`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `fonde-filtreret-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  showActionToast(`${rows.length} viste fonde eksporteret.`);
}

function setPageLoading(isLoading) {
  document.body.classList.toggle("is-loading", isLoading);
}

function isFilePreview() {
  return window.location.protocol === "file:";
}

function redirectToLocalhost() {
  window.location.href = "http://127.0.0.1:8010/";
}

function configureServerOnlyControls() {
  if (!isFilePreview()) return false;

  setScrapeStatus("Webscraperen kræver LocalHost. Klik på knappen for at åbne appen korrekt.", true);
  els.scrapeTestButton.textContent = "Åbn LocalHost";
  els.scrapeRunButton.disabled = true;
  els.scrapeRunButton.title = "Start appen via LocalHost for at køre scraperen";
  return true;
}

function renderFilterOptions() {
  const categories = new Set();
  const locations = new Map();

  state.foundations.forEach((foundation) => {
    splitList(foundation.support_areas).forEach((area) => categories.add(area));
    const location = locationForFoundation(foundation);
    [
      [`region:${location.region}`, `Region: ${location.region}`],
      [`municipality:${location.municipality}`, `Kommune: ${location.municipality}`],
      [`city:${location.city}`, `By: ${location.city}`],
    ].forEach(([value, label]) => locations.set(value, label));
  });

  [...locations.entries()]
    .sort((a, b) => a[1].localeCompare(b[1], "da"))
    .forEach(([value, label]) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      els.locationFilter.append(option);
    });

  [...categories].sort((a, b) => a.localeCompare(b, "da")).forEach((area) => {
    const option = document.createElement("option");
    option.value = area;
    option.textContent = area;
    els.categoryFilter.append(option);
  });
}

function renderChart() {
  const areaCounts = new Map();
  state.filtered.forEach((foundation) => {
    splitList(foundation.support_areas).forEach((area) => {
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

  const statusCounts = countBy(state.filtered, (foundation) => foundation.verification_status);
  const total = Math.max(state.filtered.length, 1);
  els.checkedMeter.value = ((statusCounts.get("source_checked") || 0) / total) * 100;
  els.verifyMeter.value = ((statusCounts.get("to_verify") || 0) / total) * 100;
  els.visibleCount.textContent = `${state.filtered.length} vist`;
  if (els.resultsHint) {
    els.resultsHint.textContent = state.filtered.length
      ? "Vælg en række for detaljer"
      : "Juster søgning eller filtre";
  }
  els.quickFilterButtons.forEach((button) => {
    const isActive = button.dataset.quickFilter === state.quickFilter;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-pressed", isActive ? "true" : "false");
  });
}

function renderRows() {
  els.rows.replaceChildren();

  if (!state.filtered.length) {
    const tr = document.createElement("tr");
    tr.className = "empty-row";
    tr.innerHTML = `
      <td colspan="7">
        <div class="empty-table-state">
          <strong>Ingen fonde matcher filtrene</strong>
          <span>Prøv at fjerne et filter, udvide beløbsintervallet eller søge bredere.</span>
        </div>
      </td>
    `;
    els.rows.append(tr);
    return;
  }

  state.filtered.forEach((foundation) => {
    const tr = document.createElement("tr");
    tr.tabIndex = 0;
    tr.className = foundation.foundation_id === state.selectedId ? "active" : "";
    tr.dataset.id = foundation.foundation_id;
    tr.setAttribute("aria-selected", foundation.foundation_id === state.selectedId ? "true" : "false");
    const location = locationForFoundation(foundation);
    const amount = amountProfile(foundation);
    const quality = qualityProfile(foundation);

    const areas = splitList(foundation.support_areas)
      .slice(0, 4)
      .map((area) => `<span class="pill">${area}</span>`)
      .join("");

    tr.innerHTML = `
      <td class="name-cell" data-label="Fond"><strong>${foundation.name}</strong><span>${foundation.legal_type || "Fond"}</span></td>
      <td class="name-cell" data-label="Lokation"><strong>${location.municipality}</strong><span>${location.region}</span></td>
      <td data-label="Støtteområder"><div class="pill-list">${areas}</div></td>
      <td data-label="Beløb">${amount.label}</td>
      <td data-label="Fristmodel">${foundation.deadline_model || "-"}</td>
      <td data-label="Datakvalitet">${qualityBadge(quality)}</td>
      <td data-label="Status"><span class="status ${foundation.verification_status}">${statusLabel(foundation.verification_status)}</span></td>
    `;

    els.rows.append(tr);
  });
}

function renderDetail() {
  const foundation = state.foundations.find((item) => item.foundation_id === state.selectedId);

  if (!foundation) {
    els.detailEmpty.hidden = false;
    els.detailContent.hidden = true;
    return;
  }

  els.detailEmpty.hidden = true;
  els.detailContent.hidden = false;
  const location = locationForFoundation(foundation);
  const amount = amountProfile(foundation);
  const quality = qualityProfile(foundation);
  const checklist = verificationChecklist(foundation);
  const canVerify = foundation.verification_status !== "source_checked" && !isFilePreview();
  els.detailContent.innerHTML = `
    <div class="detail-title">
      <h2>${escapeHtml(foundation.name)}</h2>
      <p>${escapeHtml(foundation.legal_type || "Fond")} · ${escapeHtml(location.municipality)} · ${escapeHtml(location.region)}</p>
    </div>
    <div class="pill-list">
      ${splitList(foundation.support_areas).map((area) => `<span class="pill">${escapeHtml(area)}</span>`).join("")}
    </div>
    <div class="quality-card ${quality.level}">
      <div>
        <h3>Datakvalitet</h3>
        <strong>${quality.score}% · ${quality.label}</strong>
      </div>
      <meter min="0" max="100" value="${quality.score}" aria-label="Datakvalitet ${quality.score} procent"></meter>
      <ul>
        ${quality.issues.map((issue) => `<li>${escapeHtml(issue)}</li>`).join("")}
      </ul>
    </div>
    <div class="detail-block">
      <h3>Ansøgere</h3>
      <p>${escapeHtml(foundation.applicant_types || "-")}</p>
    </div>
    <div class="detail-block">
      <h3>Fristmodel</h3>
      <p>${escapeHtml(foundation.deadline_model || "-")}</p>
    </div>
    <div class="detail-block">
      <h3>Beløb</h3>
      <p>${escapeHtml(amount.label)}${amount.source === "scraped" ? " · fra scraper" : ""}</p>
    </div>
    <div class="detail-block">
      <h3>Note</h3>
      <p>${escapeHtml(foundation.notes || "-")}</p>
    </div>
    <div class="verification-panel ${foundation.verification_status}">
      <div>
        <h3>Verificering</h3>
        <p><span class="status ${foundation.verification_status}">${escapeHtml(statusLabel(foundation.verification_status))}</span> · tjekket ${escapeHtml(foundation.last_checked || "-")}</p>
      </div>
      <ul>
        ${checklist.map((task) => `<li>${escapeHtml(task)}</li>`).join("")}
      </ul>
      ${
        canVerify
          ? `<button class="detail-action" type="button" data-verify-foundation="${escapeHtml(foundation.foundation_id)}">Markér som verificeret</button>`
          : ""
      }
    </div>
    <div class="detail-links">
      <a class="button-link" href="${escapeHtml(foundation.application_url)}" target="_blank" rel="noreferrer">Ansøgning</a>
      <a class="button-link secondary" href="${escapeHtml(foundation.website)}" target="_blank" rel="noreferrer">Website</a>
      <a class="button-link secondary" href="${escapeHtml(foundation.source_url)}" target="_blank" rel="noreferrer">Kilde</a>
    </div>
  `;
}

function applyFilters() {
  const query = els.searchInput.value.trim().toLocaleLowerCase("da");
  const locationValue = els.locationFilter.value;
  const category = els.categoryFilter.value;
  const amountRange = els.amountFilter.value;
  const amountMin = Number(els.amountMinInput.value || 0);
  const amountMax = Number(els.amountMaxInput.value || 0);
  const status = els.statusFilter.value;

  state.filtered = state.foundations.filter((foundation) => {
    const location = locationForFoundation(foundation);
    const amount = amountProfile(foundation);
    const quality = qualityProfile(foundation);
    const haystack = [
      foundation.name,
      foundation.city,
      location.municipality,
      location.region,
      foundation.support_areas,
      foundation.applicant_types,
      foundation.deadline_model,
      foundation.notes,
    ]
      .join(" ")
      .toLocaleLowerCase("da");

    const matchesQuery = !query || haystack.includes(query);
    const matchesLocation =
      !locationValue ||
      locationValue === `region:${location.region}` ||
      locationValue === `municipality:${location.municipality}` ||
      locationValue === `city:${location.city}`;
    const matchesCategory = !category || splitList(foundation.support_areas).includes(category);
    const matchesAmount = matchesAmountRange(amount.average, amountRange, amountMin, amountMax);
    const matchesStatus = !status || foundation.verification_status === status;
    const matchesQuickFilter =
      !state.quickFilter ||
      (state.quickFilter === "attention" && (foundation.verification_status !== "source_checked" || quality.score < 70)) ||
      (state.quickFilter === "high_quality" && quality.score >= 80) ||
      (state.quickFilter === "stale" && quality.stale);
    return matchesQuery && matchesLocation && matchesCategory && matchesAmount && matchesStatus && matchesQuickFilter;
  });

  if (!state.filtered.some((foundation) => foundation.foundation_id === state.selectedId)) {
    state.selectedId = state.filtered[0]?.foundation_id || null;
  }

  renderChart();
  renderRows();
  renderDetail();
}

function selectFoundation(id) {
  state.selectedId = id;
  renderRows();
  renderDetail();
}

async function loadExtractedFields() {
  if (isFilePreview()) return;

  try {
    const response = await fetch("/api/foundations/extracted-fields");
    const payload = await response.json();
    if (!response.ok || !payload.ok) return;

    state.extractedFields = payload.fields.reduce((map, field) => {
      const current = map.get(field.foundation_id) || {};
      current[field.field_name] = field.field_value;
      map.set(field.foundation_id, current);
      return map;
    }, new Map());
  } catch {
    state.extractedFields = new Map();
  }
}

async function loadScrapeChanges() {
  if (isFilePreview()) {
    els.scrapeChangeRows.innerHTML = `<tr><td colspan="5">Åbn appen via LocalHost for at bruge webscraperen.</td></tr>`;
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
    const tr = document.createElement("tr");
    tr.dataset.changeId = change.change_id;
    tr.innerHTML = `
      <td class="name-cell"><strong>${escapeHtml(change.foundation_name)}</strong><span>${escapeHtml(change.detected_at)}</span></td>
      <td>${escapeHtml(fieldLabel(change.field_name))}</td>
      <td>
        <div class="compare-values">
          <div>
            <span>Før</span>
            <div class="value-preview muted">${displayScrapedText(change.old_value || "Ingen tidligere værdi")}</div>
          </div>
          <div>
            <span>Nu</span>
            <div class="value-preview">${displayScrapedText(change.new_value)}</div>
          </div>
        </div>
      </td>
      <td><span class="status ${change.significance === "high" ? "needs_update" : "to_verify"}">${escapeHtml(change.significance)} · ${Math.round(change.confidence * 100)}%</span></td>
      <td>
        <div class="review-actions">
          <textarea class="review-note" rows="2" placeholder="Kort note"></textarea>
          <button class="mini-button approve" type="button" data-action="approve">Godkend</button>
          <button class="mini-button reject" type="button" data-action="reject">Afvis</button>
        </div>
      </td>
    `;
    els.scrapeChangeRows.append(tr);
  });
}

async function runScraper({ limit = 0 } = {}) {
  if (isFilePreview()) {
    redirectToLocalhost();
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
    setScrapeStatus(
      `Scraper færdig. ${report.targets_checked} fonde tjekket, ${report.changes_detected} mulige ændringer, ${report.manual_review} kræver gennemgang.`,
    );
    await loadExtractedFields();
    applyFilters();
    await loadScrapeChanges();
  } catch (error) {
    setScrapeStatus(`Scraper fejlede: ${error.message}`, true);
  } finally {
    setPageLoading(false);
    els.scrapeRunButton.disabled = false;
    els.scrapeTestButton.disabled = false;
  }
}

async function markFoundationVerified(foundationId, button) {
  if (isFilePreview()) {
    redirectToLocalhost();
    return;
  }

  const feedback = button.parentElement.querySelector(".verification-feedback");
  const wasVerificationFilterActive = els.statusFilter.value === "to_verify";
  setPageLoading(true);
  button.disabled = true;
  button.textContent = "Gemmer...";
  if (feedback) feedback.hidden = true;

  try {
    const response = await fetch("/api/foundations/verification", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ foundation_id: foundationId, status: "source_checked" }),
    });
    const payload = await response.json();
    if (!response.ok || !payload.ok) throw new Error(payload.message || "Kunne ikke gemme verificering");

    const index = state.foundations.findIndex((foundation) => foundation.foundation_id === foundationId);
    if (index >= 0) state.foundations[index] = payload.foundation;
    renderSummary();
    applyFilters();
    const message = wasVerificationFilterActive
      ? `${payload.foundation.name} er verificeret og fjernet fra filteret "Skal verificeres".`
      : `${payload.foundation.name} er markeret som kilde-tjekket.`;
    setUpdateStatus(message);
  } catch (error) {
    const message = `Verificering fejlede: ${error.message}`;
    if (feedback) {
      feedback.hidden = false;
      feedback.textContent = message;
    }
    setUpdateStatus(message, true);
    button.disabled = false;
    button.textContent = "Markér som verificeret";
  } finally {
    setPageLoading(false);
  }
}

async function init() {
  setPageLoading(true);
  const response = await fetch(`data/fonde_seed.csv?ts=${Date.now()}`);
  const csvText = await response.text();
  state.foundations = csvToObjects(csvText);
  const filePreviewMode = configureServerOnlyControls();
  await loadExtractedFields();
  state.filtered = [...state.foundations];
  state.selectedId = state.foundations[0]?.foundation_id || null;

  renderSummary();
  renderFilterOptions();
  applyFilters();

  [
    els.searchInput,
    els.locationFilter,
    els.categoryFilter,
    els.amountFilter,
    els.amountMinInput,
    els.amountMaxInput,
    els.statusFilter,
  ].forEach((control) => {
    control.addEventListener("input", applyFilters);
  });

  els.quickFilterButtons.forEach((button) => {
    button.addEventListener("click", () => {
      state.quickFilter = button.dataset.quickFilter || "";
      applyFilters();
    });
  });

  els.exportFilteredButton.addEventListener("click", exportFilteredCsv);

  els.rows.addEventListener("click", (event) => {
    const row = event.target.closest("tr[data-id]");
    if (row) selectFoundation(row.dataset.id);
  });

  els.rows.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const row = event.target.closest("tr[data-id]");
    if (row) {
      event.preventDefault();
      selectFoundation(row.dataset.id);
    }
  });

  els.detailContent.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-verify-foundation]");
    if (!button) return;
    markFoundationVerified(button.dataset.verifyFoundation, button);
  });

  els.updateButton.addEventListener("click", async () => {
    els.updateButton.disabled = true;
    setPageLoading(true);
    setUpdateStatus("Opdaterer kilder og database...");

    try {
      const response = await fetch("/api/update-sources", { method: "POST" });
      const payload = await response.json();

      if (!response.ok || !payload.ok) {
        throw new Error(payload.message || "Opdatering fejlede");
      }

      state.foundations = csvToObjects(await (await fetch(`data/fonde_seed.csv?ts=${Date.now()}`)).text());
      state.filtered = [...state.foundations];
      renderSummary();
      applyFilters();

      setUpdateStatus(
        `Opdateret. ${payload.report.total_foundations} fonde tjekket, ${payload.report.failed_foundations} kræver gennemgang.`,
      );
    } catch (error) {
      setUpdateStatus(`Opdatering fejlede: ${error.message}`, true);
    } finally {
      setPageLoading(false);
      els.updateButton.disabled = false;
    }
  });

  els.scrapeRunButton.addEventListener("click", () => runScraper());
  els.scrapeTestButton.addEventListener("click", () => runScraper({ limit: 5 }));

  els.scrapeChangeRows.addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-action]");
    const row = event.target.closest("tr[data-change-id]");
    if (!button || !row) return;
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
  });

  if (filePreviewMode) {
    loadScrapeChanges();
  } else {
    loadScrapeChanges().catch(() => {
      els.scrapeChangeRows.innerHTML = `<tr><td colspan="5">Scraping-tabellerne er ikke initialiseret endnu.</td></tr>`;
    });
  }

  setPageLoading(false);
}

init().catch((error) => {
  console.error(error);
  setPageLoading(false);
  els.rows.innerHTML = `<tr><td colspan="4">Data kunne ikke indlæses.</td></tr>`;
});

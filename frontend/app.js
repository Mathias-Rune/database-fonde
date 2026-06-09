const state = {
  foundations: [],
  filtered: [],
  selectedId: null,
};

const els = {
  totalCount: document.querySelector("#totalCount"),
  checkedCount: document.querySelector("#checkedCount"),
  verifyCount: document.querySelector("#verifyCount"),
  topCity: document.querySelector("#topCity"),
  visibleCount: document.querySelector("#visibleCount"),
  checkedMeter: document.querySelector("#checkedMeter"),
  verifyMeter: document.querySelector("#verifyMeter"),
  areaChart: document.querySelector("#areaChart"),
  rows: document.querySelector("#foundationRows"),
  detailEmpty: document.querySelector("#detailEmpty"),
  detailContent: document.querySelector("#detailContent"),
  searchInput: document.querySelector("#searchInput"),
  areaFilter: document.querySelector("#areaFilter"),
  statusFilter: document.querySelector("#statusFilter"),
  updateButton: document.querySelector("#updateButton"),
  updateStatus: document.querySelector("#updateStatus"),
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

function statusLabel(status) {
  return {
    source_checked: "Kilde-tjekket",
    to_verify: "Skal verificeres",
    needs_update: "Skal opdateres",
  }[status] || status;
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

  els.totalCount.textContent = state.foundations.length;
  els.checkedCount.textContent = statusCounts.get("source_checked") || 0;
  els.verifyCount.textContent = statusCounts.get("to_verify") || 0;
  els.topCity.textContent = cityCount ? `${city} (${cityCount})` : "-";
}

function setUpdateStatus(message, isError = false) {
  els.updateStatus.hidden = false;
  els.updateStatus.classList.toggle("error", isError);
  els.updateStatus.textContent = message;
}

function renderAreaOptions() {
  const areas = new Set();
  state.foundations.forEach((foundation) => {
    splitList(foundation.support_areas).forEach((area) => areas.add(area));
  });

  [...areas].sort((a, b) => a.localeCompare(b, "da")).forEach((area) => {
    const option = document.createElement("option");
    option.value = area;
    option.textContent = area;
    els.areaFilter.append(option);
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
}

function renderRows() {
  els.rows.replaceChildren();

  state.filtered.forEach((foundation) => {
    const tr = document.createElement("tr");
    tr.tabIndex = 0;
    tr.className = foundation.foundation_id === state.selectedId ? "active" : "";
    tr.dataset.id = foundation.foundation_id;

    const areas = splitList(foundation.support_areas)
      .slice(0, 4)
      .map((area) => `<span class="pill">${area}</span>`)
      .join("");

    tr.innerHTML = `
      <td class="name-cell"><strong>${foundation.name}</strong><span>${foundation.city || "Ukendt by"}</span></td>
      <td><div class="pill-list">${areas}</div></td>
      <td>${foundation.deadline_model || "-"}</td>
      <td><span class="status ${foundation.verification_status}">${statusLabel(foundation.verification_status)}</span></td>
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
  els.detailContent.innerHTML = `
    <div class="detail-title">
      <h2>${foundation.name}</h2>
      <p>${foundation.legal_type || "Fond"} · ${foundation.city || "Danmark"}</p>
    </div>
    <div class="pill-list">
      ${splitList(foundation.support_areas).map((area) => `<span class="pill">${area}</span>`).join("")}
    </div>
    <div class="detail-block">
      <h3>Ansøgere</h3>
      <p>${foundation.applicant_types || "-"}</p>
    </div>
    <div class="detail-block">
      <h3>Fristmodel</h3>
      <p>${foundation.deadline_model || "-"}</p>
    </div>
    <div class="detail-block">
      <h3>Note</h3>
      <p>${foundation.notes || "-"}</p>
    </div>
    <div class="detail-block">
      <h3>Datastatus</h3>
      <p>${statusLabel(foundation.verification_status)} · tjekket ${foundation.last_checked || "-"}</p>
    </div>
    <div class="detail-links">
      <a class="button-link" href="${foundation.application_url}" target="_blank" rel="noreferrer">Ansøgning</a>
      <a class="button-link secondary" href="${foundation.website}" target="_blank" rel="noreferrer">Website</a>
      <a class="button-link secondary" href="${foundation.source_url}" target="_blank" rel="noreferrer">Kilde</a>
    </div>
  `;
}

function applyFilters() {
  const query = els.searchInput.value.trim().toLocaleLowerCase("da");
  const area = els.areaFilter.value;
  const status = els.statusFilter.value;

  state.filtered = state.foundations.filter((foundation) => {
    const haystack = [
      foundation.name,
      foundation.city,
      foundation.support_areas,
      foundation.applicant_types,
      foundation.deadline_model,
      foundation.notes,
    ]
      .join(" ")
      .toLocaleLowerCase("da");

    const matchesQuery = !query || haystack.includes(query);
    const matchesArea = !area || splitList(foundation.support_areas).includes(area);
    const matchesStatus = !status || foundation.verification_status === status;
    return matchesQuery && matchesArea && matchesStatus;
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

async function init() {
  const response = await fetch(`data/fonde_seed.csv?ts=${Date.now()}`);
  const csvText = await response.text();
  state.foundations = csvToObjects(csvText);
  state.filtered = [...state.foundations];
  state.selectedId = state.foundations[0]?.foundation_id || null;

  renderSummary();
  renderAreaOptions();
  applyFilters();

  [els.searchInput, els.areaFilter, els.statusFilter].forEach((control) => {
    control.addEventListener("input", applyFilters);
  });

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

  els.updateButton.addEventListener("click", async () => {
    els.updateButton.disabled = true;
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
      els.updateButton.disabled = false;
    }
  });
}

init().catch((error) => {
  console.error(error);
  els.rows.innerHTML = `<tr><td colspan="4">Data kunne ikke indlæses.</td></tr>`;
});

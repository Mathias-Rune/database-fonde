(() => {
  const sectionCopy = {
    fund: ["Fund og nye opslag", "Vurder nye støttemuligheder fra dine kilder."],
    projekter: ["Dine projekter", "Saml projekter, fondsansøgninger og opgaver ét sted."],
    fonde: ["Fonde i Danmark", "Find, vurder og følg de rette støttemuligheder."],
    favoritter: ["Dine favoritter", "Hold styr på de fonde, der passer til dine projekter."],
    alerts: ["Alerts", "Følg frister, nye fonde og ændringer i dine favoritter."],
    data: ["Data og kilder", "Se datakvalitet og hold fondenes oplysninger opdateret."],
  };
  const mobile = window.matchMedia("(max-width: 900px)");
  const stackedFunds = window.matchMedia("(max-width: 700px)");
  let initialized = false;
  let drawerOpen = false;
  let dialogTrigger = null;

  const element = (selector) => document.querySelector(selector);

  function setDrawer(open, { restoreFocus = false } = {}) {
    const sidebar = element("#appSidebar");
    const toggle = element("#menuToggle");
    drawerOpen = Boolean(open && mobile.matches);
    document.body.classList.toggle("sidebar-open", drawerOpen);
    toggle?.setAttribute("aria-expanded", String(drawerOpen));
    if (sidebar) sidebar.inert = mobile.matches && !drawerOpen;
    const backdrop = element("#sidebarBackdrop");
    if (backdrop) backdrop.hidden = !drawerOpen;
    if (drawerOpen) (sidebar?.querySelector("[aria-current='page']") || sidebar?.querySelector("[data-tab]"))?.focus();
    else if (restoreFocus) toggle?.focus();
  }

  function openAccount(trigger) {
    const dialog = element("#accountDialog");
    if (!dialog || dialog.open) return;
    dialogTrigger = trigger || document.activeElement;
    setDrawer(false);
    dialog.showModal();
    dialog.querySelector("input:not([type='hidden']), [data-auth-logout]")?.focus();
  }

  function closeAccount() {
    element("#accountDialog")?.close();
  }

  function syncTab(tabName) {
    const [title, subtitle] = sectionCopy[tabName] || sectionCopy.fonde;
    const heading = element("#workspaceTitle");
    const description = element("#workspaceSubtitle");
    if (heading) heading.textContent = title;
    if (description) description.textContent = subtitle;
    document.title = `${title} · Dansk Fondsdatabase`;
    document.querySelectorAll("#appSidebar [data-tab]").forEach((button) => {
      if (button.dataset.tab === tabName) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    });
    const wasDrawerOpen = drawerOpen;
    setDrawer(false);
    if (wasDrawerOpen) (element("#mainContent") || heading)?.focus();
  }

  function syncAuth(auth) {
    const authenticated = Boolean(auth.authenticated);
    document.body.classList.toggle("is-signed-out", !authenticated);
    const button = element("#accountButton");
    const accountName = auth.user?.display_name || auth.user?.email || "Min konto";
    if (button) {
      let label = button.querySelector("[data-account-label]");
      if (!label) {
        label = document.createElement("span");
        label.dataset.accountLabel = "";
        button.append(label);
      }
      label.textContent = authenticated ? accountName : "Log ind";
      button.setAttribute("aria-label", authenticated ? `Konto: ${accountName}` : "Log ind");
      button.classList.toggle("is-authenticated", authenticated);
    }
    const title = element("#accountDialogTitle");
    if (title) title.textContent = authenticated ? "Din konto" : auth.setupRequired ? "Opret konto" : "Log ind";
    const prompt = element("#projectLoginPrompt");
    if (prompt) prompt.hidden = authenticated;
    if (!authenticated) {
      document.querySelectorAll("#projectDashboard, .projects-workspace, .projects-header, .project-config-panel").forEach((panel) => { panel.hidden = true; });
    }
  }

  function showFundDetail() {
    if (!stackedFunds.matches) return;
    window.requestAnimationFrame(() => {
      const panel = element("#panel-fonde .detail-panel");
      const heading = panel?.querySelector("#detailContent h2");
      if (!stackedFunds.matches || !heading || panel.closest("[hidden]")) return;
      heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
      panel.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "start" });
    });
  }

  function backToFunds() {
    const results = element("#panel-fonde .results-panel");
    const selectedRow = results?.querySelector("tr.active[data-id]");
    const target = selectedRow || results;
    if (!target) return;
    if (!selectedRow) target.tabIndex = -1;
    target.focus({ preventScroll: true });
    target.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "start" });
  }

  function syncFilters() {
    const activeCount = ["#applicantFilter", "#statusFilter"].filter((selector) => element(selector)?.value).length;
    const label = element("#moreFiltersLabel");
    if (label) label.textContent = activeCount ? `Flere filtre (${activeCount})` : "Flere filtre";
  }

  function init(auth) {
    if (initialized) return;
    initialized = true;
    setDrawer(false);
    syncAuth(auth);
    syncFilters();
    element("#menuToggle")?.addEventListener("click", () => setDrawer(!drawerOpen));
    element("#sidebarBackdrop")?.addEventListener("click", () => setDrawer(false, { restoreFocus: true }));
    element("#accountButton")?.addEventListener("click", (event) => openAccount(event.currentTarget));
    element("#closeAccountDialog")?.addEventListener("click", closeAccount);
    element("#backToFunds")?.addEventListener("click", backToFunds);
    document.querySelectorAll("[data-open-account]").forEach((button) => {
      button.addEventListener("click", (event) => openAccount(event.currentTarget));
    });
    const dialog = element("#accountDialog");
    dialog?.addEventListener("click", (event) => {
      if (event.target !== dialog) return;
      const bounds = dialog.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) closeAccount();
    });
    dialog?.addEventListener("close", () => {
      const canRestoreTrigger = dialogTrigger?.isConnected && dialogTrigger.getClientRects().length > 0 && !dialogTrigger.closest("[hidden], [inert]");
      const focusTarget = canRestoreTrigger ? dialogTrigger : element("#accountButton") || element("#mainContent");
      focusTarget?.focus({ preventScroll: true });
      dialogTrigger = null;
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && drawerOpen) {
        event.preventDefault();
        setDrawer(false, { restoreFocus: true });
      }
      if (event.key === "Escape") {
        document.querySelectorAll(".export-menu[open], .more-filters[open]").forEach((details) => {
          const restoreFocus = details.contains(document.activeElement);
          details.open = false;
          if (restoreFocus) details.querySelector("summary")?.focus();
        });
      }
      if (event.key !== "Tab" || !drawerOpen) return;
      const controls = [...element("#appSidebar").querySelectorAll("button:not([disabled]), a[href]")];
      const first = controls[0];
      const last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    });
    mobile.addEventListener("change", () => setDrawer(false));
    document.addEventListener("click", (event) => {
      document.querySelectorAll(".export-menu[open], .more-filters[open]").forEach((details) => {
        if (!details.contains(event.target)) details.open = false;
      });
    });
  }

  window.WorkspaceShell = { init, syncTab, syncAuth, syncFilters, closeAccount, showFundDetail };
})();

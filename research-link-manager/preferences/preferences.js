window.ResearchLinkManagerPreferences = {
  busy: false,

  init() {
    const settings = Zotero.ResearchLinkManager.getSettings();
    document.getElementById("research-link-manager-root").value = settings.root;
    document.getElementById("research-link-manager-mode").value = settings.linkMode;
    document.getElementById("research-link-manager-startup").checked = settings.startupSync;
    document.getElementById("research-link-manager-apply").addEventListener("command", () => this.apply());
    document.getElementById("research-link-manager-sync").addEventListener("command", () => this.sync());
  },

  async apply() {
    if (this.busy) {
      return;
    }
    this.setBusy(true);
    const status = document.getElementById("research-link-manager-status");
    status.textContent = "Syncing...";
    try {
      const applied = await Zotero.ResearchLinkManager.applySettings({
        root: document.getElementById("research-link-manager-root").value,
        linkMode: document.getElementById("research-link-manager-mode").value,
        startupSync: document.getElementById("research-link-manager-startup").checked
      }, window);
      status.textContent = applied ? "Settings applied and sync completed." : "No changes were applied.";
    }
    catch (error) {
      status.textContent = `Sync failed safely: ${error.message}`;
    }
    finally {
      this.setBusy(false);
    }
  },

  async sync() {
    if (this.busy) {
      return;
    }
    this.setBusy(true);
    const status = document.getElementById("research-link-manager-status");
    status.textContent = "Syncing...";
    try {
      const result = await Zotero.ResearchLinkManager.syncManager.sync("preferences");
      status.textContent = `Sync complete. ${result.links} links managed; ${result.errors} errors.`;
    }
    catch (error) {
      status.textContent = `Sync failed safely: ${error.message}`;
    }
    finally {
      this.setBusy(false);
    }
  },

  setBusy(busy) {
    this.busy = busy;
    document.getElementById("research-link-manager-apply").disabled = busy;
    document.getElementById("research-link-manager-sync").disabled = busy;
  }
};

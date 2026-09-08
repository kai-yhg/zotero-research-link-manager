var ResearchManager = class ResearchManager {
  constructor(logger) {
    this.logger = logger;
    this.stateStore = new StateStore(logger);
    this.linkManager = new LinkManager(logger);
    this.collectionMapper = new CollectionMapper(logger);
    this.syncManager = new SyncManager({
      logger,
      stateStore: this.stateStore,
      linkManager: this.linkManager,
      collectionMapper: this.collectionMapper,
      getSettings: () => this.getSettings()
    });
    this.notifierID = null;
    this.timer = null;
    this.stopped = false;
  }

  async start() {
    this.notifierID = Zotero.Notifier.registerObserver(
      {
        notify: (event, type, ids) => {
          if (this._isRelevantEvent(event, type)) {
            this.logger.info("Zotero change scheduled reconciliation", {
              event,
              type,
              ids: ids.slice(0, 10)
            });
            this.schedule(`notifier:${type}:${event}`);
          }
        }
      },
      ["item", "collection", "collection-item"],
      "research-link-manager"
    );
    if (this.getSettings().startupSync) {
      this.schedule("startup", 3000);
    }
  }

  stop() {
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.notifierID) {
      Zotero.Notifier.unregisterObserver(this.notifierID);
      this.notifierID = null;
    }
  }

  getSettings() {
    return {
      root: Zotero.Prefs.get("research-link-manager.root"),
      linkMode: Zotero.Prefs.get("research-link-manager.linkMode"),
      startupSync: Zotero.Prefs.get("research-link-manager.startupSync")
    };
  }

  schedule(reason, delay = 1500) {
    if (this.stopped) {
      return;
    }
    if (this.timer) {
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      this.syncManager.sync(reason).catch((error) =>
        this.logger.error("Background reconciliation failed", error));
    }, delay);
  }

  async syncWithUI(parentWindow) {
    try {
      const result = await this.syncManager.sync("manual");
      Services.prompt.alert(
        parentWindow || null,
        "Research Link Manager",
        `Sync complete.\n\nManaged links: ${result.links}\nErrors: ${result.errors}`
      );
      return result;
    }
    catch (error) {
      this.logger.error("Manual reconciliation failed", error);
      Services.prompt.alert(
        parentWindow || null,
        "Research Link Manager",
        `Sync failed safely. Zotero data was not changed.\n\n${error.message}`
      );
      throw error;
    }
  }

  async applySettings({ root, linkMode, startupSync }, parentWindow) {
    const normalizedRoot = normalizeRoot(root);
    if (!["auto", "hard", "symbolic"].includes(linkMode)) {
      throw new Error("Invalid link mode");
    }
    const old = this.getSettings();
    if (old.root.toLowerCase() !== normalizedRoot.toLowerCase()) {
      const confirmed = Services.prompt.confirm(
        parentWindow || null,
        "Change Research Root",
        "The new Research view will be built at the selected path. Only links and empty directories verified as plugin-managed may be removed from the old root. Continue?"
      );
      if (!confirmed) {
        return false;
      }
    }
    Zotero.Prefs.set("research-link-manager.root", normalizedRoot);
    Zotero.Prefs.set("research-link-manager.linkMode", linkMode);
    Zotero.Prefs.set("research-link-manager.startupSync", !!startupSync);
    await this.syncManager.sync("settings-change");
    return true;
  }

  _isRelevantEvent(event, type) {
    if (type === "collection-item") {
      return event === "add" || event === "remove";
    }
    if (type === "collection") {
      return ["add", "modify", "move", "trash", "delete"].includes(event);
    }
    return type === "item" && ["add", "modify", "trash", "delete"].includes(event);
  }
};

var StateStore = class StateStore {
  constructor(logger) {
    this.logger = logger;
    this.path = PathUtils.join(Zotero.Profile.dir, "research-link-manager-state.json");
  }

  empty(root = "") {
    return {
      schemaVersion: 1,
      root,
      entries: [],
      managedDirectories: [],
      lastSync: null,
      lastErrors: []
    };
  }

  async load() {
    if (!(await IOUtils.exists(this.path))) {
      return this.empty();
    }
    try {
      const parsed = JSON.parse(await IOUtils.readUTF8(this.path));
      if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.entries)
        || !Array.isArray(parsed.managedDirectories)) {
        throw new Error("Unsupported or invalid state file");
      }
      parsed.entries = parsed.entries.map((entry) => ({ ...entry, owned: true }));
      return parsed;
    }
    catch (error) {
      this.logger.error("Could not read ownership state; no cleanup will be attempted", error);
      return this.empty();
    }
  }

  async save(state) {
    const contents = JSON.stringify(state, null, 2) + "\n";
    await IOUtils.writeUTF8(this.path, contents, { tmpPath: this.path + ".tmp" });
  }
};

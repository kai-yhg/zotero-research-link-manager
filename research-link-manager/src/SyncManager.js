var SyncManager = class SyncManager {
  constructor({ logger, stateStore, linkManager, collectionMapper, getSettings }) {
    this.logger = logger;
    this.stateStore = stateStore;
    this.linkManager = linkManager;
    this.collectionMapper = collectionMapper;
    this.getSettings = getSettings;
    this.running = null;
    this.runAgain = false;
  }

  sync(reason = "manual") {
    if (this.running) {
      this.runAgain = true;
      return this.running;
    }
    this.running = this._run(reason).finally(() => {
      this.running = null;
      if (this.runAgain) {
        this.runAgain = false;
        this.sync("queued");
      }
    });
    return this.running;
  }

  async _run(reason) {
    const started = Date.now();
    const settings = this.getSettings();
    const root = normalizeRoot(settings.root);
    this._validateRoot(root);
    this.logger.info("Starting reconciliation", { reason, root, linkMode: settings.linkMode });

    let state = await this.stateStore.load();
    if (state.root && state.root.toLowerCase() !== root.toLowerCase()) {
      const retained = await this._cleanupObsoleteState(state, new Map());
      if (retained.length) {
        state.entries = retained;
        await this.stateStore.save(state);
        throw new Error("Some old-root paths could not be verified; root change was stopped safely");
      }
      await this._cleanupDirectories(state.managedDirectories, new Set(), state.root);
      state = this.stateStore.empty(root);
    }
    state.root = root;

    if (!(await IOUtils.exists(root))) {
      await IOUtils.makeDirectory(root, { createAncestors: true });
    }
    const rootInfo = await IOUtils.stat(root);
    if (rootInfo.type !== "directory") {
      throw new Error("Research Root exists but is not a directory");
    }

    const desired = await this.collectionMapper.build(root);
    const errors = [];
    const blockedDirectories = [];
    const nextManagedDirs = new Set(state.managedDirectories);
    for (const directory of desired.directories) {
      if (blockedDirectories.some((path) =>
        directory.path.toLowerCase().startsWith(path.toLowerCase() + "\\"))) {
        blockedDirectories.push(directory.path);
        continue;
      }
      try {
        if (!(await IOUtils.exists(directory.path))) {
          await IOUtils.makeDirectory(directory.path, { createAncestors: true });
          nextManagedDirs.add(directory.path);
          this.logger.info("Created collection directory", {
            collectionKey: directory.collectionKey,
            path: directory.path
          });
        }
        else if ((await IOUtils.stat(directory.path)).type !== "directory") {
          throw new Error(`Collection path is occupied by a non-directory: ${directory.path}`);
        }
      }
      catch (error) {
        blockedDirectories.push(directory.path);
        this.logger.error("Could not prepare collection directory", error, {
          collectionKey: directory.collectionKey,
          path: directory.path
        });
        errors.push({
          collectionKey: directory.collectionKey,
          destination: directory.path,
          message: error.message
        });
      }
    }

    const oldByID = new Map(state.entries.map((entry) => [entry.id, entry]));
    const desiredPaths = new Set(
      desired.entries.map((entry) => entry.destination.toLowerCase())
    );
    const nextEntries = [];
    const createdThisRun = [];
    for (const desiredEntry of desired.entries) {
      try {
        if (blockedDirectories.some((path) =>
          desiredEntry.directory.toLowerCase() === path.toLowerCase()
          || desiredEntry.directory.toLowerCase().startsWith(path.toLowerCase() + "\\"))) {
          throw new Error("Collection directory is unavailable");
        }
        const oldEntry = oldByID.get(desiredEntry.id);
        if (oldEntry
          && oldEntry.destination.toLowerCase() === desiredEntry.destination.toLowerCase()
          && await IOUtils.exists(oldEntry.destination)) {
          nextEntries.push({ ...oldEntry, source: desiredEntry.source });
          continue;
        }
        let destination;
        let adoptedFileID = null;
        if (!oldEntry && await IOUtils.exists(desiredEntry.destination)
          && this.linkManager.resolveMode(
            settings.linkMode,
            desiredEntry.source,
            desiredEntry.destination
          ) === "hard") {
          adoptedFileID = await this.linkManager.matchingHardLinkFileID(
            desiredEntry.source,
            desiredEntry.destination
          );
        }
        if (adoptedFileID) {
          destination = desiredEntry.destination;
        }
        else {
          destination = await this._selectDestination(desiredEntry, oldEntry, oldByID);
        }
        const candidate = { ...desiredEntry, destination };
        if (oldEntry && oldEntry.destination.toLowerCase() === destination.toLowerCase()
          && await this.linkManager.verify(
            { ...oldEntry, source: desiredEntry.source },
            { requireSourceMatch: true }
          )) {
          nextEntries.push({ ...oldEntry, source: desiredEntry.source });
          continue;
        }
        if (adoptedFileID) {
          const adoptedEntry = {
            id: desiredEntry.id,
            libraryID: desiredEntry.libraryID,
            attachmentKey: desiredEntry.attachmentKey,
            collectionKey: desiredEntry.collectionKey,
            source: desiredEntry.source,
            destination,
            linkType: "hard",
            fileID: adoptedFileID,
            owned: true
          };
          nextEntries.push(adoptedEntry);
          await this._removeLegacyUnkeyedLink(
            desiredEntry,
            desiredPaths
          );
          this.logger.info("Adopted existing verified PDF hard link", {
            attachmentKey: desiredEntry.attachmentKey,
            collectionKey: desiredEntry.collectionKey,
            source: desiredEntry.source,
            destination
          });
          continue;
        }
        const created = await this.linkManager.create(
          desiredEntry.source,
          destination,
          settings.linkMode
        );
        const newEntry = {
          id: desiredEntry.id,
          libraryID: desiredEntry.libraryID,
          attachmentKey: desiredEntry.attachmentKey,
          collectionKey: desiredEntry.collectionKey,
          source: desiredEntry.source,
          destination,
          linkType: created.linkType,
          fileID: created.fileID,
          owned: true
        };
        nextEntries.push(newEntry);
        createdThisRun.push(newEntry);
        await this._removeLegacyUnkeyedLink(desiredEntry, desiredPaths);
        this.logger.info("Created PDF link", {
          attachmentKey: desiredEntry.attachmentKey,
          collectionKey: desiredEntry.collectionKey,
          source: desiredEntry.source,
          destination,
          linkType: created.linkType
        });
      }
      catch (error) {
        const context = {
          attachmentKey: desiredEntry.attachmentKey,
          collectionKey: desiredEntry.collectionKey,
          source: desiredEntry.source,
          destination: desiredEntry.destination
        };
        this.logger.error("Could not reconcile PDF link", error, context);
        errors.push({ ...context, message: error.message });
      }
    }

    const nextByID = new Map(nextEntries.map((entry) => [entry.id, entry]));
    const desiredIDs = new Set(desired.entries.map((entry) => entry.id));
    const retainedOldEntries = await this._cleanupObsoleteState(state, nextByID, desiredIDs);
    for (const entry of retainedOldEntries) {
      if (!nextEntries.some((current) => current.destination.toLowerCase() === entry.destination.toLowerCase())) {
        nextEntries.push(entry);
      }
    }

    const desiredDirSet = new Set(desired.directories.map((entry) => entry.path.toLowerCase()));
    const retainedDirs = await this._cleanupDirectories(
      Array.from(nextManagedDirs),
      desiredDirSet,
      root
    );

    const nextState = {
      schemaVersion: 1,
      root,
      entries: nextEntries,
      managedDirectories: retainedDirs,
      lastSync: new Date().toISOString(),
      lastErrors: errors.slice(-50)
    };
    try {
      await this.stateStore.save(nextState);
    }
    catch (error) {
      for (const entry of createdThisRun.reverse()) {
        try {
          if (isWithinRoot(root, entry.destination) && await this.linkManager.verify(entry)) {
            await IOUtils.remove(entry.destination);
          }
        }
        catch (cleanupError) {
          this.logger.error("Could not roll back an untracked new link", cleanupError, {
            destination: entry.destination
          });
        }
      }
      throw error;
    }
    this.logger.info("Reconciliation complete", {
      links: nextEntries.length,
      errors: errors.length,
      durationMs: Date.now() - started
    });
    return { links: nextEntries.length, errors: errors.length };
  }

  async _removeLegacyUnkeyedLink(desiredEntry, desiredPaths) {
    const keyedName = PathUtils.filename(desiredEntry.destination);
    const marker = ` [${desiredEntry.attachmentKey}]`;
    const parts = /^(.*)(\.pdf)$/i.exec(keyedName);
    if (!parts || !parts[1].endsWith(marker)) {
      return;
    }
    const legacy = PathUtils.join(
      PathUtils.parent(desiredEntry.destination),
      parts[1].slice(0, -marker.length) + parts[2]
    );
    if (desiredPaths.has(legacy.toLowerCase())
      || !(await IOUtils.exists(legacy))
      || !(await this.linkManager.sameHardLinkedFile(desiredEntry.source, legacy))) {
      return;
    }
    await IOUtils.remove(legacy);
    this.logger.info("Removed verified legacy unkeyed hard link", {
      attachmentKey: desiredEntry.attachmentKey,
      collectionKey: desiredEntry.collectionKey,
      destination: legacy
    });
  }

  _validateRoot(root) {
    const dataDir = String(Zotero.DataDirectory.dir).replace(/\//g, "\\").replace(/\\+$/g, "");
    const lowerRoot = root.toLowerCase();
    const lowerData = dataDir.toLowerCase();
    if (lowerRoot === lowerData || lowerRoot.startsWith(lowerData + "\\")
      || lowerData.startsWith(lowerRoot + "\\")) {
      throw new Error("Research Root must not overlap the Zotero data directory");
    }
  }

  async _selectDestination(desired, oldEntry, oldByID) {
    if (!(await IOUtils.exists(desired.destination))) {
      return desired.destination;
    }
    if (oldEntry && oldEntry.destination.toLowerCase() === desired.destination.toLowerCase()
      && await this.linkManager.verify(
        { ...oldEntry, source: desired.source },
        { requireSourceMatch: true }
      )) {
        return desired.destination;
    }
    if (oldEntry && oldEntry.destination.toLowerCase() === desired.destination.toLowerCase()
      && await this.linkManager.verify(oldEntry)) {
      await IOUtils.remove(oldEntry.destination);
      return desired.destination;
    }
    const occupiedByManaged = Array.from(oldByID.values()).find((entry) =>
      entry.destination.toLowerCase() === desired.destination.toLowerCase());
    if (occupiedByManaged && occupiedByManaged.id === desired.id) {
      return desired.destination;
    }

    throw new Error(`Destination is occupied by an unmanaged file: ${desired.destination}`);
  }

  async _cleanupObsoleteState(state, desiredByID, desiredIDs = new Set()) {
    const retained = [];
    for (const oldEntry of state.entries) {
      const desired = desiredByID.get(oldEntry.id);
      if (desiredIDs.has(oldEntry.id) && !desired) {
        retained.push(oldEntry);
        continue;
      }
      if (desired && desired.destination.toLowerCase() === oldEntry.destination.toLowerCase()) {
        continue;
      }
      if (!isWithinRoot(state.root, oldEntry.destination)) {
        this.logger.warn("Refusing to remove managed path outside recorded root", {
          destination: oldEntry.destination
        });
        retained.push(oldEntry);
        continue;
      }
      if (!oldEntry.owned && !(await this.linkManager.verify(oldEntry))) {
        if (!(await IOUtils.exists(oldEntry.destination))) {
          continue;
        }
        this.logger.warn("Refusing to remove path that no longer verifies as the managed link", {
          destination: oldEntry.destination
        });
        retained.push(oldEntry);
        continue;
      }
      if (!(await IOUtils.exists(oldEntry.destination))) {
        continue;
      }
      await IOUtils.remove(oldEntry.destination);
      this.logger.info("Removed obsolete managed link", {
        attachmentKey: oldEntry.attachmentKey,
        collectionKey: oldEntry.collectionKey,
        destination: oldEntry.destination
      });
    }
    return retained;
  }

  async _cleanupDirectories(managedDirectories, desiredDirectories, root) {
    const retained = [];
    const sorted = managedDirectories.slice().sort((a, b) => b.length - a.length);
    for (const directory of sorted) {
      if (!isWithinRoot(root, directory) || desiredDirectories.has(directory.toLowerCase())) {
        retained.push(directory);
        continue;
      }
      if (!(await IOUtils.exists(directory))) {
        continue;
      }
      try {
        await IOUtils.remove(directory);
        this.logger.info("Removed empty managed directory", { path: directory });
      }
      catch (error) {
        retained.push(directory);
        this.logger.warn("Managed directory is not empty; leaving it untouched", {
          path: directory
        });
      }
    }
    return retained;
  }
};

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const core = require("../research-link-manager/src/Core.js");

function loadClass(file, className, globals) {
  const context = vm.createContext({ ...globals });
  vm.runInContext(fs.readFileSync(file, "utf8"), context, { filename: file });
  return context[className];
}

test("keeps an old managed link when its desired replacement failed", async () => {
  const removed = [];
  const oldEntry = {
    id: "1:ATTACH01:COLL0001",
    destination: "C:\\Research\\Old\\Paper.pdf"
  };
  const SyncManager = loadClass(
    path.join(__dirname, "../research-link-manager/src/SyncManager.js"),
    "SyncManager",
    {
      ...core,
      IOUtils: {
        exists: async () => true,
        remove: async (target) => removed.push(target)
      },
      PathUtils: {
        filename: path.win32.basename,
        parent: path.win32.dirname,
        join: path.win32.join
      },
      Zotero: { DataDirectory: { dir: "C:\\Users\\test\\Zotero" } }
    }
  );
  const instance = Object.create(SyncManager.prototype);
  instance.logger = { info() {}, warn() {} };
  instance.linkManager = { verify: async () => true };
  const retained = await instance._cleanupObsoleteState(
    { root: "C:\\Research", entries: [oldEntry] },
    new Map(),
    new Set([oldEntry.id])
  );
  assert.deepEqual(Array.from(retained), [oldEntry]);
  assert.deepEqual(removed, []);
});

test("removes only obsolete links that still verify as plugin-managed", async () => {
  const removed = [];
  const SyncManager = loadClass(
    path.join(__dirname, "../research-link-manager/src/SyncManager.js"),
    "SyncManager",
    {
      ...core,
      IOUtils: {
        exists: async () => true,
        remove: async (target) => removed.push(target)
      },
      PathUtils: path.win32,
      Zotero: { DataDirectory: { dir: "C:\\Users\\test\\Zotero" } }
    }
  );
  const entries = [
    { id: "verified", destination: "C:\\Research\\verified.pdf" },
    { id: "replaced", destination: "C:\\Research\\replaced.pdf" }
  ];
  const instance = Object.create(SyncManager.prototype);
  instance.logger = { info() {}, warn() {} };
  instance.linkManager = { verify: async (entry) => entry.id === "verified" };
  const retained = await instance._cleanupObsoleteState(
    { root: "C:\\Research", entries },
    new Map()
  );
  assert.deepEqual(removed, ["C:\\Research\\verified.pdf"]);
  assert.deepEqual(Array.from(retained), [entries[1]]);
});

test("removes an obsolete state-owned link even when file-ID lookup is unavailable", async () => {
  const removed = [];
  const SyncManager = loadClass(
    path.join(__dirname, "../research-link-manager/src/SyncManager.js"),
    "SyncManager",
    {
      ...core,
      IOUtils: {
        exists: async () => true,
        remove: async (target) => removed.push(target)
      },
      PathUtils: path.win32,
      Zotero: { DataDirectory: { dir: "C:\\Users\\test\\Zotero" } }
    }
  );
  const entry = {
    id: "deleted",
    destination: "C:\\Research\\deleted.pdf",
    owned: true
  };
  const instance = Object.create(SyncManager.prototype);
  instance.logger = { info() {}, warn() {} };
  instance.linkManager = { verify: async () => false };
  const retained = await instance._cleanupObsoleteState(
    { root: "C:\\Research", entries: [entry] },
    new Map()
  );
  assert.deepEqual(removed, [entry.destination]);
  assert.deepEqual(Array.from(retained), []);
});

test("deleting one attachment removes only its bound Research link", async () => {
  const removed = [];
  const SyncManager = loadClass(
    path.join(__dirname, "../research-link-manager/src/SyncManager.js"),
    "SyncManager",
    {
      ...core,
      IOUtils: {
        exists: async () => true,
        remove: async (target) => removed.push(target)
      },
      PathUtils: path.win32,
      Zotero: { DataDirectory: { dir: "C:\\Users\\test\\Zotero" } }
    }
  );
  const first = {
    id: "1:AB12CD34:COLL0001",
    attachmentKey: "AB12CD34",
    destination: "C:\\Research\\Paper [AB12CD34].pdf",
    owned: true
  };
  const second = {
    id: "1:EF56GH78:COLL0001",
    attachmentKey: "EF56GH78",
    destination: "C:\\Research\\Paper [EF56GH78].pdf",
    owned: true
  };
  const instance = Object.create(SyncManager.prototype);
  instance.logger = { info() {}, warn() {} };
  instance.linkManager = { verify: async () => false };
  const retained = await instance._cleanupObsoleteState(
    { root: "C:\\Research", entries: [first, second] },
    new Map([[second.id, second]]),
    new Set([second.id])
  );
  assert.deepEqual(removed, [first.destination]);
  assert.deepEqual(Array.from(retained), []);
});

test("drops an obsolete owned state entry when its path was already removed", async () => {
  const removed = [];
  const SyncManager = loadClass(
    path.join(__dirname, "../research-link-manager/src/SyncManager.js"),
    "SyncManager",
    {
      ...core,
      IOUtils: {
        exists: async () => false,
        remove: async (target) => removed.push(target)
      },
      PathUtils: path.win32,
      Zotero: { DataDirectory: { dir: "C:\\Users\\test\\Zotero" } }
    }
  );
  const entry = {
    id: "1:AB12CD34:COLL0001",
    destination: "C:\\Research\\Paper.pdf",
    owned: true
  };
  const instance = Object.create(SyncManager.prototype);
  instance.logger = { info() {}, warn() {} };
  instance.linkManager = { verify: async () => false };
  const retained = await instance._cleanupObsoleteState(
    { root: "C:\\Research", entries: [entry] },
    new Map()
  );
  assert.deepEqual(removed, []);
  assert.deepEqual(Array.from(retained), []);
});

test("never adds another attachment-key suffix to an unmanaged occupied path", async () => {
  const SyncManager = loadClass(
    path.join(__dirname, "../research-link-manager/src/SyncManager.js"),
    "SyncManager",
    {
      ...core,
      IOUtils: { exists: async () => true },
      PathUtils: path.win32,
      Zotero: { DataDirectory: { dir: "C:\\Users\\test\\Zotero" } }
    }
  );
  const instance = Object.create(SyncManager.prototype);
  instance.linkManager = { verify: async () => false };
  await assert.rejects(
    instance._selectDestination({
      destination: "C:\\Research\\Paper [AB12CD34].pdf",
      attachmentKey: "AB12CD34"
    }, null, new Map()),
    /occupied by an unmanaged file/
  );
});

test("hard-link verification never treats two missing file IDs as equal", async () => {
  const LinkManager = loadClass(
    path.join(__dirname, "../research-link-manager/src/LinkManager.js"),
    "LinkManager",
    {
      IOUtils: { exists: async () => true },
      PathUtils: path.win32,
      Services: { dirsvc: { get: () => ({ path: "C:\\Windows\\System32" }) } },
      Ci: { nsIFile: {} },
      Zotero: { Utilities: { Internal: { subprocess: async () => "" } } }
    }
  );
  const instance = new LinkManager({ warn() {} }, async () => "no file id available");
  assert.equal(await instance.verify({
    source: "C:\\source.pdf",
    destination: "C:\\destination.pdf",
    linkType: "hard",
    fileID: null
  }), false);
});

test("removes only a same-identity legacy unkeyed link during migration", async () => {
  const removed = [];
  const SyncManager = loadClass(
    path.join(__dirname, "../research-link-manager/src/SyncManager.js"),
    "SyncManager",
    {
      ...core,
      IOUtils: {
        exists: async () => true,
        remove: async (target) => removed.push(target)
      },
      PathUtils: {
        filename: path.win32.basename,
        parent: path.win32.dirname,
        join: path.win32.join
      },
      Zotero: { DataDirectory: { dir: "C:\\Users\\test\\Zotero" } }
    }
  );
  const instance = Object.create(SyncManager.prototype);
  instance.logger = { info() {} };
  instance.linkManager = { sameHardLinkedFile: async () => true };
  const desired = {
    attachmentKey: "AB12CD34",
    collectionKey: "COLL0001",
    source: "C:\\Zotero\\source.pdf",
    destination: "C:\\Research\\Paper - 2025 [AB12CD34].pdf"
  };
  await instance._removeLegacyUnkeyedLink(desired, new Set([
    desired.destination.toLowerCase()
  ]));
  assert.deepEqual(removed, ["C:\\Research\\Paper - 2025.pdf"]);

  removed.length = 0;
  await instance._removeLegacyUnkeyedLink(desired, new Set([
    desired.destination.toLowerCase(),
    "c:\\research\\paper - 2025.pdf"
  ]));
  assert.deepEqual(removed, []);
});

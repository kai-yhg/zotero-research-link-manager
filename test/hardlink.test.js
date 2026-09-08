const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { execFileSync } = require("node:child_process");

function loadLinkManager(ioUtils) {
  const context = vm.createContext({
    IOUtils: ioUtils,
    PathUtils: path.win32,
    Services: { dirsvc: { get: () => ({ path: "C:\\Windows\\System32" }) } },
    Ci: { nsIFile: {} },
    Zotero: { Utilities: { Internal: { subprocess: async () => "" } } },
    btoa
  });
  const file = path.join(__dirname, "../research-link-manager/src/LinkManager.js");
  vm.runInContext(fs.readFileSync(file, "utf8"), context, { filename: file });
  return context.LinkManager;
}

test("Windows fsutil creates a real hard link, not a copy", {
  skip: process.platform !== "win32"
}, () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "research-link-manager-"));
  const source = path.join(directory, "source.pdf");
  const destination = path.join(directory, "Research link.pdf");
  try {
    fs.writeFileSync(source, "original");
    execFileSync("fsutil.exe", ["hardlink", "create", destination, source]);
    const sourceID = execFileSync("fsutil.exe", ["file", "queryFileID", source], { encoding: "utf8" })
      .match(/0x[0-9a-f]+/i)[0];
    const destinationID = execFileSync("fsutil.exe", ["file", "queryFileID", destination], { encoding: "utf8" })
      .match(/0x[0-9a-f]+/i)[0];
    assert.equal(destinationID.toLowerCase(), sourceID.toLowerCase());
    fs.writeFileSync(source, "changed");
    assert.equal(fs.readFileSync(destination, "utf8"), "changed");
  }
  finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("LinkManager reads matching NTFS identities without fsutil queryFileID", {
  skip: process.platform !== "win32"
}, async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "research-link-manager-identity-"));
  const source = path.join(directory, "source.pdf");
  const destination = path.join(directory, "destination.pdf");
  try {
    fs.writeFileSync(source, "content");
    fs.linkSync(source, destination);
    const LinkManager = loadLinkManager({ exists: async (target) => fs.existsSync(target) });
    const runProcess = async (command, args) =>
      execFileSync(command, args, { encoding: "utf8" });
    const manager = new LinkManager({ warn() {} }, runProcess);
    assert.equal(await manager.sameHardLinkedFile(source, destination), true);
    assert.match(await manager.fileID(source), /^[0-9a-f]{8}:[0-9a-f]{16}$/);
  }
  finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("LinkManager records a successful hard link when IOUtils still reports it missing", async () => {
  const destination = "C:\\Research\\unverified.pdf";
  const LinkManager = loadLinkManager({
    exists: async () => false
  });
  const manager = new LinkManager(
    { error() {} },
    async () => ""
  );
  const created = await manager.create("C:\\Zotero\\source.pdf", destination, "hard");
  assert.equal(created.linkType, "hard");
  assert.equal(created.fileID, null);
});

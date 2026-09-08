const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const manifestPath = path.join(__dirname, "..", "research-link-manager", "manifest.json");

test("manifest includes Zotero 9 required compatibility fields", () => {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const zotero = manifest.applications?.zotero;

  assert.equal(manifest.manifest_version, 2);
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  assert.match(zotero?.id, /^[a-z0-9-._]+@[a-z0-9-._]+$/i);
  assert.match(zotero?.update_url, /^https:\/\//);
  assert.equal(zotero?.strict_min_version, "9.0");
  assert.equal(zotero?.strict_max_version, "9.0.*");
  assert.deepEqual(zotero?.data_collection_permissions?.required, ["none"]);
});

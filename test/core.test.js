const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const {
  allocateAttachmentNames,
  buildMetadataPDFFilename,
  buildCollectionPaths,
  fitFilenameToPath,
  isWithinRoot,
  normalizeRoot,
  sanitizePDFFilename,
  sanitizeSegment
} = require("../research-link-manager/src/Core.js");

test("builds PDF names from title and year with stable missing-field fallbacks", () => {
  assert.equal(
    buildMetadataPDFFilename("GraphRAG: A New Approach?", "2025", "AB12CD34"),
    "GraphRAG: A New Approach? - 2025.pdf"
  );
  assert.equal(buildMetadataPDFFilename("Paper A", "", "AB12CD34"), "Paper A.pdf");
  assert.equal(
    buildMetadataPDFFilename("", "2025", "AB12CD34"),
    "attachment-AB12CD34 - 2025.pdf"
  );
  assert.equal(
    buildMetadataPDFFilename("", "0000", "AB12CD34"),
    "attachment-AB12CD34.pdf"
  );
});

test("sanitizes Windows-invalid and reserved names", () => {
  assert.equal(sanitizePDFFilename("GraphRAG: A New Approach?.pdf", "AB12CD34"),
    "GraphRAG_ A New Approach_.pdf");
  assert.equal(sanitizeSegment("CON", "fallback"), "_CON");
  assert.equal(sanitizeSegment("name. ", "fallback"), "name");
  assert.equal(sanitizeSegment("", "fallback"), "fallback");
});

test("keeps each attachment filename stable as duplicate items are added and removed", () => {
  const first = { directory: "C:\\Research\\RAG", filename: "Paper A.pdf", attachmentKey: "AB12CD34" };
  const second = { directory: "C:\\Research\\RAG", filename: "Paper A.pdf", attachmentKey: "EF56GH78" };
  assert.deepEqual(allocateAttachmentNames([first]).map((record) => record.targetName), [
    "Paper A [AB12CD34].pdf"
  ]);
  const records = allocateAttachmentNames([
    first,
    second,
    { directory: "C:\\Research\\LLM", filename: "Paper A.pdf", attachmentKey: "AB12CD34" }
  ]);
  assert.deepEqual(records.map((record) => record.targetName), [
    "Paper A [AB12CD34].pdf",
    "Paper A [EF56GH78].pdf",
    "Paper A [AB12CD34].pdf"
  ]);
  assert.deepEqual(allocateAttachmentNames([second]).map((record) => record.targetName), [
    "Paper A [EF56GH78].pdf"
  ]);
});

test("maps nested collections and disambiguates sanitized sibling names", () => {
  const records = [
    { id: 1, key: "RAG00001", name: "RAG", parentID: null },
    { id: 2, key: "GRAPH001", name: "Graph:RAG", parentID: 1 },
    { id: 3, key: "GRAPH002", name: "Graph?RAG", parentID: 1 }
  ];
  const paths = buildCollectionPaths(records, (base, part) =>
    base ? path.win32.join(base, part) : part);
  assert.equal(paths.get(1), "RAG");
  assert.equal(paths.get(2), "RAG\\Graph_RAG [GRAPH001]");
  assert.equal(paths.get(3), "RAG\\Graph_RAG [GRAPH002]");
});

test("rejects unsafe roots and enforces root containment boundaries", () => {
  assert.equal(normalizeRoot("C:/Research/"), "C:\\Research");
  assert.throws(() => normalizeRoot("Research"));
  assert.throws(() => normalizeRoot("C:\\"));
  assert.equal(isWithinRoot("C:\\Research", "C:\\Research\\RAG\\Paper.pdf"), true);
  assert.equal(isWithinRoot("C:\\Research", "C:\\Research-old\\Paper.pdf"), false);
});

test("truncates a filename deterministically when the full path is too long", () => {
  const directory = "C:\\Research\\" + "x".repeat(180);
  const fitted = fitFilenameToPath(directory, `${"a".repeat(100)}.pdf`, "AB12CD34", 240);
  assert.ok((directory.length + 1 + fitted.length) <= 240);
  assert.match(fitted, / \[AB12CD34\]\.pdf$/);
  assert.doesNotMatch(fitted, /\[AB12CD34\] \[AB12CD34\]/);
});

(function (global, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  else {
    Object.assign(global, api);
  }
})(this, function () {
  const RESERVED_NAMES = new Set([
    "CON", "PRN", "AUX", "NUL",
    "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
    "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9"
  ]);

  function sanitizeSegment(value, fallback, maxLength = 80) {
    let result = String(value || "").normalize("NFKC")
      .replace(/[\\/:*?"<>|\x00-\x1f]/g, "_")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/[ .]+$/g, "");

    if (!result) {
      result = fallback;
    }
    const stem = result.split(".")[0].toUpperCase();
    if (RESERVED_NAMES.has(stem)) {
      result = `_${result}`;
    }
    if (result.length > maxLength) {
      result = result.slice(0, maxLength).replace(/[ .]+$/g, "");
    }
    return result || fallback;
  }

  function splitPDFName(filename) {
    let value = String(filename || "");
    if (/\.pdf$/i.test(value)) {
      return { base: value.slice(0, -4), extension: ".pdf" };
    }
    return { base: value, extension: ".pdf" };
  }

  function sanitizePDFFilename(filename, fallbackKey, maxLength = 120) {
    const { base, extension } = splitPDFName(filename);
    const safeBase = sanitizeSegment(base, `attachment-${fallbackKey}`, maxLength - extension.length);
    return safeBase + extension;
  }

  function buildMetadataPDFFilename(title, year, attachmentKey) {
    const titlePart = String(title || "").trim();
    const yearPart = String(year || "").trim();
    const usableYear = yearPart === "0000" ? "" : yearPart;
    const base = titlePart || `attachment-${attachmentKey}`;
    return usableYear ? `${base} - ${usableYear}.pdf` : `${base}.pdf`;
  }

  function addStableSuffix(filename, suffix, maxLength = 120) {
    const { base, extension } = splitPDFName(filename);
    const marker = ` [${suffix}]`;
    const room = Math.max(1, maxLength - extension.length - marker.length);
    const shortened = base.slice(0, room).replace(/[ .]+$/g, "") || "attachment";
    return shortened + marker + extension;
  }

  function allocateAttachmentNames(records) {
    return records.map((record) => {
      const safeName = sanitizePDFFilename(record.filename, record.attachmentKey);
      return {
        ...record,
        targetName: addStableSuffix(safeName, record.attachmentKey)
      };
    });
  }

  function buildCollectionPaths(records, join) {
    const byID = new Map(records.map((record) => [record.id, record]));
    const siblingGroups = new Map();
    for (const record of records) {
      const safeName = sanitizeSegment(record.name, `collection-${record.key}`);
      record.safeName = safeName;
      const groupKey = `${record.parentID || 0}\u0000${safeName.toLowerCase()}`;
      if (!siblingGroups.has(groupKey)) {
        siblingGroups.set(groupKey, []);
      }
      siblingGroups.get(groupKey).push(record);
    }

    const cache = new Map();
    const resolving = new Set();
    function resolve(record) {
      if (cache.has(record.id)) {
        return cache.get(record.id);
      }
      if (resolving.has(record.id)) {
        throw new Error(`Collection cycle detected at ${record.key}`);
      }
      resolving.add(record.id);
      const groupKey = `${record.parentID || 0}\u0000${record.safeName.toLowerCase()}`;
      const segment = siblingGroups.get(groupKey).length > 1
        ? `${record.safeName} [${record.key}]`
        : record.safeName;
      let parts = [segment];
      if (record.parentID) {
        const parent = byID.get(record.parentID);
        if (!parent) {
          throw new Error(`Missing parent collection for ${record.key}`);
        }
        parts = resolve(parent).concat(parts);
      }
      resolving.delete(record.id);
      cache.set(record.id, parts);
      return parts;
    }

    const result = new Map();
    for (const record of records) {
      result.set(record.id, resolve(record).reduce((path, part) => join(path, part), ""));
    }
    return result;
  }

  function fitFilenameToPath(directory, filename, attachmentKey, maxPath = 240) {
    const separatorCost = directory.endsWith("\\") ? 0 : 1;
    const available = maxPath - directory.length - separatorCost;
    if (available < 24) {
      throw new Error(`Collection path is too long for attachment ${attachmentKey}`);
    }
    if (filename.length <= available) {
      return filename;
    }
    const marker = ` [${attachmentKey}]`;
    const { base, extension } = splitPDFName(filename);
    const unsuffixed = base.endsWith(marker) ? base.slice(0, -marker.length) + extension : filename;
    return addStableSuffix(unsuffixed, attachmentKey, available);
  }

  function normalizeRoot(value) {
    let root = String(value || "").trim().replace(/\//g, "\\");
    if (!/^[A-Za-z]:\\/.test(root)) {
      throw new Error("Research Root must be an absolute Windows drive path");
    }
    root = root.replace(/\\+$/g, "");
    if (/^[A-Za-z]:$/.test(root)) {
      throw new Error("A drive root cannot be used as Research Root");
    }
    return root;
  }

  function isWithinRoot(root, candidate) {
    const normalizedRoot = normalizeRoot(root).toLowerCase();
    const normalizedCandidate = String(candidate || "").replace(/\//g, "\\").toLowerCase();
    return normalizedCandidate.startsWith(normalizedRoot + "\\");
  }

  return {
    RESERVED_NAMES,
    addStableSuffix,
    allocateAttachmentNames,
    buildMetadataPDFFilename,
    buildCollectionPaths,
    fitFilenameToPath,
    isWithinRoot,
    normalizeRoot,
    sanitizePDFFilename,
    sanitizeSegment
  };
});

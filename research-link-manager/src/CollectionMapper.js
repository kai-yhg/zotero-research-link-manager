var CollectionMapper = class CollectionMapper {
  constructor(logger) {
    this.logger = logger;
  }

  async build(root) {
    const libraryID = Zotero.Libraries.userLibraryID;
    const collections = Zotero.Collections.getByLibrary(libraryID, true, false);
    const records = collections.map((collection) => ({
      id: collection.id,
      key: collection.key,
      name: collection.name,
      parentID: collection.parentID || null
    }));
    const relativePaths = buildCollectionPaths(records, (base, part) =>
      base ? PathUtils.join(base, part) : part);
    const directories = [];
    for (const collection of collections) {
      const path = PathUtils.join(root, relativePaths.get(collection.id));
      if (path.length > 220) {
        this.logger.warn("Collection path exceeds the safe Windows path budget", {
          collectionKey: collection.key,
          path
        });
        continue;
      }
      directories.push({
        collectionID: collection.id,
        collectionKey: collection.key,
        path
      });
    }
    const directoryByCollectionID = new Map(
      directories.map((directory) => [directory.collectionID, directory])
    );

    const items = await Zotero.Items.getAll(libraryID, false, false);
    const attachmentRecords = [];
    for (const attachment of items) {
      if (!attachment.isAttachment() || !attachment.isPDFAttachment()
        || !attachment.isStoredFileAttachment() || attachment.deleted) {
        continue;
      }
      const source = await attachment.getFilePathAsync();
      if (!source) {
        this.logger.warn("Stored PDF has no local file", {
          attachmentKey: attachment.key
        });
        continue;
      }
      const owner = attachment.parentItemID
        ? await Zotero.Items.getAsync(attachment.parentItemID)
        : attachment;
      if (!owner || owner.deleted) {
        continue;
      }
      const metadataFilename = buildMetadataPDFFilename(
        owner.getField("title"),
        owner.getField("year"),
        attachment.key
      );
      for (const collectionID of owner.getCollections(false)) {
        const directory = directoryByCollectionID.get(collectionID);
        if (!directory) {
          continue;
        }
        attachmentRecords.push({
          id: `${libraryID}:${attachment.key}:${directory.collectionKey}`,
          libraryID,
          attachmentID: attachment.id,
          attachmentKey: attachment.key,
          collectionID,
          collectionKey: directory.collectionKey,
          directory: directory.path,
          filename: metadataFilename,
          source
        });
      }
    }

    const entries = allocateAttachmentNames(attachmentRecords).map((record) => {
      const targetName = fitFilenameToPath(
        record.directory,
        record.targetName,
        record.attachmentKey
      );
      return {
        ...record,
        destination: PathUtils.join(record.directory, targetName)
      };
    });

    entries.sort((a, b) => a.id.localeCompare(b.id));
    directories.sort((a, b) => a.path.length - b.path.length || a.path.localeCompare(b.path));
    return { directories, entries };
  }
};

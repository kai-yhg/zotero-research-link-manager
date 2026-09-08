# Test Matrix

Automated tests cover Windows filename sanitization, reserved names, stable
attachment-key filenames, nested Collection mapping, root containment, path-length
truncation, and real NTFS hard-link identity.

Run `npm test`, then `npm run build`.

## Zotero integration tests

Use a separate Zotero profile and an isolated Research Root. Never use the
production `C:\Research` for destructive test setup.

1. Save a paper from Edge and confirm its Zotero PDF appears before the Research
   link. Verify the Research path with `fsutil file queryFileID` on both paths.
2. Add one item to three Collections and verify three links share the source
   file ID.
3. Move a Collection and verify Repair creates the new path and removes only the
   old managed link/empty directory.
4. Remove an item from a Collection and verify only that Research link is
   removed.
5. Change the parent item's title or year and verify the Research filename
   changes to `Title - Year [attachmentKey].pdf`. Renaming only the stored attachment file
   must not change the metadata-derived Research filename.
6. Trash/delete an item and verify managed links are removed while unrelated
   Research files remain.
7. Restart Zotero and inspect the debug log for a successful startup
   reconciliation.
8. Delete one Research link manually, run Sync / Repair, and verify it is
   recreated with the same NTFS file ID.
9. Change Research Root and confirm only verified managed links and empty
   plugin-created directories are removed from the old root.
10. In Auto mode on the same drive, verify `HardLink` and matching file IDs.
11. Create two attachments with the same title in one Collection and verify
    each receives its stable key suffix. Delete either attachment and verify
    the other filename does not change.
12. Test invalid characters and Windows reserved names.
13. Deny write access to an isolated Research Root, save from Edge, and verify
    Zotero succeeds while the plugin logs an error.
14. Trigger Sync twice rapidly and verify that only one path exists for each
    attachment. Simulate a missing state entry and verify Repair adopts the
    matching keyed hard link and removes only its same-identity legacy
    unkeyed path.

Symbolic-link testing is optional on this single-drive machine and requires
Windows Developer Mode or an elevated Zotero process.

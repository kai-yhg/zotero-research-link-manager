var LinkManager = class LinkManager {
  constructor(logger, runProcess) {
    this.logger = logger;
    this.runProcess = runProcess || ((command, args) =>
      Zotero.Utilities.Internal.subprocess(command, args));
    const systemDir = Services.dirsvc.get("SysD", Ci.nsIFile).path;
    this.fsutil = PathUtils.join(systemDir, "fsutil.exe");
    this.powershell = PathUtils.join(systemDir, "WindowsPowerShell", "v1.0", "powershell.exe");
  }

  drive(path) {
    const match = /^([A-Za-z]):\\/.exec(path);
    return match ? match[1].toUpperCase() : null;
  }

  resolveMode(requestedMode, source, destination) {
    if (requestedMode === "hard" || requestedMode === "symbolic") {
      return requestedMode;
    }
    return this.drive(source) && this.drive(source) === this.drive(destination)
      ? "hard"
      : "symbolic";
  }

  async create(source, destination, requestedMode) {
    const linkType = this.resolveMode(requestedMode, source, destination);
    let created = false;
    try {
      if (linkType === "hard") {
        if (this.drive(source) !== this.drive(destination)) {
          throw new Error("Hard links require source and destination on the same volume");
        }
        await this.runProcess(this.fsutil, ["hardlink", "create", destination, source]);
      }
      else {
        const script = `New-Item -ItemType SymbolicLink -LiteralPath ${this._psQuote(destination)} -Target ${this._psQuote(source)} -ErrorAction Stop | Out-Null`;
        await this._runPowerShell(script);
      }
      created = true;
      // fsutil returning successfully is authoritative. IOUtils can briefly retain a
      // negative result for a newly-created hard link, which would leave it untracked.
      if (linkType === "hard") {
        return { linkType, fileID: null };
      }
      if (!(await IOUtils.exists(destination))) {
        throw new Error(`${linkType} link was not created`);
      }
      const fileID = null;
      const entry = { source, destination, linkType, fileID };
      if (!(await this.verify(entry))) {
        throw new Error(`${linkType} link verification failed`);
      }
      return { linkType, fileID };
    }
    catch (error) {
      if (created && await IOUtils.exists(destination)) {
        try {
          await IOUtils.remove(destination);
        }
        catch (cleanupError) {
          this.logger.error("Could not roll back an unverified link", cleanupError, { destination });
        }
      }
      throw error;
    }
  }

  async verify(entry, { requireSourceMatch = false } = {}) {
    try {
      if (entry.linkType === "hard") {
        if (!(await IOUtils.exists(entry.destination))) {
          return false;
        }
        const paths = requireSourceMatch || !entry.fileID
          ? [entry.destination, entry.source]
          : [entry.destination];
        if (paths.length === 2 && !(await IOUtils.exists(entry.source))) {
          return false;
        }
        const [destinationID, sourceID] = await this._fileIDs(paths);
        if (entry.fileID) {
          if (destinationID !== entry.fileID) {
            return false;
          }
          if (!requireSourceMatch) {
            return true;
          }
          return destinationID === sourceID;
        }
        return !!destinationID && !!sourceID && destinationID === sourceID;
      }
      if (entry.linkType === "symbolic") {
        const script = `$i=Get-Item -LiteralPath ${this._psQuote(entry.destination)} -Force; [Console]::Out.WriteLine($i.LinkType); [Console]::Out.WriteLine($i.Target)`;
        const output = await this._runPowerShell(script);
        const lines = String(output).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
        return lines[0] === "SymbolicLink"
          && lines.slice(1).join(" ").toLowerCase() === entry.source.toLowerCase();
      }
    }
    catch (error) {
      this.logger.warn("Link verification failed", {
        destination: entry.destination,
        error: error.message
      });
    }
    return false;
  }

  async sameHardLinkedFile(source, destination) {
    return !!(await this.matchingHardLinkFileID(source, destination));
  }

  async matchingHardLinkFileID(source, destination) {
    try {
      if (!(await IOUtils.exists(source)) || !(await IOUtils.exists(destination))) {
        return null;
      }
      const [sourceID, destinationID] = await this._fileIDs([source, destination]);
      return sourceID && sourceID === destinationID ? sourceID : null;
    }
    catch (error) {
      this.logger.warn("Hard-link identity comparison failed", {
        source,
        destination,
        error: error.message
      });
      return null;
    }
  }

  fileID(path) {
    return this._fileID(path);
  }

  async _fileID(path) {
    return (await this._fileIDs([path]))[0] || null;
  }

  async _fileIDs(paths) {
    const code = `
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
public static class RLMFileIdentity {
  [StructLayout(LayoutKind.Sequential)]
  public struct Info {
    public uint Attributes;
    public System.Runtime.InteropServices.ComTypes.FILETIME CreationTime;
    public System.Runtime.InteropServices.ComTypes.FILETIME AccessTime;
    public System.Runtime.InteropServices.ComTypes.FILETIME WriteTime;
    public uint VolumeSerialNumber, FileSizeHigh, FileSizeLow, NumberOfLinks, FileIndexHigh, FileIndexLow;
  }
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  static extern IntPtr CreateFile(string name, uint access, uint share, IntPtr security, uint creation, uint flags, IntPtr template);
  [DllImport("kernel32.dll", SetLastError=true)]
  static extern bool GetFileInformationByHandle(IntPtr handle, out Info info);
  [DllImport("kernel32.dll")]
  static extern bool CloseHandle(IntPtr handle);
  public static string Get(string path) {
    IntPtr handle = CreateFile(path, 0, 7, IntPtr.Zero, 3, 0x02000000, IntPtr.Zero);
    if (handle == new IntPtr(-1)) throw new Win32Exception(Marshal.GetLastWin32Error());
    try {
      Info info;
      if (!GetFileInformationByHandle(handle, out info)) throw new Win32Exception(Marshal.GetLastWin32Error());
      return info.VolumeSerialNumber.ToString("x8") + ":" + info.FileIndexHigh.ToString("x8") + info.FileIndexLow.ToString("x8");
    }
    finally { CloseHandle(handle); }
  }
}`;
    const pathArray = paths.map((path) => this._psQuote(path)).join(",");
    const script = `Add-Type -TypeDefinition ${this._psQuote(code)}; foreach($path in @(${pathArray})) { [Console]::Out.WriteLine([RLMFileIdentity]::Get($path)) }`;
    const output = await this._runPowerShell(script);
    return Array.from(String(output).matchAll(/[0-9a-f]{8}:[0-9a-f]{16}/ig),
      (match) => match[0].toLowerCase());
  }

  _psQuote(value) {
    return `'${String(value).replace(/'/g, "''")}'`;
  }

  _encodedPowerShell(script) {
    let binary = "";
    for (let i = 0; i < script.length; i++) {
      const code = script.charCodeAt(i);
      binary += String.fromCharCode(code & 0xff, code >>> 8);
    }
    return btoa(binary);
  }

  _runPowerShell(script) {
    return this.runProcess(this.powershell, [
      "-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand",
      this._encodedPowerShell(script)
    ]);
  }
};

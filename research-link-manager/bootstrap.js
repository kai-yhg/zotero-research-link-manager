const PLUGIN_ID = "research-link-manager@local";
const PREF_PANE_ID = "research-link-manager-preferences";

var manager;
var menuID;
var preferencePaneID;

async function startup({ rootURI }) {
  const scope = {
    Zotero,
    Services,
    Cc,
    Ci,
    IOUtils,
    PathUtils,
    btoa,
    setTimeout,
    clearTimeout
  };
  const scripts = [
    "Core.js",
    "Logger.js",
    "StateStore.js",
    "LinkManager.js",
    "CollectionMapper.js",
    "SyncManager.js",
    "ResearchManager.js"
  ];
  for (const script of scripts) {
    Services.scriptloader.loadSubScript(rootURI + "src/" + script, scope, "UTF-8");
  }

  manager = new scope.ResearchManager(new scope.Logger());
  Zotero.ResearchLinkManager = manager;

  preferencePaneID = await Zotero.PreferencePanes.register({
    pluginID: PLUGIN_ID,
    id: PREF_PANE_ID,
    label: "Research Link Manager",
    src: rootURI + "preferences/preferences.xhtml",
    scripts: [rootURI + "preferences/preferences.js"]
  });

  menuID = Zotero.MenuManager.registerMenu({
    menuID: "research-link-manager-tools",
    pluginID: PLUGIN_ID,
    target: "main/menubar/tools",
    menus: [
      {
        menuType: "menuitem",
        l10nID: "research-link-manager-menu-sync",
        onCommand: () => manager.syncWithUI(Zotero.getMainWindow()).catch(() => {})
      },
      {
        menuType: "menuitem",
        l10nID: "research-link-manager-menu-settings",
        onCommand: () => Zotero.Utilities.Internal.openPreferences(PREF_PANE_ID)
      }
    ]
  });

  await manager.start();
}

function shutdown() {
  if (manager) {
    manager.stop();
  }
  if (menuID) {
    Zotero.MenuManager.unregisterMenu(menuID);
  }
  if (preferencePaneID) {
    Zotero.PreferencePanes.unregister(preferencePaneID);
  }
  delete Zotero.ResearchLinkManager;
  manager = null;
  menuID = null;
  preferencePaneID = null;
}

function install() {}

function uninstall() {}

function onMainWindowLoad() {}

function onMainWindowUnload() {}

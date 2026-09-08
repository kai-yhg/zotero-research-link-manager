# Research Link Manager 架构分析

## 范围与已验证基线

本分析以本机安装的 Zotero 9.0.6（Build ID 20260707151128，Gecko 140）和用户提供的 Connector 源码 `C:\tools\zotero-connectors` 为依据。下文引用的 Zotero 应用源码提取自本机安装目录中的 `C:\tools\Zotero\app\omni.ja`。

本插件被明确设计为单向数据流：

```text
官方浏览器 Connector -> Zotero Desktop -> Research Link Manager -> C:\Research
```

Zotero 始终是唯一数据源。插件从不写入 `zotero.sqlite`，不修改附件元数据，不移动 Zotero storage 中的文件，也绝不复制 PDF。

## 架构问题逐项回答

### 1. Connector 如何保存条目和 PDF

Edge/Chrome Connector 是一个 Manifest V3 WebExtension。注入页面的翻译代码负责提取条目元数据，后台 Service Worker 协调整个保存流程，`Zotero.Connector.callMethod()` 则通过 HTTP 向 Zotero Desktop 的 Connector 服务器 `http://127.0.0.1:23119/` 发送请求。

Desktop 在 `xpcom/server/server_connector.js` 中实现了 `/connector/saveItems`、`/connector/saveAttachment`、`/connector/saveStandaloneAttachment` 和 `/connector/saveSnapshot`。Desktop 创建 Zotero 条目，并将附件数据流导入 Zotero 管理的存储目录。数据库事务提交后，Zotero 才会发出 Notifier 事件。

不需要由 Connector 提供额外回调：Research Link Manager 所需的操作只应在 Zotero 成功创建或修改条目/附件后启动。

### 2. 附件文件系统路径 API

对于附件类型的 `Zotero.Item`，只有关联文件确实存在时，`await item.getFilePathAsync()` 才会返回解析后的绝对路径。插件会先检查 `item.isPDFAttachment()` 和 `item.isStoredFileAttachment()`。

`getFilePath()` 也存在，但它是同步方法，并且不验证文件是否存在。`attachmentPath` 是 Zotero 内部保存的值，例如 `storage:filename.pdf`，本插件不得自行解析该值。

### 3. Zotero 9 相关 Notifier 事件

`Zotero.Notifier.registerObserver(ref, types, id)` 接收一个实现了 `notify(event, type, ids, extraData)` 的观察者。Zotero 9.0.6 中与本项目相关的事件类型如下：

- `item`：add、modify、trash、delete
- `collection`：add、modify、move、trash、delete
- `collection-item`：添加和移除 Collection 成员关系
- `file`：文件相关事件，但它并不是一套完整的附件重命名 API

Notifier 会捕获并记录观察者抛出的异常，因此插件观察者出错不会中止其他观察者，也不会让已经提交的 Connector 保存操作失败。

### 4. Collection 成员关系事件

成员关系变化会加入 `collection-item` 通知队列。每个 ID 编码为 `<collectionID>-<itemID>`。为了保证正确性，插件不依赖这一编码格式；它只把这些事件当作“现有派生状态已经失效”的信号，然后针对当前 Item/Collection 官方 API 返回的数据执行一次防抖后的 reconciliation（状态校准）。

条目的直接 Collection 成员关系由 `item.getCollections(false)` 返回。子级 PDF 附件沿用其父级普通条目的 Collection 成员关系；独立保存的 PDF 附件则使用附件自身的 Collection 成员关系。

Research 中的 PDF 基础名称来自所属条目的标题和年份，格式为
`标题 - 年份.pdf`。缺少年份时省略年份；缺少标题时使用稳定的
`attachment-<attachmentKey>`。每个文件名始终追加附件 Key，而不是仅在发生重名时追加。这样目标路径只由该 attachment 自身的元数据、attachment key 和 Collection 决定；其他同名条目的增加或删除不会导致已有链接改名。

### 5. Zotero 9 插件如何创建文件系统链接

Zotero 插件仍然拥有特权文件访问和子进程执行能力。目录和状态文件操作使用 `IOUtils`/`PathUtils`。Windows 链接创建则通过 `Zotero.Utilities.Internal.subprocess(command, args)` 调用操作系统内置命令：

- 硬链接：`fsutil.exe hardlink create <destination> <source>`
- 符号链接：PowerShell `New-Item -ItemType SymbolicLink`

所有参数都以数组形式传递；附件文件名不会拼接到 shell 命令字符串中。

### 6. XPCOM 是否直接支持硬链接

Zotero 9/Gecko 140 中 Zotero 所使用的文件 API 没有提供受支持的跨平台硬链接创建方法。本插件不使用 `nsIFile` 创建硬链接。与增加原生二进制 helper 相比，调用 Windows 内置的 `fsutil.exe` 体积更小，也更容易审计。

### 7. 符号链接是否需要原生 helper

不需要。PowerShell 可以请求创建符号链接。不过，当 Windows Developer Mode 未启用且 Zotero 进程没有管理员权限时，Windows 仍可能拒绝创建。此类失败会被记录，之后可通过 Repair 重试；插件绝不会退回到复制 PDF。

本机的 Zotero storage 与 Research Root 都位于 `C:`，因此 `Auto` 模式会选择硬链接，不涉及符号链接权限问题。

### 8. 是否需要修改 Connector

不需要。Connector 已经把元数据和附件数据交给 Desktop。Desktop Notifier 提供了所需的保存后失效信号，启动同步和手动 reconciliation 则可以弥补遗漏的事件。修改 Connector 会重复实现生命周期逻辑，使本功能与浏览器扩展更新绑定，而且仍然无法覆盖用户直接在 Zotero Desktop 中进行的修改。

### 9. 是否需要修改 Zotero Desktop 核心

不需要。独立 bootstrap 插件已经可以使用 Attachment、Item、Collection、Notifier、Preferences、Menu、特权文件访问和子进程执行能力。

### 10. 推荐的独立插件结构

```text
research-link-manager/
  manifest.json
  bootstrap.js
  prefs.js
  src/
    Core.js
    Logger.js
    StateStore.js
    LinkManager.js
    CollectionMapper.js
    SyncManager.js
    ResearchManager.js
  preferences/
    preferences.xhtml
    preferences.js
  locale/{en-US,zh-CN}/research-link-manager.ftl
```

### 11. Zotero 9 插件要求

当前实现是一个包含 `manifest.json` 和 `bootstrap.js` 的 bootstrap 扩展。`applications.zotero` 声明插件 ID、必需的 HTTPS 更新清单 URL，以及经过测试的 Zotero 版本范围。Zotero 9 会拒绝缺少 `update_url` 的 Desktop 插件清单。在具备真实发布地址之前，本地安装包使用保留域名 `example.invalid`。插件还通过 `data_collection_permissions` 声明不收集数据。

插件生命周期钩子为 `startup`、`shutdown`、`install` 和 `uninstall`。界面功能使用 Zotero 官方的 `MenuManager` 和 `PreferencePanes` API，而不是 XUL overlay。Fluent 文件负责界面本地化。

Zotero 9 的 Gecko 140 基础环境在内部使用标准 Promise 和现代 ESM。本插件使用由 bootstrap 加载的脚本，因此不需要动态注册 ESM。

### 12. 稳定 API 与内部 API

本插件使用的公开或成熟 Zotero 插件接口包括：

- bootstrap 生命周期和 `manifest.json`
- `Zotero.PreferencePanes.register()`
- `Zotero.MenuManager.registerMenu()`
- `Zotero.Notifier.registerObserver()`
- Item 方法（`isPDFAttachment`、`isStoredFileAttachment`、`getFilePathAsync`、`getCollections`）
- `Zotero.Items`、`Zotero.Collections` 和 `Zotero.Prefs`
- 平台全局对象 `IOUtils` 和 `PathUtils`

封装在 `LinkManager` 后面的内部接口只有：

- `Zotero.Utilities.Internal.subprocess()`

子进程封装是主要兼容性风险。如果 Zotero 将来修改该接口，只需替换 `LinkManager.js`。插件没有使用 Zotero 数据库内部接口。

## 推荐架构

使用独立的 Zotero 9 bootstrap 插件。注册一个开销很小的 Notifier 观察者，它只负责安排一次防抖后的 reconciliation。Zotero 启动时，或用户执行“工具”菜单中的 `Sync / Repair Research Links` 时，插件根据当前用户文献库计算完整的目标视图，再将其与保存在 Zotero profile 中的 JSON 所有权清单进行校准。

在 `Auto` 模式下，如果源路径和目标路径的盘符相同，则使用硬链接。只有跨卷或用户明确指定时才使用符号链接。绝不复制 PDF，也绝不覆盖未受插件管理的路径。

## 选择这一架构的原因

- 它既能覆盖 Connector 保存，也能覆盖直接在 Zotero 中进行的所有修改。
- 它在 Zotero 提交事务后运行，因此链接功能失败不会影响抓取或保存。
- Reconciliation 能让重启、重命名、事件遗漏、手动删除和根目录变化最终收敛到同一个确定状态。
- 保存在 profile 中的所有权记录允许插件执行保守清理，不必在用户的 Research 目录中放置控制标记。
- 链接创建逻辑与 Zotero 数据 API 隔离；如果平台行为发生变化，可以单独更新链接模块。
- 同步请求会串行化并进行防抖，重复点击不会并行执行。硬链接身份通过
  Windows 文件句柄 API 验证，不依赖需要额外权限的
  `fsutil file queryFileID`。新链接若未通过验证会立即回滚。

## 安全与所有权规则

状态文件记录准确的 Research Root、attachment key、collection key、源路径、目标路径、链接类型和所有权标记。对于状态中标记为 `owned: true` 的路径，只有同时满足以下条件，插件才会执行清理：

1. 该路径记录在插件状态中；
2. 该路径位于记录的 Research Root 之下。

`owned: true` 是插件创建并登记该链接的所有权凭据。这样即使 Windows 文件标识查询不可用，Connector 分阶段写入元数据后产生的临时链接、Zotero 重命名后的旧链接以及已删除条目的链接仍能被正确清理。只有当某个目录由插件创建且当前为空时，插件才会删除它。Research Root 本身永远不会被删除。

未登记路径不属于插件，绝不会仅凭文件名被接管或删除。如果状态文件曾因异常未记录已创建的硬链接，Repair 只会在目标与 Zotero
源文件具有相同 NTFS 文件标识时接管目标。升级到固定 attachment key
命名时，旧版本生成的无 Key 路径也只有在 NTFS 文件标识与对应源文件相同时才会删除。

## v1 的明确边界

- 仅处理用户文献库，不镜像群组文献库。
- 仅处理 Zotero 管理的 stored PDF，排除 linked-file PDF。
- 仅使用条目的直接 Collection 成员关系；属于子 Collection 不会自动在每个祖先 Collection 中再创建一个链接。
- 不导出 annotation 或 note。
- 启动时执行完整 reconciliation，而不是增量 reconciliation。运行期间的事件会进行防抖，因此一次 Connector 批量保存只触发一次处理，而不是每条附件通知各触发一次。

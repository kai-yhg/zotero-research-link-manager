# Zotero 9 Research Link Manager

Research Link Manager 在用户配置的 Windows 目录下，为 Zotero 管理的 PDF 创建文件系统视图。插件会镜像 Collection 目录结构，并为每个 PDF 创建指向 Zotero 原始文件的硬链接或符号链接，绝不复制 PDF。

本项目不修改官方 Edge Zotero Connector。源码级架构分析和 API 边界见 [ARCHITECTURE.md](ARCHITECTURE.md)。

## 功能行为

- 默认 Research 根目录：`C:\Research`
- 默认链接模式：`Auto`
- `Auto` 模式在源文件和目标路径盘符相同时使用硬链接，否则使用符号链接。
- 仅镜像用户文献库中由 Zotero 管理的 PDF 附件。
- 子级 PDF 附件继承其父条目的直接 Collection 成员关系。
- 顶层 Collection 直接映射为 Research 根目录的子目录。
- 一个附件属于多个 Collection 时，会在每个对应目录中各创建一个链接。
- PDF 根据 Zotero 元数据命名为 `标题 - 年份 [attachmentKey].pdf`。缺少年份时省略年份；缺少标题时使用 `attachment-<attachmentKey>`。
- 每个文件名始终包含稳定的附件 Key。添加或删除其他同名条目不会导致已有 Research 链接改名。
- 绝不覆盖现有的普通文件。

## 构建

环境要求：

- Windows PowerShell 5.1 或更高版本
- Node.js 20 或更高版本，用于运行测试

执行：

```powershell
npm test
npm run build
```

生成的插件安装包位于：

```text
outputs\research-link-manager-0.1.7.xpi
```

## 安装

1. 在 Zotero 中打开“工具 -> 插件”。
2. 打开齿轮菜单，选择“从文件安装插件”。
3. 选择 `research-link-manager-0.1.7.xpi`。
4. 打开“编辑 -> 设置 -> Research Link Manager”。
5. 确认 Research 根目录和链接模式，然后选择“应用并同步”。

插件清单有意将兼容范围限制为已验证的 Zotero `9.0.*`。

Zotero 9 要求每个桌面插件在清单中声明 HTTPS `applications.zotero.update_url`。当前本地构建使用保留域名 `example.invalid`，因此不会下载更新。正式发布自动更新前，需要将其替换为真实托管的 Zotero 更新清单地址。清单同时声明 `data_collection_permissions.required: ["none"]`，表示 Research Link Manager 不会向外发送 Zotero 或 Research 数据。

## 配置与修复

设置页面提供：

- Research 根目录
- `Auto`、`Hard link` 或 `Symbolic link` 链接模式
- 启动时同步开关

可以随时使用“工具 -> Sync / Repair Research Links”重新创建缺失链接、更新因元数据变化而重命名的 PDF、同步 Collection 移动和成员关系变化，以及删除过期的插件管理链接。

同步操作具有幂等性：重复或重叠的同步请求会串行执行。同步修复还可以找回因同步中断而未登记的链接，但前提是其 NTFS 文件标识与 Zotero 源文件完全一致。升级旧版命名时，也只会删除与对应 Zotero 源文件具有相同文件标识的旧式无 Key 路径。

修改 Research 根目录前需要确认。清理旧根目录时，插件仅处理其所有权状态中登记的链接，以及由插件创建且已经为空的目录；Research 根目录本身永远不会被删除。

## 日志与状态

运行日志会写入 Zotero 的调试或错误日志，并使用前缀 `[Research Link Manager]`。相关消息会尽可能记录附件 Key、Collection Key、源路径、目标路径、链接类型和错误内容。

所有权状态保存在 Zotero profile 中：

```text
research-link-manager-state.json
```

Zotero 运行时不要手动修改该文件。状态文件不放在 Research 根目录中，因此 Research 中原有的内容不会被当作插件所有。

## 安全保证

- 不直接访问 SQLite。
- 不修改 Zotero 元数据或 storage 文件。
- 不复制 PDF，也没有复制回退机制。
- 不覆盖未受插件管理的文件。
- 不递归删除 Research 根目录。
- 删除链接必须同时满足所有权状态登记和 Research 根目录边界检查。
- 未登记路径仍必须通过文件身份验证，绝不会仅凭文件名被接管或删除。
- Notifier 或链接操作异常会在 Zotero 保存事务完成后被捕获并记录，不会让一次成功的 Connector 抓取变成 Zotero 保存失败。

## 已知限制

- v1 不镜像群组文献库。
- 不处理 linked-file 附件，仅处理 Zotero 管理的 stored PDF。
- 条目只出现在其直接所属的 Collection 目录中，不会同时出现在所有祖先 Collection 目录中。
- 创建符号链接依赖 Windows Developer Mode 或管理员权限。失败时只记录错误，绝不会回退为复制 PDF。
- 运行期间发生变化时，会触发一次经过防抖的完整用户文献库校准。该方式可靠，但超大型文献库可能需要更长时间。
- 如果插件管理的路径后来被普通文件替换，插件会拒绝删除该文件，需要用户手动检查。

## 后续改进

- 为超大型文献库实现增量校准
- 可选的群组文献库命名空间
- 可浏览的诊断面板和重试队列
- 用于安全检查未验证旧根目录路径的迁移界面
- 作为独立可选 v2 功能导出 annotation 和 note

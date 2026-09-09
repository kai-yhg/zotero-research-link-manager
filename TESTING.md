# 测试矩阵

自动测试覆盖 Windows 文件名清理、保留名称、稳定的 attachment-key 文件名、嵌套 Collection 映射、根目录边界、路径长度截断，以及真实 NTFS 硬链接身份验证。

先执行 `npm test`，然后执行 `npm run build`。

## Zotero 集成测试

集成测试应使用独立的 Zotero profile 和隔离的 Research 根目录。破坏性测试绝不能使用正式的 `C:\Research`。

1. 从 Edge 保存一篇论文，确认 Zotero PDF 先成功出现，随后 Research 链接出现。分别对源路径和 Research 路径执行 `fsutil file queryFileID`，验证二者具有相同文件标识。
2. 将一个条目加入三个 Collection，确认三个链接与源文件具有相同文件标识。
3. 移动 Collection，确认 Repair 创建新路径，并且只删除旧的受管理链接和空目录。
4. 从 Collection 中移除一个条目，确认只删除该 Collection 下对应的 Research 链接。
5. 修改父条目的标题或年份，确认 Research 文件名变为 `标题 - 年份 [attachmentKey].pdf`。仅重命名 Zotero storage 中的附件文件，不应改变由元数据生成的 Research 文件名。
6. 将条目移入回收站或彻底删除，确认受管理链接被删除，而无关的 Research 文件保持不变。
7. 重启 Zotero，检查调试日志中是否记录了成功的启动校准。
8. 手动删除一个 Research 链接，执行 Sync / Repair，确认链接被重新创建，并且与源 PDF 具有相同 NTFS 文件标识。
9. 修改 Research 根目录，确认插件只清理经过验证的受管理链接和由插件创建的空目录。
10. 在同一盘符使用 `Auto` 模式，确认创建结果为 `HardLink`，并且源文件和目标文件的文件标识相同。
11. 在同一个 Collection 中创建两个标题相同的附件，确认二者分别使用各自稳定的 Key 后缀。删除任意一个附件后，另一个附件的文件名必须保持不变。
12. 使用包含 Windows 非法字符和保留名称的标题进行测试。
13. 在隔离的 Research 根目录中拒绝写入权限，然后从 Edge 保存论文；确认 Zotero 保存成功，同时插件记录链接创建错误。
14. 快速连续触发两次同步，确认每个附件只存在一个目标路径。模拟状态记录缺失，确认 Repair 只接管与源文件匹配的带 Key 硬链接，并且只删除具有相同文件标识的旧式无 Key 路径。

当前机器只有一个盘符，因此符号链接测试是可选项。该测试需要启用 Windows Developer Mode，或者以管理员权限运行 Zotero。

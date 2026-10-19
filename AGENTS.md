# 项目交付规则

用户已明确要求：每次更新都要递增版本并发布到 GitHub Releases。这是持续有效的交付要求，不能只提交代码后就宣布完成，也不需要每次重新询问是否发布。

- 小更新、界面优化、修复：补丁位 +1，例如 0.1.0 → 0.1.1。
- 中更新、成组功能增加：次版本位 +1，补丁位归零，例如 0.1.3 → 0.2.0。
- 大更新、重大架构或产品变化：主版本位 +1，其余位归零，例如 0.8.2 → 1.0.0。
- 一批完整开发交付对应一个版本；版本内可以有多次开发提交。
- 根 package.json、package-lock.json（含 packages[""].version）和 desktop/package.json 必须一致，使用 npm run version:bump -- patch|minor|major。
- 填写 docs/releases/v版本号.md；检查通过后提交、同步仓库，创建对应 vX.Y.Z 标签，运行 Desktop release 工作流。
- 每个 Release 必须有 Windows x64 安装程序、Mac arm64 和 x64 DMG、公司服务器更新包、SHA-256 校验文件及真实检查记录。不能上传数据库、密钥、员工聊天或开发缓存。
- 所有构建与检查通过、资源上传并核对后，才将草稿公开为最新 Release，再向用户交付下载链接。
- 已发布的标签和安装包不覆盖；修复已发布版本必须递增版本。不能把上传源码或 Actions 临时产物当成已完成 Release。
- 客户端当前从公司服务器加载界面。界面和业务服务变更必须随服务器包交付，更新说明要写清客户端与服务器各自的更新方式。

详细流程见 [docs/RELEASE-POLICY.md](docs/RELEASE-POLICY.md)。

开源分发：原创代码采用 MIT，保留第三方原有许可；不得提交密钥、真实数据库、内部 Skills、员工记录或专有分析缓存。发布须带许可、隐私及签名状态，公开前检查完整历史与旧 Release。SignPath 尚未获批，不得称已签名；未来正式签名遵守其人工审批要求。见 docs/OPEN-SOURCE-READINESS.md。

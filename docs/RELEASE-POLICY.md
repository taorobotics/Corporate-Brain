# 版本与 Releases 发布规则

根据用户于 2026-10-19 确认的要求，每一批完成的更新都必须有独立版本和 GitHub Release。

| 更新级别 | 递增方式 | 例子 |
| --- | --- | --- |
| 小更新：界面、交互优化与问题修复 | patch +1 | 0.1.0 → 0.1.1 |
| 中更新：增加成组功能 | minor +1，patch 归零 | 0.1.4 → 0.2.0 |
| 大更新：重大架构或产品升级 | major +1，其余归零 | 0.8.3 → 1.0.0 |

一次完整交付对应一个版本，开发过程可以有多次提交。不能只上传代码、保留 Actions 临时产物或创建空 Release 就宣布交付。已公开的版本标签和安装包不覆盖，修复后使用新版本。

## 发版流程

1. 完成变更后，在项目根目录执行 npm run version:bump -- patch（中更新用 minor，大更新用 major）。脚本同时修改根 package.json、package-lock.json 及 desktop/package.json，版本必须一致。
2. 写好 docs/releases/vX.Y.Z.md，说明变更、下载选择、服务器更新方式及实际验证范围。先运行版本检查、对应测试与生产构建。
3. 提交并同步代码到 main，创建指向该提交的 vX.Y.Z 标签并推送。不要在构建过程中继续修改已标记的产品源码。
4. 标签推送触发 [.github/workflows/desktop-release.yml](../.github/workflows/desktop-release.yml) 的 Desktop release。必要时可手动运行同一个工作流，明确填写已存在的标签；手动运行仍只构建该标签对应的源码。
5. 工作流分别在原生 Windows x64、Mac arm64、Mac x64 环境执行后端、构建和桌面交互检查，然后生成与检查安装包；Linux 环境另行生成包含已构建网页的公司服务器更新包。
6. 只有所有检查都通过，发布任务才会创建草稿、上传完整资源、逐一复核 GitHub 返回的 SHA-256，然后将草稿发布为最新 Release。失败时修复实际问题后重试，不能伪造通过或跳过必要检查。
7. 最后核对 Releases/latest 指向本次版本、下载资源完整、校验值正确，向用户提供该版本页面链接。

如果只有发布工具或上传失败，可以在 main 修正发布工具，再手动运行工作流，填写同一 release_tag 及原构建的 reuse_run_id。恢复任务必须验证原运行来自同一仓库、同一版本标签提交，且 Windows、两种 Mac 和服务器的构建检查均成功，才允许复用原始资源。应用包仍来自版本标签；发布工具使用触发该工作流的受控提交，不重写标签或更换已检查的产品源码。草稿按 Release ID 管理，完整上传和复核之前不公开。

## 每个 Release 的交付内容

- Corporate-Brain-Setup-X.Y.Z-x64.exe：Windows 客户端。
- Corporate-Brain-X.Y.Z-macOS-arm64.dmg：Apple 芯片 Mac 客户端。
- Corporate-Brain-X.Y.Z-macOS-x64.dmg：Intel Mac 客户端。
- Corporate-Brain-Server-X.Y.Z.zip：预构建网页及服务端源码、依赖锁文件和部署说明。
- SHA256SUMS.txt：四个安装与更新包的合并 SHA-256；同时保留各平台校验文件。
- 平台检查 JSON：标注源码提交、版本、实际检查、签名和尚未验证的项目。
- GitHub 自带的 Source code：标签对应的完整项目源码归档。

公司数据库、模型密钥、证书私钥、员工聊天及 .data、.cache、node_modules 均不能混入交付包。

## 员工客户端与服务器的更新关系

当前桌面客户端从公司服务器加载员工网页，个人记录保存在各员工本机。桌面安装包更新和服务器更新分别处理；只重新安装桌面客户端不会自动替换服务器上的网页和业务代码。

管理员更新服务器前，先停止服务并一致性备份现有 .data（包括 secrets.key）及部署配置。将服务器包解压到新的应用目录，运行 npm ci --include=dev（当前启动入口需要 tsx），继续指向原有 BRAIN_DATABASE 和相应 secrets.key，不覆盖、不清空原数据，按原 HTTPS、APP_ORIGIN、HOST、PORT 配置启动。服务器包已含 dist，无须重新构建即可 npm start；从 GitHub 源码部署则仍需 npm run build。详细变量和数据边界见 [DEPLOYMENT.md](DEPLOYMENT.md)。

现阶段 Windows 未做可信代码签名，Mac 只有 ad-hoc 签名、没有 Apple 公证；发版不代表这些条件自动完成。客户端自动发现、下载和安装更新仍未实现，当前按 Releases 手动分发。

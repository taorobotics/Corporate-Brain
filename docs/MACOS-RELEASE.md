# macOS 安装包与发布

Mac 客户端使用 DMG 分发，安装包和 Windows 版本放在同一个 [GitHub Releases](https://github.com/taorobotics/Corporate-Brain/releases) 页面。

## 员工如何选择

在 Mac 的“关于本机”中查看芯片类型：

| Mac 类型 | 下载文件 |
| --- | --- |
| Apple 芯片，例如 M1、M2、M3、M4 等 | Corporate-Brain-版本号-macOS-arm64.dmg |
| Intel 处理器 | Corporate-Brain-版本号-macOS-x64.dmg |

打开 DMG，将“公司大脑”拖入 Applications（应用程序），再从应用程序打开。首次启动填写管理员提供的公司 HTTPS 根地址，使用分配的部门员工账号登录。员工 Mac 不必单独安装服务器数据库；公司服务和管理后台仍需由管理员部署。

当前为开发测试版，只做 ad-hoc 签名以检查代码完整性，没有 Apple Developer ID 开发者签名或 Apple 公证。从互联网下载后可能被 macOS 的安全检查拦截。如果无法打开，请先核对文件来源、SHA-256 和系统提示，再按 Apple 的[打开来自未知开发者的 Mac App](https://support.apple.com/zh-cn/guide/mac-help/mh40616/mac)说明处理，或等待正式签名版。不要全局关闭系统安全检查。

对话、项目和个人技能草稿保存在该 Mac 本地，按公司与员工账号隔离；安装包没有公司数据库、默认账号或模型密钥。当前手动下载安装新版本，尚未实现自动更新。

## 构建与检查

工作流已统一为 [.github/workflows/desktop-release.yml](../.github/workflows/desktop-release.yml)。推送新的 vX.Y.Z 标签会触发“Desktop release”，必要时也可手动填写已存在且匹配版本的 release_tag，例如 v0.1.1。旧的 Mac 专用工作流已替换，后续 Windows、两种 Mac 和服务器更新包共同通过检查后再发布。

流程使用 Apple 芯片和 Intel 的原生 Mac runner 分别构建，先核对版本、标签对应的应用源码和实际架构，然后执行后端测试、前端构建与真实 Electron 桌面操作检查。生成 DMG 后继续检查：

- 磁盘映像完整性、应用版本、Bundle ID、二进制架构与 ad-hoc 签名。
- app.asar 只含允许分发的客户端和字体文件，不携带数据库、开发依赖或分析缓存。
- 从挂载的 DMG 启动实际打包应用，以临时本地空间检查首次公司连接页、中文字体、preload 隔离和 HTTPS 地址校验。

所有平台和服务器包通过后才进入发布步骤，将 DMG、各自的 SHA256SUMS-macOS-架构.txt 和 macos-verification-架构.json 与其他资源上传到草稿，复核全部校验值后再公开 Release。失败后可以重试尚未公开的草稿；已公开的资源不覆盖，若需修复已发布程序，应使用新版本和新标签。

GitHub Actions 的截图与桌面诊断保留 14 天。随 Release 发布的验证 JSON 记录源码提交、工作流运行编号、运行系统、架构、安装包体积、校验值和检查结果。GitHub Mac runner 验证不能替代员工物理设备上从浏览器下载后的 Gatekeeper、文件授权、升级与卸载验收。

本机 Mac 也可运行：

```sh
npm ci
npm test
npm run build
npm run test:desktop
node scripts/package-desktop.mjs --mac dmg --arm64 --publish never
TARGET_ARCH=arm64 node scripts/verify-macos-package.mjs
```

Intel Mac 将上述 arm64 改为 x64。输出位于 release。正式发布前需另行配置 Apple Developer ID 证书、公证和 Hardened Runtime 所需权限；不能把当前 ad-hoc 签名测试包视为已通过 Apple 信任验证的正式员工发行版。

# Corporate Brain 公司大脑

面向公司员工的 AI 创作与工作平台，包含 Windows 客户端、macOS 客户端、员工网页端和浏览器管理后台。

当前已有 v0.1 开发版：员工网页端、Windows 桌面外壳和管理后台可运行，部门账号及文本型 Skill 的提交、审核、发布、下载安装流程已接通。真实模型、视频、NAS 和完整 Agent 执行仍按阶段推进，详见[开发状态与验证记录](docs/DEVELOPMENT-STATUS.md)。

## 下载 Windows 测试版

在仓库首页右侧点击 **Releases**，进入版本页后在 **Assets** 下载客户端：

- [最新版下载页](https://github.com/taorobotics/Corporate-Brain/releases/latest)：后续新版本继续使用这个入口。
- [全部版本与更新说明](https://github.com/taorobotics/Corporate-Brain/releases)：保留各版本独立的安装包和说明。

- [Windows x64 安装包 v0.1.0](https://github.com/taorobotics/Corporate-Brain/releases/download/v0.1.0/Corporate-Brain-Setup-0.1.0-x64.exe)
- [安装包 SHA-256 校验文件](https://github.com/taorobotics/Corporate-Brain/releases/download/v0.1.0/SHA256SUMS.txt)

这是未签名的 Windows 开发测试版，macOS 安装包尚未发布。仓库当前为私有，访问源码和安装包需要相应 GitHub 权限。

安装后填写管理员提供的公司服务器地址，再使用公司分配的账号登录。管理后台与业务服务需单独部署；安装包不包含服务器数据库、预设账号或公司密钥。本机开发测试可先按下文启动服务，使用 http://127.0.0.1:4173 作为客户端连接地址。

当前通过 Releases 手动下载新版本安装包升级，客户端自动检查更新与下载尚未实现。仓库右侧的 Packages 用于 npm 等依赖包或容器镜像，本项目的 Windows 安装包统一放在 Releases。

## 本地运行

使用 Node.js 24.13 或更高版本。所有命令在本项目根目录执行。

```powershell
npm ci
npm run dev
```

访问 http://127.0.0.1:4173。首次访问创建管理员，不提供固定默认密码；随后在管理后台建立部门、单个或批量开通员工账号。初始密码 24 小时有效，员工首次登录须改密。

保持服务运行，在另一个终端启动桌面开发版：

```powershell
npm run desktop
```

打包客户端首次打开时填写公司服务器地址。正式员工客户端连接统一公司服务器，员工电脑无需安装业务数据库或各自部署公司后端。当前客户端从公司服务器加载员工界面，个人记录仍由桌面本地存储保存；离线冷启动尚未实现。

## 构建、检查与部署准备

```powershell
npm test
npm run build
npm run test:desktop
npm run test:dsh
npm run package:win
```

Windows 安装包输出到 release；macOS 需在 Mac 上运行 npm run package:mac，并做实机与签名验证。当前 Windows 包供本地测试，未做正式代码签名。桌面包独立于服务器依赖，开发测试和第三方分析缓存不打包给员工。

构建后可用 npm start 启动带静态界面的公司业务服务，默认只监听本机 4310 端口。[部署说明](docs/DEPLOYMENT.md)记录公司服务器地址、HTTPS、数据与备份边界。真实接口配置前，开发程序不显示伪造生成结果。

## 开发依据

- [产品需求文档](docs/PRD.md)：范围、角色权限、业务流程、异常处理、验收标准和待补参数。
- [UI 规范与已确认效果图](docs/UI-SPEC.md)：页面规则、图稿来源及最终版本。
- [实施计划](docs/IMPLEMENTATION-PLAN.md)：技术验证、开发任务、依赖和交付关卡。
- [开发状态](docs/DEVELOPMENT-STATUS.md)：已实现、已验证与仍未完成的部分。

首版必须打通：员工登录 → 使用获准模型和资料 → 生成并保存成果 → 对话转 Skill → 审核发布 → 其他员工安装复用。

完整对话、个人项目和 Skill 草稿保存在员工本机，按公司与员工账号隔离，不自动上传服务器、NAS 或其他设备。平台只接收员工主动提交的 Skill 包、明确选择的共享资料和必要任务输入；其他员工安装的是可复用技能，其使用记录仍保存在自己的设备。

调用模型时仍需发送本次必要上下文；后台保存账号、权限、共享项目、知识、已提交技能及必要任务状态，不集中保存员工聊天历史。员工网页端使用浏览器本地存储，换设备不自动带出旧聊天，本地记录通过主动导出导入迁移。

部门是账号管理与 Skill 分发的基本单位：按部门为每位员工单个或批量开通独立账号、分发初始临时密码，首次登录改密。Skill 默认提交本部门，也可申请共享给指定多个部门或全公司，由对应权限的审核员批准。调部门调整共享资源权限，保留个人本地记录；已有部门技能归属不随作者自动迁移。

未接通的能力须明确显示未配置或不可用。演示数据、模拟任务和真实调用须清楚区分。

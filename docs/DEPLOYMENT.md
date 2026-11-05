# 运行与部署说明

当前版本为 v0.4.0 测试版，部署结构为统一公司服务加员工客户端。员工端与管理后台来自同一服务，按登录账号在后端授权。员工聊天和个人草稿不进入该服务数据库；DSH 运行时只使用按员工和会话隔离的临时工作区。

## 本机开发与预览

根目录执行 npm ci、npm run dev，网页地址 http://127.0.0.1:4173，业务服务 http://127.0.0.1:4310。首次访问初始化管理员；用户名使用 2–64 位字母、数字及 . _ @ -，密码至少 12 位。没有内置员工名单、部门名单或默认管理员密码。

npm run desktop 启动桌面开发版。员工分发包在构建时读取 `BRAIN_APP_URL`，将公司统一入口作为不含密钥的配置文件放进应用资源；员工首次打开直接进入账号登录页。没有预设入口的包只显示联系管理员的提示。仅允许 HTTPS，localhost 和 127.0.0.1 等本机地址可使用 HTTP。当前只支持根路径部署，不支持将应用放在域名的子路径下。

## 公司服务配置

先执行 npm run build。启动 npm start 前按部署环境设置下列变量，使用部署系统保存实际值，不将凭据提交进代码。

| 变量 | 默认 | 用途 |
| --- | --- | --- |
| HOST | 127.0.0.1 | 服务监听地址；同机反向代理可保留本机绑定 |
| PORT | 4310 | 服务端口 |
| BRAIN_DATABASE | .data/platform.sqlite | 公司业务 SQLite 数据库文件 |
| APP_ORIGIN | 本机开发入口列表 | 公司实际 HTTPS 根入口，用于写请求来源校验 |
| NODE_ENV | 未设置 | 生产入口设置 production，启用安全 Cookie；须经 HTTPS 访问 |
| BRAIN_APP_URL | 开发版默认本机 4173 | 桌面开发或公司预设的服务器地址；打包时只写入 URL，不写入账号、密码或密钥 |
| BRAIN_ADMIN_SETUP | 未设置 | 仅管理员配置环境开启服务器入口配置页；普通员工包不要设置 |
| BRAIN_GITHUB_TOKEN | 未配置 | 仅服务器使用，读取私有仓库发布与安装包；建议限定本仓库、Contents: read |
| BRAIN_UPDATE_SOURCE | public | 公开仓库默认读取 GitHub Release；可设置 private/disabled 关闭公开源，私有模式仍需 BRAIN_GITHUB_TOKEN |
| BRAIN_DSH_ENABLED | 1 | 启用完整 DSH Agent 路由；设为 0 时回退到原 OpenAI 兼容聊天适配器 |
| BRAIN_DSH_HOME | .cache/dsh-runtime | DSH 会话、附件和临时工作区根目录；应放在服务器私有、可清理的位置，不纳入发布包 |
| BRAIN_NAS_PYTHON | python3 | NAS 目录连接使用的 Python 解释器，生产环境建议绝对路径 |
| BRAIN_NAS_PYTHON_PATH | 未设置 | 本项目安装的可选 SMB 依赖目录，详见 [NAS 接入](NAS.md) |
| DEEPSEEK_API_KEY | 未配置 | DSH 的 `web_search` 需要的 DeepSeek 搜索凭据；不配置时联网工具会据实返回不可用 |
| DEEPSEEK_SEARCH_BASE_URL | DeepSeek 默认搜索地址 | 可选的 DeepSeek Messages 兼容搜索网关；与公司对话模型地址分开配置 |

生产环境应由受控 HTTPS 入口反向代理到该服务。首次管理员初始化须由部署人员在受控入口完成，然后再向员工开放。为服务配置固定工作目录、专用运行账号与重启策略。当前没有经过生产并发压测、高可用或全面安全审计，不将本机运行检查当作可直接全员投产的证明。

公司提供的模型在后台添加服务名称、完整 API 前缀地址、实际模型标识、API 密钥、用途与获准部门。对话连接现在经 DSH `sdk` profile 路由，使用 OpenAI 兼容模型适配器，并提供 `web_search`、`web_fetch`、`read`、`read_image` 等工具；图片会作为原生视觉输入发送，文本文件会放入当前受限工作区供 DSH 文件工具读取。DSH 启动失败时才回退到原 OpenAI 兼容 chat/completions 请求。图片生成仍使用 images/generations，且图片服务须返回 b64_json。测试对话连接会发起一次真实调用，可能计费；保存配置本身不证明接口可用。

员工端可在本机创建和切换命名工作区。工作区选择只保存本地目录和显示设置，不把路径上传给公司服务；发送请求时只传递当前模式与权限策略。标准、PTC、极简、创造模式分别对应 DSH 的 `standard`、`ptc`、`minimal`、`cordis` preset；仅可查看、工作区内修改、完全权限分别对应 `read-only`、`workspace-write`、`danger-full-access` 沙箱。输入区的 Token 数量是估算值或服务返回的实际值，额度上限必须由管理员另行配置。

## 客户端更新源

公司部署推荐从 0.11.0 起使用本地安装包镜像：设置 `BRAIN_UPDATE_DIRECTORY=/var/lib/corporate-brain-updates`，按 [UPDATE-DISTRIBUTION.md](UPDATE-DISTRIBUTION.md) 配置专用发布账号及 GitHub Actions 自动分发。镜像优先于下述 GitHub 代理配置；私有仓库无需向业务服务器或员工客户端复制 GitHub token。发布必须核对最后的公司分发任务和真实生产下载，不能仅以 Release 公开为完成依据。

客户端更新默认从公开的 GitHub Release 自动读取，不需要在服务器上填写 GitHub token；服务器仍可设置 BRAIN_UPDATE_SOURCE=private/disabled 关闭公开源，或设置 BRAIN_GITHUB_TOKEN 使用私有仓库与更高的 API 限额。公司登录与部门授权始终由公司服务器控制，服务器之外不要分发凭据。

从 v0.2.0 起，公司服务通过 GitHub API 读取 taorobotics/Corporate-Brain 的最新已公开 Release。公开仓库模式默认启用，服务器重启后客户端会自动检查并在左下角显示新版本；若服务器仍返回“更新服务尚未启用”，请先部署包含本功能的服务器包。私有仓库或需要更高 GitHub API 限额时，在服务启动环境或部署平台密钥中设置 BRAIN_GITHUB_TOKEN。令牌建议仅授予此仓库的 Contents: read 权限，按部署平台的密钥轮换机制维护；不要写进 package.json、桌面环境、源码、聊天或公开日志。员工只用原公司账号登录，不需要 GitHub 账号或令牌。

客户端登录后检查一次，运行中每 30 分钟检查；在线或窗口激活时在 5 分钟节流范围外复查，可从左侧、帮助菜单或账号菜单手动检查。服务器缓存版本元数据 5 分钟，合并并发查询，失败后退避 30 秒；只有完整、非草稿、非预发布、三种架构均有已上传包与 SHA-256 摘要的最新版本可供下载。发布完成后提示通常在下次检查出现，手动检查仍可能受服务器 5 分钟缓存影响。客户端按数字比较三段版本号，`0.2.10` 会正确识别为高于 `0.2.9`。

检查与下载接口均要求有效公司登录，下载只代理已核对的版本及平台资源，GitHub token 和短期资源地址不返回员工端。服务器须能经 HTTPS 访问 api.github.com、release-assets.githubusercontent.com 和 objects.githubusercontent.com。反向代理允许大约 150 MB 安装包流式传输，下载超时至少 15 分钟；不要把凭据加入 URL。多员工同时下载会占公司服务器出口带宽，当前没有 CDN 或断点续传。中断可重试，部分文件会清理；本机更新目录仅保留当前成功下载的安装包，不触碰 profiles。

新版客户端下载到系统应用数据的 updates 子目录，按平台自动选包，边下载边计算 SHA-256，校验大小和摘要后才允许安装，打开前再次校验。安装动作先保存当前本地记录，再显示系统确认；Windows 退出并打开 NSIS 向导，Mac 打开 DMG，由员工退出应用并拖入 Applications 替换。当前未签名/未公证条件保持不变，不是静默升级。0.1.x 的旧桥接没有原生更新能力，加载新版公司网页后显示过渡下载链接，员工先手动安装一次新版。网页端不显示桌面更新入口。

发布新的安装包不代表公司服务器也已部署。每次管理员仍需按 RELEASE-POLICY.md 备份并升级服务器包，然后让已打开的员工端重新载入页面；不要清空原 .data 或员工本地 profiles。

## 数据与备份

| 位置 | 数据 | 备份要求 |
| --- | --- | --- |
| .data/platform.sqlite 及同目录 SQLite 文件 | 部门、账号密码哈希、登录凭证哈希、已提交技能、审核、模型配置及元数据审计 | 停止服务后备份整个 .data，或采用受支持的一致性 SQLite 备份方法；不可仅随意复制正在写入的数据库主文件 |
| .data/secrets.key | 公司连接密钥的本地加密主密钥 | 与数据库一并妥善备份，限制服务账号访问；丢失会使既有连接密钥无法解密 |
| 桌面系统用户的应用数据 profiles 目录 | 按公司服务根地址和员工稳定标识隔离的本地对话、草稿和安装项 | 员工在设置里主动导出和导入；不会自动传入公司备份或 NAS |
| 浏览器 IndexedDB | 当前站点、浏览器配置文件与公司账号的本地记录 | 主动导出，清除站点数据或更换浏览器不自动恢复 |

账号分发结果中的初始密码只在本次结果显示，24 小时有效，首次改密即失效。账号导出不包含密码；审计只记录操作者、动作、资源编号和时间。原始对话中用户自己粘贴的敏感信息仍属于其本地内容，导出备份前应查看实际内容。

## 验证与交付限制

### 模型域名的项目专用解析

当公司网络把公网模型域名解析到错误内网地址时，可在**服务端**配置 `BRAIN_MODEL_DOH_HOSTS=linoroute.com`（多个域名使用逗号分隔），重启项目服务。仅这些模型域名使用 `https://dns.google/resolve` 查询 IPv4 地址，结果按 TTL 缓存（最多 5 分钟）且必须是公网地址。模型连接仍使用原始 HTTPS 域名、SNI 和正常证书校验，查询失败不会退回不可信地址或关闭 TLS 校验。目录、对话、图片和 DSH 请求沿用相同设置。

默认不开启，不修改操作系统 DNS、NAS 或其他项目；解析服务仅接收域名查询，不接收模型密钥或消息。不要用此设置处理需要公司内网解析的私有模型地址。首次配置后应从服务器实际检查目录和最小模型调用。

- npm test：真实 HTTP 接口、数据库、部门授权、账号凭据与技能发布规则测试。
- npm run test:desktop：隔离的内存服务与临时桌面用户目录，实际 Electron 窗口、渲染与 preload 桥接操作验收；不污染公司业务数据库。
- npm run test:dsh：在项目 .cache 的隔离目录启动 DSH SDK，验证初始化握手；生产聊天的 DSH 路由另由 `server/dsh.test.ts` 使用本机流式 OpenAI 兼容假服务验证，不调用真实模型。
- npm run package:win：Windows 本地测试安装包；npm run package:win:dir：展开运行目录。
- npm run package:mac：需 Mac 环境。已通过 GitHub 原生 Mac runner 构建并发布 arm64 与 x64 DMG，包含原生桌面交互及实际打包程序启动检查；使用 ad-hoc 签名，没有 Apple Developer ID 签名、公证或员工物理 Mac 的系统授权验收。见 [Mac 分发与检查说明](MACOS-RELEASE.md)。

未接通的视频任务、NAS 检索归档、个人模型安全存储、完整 Agent 工具执行和团队项目不会因设置表单或按钮存在而标记成功。客户端已支持检查、下载并主动打开安装程序，真实员工设备的覆盖安装及正式签名仍待验收。后续任务清单见 DEVELOPMENT-STATUS.md。

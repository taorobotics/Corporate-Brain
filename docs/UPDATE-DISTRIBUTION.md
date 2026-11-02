# 公司客户端更新分发

从 0.11.0 起，本公司使用安装包镜像；GitHub 仓库仍为 Private。服务器不保存 GitHub 个人令牌，员工无需 GitHub 账号。客户端仍使用已登录公司服务的 `/api/desktop-updates/latest` 和版本下载接口，兼容 0.9.0。

## 一次配置

1. 生成独立的 Ed25519 发布密钥，仅用于分发安装包。私钥放 GitHub repository secret `BRAIN_UPDATE_SSH_KEY`；经过已有可信 SSH 连接核对的主机公钥放 `BRAIN_UPDATE_KNOWN_HOSTS`。禁止复用 root 密钥或个人 GitHub token。
2. 服务器以 root 执行 `scripts/setup-update-publisher.sh <专用公钥文件> <shared/update-mirror.cjs>`。专用系统账号只有安装包目录写权限，SSH 强制执行导入程序，禁止交互 shell、PTY 和转发；发布账号不能编辑授权密钥或导入程序。
3. 配置仓库变量 `BRAIN_UPDATE_MIRROR=true`、`BRAIN_UPDATE_HOST`、`BRAIN_UPDATE_USER=brain-update-publisher`，以及安装包预置公司地址 `BRAIN_APP_URL`。服务端设置 `BRAIN_UPDATE_DIRECTORY=/var/lib/corporate-brain-updates`，备份部署新版服务器包并重启。

## 每次发布

Desktop release 先运行 Windows、两种 Mac、服务器的检查和打包，核对四个交付包的摘要，再公开 Release。最后的 **Verify company update distribution** 任务读取刚发布的安装包，校验 GitHub SHA-256，再通过专用 SSH 连接上传。导入程序逐个校验固定名称、版本、大小、摘要和总字节数，三包完整才原子切换 latest。

同版本同内容可以重试；禁止覆盖已分发版本或降级。保留最近三个完整版本，已开始的 Linux 文件流可继续完成；过旧下载重新检查最新版。不完整上传不会替换可用版本。源文件损坏会让服务返回错误，不能误报“当前已最新”。下载需要公司登录，支持 Range 和 SHA-256 ETag。新客户端最多自动重试三次并校验续传位置、总大小和完整摘要，安装前再校验一次。

必须检查整个工作流为成功，不能仅以 GitHub Release 已公开作为完成证据。分发失败时该任务标红，旧镜像继续服务；修复网络或权限后选择 **Re-run failed jobs** 即可重试，不覆盖 Release。对较旧工作流使用 main 上当前脚本，设置 `RELEASE_TAG` 和同样的发布环境执行 `node scripts/sync-update-mirror.mjs`；脚本仅允许同步当前 latest。

## 员工体验与验收边界

登录后立即检查，在线期间每五分钟检查；断网失败一分钟后重试，恢复联网立即重试，主动点左下角会刷新状态。离线电脑和未打开的客户端无法即时接收，重新联网并登录后再检查。这里表示“发现/已下载”，不表示每个员工已经安装。

Windows 点“下载更新”，校验通过后点“退出并安装”，按安装向导完成；Mac 打开 DMG 后退出应用、拖入 Applications 替换。公司地址和本地记录保留。没有无提示的后台安装；Windows 目前未可信签名，Mac 仅 ad-hoc、未公证，系统可能显示确认提示。

发布验收包括：真实旧版 0.9.0 更新模块读取生产 feed 并下载验证；隔离 Windows runner 安装 0.9.0 再升级新包，核对安装位置、版本、本地记录和卸载；所有平台交互与包检查。员工个人设备不被自动卸载或覆盖。管理员单独备份部署服务器包，客户端更新不会替换服务端程序。

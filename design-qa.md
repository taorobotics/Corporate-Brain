# 已实现界面视觉核对

final result: passed

## v0.2.2 隐私与许可

新增登录前与帮助菜单入口，许可弹窗沿用现有暖色、字体和键盘焦点管理；原生公司连接页在未连接时也可打开随包法律文件，内容仅本地读取。截图：artifacts/screenshots/client-legal-license.png、client-offline-legal.png。真实 Windows 桌面检查通过在线 MIT 分类、Escape 关闭、离线隐私与许可证折叠阅读及沙箱边界；渲染控制台无错误。没有以增加文案宣称已取得可信签名。

## v0.2.0 客户端更新入口

新增左侧底部、账号区上方的更新行，沿用 Marvis 字体、暖灰侧栏和陶土色提示；无新版时为低强调检查入口，有新版时显示版本和小圆点。点击打开居中的更新弹窗，当前版本、平台、更新内容、下载状态和主操作按顺序排列，未使用默认展开的右侧预览。

真实 Windows Electron 截图为 artifacts/screenshots/client-update-sidebar.png、client-update-dialog.png、client-update-ready.png（1586 × 992）。画面中的 v0.2.2 和小体积安装包是明确标注的隔离验收素材，不是实际 Release 或可执行安装程序。实际验证左侧发现更新、弹窗与 Escape 关闭、通过登录服务下载、SHA-256 校验和状态回显；本机 21 项桌面检查通过，渲染控制台无错误。Mac 原生与打包检查以对应 Release 的报告为准，员工物理设备覆盖安装未据此标记通过。

本结论只覆盖本次工程版已实现页面的共同布局、可读性和关键交互，不是全部效果图的逐像素复制证明，也不是 PRD 全部功能验收。模型个人连接、视频、NAS、完整文件权限和后台运行等未完成模块见 docs/DEVELOPMENT-STATUS.md，不将缺少这些模块解释为已经完成。

## 对照范围与证据

- 源视觉：docs/design/approved/admin-users.png、employee-settings.png；聊天和账号菜单规则另以 employee-chat-preview.png、employee-account-menu.png 为准。
- 实现截图：artifacts/screenshots/admin-users.png、employee-settings.png、employee-chat.png、employee-account-menu.png、employee-chat-narrow.png、desktop-server-setup.png。
- 主对照 CSS 窗口：1586 × 992；源图与实现均为 1586 × 992 像素，截图密度为 1，未将缩放或浏览器边框当作样式差异。窄窗口另测 900 × 720。
- 状态：浅色，管理员已登录，员工表格和个人设置；使用隔离验收账号。源图为 5 人示例，实现为 3 个测试账号，字段增加分发状态，名称增加部门管理，属于需求变化和测试数据差异。
- 全图组合对照：artifacts/comparisons/admin-users-full.png、employee-settings-full.png，左为已批准视觉，右为实现。
- 局部组合对照：artifacts/comparisons/admin-users-header.png、admin-users-content.png、employee-settings-header.png、employee-settings-content.png。图中保留同坐标原始区域，便于核对字体、留白、分隔线和表格。
- 交互与控制台证据：artifacts/desktop-verification.json；真实 Electron 窗口与 preload，最新 13 项检查通过，渲染控制台错误为 0。测试中的跨账号 IPC 拒绝是预期负例，不是放行或运行成功的伪造。

## 发现、修正与复核历史

1. P1，个人设置的二级导航曾在页面标题下方，导致标题位于第二列，偏离源图的完整设置侧栏。已改为独立全高二级导航，标题、账号卡片和表单统一进入第三列；复核见 employee-settings-full.png 及 header 局部。
2. P2，大窗口的中文正文与表格密度偏紧。已分别调整大窗口导航、标题、表格与设置行字号，按同尺寸重新截图。最初使用 Microsoft YaHei UI；后按用户指定的 Marvis 网站调整字体，最新记录见下方“Marvis 字体复核”。
3. P2，设置截图中曾残留临时提示，遮住底部内容。截图前关闭提示，并在真实交互检查之后重新采集，当前组合图可见底部备份操作。
4. 对话预览从固定宽度补为可拖动与键盘调宽的分隔条，保留默认收起、关闭和缩放；重新通过实际窗口交互。未将静态测试图片称为真实模型生成成果。

以上修正均已重拍并复核；本次已实现页面的共同布局与主操作未发现仍阻断使用的 P0/P1/P2 问题。

## 五个必查表面

| 表面 | 核对结果 |
| --- | --- |
| 字体与排版 | 中文采用苹方优先与产品自带 Noto Sans SC 后备；标题与表格字号、灰色说明和省略行为已核对。已按用户新增的 Marvis 字体要求复核，见下节 |
| 间距与布局 | 管理页 72px 顶栏、265px 导航，对话和设置共用主导航；设置二级栏独立。主操作可达，900px 无文档横向溢出，非对话页没有最右侧预览 |
| 色彩与控件 | 暖白、浅灰、细分隔线和陶土色主操作统一；加载、空状态、失败、未配置和无权使用真实状态。保留源图的克制圆角与阴影 |
| 图像与资产 | 使用 Phosphor 标准图标和可替换的临时品牌图标；真实用户头像未提供，使用标准账号图标。产品空状态不填入假海报、假成果或假连接成功标志 |
| 文案与内容 | 按新增的部门账号和本机记录规则调整文案；源图中的同步改为本地保存和显式备份。临时验收账号与业务数据库隔离，待接通能力明确说明 |

## 已核对的主流程

初始化管理员 → 部门成员显示 → 本机对话保存和重开 → 本机草稿 → 上传清单预览 → 审核 → 发布 → 本机安装 → 另一员工首次改密与安装。另核对账号弹层、设置入口、预览开关与调宽、非对话页面布局以及公司服务器连接页。

## 后续细化

P3：公司正式 Logo 与头像资源、源图同源字体细节，以及后续完整功能落地后的表单密度。新增的视频、知识阅读、插件权限、模型个人连接和客户端更新页面需要各自再次核对，不能沿用本结论直接宣布已通过。

## Marvis 字体复核

用户于 2026-10-16 指定 https://marvis.qq.com/ 作为字体参考。已检查官方样式及 Windows 上的实际字体，采用本机苹方优先、产品自带 Noto Sans SC 后备的组合；详情见 docs/FONT-SPEC.md。

本次真实窗口确认使用产品提供的 Noto Sans SC 正常体与半粗体，见 artifacts/ui-fonts.json，未仅依据 CSS 字体名称判断生效。已重拍 artifacts/screenshots 中的聊天、设置、后台、窄窗口与原生连接页截图，核对字号层次、文字换行和按钮边界；900px 窗口没有文档横向溢出，渲染控制台无错误，12 项桌面检查再次通过。artifacts/comparisons 中的原图组合保留为本次字体调整前的历史记录。

WOFF2 转换保留原字库的 30,890 个 Unicode 字符与 100–900 可变字重；网页与原生包的字体、CSS 和许可文件一致。安装包内 10 个文件已与客户端源文件逐一核对，未包含开发依赖或公司数据。Mac 字形与系统菜单仍需实机复核。

## 客户端四角复核

用户确认修改的是整个客户端的四个外角。原生窗口启用 roundedCorners 与系统阴影，Windows 工作区增加 8px 圆角和细边线；最大化、全屏时移除边线及内容圆角，恢复普通窗口时重现。网页内部不额外套操作系统窗口边框，字体方案未随本次调整改变。

新增检查直接调用真实窗口的最大化、还原、进入及退出全屏，等待窗口状态与渲染边界共同变化，13 项桌面检查通过。生产构建通过，900px 窗口无文档横向溢出。

窗口外观参考为 artifacts/screenshots/desktop-rounded-preview.png：在实际 employee-chat.png 界面截图外添加浅灰展示背景和示意阴影，便于查看小圆角；不是操作系统桌面合成器的截图。对应 HTML 保留实际界面尺寸，没有裁掉底部输入区。Windows 11 及 macOS 的最外层原生轮廓由系统控制，旧 Windows 不保证原生外角，Mac 实机仍待验证。

## 统一下拉菜单复核（2026-10-19）

依据 ui-ux-pro-max 的视觉与可访问性规则，以及 pick-ui-library 对无样式交互组件的选型建议，使用 Base UI 1.9.0 统一 14 处业务选择框和顶部、账号菜单。保留 Marvis 字体及暖白、陶土色体系：13px 选项标题、12px 说明、13px 浮层圆角、轻阴影、选中底色与勾选，触发器箭头随展开状态旋转。深色菜单使用主题变量；减少动态效果偏好禁用过渡。

对话底部菜单优先向上展开，普通表单优先向下，窗口空间不足时自动调整位置。浮层使用 Portal，弹窗和滚动容器不会裁切菜单，长列表独立滚动。模型空状态显示原因和真实配置入口；已配置模型按任务类型和启用状态筛选，选择保存到个人本地设置。规划、执行和视频选项明确标注接入中。

真实 Electron 截图：

- [对话输入区局部](artifacts/screenshots/dropdown-composer-detail.png)：直接截取运行中窗口的相关区域，没有合成或生成菜单。
- [模型未配置](artifacts/screenshots/dropdown-model-empty.png)与[模型选择验收](artifacts/screenshots/dropdown-model-configured.png)：后者使用明确标注的临时测试连接，未请求生成服务。
- [部门筛选](artifacts/screenshots/dropdown-admin-departments.png)与[角色表单](artifacts/screenshots/dropdown-admin-role.png)。
- [深色外观选择](artifacts/screenshots/dropdown-theme-dark.png)、[900px 窗口](artifacts/screenshots/dropdown-narrow.png)和[顶部编辑菜单](artifacts/screenshots/dropdown-top-menu.png)。

生产构建、9 项后端检查与 20 项 Windows 桌面交互检查通过，渲染控制台无错误。新增检查覆盖指针和键盘选择、Esc 与触发器焦点恢复、模型选择重开恢复及停用项排除、部门筛选、原生 FormData 取值、下拉层与弹窗的 Esc 层级、账号菜单键盘导航、编辑命令桥接、深色与窄窗口边界。验收使用内存服务与临时桌面本地空间，不修改实际公司账号或模型配置。Mac 的本次菜单改版未在员工物理设备复测，原有 Mac 包构建记录仍对应其原始发布版本。

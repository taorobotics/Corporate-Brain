# 公司大脑字体

自 0.34.11 起，按用户指定的“第三期 CycleAI”方法接入 Noto Sans SC：使用 Google Fonts 官方原始 Unicode 分片，项目本地托管，不向外部字体网站发送请求。

## 显示范围

界面字体顺序为 `Noto Sans SC, PingFang SC, Microsoft YaHei, Segoe UI, Arial, sans-serif`。中文、英文与数字优先使用 Noto Sans SC，支持 100–900 可变字重。系统字体仅在某字符不受覆盖或字体无法读取时后备；代码继续使用等宽字体。

对话、输入框、导航、设置、管理后台、登录页及启动动画共用这套字体。Claude 皮肤和技术变体的实际界面不再覆盖主字体。皮肤目录里的字体样片可展示各自设计，代码字体保持原有功能。

网页及公司服务使用 `public/fonts.css`，桌面首次连接、服务器设置及离线许可页使用 `desktop/fonts.css`。字体与样式字节一致，桌面离线页面从安装包读取分片。Windows 原生安装器使用系统字体，不在用户系统中安装网页字体。

## 加载与缓存

- 官方 v41 字体由 101 份 WOFF2 分片组成，总计 4,500,544 字节，使用原始 `unicode-range` 声明，浏览器只请求页面实际字符所在的分片。
- 使用 `font-display: swap`，首屏不等待整套字库。后续输入、对话和 NAS 文本出现新字符时，浏览器继续加载相应分片，无需按当前文案手工裁剪字库。
- 字体分片与声明文件的名称包含 SHA-256 摘要前缀，服务端为这些文件提供一年 `immutable` 缓存；字体入口保持可重新验证，更新可切换新的摘要文件。
- 网页与桌面的分发目录为 `fonts/noto-sans-sc/v41/`。构建和安装包验收核对每份字体、声明、许可与来源记录，禁止缺片或网页与桌面字节不一致。

## 来源与许可

字体源声明为 https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@100..900&display=swap ，二进制来自 Google 的 `fonts.gstatic.com`。沿用第三期 CycleAI 已核对的官方原始分片，字形和二进制未修改。

字体采用 SIL Open Font License 1.1；目录内保留 `OFL.txt` 和 `provenance.json`，后者记录原始链接、版本、每片字节数与 SHA-256。原有第三方皮肤字体的许可继续保留。

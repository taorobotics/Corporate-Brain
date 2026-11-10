# 公司大脑字体

2026-10-16，用户指定参考 https://marvis.qq.com/，取代此前仅使用 Windows 系统 UI 字体的方案。

## 参考网站实际使用

- 首页标语、下载按钮、多处功能说明在样式中指定 `PingFang SC, sans-serif`。
- 页面同时引入 Noto Sans SC，部分模型卡片明确使用该字体；本次 Windows 浏览器检查中，中文标语和下载文字实际渲染为 Noto Sans SC。
- 英文 Marvis 品牌字使用 Gilroy Bold。该字样用于识别参考网站，未复制到本产品。
- 样式声明与最终显示字体不一定相同，取决于系统已安装字体、网页字体是否加载以及后备顺序。本次未在 Mac 实机检查。

来源：

- [Marvis 官网](https://marvis.qq.com/)
- [首页样式](https://static.marvis.qq.com/marvisoffical/_next/static/css/171ca31ba2f9b5ca.css)
- [公共样式](https://static.marvis.qq.com/marvisoffical/_next/static/css/f5f597243bf033ff.css)
- [功能区样式](https://static.marvis.qq.com/marvisoffical/_next/static/css/70d1a99751155a3b.css)
- 实际渲染记录：`artifacts/font-reference/marvis-font-inspection.json`。

## 产品配置

自 0.33.3 起，按已确认的「协作桌面＋云雾蓝紫」统一字体顺序：`Inter, Noto Sans SC, PingFang SC, Microsoft YaHei, Segoe UI, Arial, sans-serif`。中文使用完整 Noto Sans SC，英文与数字使用 Inter，正文基准为 16px；代码区继续使用等宽字体。

Windows 原生安装器不能直接使用网页 WOFF2 字体，因此不把字体安装到系统。安装器启动时优先检测系统已有的 HarmonyOS Sans SC；未检测到时使用 Microsoft YaHei UI，欢迎页、许可链接、路径输入和按钮都使用同一套运行时字体句柄。这样能保持鸿蒙字体的视觉风格，同时保证没有鸿蒙字体的 Windows 电脑仍能正常显示中文。

Windows 与 Mac 优先使用产品提供的开放字体，减少系统字体差异；字体加载时通过 `font-display: swap` 保持界面可用。苹方等系统字体仅作后备，不打包或分发苹果字体文件。

网页端、桌面远程工作区和后台使用 `public/fonts.css`，由本公司服务提供字体文件。桌面首次连接页使用 `desktop/fonts.css` 和安装包内的相同字体，因此无须先连接服务器才能显示字体。两份字体及 CSS 保持内容一致。

## 字体资产和授权

Noto Sans SC 来自 [Google Fonts 官方仓库](https://github.com/google/fonts/tree/main/ofl/notosanssc)，原始文件为 `NotoSansSC[wght].ttf`。仅转为 WOFF2 以减少体积，保留字形、字符覆盖和 100–900 可变字重，未按本次界面文案裁剪字库。

字体依 [OFL 1.1](https://github.com/google/fonts/blob/main/ofl/notosanssc/OFL.txt) 随软件提供；字体目录包含原版权声明和许可证。网站不会为字体向 Google 或腾讯发起请求。来源、转换工具和校验值见 `public/fonts/source.json`；桌面包包含相同记录。

Inter 复用已获许可的 DSH Claude 皮肤原始可变 WOFF2，不裁剪、不改字形。其独立的 `Inter-OFL.txt`、`Inter-source.json` 及原第三方许可均随服务包和桌面包分发；来源、字节数和 SHA-256 可核对，不使用可视化预览中的字体子集替代员工实际输入所需字库。

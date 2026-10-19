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

统一字体顺序：`PingFang SC, Noto Sans SC, Microsoft YaHei, Segoe UI, Arial, sans-serif`。

Mac 可优先使用系统自带苹方；没有苹方的电脑由产品自身提供 Noto Sans SC。只引用本机苹方，不打包或分发苹果字体文件。界面既有字号和布局保留，正文、菜单和标题按已有字重显示；代码区继续使用等宽字体。

网页端、桌面远程工作区和后台使用 `public/fonts.css`，由本公司服务提供字体文件。桌面首次连接页使用 `desktop/fonts.css` 和安装包内的相同字体，因此无须先连接服务器才能显示字体。两份字体及 CSS 保持内容一致。

## 字体资产和授权

Noto Sans SC 来自 [Google Fonts 官方仓库](https://github.com/google/fonts/tree/main/ofl/notosanssc)，原始文件为 `NotoSansSC[wght].ttf`。仅转为 WOFF2 以减少体积，保留字形、字符覆盖和 100–900 可变字重，未按本次界面文案裁剪字库。

字体依 [OFL 1.1](https://github.com/google/fonts/blob/main/ofl/notosanssc/OFL.txt) 随软件提供；字体目录包含原版权声明和许可证。网站不会为字体向 Google 或腾讯发起请求。来源、转换工具和校验值见 `public/fonts/source.json`；桌面包包含相同记录。

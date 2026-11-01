# 客户端皮肤

入口为「设置 → 皮肤中心」。默认 Claude；深浅色保持原有账号偏好。偏好键为 `LocalState.settings.skin`，按现有公司地址/员工账号边界保存。旧数据、未知皮肤和无效值归一为 Claude。

选款提供卡片、分类、搜索、双主题预览和全窗试用。试用只影响当前窗口，不写本机记录；取消、Escape、刷新或退出账号恢复已保存值。点击「使用这款」或「保存皮肤」才更新本机偏好。

## 来源与适配范围

- 选款参考 dsh-web 的 2026-10-31 workshop manifest，共 62 款。
- 上游皮肤仓库固定为 https://github.com/zhu1090093659/dsh-skins/tree/1697af9820c236c4154c6ce986261cdce0b7afe0 。
- 全部布局、控件和预览均按公司大脑重新实现；不加载原站 CSS、hooks、脚本或远程壁纸。
- Claude：MIT 配色与字体适配，Newsreader / Inter / JetBrains Mono 保留 OFL 许可。
- 原作背景：冰蓝气泡玻璃、云轨舱窗、居家模型娘、虫巢、余烬、星辉教团、赛博夜城、东京夜行。分别保留 MIT / Apache-2.0 / CC0 声明与适用许可，不改变原作授权。
- 其余 53 款为独立配色适配，没有引入未确认授权、非商用限定或保留权利的原作插画。名称用于标识参考来源，不表示第三方合作或背书。
- 原作者、完整许可与引用信息位于 `src/vendor/dsh-skins.LICENSE`，构建时自动并入 `THIRD_PARTY_NOTICES.txt`，随安装包和服务器包分发。

## 维护

`shared/skin-catalog.json` 是受审查的静态目录；`shared/skins.ts` 生成安全 CSS 变量并校正文字对比度；`src/Skins.tsx` 提供选款界面。背景只允许已入库的 `/skins/…` 文件，服务器现有同源 CSP 不变。新增素材应先核对各文件许可，再添加目录与测试，不将市场清单当成执行代码。

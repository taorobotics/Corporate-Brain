# 模型与服务

公司管理员在管理后台“模型与服务”点击“自定义配置”，选择服务商、填写 API 密钥，再获取模型列表，勾选一个或多个模型并保存。LinoRoute 排在第一位并标注“推荐”。员工在对话模型菜单中选择自己获准使用的模型，无需分别填写密钥。

预设包括 LinoRoute、DeepSeek、Kimi、千问（百炼北京）、腾讯混元、智谱、MiniMax 中国区、OpenAI / GPT、Gemini、Claude 及完全自定义服务。官方预设使用各家官方的 OpenAI 兼容地址。区域、代理或专用套餐的地址可能不同，应按该密钥对应的服务文档修改；更换地址需要重新输入密钥，服务器不会把旧密钥发送到新地址。

“获取 / 刷新模型”通过服务器读取该服务的 `/models`，不发起内容生成。列表仅反映服务商返回的模型，不保证套餐允许调用全部模型。失败或没有列表时可手动添加服务实际支持的模型 ID。不要把文本嵌入、音频等不兼容模型当作对话模型；“图片”要求服务提供 OpenAI 兼容 `/images/generations` 且返回 `b64_json`。

将模型用途设为“图片生成技能”并保存后，系统会按部门授权自动提供对应的公司图片技能，无需另行下载。它会显示在技能中心、已安装列表和对话的技能上拉菜单中；聊天模型菜单只显示对话模型。员工可保持“自动调用”，或将图片技能与其他技能一起选中。普通问答、识图和讨论图片能力不会因为技能已选中就自动出图。

例如“写一段产品介绍并生成配图”：对话模型先输出文字，图片技能随后调用配置的 `/images/generations`，最终文字和图片保存在同一条本机对话回复里，也可从作品和对话中另存图片。切换或使用图片技能不会更换聊天模型。图片失败时保留已经收到的文字，停止对话会中止未完成的图片请求。当前一次回复生成一张 PNG、JPEG 或 WebP，接口必须返回 `data[0].b64_json`，单图上限 20 MB；仅返回 URL 的接口需先在服务商侧配置 base64 输出。此能力不包含图片编辑、视频生成和原生非兼容协议适配。

每项服务只保存一份加密密钥，多个模型共同引用。后台列表和员工接口只返回是否已配置密钥。修改密钥、地址或部门范围会同步至该服务所有模型；未选中的模型停用，再次选中会恢复原模型连接 ID。删除选择或列表变化不会清理员工本机对话。停用、删除或撤销部门授权会同步移除图片技能，服务调用前会再次检查账号和权限。

原有 LinoRoute 连接在服务器升级时自动归入服务配置，保持连接 ID、密钥、模型、部门范围与启停状态，不自动获取模型或扩大授权。DeepSeek 等原有单模型连接继续保留。迁移前应一致性备份数据库与 `secrets.key`。普通员工和部门管理员不能读取或修改服务配置，只有公司管理员可以操作。

官方兼容接口参考：

- DeepSeek：https://api-docs.deepseek.com/
- Kimi：https://platform.moonshot.cn/docs/guide/start-using-kimi-api
- 千问：https://help.aliyun.com/zh/model-studio/compatibility-of-openai-with-dashscope
- 腾讯混元：https://cloud.tencent.com/document/product/1729/111007
- 智谱：https://docs.bigmodel.cn/cn/guide/develop/openai/introduction
- MiniMax：https://platform.minimaxi.com/docs/api-reference/text-openai-api
- OpenAI：https://platform.openai.com/docs/api-reference/models/list
- Gemini：https://ai.google.dev/gemini-api/docs/openai
- Claude：https://platform.claude.com/docs/en/api/openai-sdk

预设地址不代表项目已持有各家有效密钥。发布检查使用本机模拟服务验证多模型、流转、权限和加密；真实模型验证的范围单独记录，不将未调用的官方服务宣称为已验收。

# 模型与服务

公司管理员在管理后台“模型与服务”点击“自定义配置”，选择服务商、填写 API 密钥，再获取模型列表，勾选一个或多个模型并保存。LinoRoute 排在第一位并标注“推荐”。员工在对话模型菜单中选择自己获准使用的模型，无需分别填写密钥。

预设包括 LinoRoute、DeepSeek、Kimi、千问（百炼北京）、腾讯混元、智谱、MiniMax 中国区、OpenAI / GPT、Gemini、Claude 及完全自定义服务。官方预设使用各家官方的 OpenAI 兼容地址。区域、代理或专用套餐的地址可能不同，应按该密钥对应的服务文档修改；更换地址需要重新输入密钥，服务器不会把旧密钥发送到新地址。

“获取 / 刷新模型”通过服务器读取该服务的 `/models`，不发起内容生成。列表仅反映服务商返回的模型，不保证套餐允许调用全部模型。失败或没有列表时可手动添加服务实际支持的模型 ID。不要把文本嵌入、音频等不兼容模型当作对话模型；“图片”要求服务提供 OpenAI 兼容 `/images/generations` 且返回 `b64_json`。

每项服务只保存一份加密密钥，多个模型共同引用。后台列表和员工接口只返回是否已配置密钥。修改密钥、地址或部门范围会同步至该服务所有模型；未选中的模型停用，再次选中会恢复原模型连接 ID。删除选择或列表变化不会清理员工本机对话。

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

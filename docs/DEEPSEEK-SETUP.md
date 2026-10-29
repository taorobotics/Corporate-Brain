# DeepSeek 视觉与联网配置

当前项目使用 DSH 完整 `sdk` profile：DeepSeek Flash 负责文本和图片输入，DSH 的 `web_search` / `web_fetch` 负责联网。两者可以在同一轮对话中使用同一个 DeepSeek API Key。图片能力要求模型连接使用支持视觉输入的 `deepseek-flash`。

## 本地填写

1. 复制 `config/deepseek.env.example` 为 `config/deepseek.env`。
2. 只在本地文件中填写 `DEEPSEEK_API_KEY`，不要提交 Git、不要放进安装包或 Release。
3. 执行 `npm run deepseek:check`。命令只显示“已配置”，不会打印密钥。

服务器配置文件使用 Node 24 的环境文件加载器；显式设置的系统环境变量优先于文件内容。也可以通过 `BRAIN_ENV_FILE` 指定服务器上的绝对路径。

## 公司模型连接

在管理后台新增一个“对话”连接：

- 服务地址：`https://api.deepseek.com/v1`
- 模型标识：`deepseek-flash`
- API 密钥：填写同一个 DeepSeek API Key
- 部门范围：按公司策略选择

保存后，员工聊天会通过 DSH 路由调用该连接。带图片的消息会作为视觉输入发送；需要实时信息时，DSH 会调用联网工具。当前 DSH 依赖版本使用 Anthropic 兼容搜索入口，因此 `DEEPSEEK_SEARCH_BASE_URL` 默认填写 `https://api.deepseek.com/anthropic/v1`，不要改成 OpenAI `/v1` 聊天地址。

## 部署到公司服务器

发布包中的服务器代码和网页来自同一个版本。管理员应：

1. 备份现有 `.data` 和部署配置。
2. 解压对应 Release 的 `Corporate-Brain-Server-X.Y.Z.zip`。
3. 将填写好的 `config/deepseek.env` 通过受控方式复制到服务器私有目录；不要提交到 GitHub。
4. 设置 `BRAIN_ENV_FILE=/绝对路径/config/deepseek.env`，或把文件放在服务器应用目录的 `config/deepseek.env`。
5. 按原有 HTTPS、`BRAIN_DATABASE`、`APP_ORIGIN` 配置重启 `npm start`。

员工客户端继续从公司服务器加载网页，因此服务器更新后重新打开或刷新客户端即可使用新能力。桌面安装包不保存 DeepSeek API Key。

DeepSeek 请求和联网搜索可能产生费用；模型调用只发送本次任务所需的文本、图片和 DSH 工具结果。不要把员工聊天、密钥或公司数据库放进 Release 资源。

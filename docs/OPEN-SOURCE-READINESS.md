# 开源与免费签名准备清单

本清单区分技术准备、账号操作和签名服务审批。2026-11-04 核对仓库已为 Public，标准 Windows、Mac 和 Linux 构建已实际运行；公司数据库、密钥、员工记录和内部 Skills 仍禁止进入公开仓库。以下维护者确认事项和签名服务审批要求继续适用。

## 仓库准备

- 原创代码采用 MIT，根 LICENSE 与 npm 元数据一致；第三方许可原文保留，1152 个锁定依赖的声明记录在 dependency-licenses.json，不把 MPL/LGPL 等组件重新许可为 MIT。
- 前端、字体、Electron 与 Chromium 的许可随对应分发保留。员工客户端有隐私说明、签名政策和离线入口；Windows 安装向导显示许可。
- 提供 Code signing policy、隐私说明、安全报告说明、贡献规则、CODEOWNERS 和基于精确版本标签的原生 GitHub Actions 构建。
- Windows PE 产品名与版本须匹配项目和发版号；未签名仍据实标记 NotSigned。签名后必须重新验签、计算摘要并以新版本分发。
- Gitleaks 固定版本及校验值，扫描全部可达历史且输出脱敏。CI 拒绝跟踪数据库、员工目录、内部 Skills、环境文件和签名私钥。包检查不允许这些内容进入分发。
- 服务器设置 BRAIN_UPDATE_SOURCE=public 可读取公开 Release，不要求 GitHub token；私有模式继续只在服务器保存令牌。公司登录与部门授权不随仓库可见性改变。

实际执行结果见 artifacts/open-source-readiness.json 及各 Release 报告。密钥扫描不证明无漏洞，也不能判断所有素材的商业敏感性。历史设计图和产品演示为既有参考与隔离测试材料；维护者仍须确认允许公开这些素材及全部原创代码。

## 公开前需维护者确认

1. 确认有权以 MIT 公开源码与演示素材，并接受全部历史和旧 Release 同时可见；他人复制的内容无法保证收回。
2. 确认 GitHub 和 SignPath 所有相关账号均已开启 MFA。当前 OAuth 接口未返回可用的 two_factor_authentication 值，不能据此证明已开或未开。
3. 审阅检查结果后将仓库改为 Public，并启用可用的私密漏洞报告、secret scanning/push protection，复核 CI 凭据权限；不公开公司后台、NAS 或业务数据。

## SignPath 仍需外部完成

1. 维护者建立 SignPath 账号并开启 MFA，从 https://signpath.org/apply 申请，使用 SIGNPATH-APPLICATION.md 的准备材料。
2. 服务方审核项目控制权、开源许可、用途、构建及可核实声誉。新项目不保证马上获批，不能靠添加 LICENSE 自动满足声誉要求。
3. 获批后配置实际 organization/project/artifact/signing-policy 标识、CI 来源验证、受控凭据、测试签名和正式人工审批者；不能使用假标识或绕过审批。
4. 每次正式签名需维护者明确审批；签后验签并生成新摘要，以新版本发布。v0.2.2 仍是未取得可信签名的准备版。

官方依据：https://signpath.org/terms ，https://docs.signpath.io/origin-verification/ ，https://opensource.org/license/mit 。Mac Developer ID 与公证是独立申请：https://developer.apple.com/developer-id/ 。

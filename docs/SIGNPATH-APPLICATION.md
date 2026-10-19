# SignPath application material — not yet submitted

Project: Corporate Brain / 公司大脑

Repository: https://github.com/taorobotics/Corporate-Brain

Maintainer, reviewer and proposed signing approver: @taorobotics, https://github.com/taorobotics . The account owner must supply their verified contact details in the application; none are invented here.

License: MIT for original project code; upstream notices and locked dependency licenses are preserved. No commercial dual-licensing of project source is proposed.

Description: An open-source Windows/macOS employee client, web UI and self-hosted company service for department accounts, local conversation storage and reviewed sharing of reusable Skills. Credentials, employee histories, internal Skills and business documents are deployment data, excluded from public source and employee packages. The product is not a vulnerability scanner, exploitation toolkit or OS-security bypass tool.

Download: https://github.com/taorobotics/Corporate-Brain/releases/latest . Windows artifact: Corporate-Brain-Setup-X.Y.Z-x64.exe (NSIS). Desktop ProductName: 公司大脑; ProductVersion follows the release. Existing test releases are unsigned; admission is requested, not claimed.

Build: .github/workflows/desktop-release.yml checks out the exact tag, installs locked dependencies and runs backend, update, frontend, native desktop and package checks. Windows and both Mac architectures use native GitHub runners. Reports preserve source commit, file allowlist, product metadata and SHA-256. Published assets are immutable.

Scope: Main/preload and UI are independently implemented in this repository. No proprietary Codex, ChatGPT or Claude Code source or analysis cache is distributed. Electron, Chromium and open-font notices remain with the product. REA is a development-only tool and is not shipped in the employee client. Upstream binaries are not falsely signed as project-authored code.

Code signing policy: https://github.com/taorobotics/Corporate-Brain/blob/main/docs/CODE_SIGNING_POLICY.md

Privacy policy: https://github.com/taorobotics/Corporate-Brain/blob/main/docs/PRIVACY.md . Users select the company endpoint and task inputs; company operators select model providers and enable release checks. Local histories are not uploaded to maintainers. Application code has no advertising, behavior analytics or remote crash-upload integration.

Approval: External contributions are reviewed by the maintainer. Privileged GitHub and SignPath users must use MFA. Each production signing request requires explicit human approval in SignPath; account enrollment and service configuration remain pending until admission.

Reputation: This is a new project. Please assess its actual public maintenance and release evidence; no community reputation, download count or external endorsement is claimed.

Next owner actions: confirm publication rights and MFA, make the reviewed repository public, provide verified SignPath account/contact details and submit the application. After acceptance, integrate the assigned test and production policies and verify signatures before publishing a new signed version.

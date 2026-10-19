# Security policy

Use the latest tested release. This project is under active development and has not completed a comprehensive independent security audit or the full production acceptance plan.

Do not open a public Issue containing credentials, employee records, internal Skills, NAS addresses or private documents. When available, use GitHub's private vulnerability reporting entry for this repository. If that channel has not been enabled, contact @taorobotics through an existing private channel and request a secure reporting route; do not post the vulnerability details publicly to ask for contact.

Reports should include the affected version, a minimal reproduction with synthetic data, impact, and any proposed fix. Never attach production databases, signing keys, environment files or raw employee conversations.

Maintainers must verify and rotate any exposed credential, assess all affected Git history and Release assets, and publish a new version for product fixes. Adding .gitignore does not remove existing history. Third-party notices and signatures must be checked separately from secret scanning.

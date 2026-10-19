# Code signing policy

Repository: https://github.com/taorobotics/Corporate-Brain

Status as of 2026-10-19: preparing an application; not submitted or approved by SignPath Foundation. Windows releases are currently unsigned. Mac releases use an ad-hoc signature, without Apple Developer ID or notarization. No trusted-signing badge or approval is claimed.

## Project and license

Corporate Brain is an MIT-licensed employee desktop, web, and company-service application. Third-party components keep their original licenses; see THIRD_PARTY_NOTICES.txt and docs/dependency-licenses.json. Company credentials, live databases, employee conversations, internal Skills, NAS documents, and proprietary analysis caches are deployment data, not part of the public source or signed distributions.

Only builds produced from this repository's public source and reviewed build scripts may be submitted for the project's signature. No copied proprietary ChatGPT, Codex or Claude Code implementation, upstream private binary, REA analysis cache, company data or signing private key may enter the signed application. REA is a development-only analysis tool and is not shipped in the employee desktop package. Product references do not imply sponsorship or affiliation.

## Team roles

- Maintainer and trusted author: @taorobotics (https://github.com/taorobotics).
- Reviewer of external contributions and signing-related changes: @taorobotics.
- Proposed release-signing approver: @taorobotics; this assignment must be accepted and configured in SignPath before production signing.

All repository and SignPath users with relevant access must enable multi-factor authentication. This requirement is documented; a local script or OAuth repository token cannot attest that the owner has completed SignPath enrollment or MFA. The account owner must verify both in the respective services.

## Build and approval policy

1. Every delivered update has an immutable version tag and corresponding GitHub Release. Published installers are never replaced in place.
2. The Desktop release workflow checks out the exact tag, installs from package-lock.json and runs backend, production UI, desktop and package checks on native Windows and Mac runners.
3. The Windows executable product name and version must match the project and release. Only project-owned executable artifacts are eligible for the project's signature; upstream binaries retain their upstream signatures and notices.
4. If SignPath approves the project, a trusted GitHub Actions origin must be connected according to its requirements, using protected credentials and a distinct test-signing policy before release-signing.
5. Each production signing request requires the configured human signing approver's explicit approval in SignPath. Automated version publication does not imply automated signing approval. Never bypass that service requirement.
6. Hashes and signature verification of the final signed artifact must succeed before publishing it. Hashing must occur after signing. Unsigned artifacts must never be described as signed.
7. Keep provenance, source commit, package checks and final SHA-256 manifests with the Release. A corrected or newly signed installer uses a new version rather than overwriting an existing public asset.

## Attribution after approval

The following attribution will apply only after SignPath Foundation accepts and activates the project:

Free code signing provided by SignPath.io (https://about.signpath.io), certificate by SignPath Foundation (https://signpath.org).

The Foundation certificate identifies SignPath Foundation as the certificate publisher; it is not a certificate issued in the company's own legal name. Until approval, this attribution describes the proposed service rather than an active endorsement.

## User privacy and system changes

See the bundled privacy policy, docs/PRIVACY.md. The program transfers necessary data only to destinations selected or enabled by the user or company operator. Installation, opening a downloaded update, file selection and saving are explicit user operations. No hidden telemetry or company transcript upload is added for signing. Native installers provide their standard installation and removal behavior; physical-device upgrade and uninstall acceptance remains separately recorded.

## Application and verification boundary

Official requirements: https://signpath.org/terms . Application entry: https://signpath.org/apply . Foundation acceptance, project reputation evaluation, service-account enrollment, MFA and issuance/activation are external decisions or account-owner actions. This repository cannot guarantee admission by adding files or changing its visibility.

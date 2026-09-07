# Security Policy

Security is important for this project. If you discover a vulnerability, please report it responsibly and avoid publicly disclosing the issue before a fix is available.

## Supported Versions

This project is under active development.

| Version        | Supported |
| -------------- | --------- |
| `main`         | ✅ Yes     |
| Latest release | ✅ Yes     |
| Older releases | ❌ No      |

Security fixes are generally applied to the latest version only.

## Reporting a Vulnerability

**Please do not report security vulnerabilities through public GitHub Issues, Discussions, or other public channels.**

If you believe you have discovered a security vulnerability, please report it privately using **GitHub Private Vulnerability Reporting / Security Advisories** for this repository.

When submitting a report, please include as much of the following information as possible:

* A clear description of the vulnerability
* The affected component or feature
* Steps required to reproduce the issue
* Proof-of-concept code or requests, if applicable
* Potential security impact
* Screenshots, logs, or error messages, if relevant
* Any suggested mitigation or fix

Please remove passwords, authentication tokens, private messages, email credentials, encryption keys, or other sensitive user data from screenshots and logs before submitting them.

## Security Scope

Examples of vulnerabilities that are particularly relevant to this project include:

* Authentication or authorization bypasses
* Account takeover vulnerabilities
* JWT/session vulnerabilities
* Password reset or email verification bypasses
* Privilege escalation
* Server, channel, role, or permission bypasses
* Unauthorized access to direct messages or private channels
* Unauthorized message modification or deletion
* Socket.IO authentication or authorization issues
* Cross-Site Scripting (XSS)
* Cross-Site Request Forgery (CSRF), where applicable
* SQL injection or other injection vulnerabilities
* Path traversal
* Arbitrary file access
* Unsafe file uploads
* Remote code execution
* Server-Side Request Forgery (SSRF)
* Sensitive information disclosure
* Exposure of passwords, JWT secrets, SMTP credentials, encryption keys, or API keys
* Weaknesses affecting encrypted application data
* Electron-specific vulnerabilities that could allow privilege escalation or arbitrary code execution
* WebRTC, PeerJS, voice, video, or screen-sharing vulnerabilities that expose information without authorization
* Rate-limit bypasses that could significantly affect availability or account security

## Out of Scope

The following generally do not qualify as security vulnerabilities:

* Missing security headers without a demonstrated security impact
* UI/UX bugs
* Self-XSS that cannot affect another user
* Social engineering attacks
* Denial-of-service testing that generates excessive traffic
* Issues that require physical access to an already unlocked device
* Vulnerabilities that only affect unsupported or significantly modified versions of the project
* Reports generated entirely by automated scanners without evidence of an exploitable vulnerability

## Testing Rules

Security research must be performed responsibly.

Please:

* Test only against systems and accounts you own or have explicit permission to test.
* Avoid accessing, modifying, or deleting another user's data.
* Avoid disrupting the service or intentionally degrading availability.
* Do not perform large-scale automated scanning against public deployments.
* Do not attempt social engineering, phishing, or credential theft.
* Do not publish vulnerability details before the issue has been investigated and, when appropriate, fixed.

If you accidentally access sensitive information belonging to another user, stop testing and report the issue immediately. Do not retain, share, or further access that information.

## Secrets and Credentials

Never include real credentials in a vulnerability report, issue, pull request, or commit.

This includes:

* Passwords
* JWT secrets
* SMTP usernames or passwords
* API keys
* Encryption keys
* Session tokens
* Authentication cookies
* Private user information

If you discover a secret that appears to have been accidentally committed to the repository, report it privately.

## Disclosure Process

After receiving a vulnerability report, the maintainer will attempt to:

1. Review and reproduce the reported issue.
2. Determine its severity and affected components.
3. Develop and test a fix when necessary.
4. Release the security fix.
5. Coordinate public disclosure when appropriate.

There is no guaranteed response or resolution time, as this is an independent educational project maintained on a best-effort basis.

## Responsible Disclosure

Please provide reasonable time for a vulnerability to be investigated and fixed before publicly disclosing technical details.

Good-faith security research that follows this policy is appreciated.

## Disclaimer

This is an independent educational and portfolio project.

tahosapp is an independent open-source communication platform.

The software is provided **"AS IS"**, without warranty of any kind. Users deploying this project publicly are responsible for properly configuring HTTPS/WSS, secrets, CORS, rate limiting, firewall rules, backups, monitoring, and other production security controls.

Thank you for helping improve the security of this project.

# Security policy

## Report vulnerabilities privately

Use this repository's **Security → Advisories → Report a vulnerability** action
when available. GitHub private vulnerability reporting is the intended reporting
channel; it must be enabled by the repository owner. Do not put exploit details,
credentials, private document data or unredacted logs in a public issue.

If that action is unavailable, open an issue asking the maintainer to enable a
private reporting channel, without disclosing the vulnerability. There is no
separate security email address or guaranteed response time.

Include the affected version and platform, impact, relevant code paths and a
minimal reproduction using local fixtures or your own disposable test data.
Do not test accounts, documents or services without their owner's permission.
Allow time for private discussion and a fix before publishing sensitive details.

## Scope and supported versions

Reports about the latest release and current default branch are welcome. Older
versions may need to be upgraded; the project does not promise security backports
or a maintenance period for every release.

Relevant boundaries include credential handling, request authorization, file
uploads, document-write protections and the integrity of release packaging.
Onshape account or service vulnerabilities belong with Onshape, not this app's
public issue tracker.

## Protect your account

- Use only the documented permissions needed for your workflow; keep API keys
  private. If a key is exposed, revoke it in Onshape and create a replacement.
- Keep configuration files and backups out of bug reports and shared archives.
  Backups may contain document information.
- Run the desktop app locally. Exposing it to a network requires a separate
  deployment and security review; a local launch is not a hosted-service setup.
- Obtain releases from a source you trust. A matching checksum detects changes
  against a trusted value, but does not authenticate an unknown publisher.
  Unsigned builds may trigger operating-system warnings; do not disable system
  protections to launch them.

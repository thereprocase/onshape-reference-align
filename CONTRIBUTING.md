# Contributing

Thanks for helping make image calibration easier for Onshape users. Small,
reproducible bug reports and focused pull requests are welcome. Discuss larger
changes in an issue before investing substantial time.

## Report a problem or suggest a change

Use an issue template. Include the app version, operating system, how you
launched it, exact steps and the visible error. For interface problems, include
the browser and window size. Describe the expected result separately from the
actual result.

Never attach API keys, secrets, `.env` files, configuration directories, backups,
or private Onshape documents. Redact screenshots and logs before sharing them;
document URLs and feature data can also be private. Follow [SECURITY.md](SECURITY.md)
for suspected vulnerabilities instead of opening a public bug report.

## Work on the source

Use Node.js 22 or newer. The app has no runtime package dependencies; there is
no install step for ordinary source development.

```sh
npm start
npm run check
```

The first command opens the app locally. Stop that process before running checks
in the same terminal, or use a second terminal. Local-image previews work without
Onshape credentials. Use the Connection panel if your change needs an account.
Do not put credentials in source files or commit them.

`npm run check` covers syntax, generated-file consistency, workflow syntax, unit
tests and a local HTTP smoke test. It does not prove live Onshape behavior or
native executable behavior on every operating system. See
[verification notes](docs/VERIFICATION.md) and
[distribution instructions](docs/DISTRIBUTION.md) for those separate checks.

## Keep changes reviewable

- Fix a root cause once; add a regression test that demonstrates the behavior.
- Preserve server-side authorization, workspace, capability, confirmation and
  backup protections. Disabled UI controls are not an authorization boundary.
- Avoid runtime dependencies unless the tradeoff has been discussed. Keep build
  tools pinned and generated assets in sync with their source.
- Update the beginner guide when buttons, launch steps or setup behavior change.
- State what you tested and what remains untested. Do not describe mocked or
  local results as live Onshape verification.

Live verification scripts can create or modify Onshape content. Reading a script
is not permission to run it: use only a scratch document you own or have explicit
permission to modify, inspect its guards first, and never use a real work document
as a test fixture. Do not include captured private data in a pull request.

Contributions are reviewed under the project's [MIT license](LICENSE) and
[Code of Conduct](CODE_OF_CONDUCT.md). Review and release timing depend on
maintainer availability; there is no guaranteed response time.

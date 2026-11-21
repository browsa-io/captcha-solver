# Contributing

Issues and pull requests are welcome.

## Before you open a pull request

```bash
npm ci
npm run typecheck
npm test
npm run build && npm run build:firefox
npx --yes web-ext@10.8.0 lint --source-dir dist/firefox
```

CI runs the same steps on Node.js 22.

## Ground rules

- **No remote code.** Everything that runs ships in the package: no `eval`, no `new Function`, no loaded scripts.
- **Keep permissions minimal.** A new permission needs a reason in the pull request and a row in the README's
  Permissions table.
- **Privacy first.** If a change alters what is sent, when, or what is kept, update [PRIVACY.md](PRIVACY.md) and
  `static/privacy.html` in the same pull request.
- **Measured claims only.** A new captcha type ships off and unlisted until it passes on public pages, counted by
  the site's own server verdict.
- **Names.** Don't name other captcha-solving services or competing products in code, comments or docs.
- **Authorized use.** Changes meant to get past captchas on sites you are not authorized to automate are not
  accepted.

## Security issues

Not in a public issue. See [SECURITY.md](SECURITY.md).

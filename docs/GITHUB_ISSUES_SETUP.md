# GitHub Issue Reporting Setup

The app's **More > Report an Issue** command opens this fixed URL in the user's
default browser:

https://github.com/kelmankenberg/Khinsider-Downloader/issues/new/choose

Users need a GitHub account to submit. The app does not upload logs, credentials,
or account data automatically, and it never renders GitHub in the privileged app
window. If the browser fails to open, a dialog provides the URL for manual use.

## Repository Setup

1. Open the repository on GitHub as an owner or administrator.
2. In **Settings > General > Features**, enable **Issues** if it is disabled.
3. Check the default branch under **Settings > General > Default branch**.
   Publish the template files to that branch (currently `main`):
   - `.github/ISSUE_TEMPLATE/bug_report.yml`
   - `.github/ISSUE_TEMPLATE/feature_request.yml`
   - `.github/ISSUE_TEMPLATE/config.yml`
4. Under **Issues > Labels**, confirm the `bug` and `enhancement` labels exist.
   Create them if missing; the forms apply these labels to submitted issues.
5. Open the issue-chooser URL above. Confirm **Bug Report** and **Feature Request**
   appear. Open each form and check its fields and required privacy acknowledgments.
   No test issue needs to be submitted to verify the chooser.

Templates only become active when present on GitHub's default branch. Local
files, a GUI rebuild, or files on an unmerged development branch are not enough.
Until they are pushed or merged, the app link may show GitHub's existing issue UI.

## Publishing the Local Templates

Review all pending project changes, then stage the intended files and push or
open a pull request according to the repository's workflow. Do not stage local
session history, secrets, generated dependencies, or downloaded music.

For the templates alone, after reviewing them:

```sh
git add .github/ISSUE_TEMPLATE
git diff --cached
git commit -m "chore: add GitHub issue forms"
git push origin main
```

The app menu action, documentation, and regression tests also need to be included
in the corresponding application commit. For a protected default branch, merge
the changes through a pull request instead of pushing directly.

## Forms and Privacy

- **Bug Report** asks for app version, Linux distribution/version, interface,
  reproduction steps, expected/actual behavior, and optional runtime details,
  screenshots, or sanitized logs.
- **Feature Request** asks for the problem/use case, proposed solution,
  alternatives, and optional context.
- Blank issues are disabled to encourage the forms. To allow them later, change
  `blank_issues_enabled` to `true` in the chooser configuration.
- Treat issue content as potentially public. Never ask users to post passwords,
  session cookies, access tokens, signed media URLs, or unredacted private paths.
- No account-free channel is configured. Add a support email or form separately
  if that becomes necessary; do not add placeholder contact details.

## Maintenance

Use `bug` and `enhancement` labels for triage, link duplicate reports to the
original issue, and ask for missing reproduction details without requesting
secrets. Review privacy-sensitive submissions promptly.

If the repository is renamed or transferred, update the fixed URL in the
Electron main process and this guide. If bug-form fields change, keep the app's
Help guidance and template validation tests in sync.
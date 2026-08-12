# Security policy

## Reporting a vulnerability

**Please do not open a public issue for a security problem.**

Report it privately through GitHub's
[private vulnerability reporting](https://github.com/Shai-Alit/sas-py-vscode/security/advisories/new)
on this repository. Include what you did, what happened, what you expected, and —
if you know — the affected version and Viya generation.

Expect an acknowledgement within a few days. This is a small project, so please
be patient; you will get a real answer rather than an automated one.

If the vulnerability is in SAS Viya itself, or in the upstream
[`sassoftware/vscode-sas-extension`](https://github.com/sassoftware/vscode-sas-extension),
report it to SAS Institute rather than here. If you are unsure which it is, report
it here and we will help work it out.

## Scope

This extension holds credentials for, and executes code on, a SAS Viya
deployment. Findings in these areas are especially relevant:

Anything that could **expose a credential** — a token appearing in the output
channel, a log file, an error message, telemetry, a fixture, or persisted
workspace state instead of `SecretStorage`.

Anything that lets **code escape its intended context** — most importantly,
Python submitted to `PROC PYTHON` that breaks out of its `submit;`/`endsubmit;`
block and executes as SAS or as a macro. Input containing `endsubmit;` or macro
syntax must be neutralised.

Anything in the **OAuth2 flow** — weak PKCE verifier generation, a missing or
unchecked `state` parameter, a redirect that can be captured by another process,
or a token that outlives its intended scope.

Anything in a **webview** — content-security-policy gaps, `unsafe-inline`, remote
script loading, or unvalidated messages crossing the extension/webview boundary.

**Dependency vulnerabilities** that are actually reachable from our code paths.

## Out of scope

Vulnerabilities in SAS Viya itself, in the VS Code platform, or in an unmodified
upstream dependency with no reachable path from this extension. Also out of scope:
findings that require an attacker to already control the user's machine or their
Viya account, and reports produced solely by an automated scanner with no
demonstrated impact.

## What this extension does with your credentials

Tokens are stored in VS Code's `SecretStorage`, which delegates to the operating
system keychain. They are never written to settings, workspace state, disk, or
logs. Connection profiles hold the server URL and client identifiers only — never
a secret.

**No telemetry is collected.** Nothing about your usage, your code, or your
deployment is transmitted anywhere except to the Viya server you configured.

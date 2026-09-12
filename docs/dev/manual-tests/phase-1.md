<!-- Copyright © 2026, Sean Ford and the Python on Viya contributors -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Manual test pass — Phase 1 (Connection profiles, sign-in)

See [`setup.md`](setup.md) for pre-flight/activation and the tagging legend, and for the index of every other phase's file.

## Connection profiles — phase 1a

The profile _model_ is validated whether you use the commands or hand-edit
`settings.json`. Secrets never live in settings.

- [x] **1.1** **Add a profile** — a name, an `https://…` endpoint, context and client id
  left empty.
  **Expect:** “Added connection profile …” toast; the status bar shows the name.
- [x] **1.2** **Endpoint validation rejects the dangerous shapes** — try
  `http://viya.example.com` (non-loopback http) and `https://user:pw@host`.
  **Expect:** both refused with a specific reason (token readable over http;
  credentials do not belong in a settings file).
- [x] **1.3** **Settings shape is right** — inspect `pythonOnViya.connectionProfiles`.
  **Expect:** keyed by name, each entry carrying a `version` and a generated
  `id`, and **no** client secret anywhere.
- [x] **1.4** **Hand-editing is picked up and re-validated** — change a profile's
  endpoint in `settings.json`, then break another (drop the scheme).
  **Expect:** the valid edit takes effect; the broken one is ignored with a log
  line naming which and why, not a whole-setting failure.
- [x] **1.5** **`defaultProfile` vs Switch** — `pythonOnViya.defaultProfile` is a
  **Settings UI / `settings.json` value, not a command** — it will never appear
  in the Command Palette by design (confirmed against `package.json`'s
  `contributes.configuration`; the 2026-08-27 pass looked for it in the
  Palette and reasonably didn't find it). Set it via **Settings → search
  "Python on Viya" → Default Profile**, or `settings.json` directly, then
  reload; then **Switch Connection Profile** to another.
  **Expect:** a fresh window starts on `defaultProfile`; switching overrides it
  for this window only and does not rewrite the setting. *(Not yet re-run
  against the corrected steps — do that before ticking this box.)*
- [x] **1.6** **Edit and Delete** — **Edit Connection Profile** (change endpoint, leave
  the secret prompt blank); **Delete Connection Profile**.
  **Expect:** edit updates in place and keeps the stored secret; delete removes
  the entry and drops its secret from secret storage.
- [x] **1.7** **(slow) One-time import from the SAS extension** — only if that extension
  is installed with profiles: **Import Connection Profiles from the SAS
  Extension**.
  **Expect:** Viya profiles copied once; non-Viya kinds skipped.


## Sign in — phase 1b

- [x] **1.8** **(live) OAuth2 + PKCE round trip** — run **Sign In**.
  **Expect:** the system browser opens SASLogon; you land back in VS Code. On a
  stock Viya 4 that is the paste-box arm; the URI-handler arm only fires with an
  admin-registered client. Signing in also opens a compute session.
- [x] **1.9** **(live) Empty client id uses the built-in client** — profile with
  `clientId` empty.
  **Expect:** the built-in `vscode` client on Viya 4 2022.11+. On an older Viya
  4 you are told, in those words, to supply an id and secret. _(Viya 3.5
  support is dropped —
  [ADR-0022](https://github.com/Shai-Alit/sas-py-vscode/blob/main/docs/adr/0022-drop-viya-35-support.md)
  — nothing to test.)_
- [x] **1.10** **Sign out** — run **Sign Out**, then trigger a run.
  **Expect:** you are taken back through authentication. **Failed, 2026-08-27**
  — clicking **Run File** after sign-out silently fails instead ("The program
  could not be sent to SAS Viya…", nothing in the log, no re-auth prompt).
  Root-caused and tracked as Phase 3's **3f** slice (`docs/phases/phase-3.md`)
  — re-run this item once that lands. **Retested 2026-09-09: passes** — Sign
  Out then Run File takes you back through auth.
- [x] **1.11** **(live) Accounts menu with two profiles signed in** — sign into two
  profiles whose auth flows differ (e.g. an SSO Viya profile and a
  corporate-creds one).
  **Expect:** both appear as separate rows. **Observed 2026-09-09:** they do —
  refining [#42](https://github.com/Shai-Alit/sas-py-vscode/issues/42), which is
  about the collapse that happens only when two profiles produce the *same*
  `account.label`. Two open points, not defects for this box: the rows do not
  identify themselves as **Python on Viya** or say which profile each is (one
  showed as `Sean Ford (SAS Viya)`, the other as `sean.ford@sas.com
  (Microsoft)` — the parenthetical is the auth provider's name, and the
  `(Microsoft)` label for a corporate-creds profile is itself confusing). Both
  carried to **Phase 11** (parity gaps) — see `docs/phases/phase-11.md`.
- [x] **1.12** **(live) (slow) Proxy / internal CA** — only if applicable: sign in as
  normal.
  **Expect:** it completes; proxy and OS/internal certificate trust are
  inherited from the extension host.

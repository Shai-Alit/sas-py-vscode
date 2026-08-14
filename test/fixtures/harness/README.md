# Harness fixtures

Synthetic payloads. Nothing in here was recorded from a deployment, and nothing
in here is evidence — that is what `viya4/` and `viya35/` are for.

- **`echo.json`** — proves the fixture reader and the mock HTTP layer work.
  Imitates nothing.
- **`identity-user-summary.json`** — the `application/vnd.sas.identity.user.summary+json`
  representation of `/identities/users/@currentUser`.

## About `identity-user-summary.json`

It is **hand-written**, which the rule at `../README.md` allows only here and only
if the file says so. This one says so.

Its field list, order, and value shapes are taken from **findings 7 and 8** in
`PROBE-FINDINGS.md`, which are a record of a live Viya 4 probe on 2026-08-13: the
twelve top-level fields the summary type returns, a 17-character non-UUID `id`
that is not the login name, `scimId` equal to `id` on a SCIM-backed deployment,
and `externalLoginIds` holding the login. The values are invented; the shapes are
not.

The reason it is not a capture is narrow and worth writing down rather than
quietly working around: the probe's raw response body was never saved. Findings 7
and 8 recorded the field list and the shape of each value — deliberately, because
the values were a real person's — and the body itself was not kept. Reconstructing
a "capture" from those notes and filing it under `viya4/` would produce a file
indistinguishable from a recording and worth much less, which is the exact failure
`../README.md` exists to prevent.

**Replace it with a real capture when one is available.** A read-only `GET` of
that URL with the summary `Accept` header, scrubbed per `../README.md`, belongs in
`viya4/identity-current-user.json`; move the tests over and delete this file. The
three PII arrays finding 7 names — `addresses`, `emailAddresses`, `phoneNumbers` —
are absent from the summary representation, so a correctly captured summary
response needs no PII scrubbing at all. That is the whole argument for asking for
it.

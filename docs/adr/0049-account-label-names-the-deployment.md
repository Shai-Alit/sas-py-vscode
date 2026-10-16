# ADR-0049 — An account's label names the deployment as well as the person

- **Status:** Accepted
- **Date:** 2026-10-15
- **Decides:** what an account's `label` says in the Accounts menu, and what
  a caller checks on a session it gets from a silent `getSession`
- **Amends:** `PRODUCTION_PLAN.md` §6 open decision 10, whose label was the
  person alone
- **Executed in:** the #250 fix on `fix/250-stale-token-bare-challenge` (the
  "Post-release fix: stale sign-in after an endpoint edit (#250)" Runbook
  entry in [`docs/phases/phase-13.md`](../phases/phase-13.md))
- **Evidence:** Phase 2a's #146 diagnosis (P35/P35a in
  [`docs/phases/phase-2a.md`](../phases/phase-2a.md)); the #250 manual test
  pass, 2026-10-15; VS Code's `authenticationService.ts`,
  `authenticationAccessService.ts` and `mainThreadAuthentication.ts` on
  `main`, read 2026-10-15

## Context

Decision 10 keys an account on the endpoint plus the Viya user id, so that a
development deployment and a production one are two accounts. It made the
label the person alone: the display name, then the login, then the id.

VS Code does not key on the account id. It keys on the label:

- `getAccounts` keeps the first account for each label and drops the rest.
- The account preference it remembers for an extension matches by label.
- Access grants are stored per provider and label, and a provider's own
  extension gets no automatic grant.

So one person signed in to two deployments was one account to VS Code. Phase
2a found this as #146: one Accounts-menu row for two deployments, and
`accountForEndpoint` finding nothing for every deployment after the first,
since `getAccounts` returned only the first one's account. Phase 2a named
this fix and held it back for an ADR.

#250 found the cost. With innovation active and verde signed in as the same
person, the CAS view found no account for innovation and called a silent
`getSession` with no account. VS Code matched its remembered label, returned
verde's session, and verde's token went to innovation's CAS management
service, which refused it. The same code path serves SAS Content and the CAS
connection snippet. Compute was protected only because it checks the
session's id against the active profile.

## Decision

1. **The label is `<person> (<deployment>)`**, for example
   `Dana Whitfield (viya.example.com)`. The person is decision 10's chain,
   unchanged. The deployment is the endpoint's root, the reduction
   `accountId` already uses, without `https://`. Any other scheme, a port and
   a path stay, so two labels differ whenever the roots differ.
2. **A session from a silent lookup is checked, not trusted.** The CAS view,
   the SAS Content view and the CAS connection snippet refuse a session whose
   account was not issued for their endpoint (`accountBelongsTo` in
   `src/auth/identity.ts`), and treat it as no session. Labels that differ
   per deployment make the hint work whenever the endpoint has exactly one
   account. They do nothing when it has none, and VS Code still answers from
   its remembered account then.

## Consequences

- One person on two deployments is two accounts and two Accounts-menu rows,
  and each row says which deployment it is. That also covers the menu not
  naming the deployment, recorded with #146.
- The host is used rather than the profile name. An account belongs to a
  deployment, and two profiles on one endpoint share one account, so a
  profile name would be ambiguous. Renaming a profile would also change the
  label and lose its access grant.
- **Existing sign-ins lose their access grant once.** The grant is stored
  under the old label. Until the next interactive request, the silent
  lookups get nothing, so CAS and SAS Content show their sign-in prompt.
  Connecting, or running code, asks VS Code's one-time "wants to sign in"
  consent for each deployment, the same prompt the first sign-in showed
  under the old label.
- **Known limit: two identities with one display name on one deployment.**
  The label is unique per deployment, not per identity. An everyday login
  and an admin login sharing a display name, on profiles pointing at the
  same endpoint, still get one label. VS Code can then hand one identity's
  token to the other's profile, and `accountBelongsTo` passes because the
  endpoint is right. This was true before this ADR. Adding the login to the
  label would close it at the cost of a longer row for everyone. Sean chose
  the shorter label and this record, 2026-10-16.
- The `Incorrect account detected` check after `createSession` compares
  labels the provider itself produces, so it is unaffected.
- Rejected: checking ownership only (the second point alone). That stops the
  wrong token, but the second deployment never finds its own account, so its
  views stay signed out while its sign-in works.
- Rejected: CAS and SAS Content asking the provider directly by profile id,
  bypassing `vscode.authentication`. That is a larger change to how the
  views get tokens, and the label fix covers it.

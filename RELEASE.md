# Release & Branching Strategy

We version with **branches**, and freeze production with **tags**:

- **Each release line is a branch** — `release/1.2`, `release/1.3`, … — the active, deployable line
  for that version. You branch the next line from the current one, deploy a line to an environment,
  fix on a line, and merge fixes forward.
- **Environments are pointers, not branches.** `dev` / `staging` / `production` each just record
  *which ref is currently deployed there*. That mapping lives in a committed `environments.json`
  the Console reads and updates on every deploy.
- **Production deploys are auto-tagged `vX.Y.Z`** — an immutable snapshot of the exact commit that
  went live. Branches are the moving working lines; the **tag is the trustworthy rollback point**
  (a branch can change later; a tag never does). A tag is also a **manifest** — every
  `apps/core/*/package.json` version is frozen at it, so `v1.2.0` = "app 1.0.3, auth 1.0.2, …".

The Console (`tools/console` → **Deploy** tab) is the source of truth for env→version mapping, shows
a **service × environment Map**, stamps the prod tag, and (next phase) drives promotion, hotfixes,
forward-merges, and rollback.

---

## Branches

| Branch          | Purpose                                                                          |
|-----------------|----------------------------------------------------------------------------------|
| `release/X.Y`   | A version line (e.g. `release/1.3`). The deployable, evolving line for that minor.|
| `<dev>-<date>`  | Your personal/parking branch (e.g. `john-061226`). Where your work lives.        |
| `hotfix/<desc>` | A short fix branch cut from a release line (or a prod tag) for an urgent bug.     |

There is **no permanent `development`/`staging`/`production` branch** — those are environments
(below). `main` may be kept as a convenience mirror of the latest production release, but it is not a
working line. `local` is the LocalStack target driven by the per-service Develop pipeline.

### Personal / parking branches

Always **branch first** on a fresh checkout — never work directly on a release line:

```bash
git switch release/1.3 && git pull
git switch -c john-061226        # your parkable workspace
```

If something urgent comes up, your work is already parked on its own branch — switch away, deal with
it, switch back. Rebase your personal branch on its release line regularly so it doesn't drift:
`git fetch && git rebase release/1.3`. (Topic names like `john/login-fix` are fine too if you juggle
several.)

---

## Environments are deploy pointers

`environments.json` (committed, Console-managed) records what's deployed where:

```jsonc
{
  "dev":        { "ref": "release/1.3" },          // the active next version
  "staging":    { "ref": "release/1.2" },          // a line under QA
  "production": { "ref": "v1.2.0", "tag": "v1.2.0" } // the live immutable release
}
```

"What's in production?" → `environments.json.production`. The Map cross-checks it against each
service's live `GET /version`.

---

## Normal release flow

Say `v1.2.0` is live (line `release/1.2`, tag `v1.2.0`).

1. **Open the next line:** `git switch -c release/1.3 release/1.2 && git push -u origin release/1.3`.
   Point **dev** at it (deploy `release/1.3` → dev account).
2. **Work:** everyone branches `<dev>-<date>` off `release/1.3`, and **merges back into `release/1.3`**
   when ready for others to see/use/test. `release/1.3` is the shared "active next version".
3. **QA:** when `release/1.3` is ready, deploy it to **staging**. Bugs found in staging are fixed on
   `release/1.3` (or a short branch merged into it); each prod-bound fix bumps the patch — so the
   version that actually ships may be `v1.3.1`.
4. **Release:** deploy `release/1.3` to **production**. The Console **auto-tags `v1.3.0`** (or
   `v1.3.1`) on that exact commit and updates `environments.json`.
5. **Roll forward:** open `release/1.4` from `release/1.3` for the next cycle. Speculative next-version
   work stays in personal branches until `release/1.4` exists (single release train — see Scaling).

---

## Hotfix flow (urgent production bug)

`v1.2.0` is live and a bug appears, while `release/1.3` is mid-flight in dev.

0. **Park** your current work (it's already on your `<dev>-<date>` branch — switch away).
1. **Cut the fix from live code:** `git switch -c hotfix/login v1.2.0` (the prod tag) — or off
   `release/1.2`. Carries *only* live code, none of `release/1.3`'s unreleased work.
2. **Fix + test locally** (LocalStack).
3. **Bump** the affected service(s) → the release becomes **v1.2.1**.
4. **Validate — by severity (your call per incident):**
   - **Emergency:** smoke-test on **dev** only, then prod. (Leaves staging's QA untouched.)
   - **Non-urgent:** deploy `hotfix/login` to **dev → staging**, then prod.
5. **Release:** merge `hotfix/login` into `release/1.2`, deploy `release/1.2` to **production**; the
   Console **auto-tags `v1.2.1`** and updates `environments.json`.
6. **Merge forward:** merge `release/1.2` (the fix) into `release/1.3` — and into every other active
   line — so the fix isn't lost when the next version ships. The Console surfaces this.
7. **Un-park:** switch back to your `<dev>-<date>` branch and carry on.

---

## Rollback

Because every production deploy is tagged, rolling back is "deploy the previous tag":

```
deploy v1.1.0 → production      # the Console redeploys that immutable commit + updates environments.json
```

A tag is exact and never changes, so a rollback always restores precisely what was live. (Rolling
back to a *branch* would only restore "the branch as it is now" — which is why prod is tagged.)

---

## Versioning

- **Per-service versions** — each `apps/core/<svc>/package.json` `version`, bumped via the Repo tab.
  Surfaced live by each service's `GET /version`.
- **Release version** — the `release/X.Y` line name while in progress; the immutable **tag `vX.Y.Z`**
  once it hits production. **patch** = hotfix/QA-fix · **minor** = feature release · **major** =
  breaking. A tag = the per-service manifest at that commit.

---

## Scaling note (single release train)

This is a **single release train**: one active next version (`release/1.3`) at a time, with next-next
work waiting in personal branches. Simple and ideal for a small team. If devs ever get blocked waiting
to integrate, open the next line earlier (`release/1.4` alongside `release/1.3`) and merge fixes
across — the model already supports multiple concurrent lines; it's just more forward-merge
bookkeeping.

---

## What the Console does

- **Map view** (built): services × environments — live version (from `/version`) vs the deployed ref,
  with drift indicators.
- **`environments.json`** (next phase): the deploy pointer per environment; Console reads on the Map
  and updates on every deploy.
- **Auto prod tag** (next phase): stamp `vX.Y.Z` on the commit deployed to production.
- **Release view** (next phase): pick a tag → its per-service manifest + which environments are on it.
- **Promotion / hotfix / rollback / forward-merge** (next phase): open the next line, deploy a line to
  an env, cut a hotfix from a tag, redeploy an older tag, and merge a fix forward — guided so steps
  aren't missed.
- **Audit trail + approval** (next phase): require a named approver before a production deploy, and on
  every deploy append a signed, committed `deploy-audit.jsonl` entry (see Compliance & Controls).

> Note: the earlier env-branch pinning in the Deploy tab (dev↔`development`, etc.) will be replaced by
> this `environments.json` + version-branch model.

---

## Compliance & Controls (ISO 27001 / SOC 2 Type 2)

This process is designed to support the change-management and environment-separation controls these
frameworks test. **Type 2 tests operating effectiveness over a period** — the controls below must be
*enforced and evidenced consistently*, not merely documented. (This is the engineering control
design; validate scope and sufficiency with your compliance owner / auditor.)

### Control mapping

| Control area                         | ISO 27001:2022 Annex A | SOC 2 (TSC) | How we meet it |
|--------------------------------------|------------------------|-------------|----------------|
| Separation of dev/test/prod          | A.8.31                 | CC6.1       | Separate AWS accounts per environment. |
| Change management + test before prod | A.8.29, A.8.32         | CC8.1       | Required unit tests + staging QA + dev→staging→prod promotion. |
| Code review / segregation of duties  | A.8.28, A.5.3          | CC8.1       | PR review required on `release/*`; author ≠ approver; restricted prod deploy. |
| Immutable release + rollback         | A.8.32                 | CC7.4, CC8.1| Auto prod tag `vX.Y.Z`; rollback = redeploy a prior tag. |
| Logging & audit trail                | A.8.15                 | CC7.2       | Append-only `deploy-audit.jsonl` + CloudTrail (below). |
| Access control to prod / source      | A.5.15, A.8.2, A.8.4   | CC6.1–6.3   | Restricted prod AWS profile + MFA; branch protection on `release/*`. |
| Secure development lifecycle         | A.8.25–A.8.30          | CC8.1       | This document, followed consistently. |

### Enforced controls

1. **Segregation of duties** — merging a `release/*` line requires PR review by someone other than the
   author (GitHub branch protection); the prod AWS profile is restricted + MFA-protected.
2. **Tested before prod** — unit tests are a required check and staging QA precedes prod; test
   evidence (CI logs) is retained for the audit period.
3. **Authorized production deploys** — each prod deploy records a **named approver** and a linked
   **ticket/issue**; the Console requires approval before a production deploy.
4. **Immutable releases + rollback** — every prod deploy is auto-tagged; rollback redeploys a prior
   tag (exact, unchangeable).
5. **Emergency-change procedure** — the skip-staging hotfix path is permitted **only** as a documented
   emergency change: it is logged like any deploy, flagged `emergency: true`, and **retroactively
   reviewed and approved within 2 business days**. Emergency changes are reported in the change review.

### Audit trail

Every deploy / rollback / promotion appends one entry to a **committed, append-only**
`deploy-audit.jsonl` (JSON Lines — never edited or reordered). Each entry records:

```jsonc
{
  "ts": "2026-06-12T14:03:22Z",      // UTC
  "actor": "jtegen (verified)",       // platform-verified identity
  "action": "deploy",                 // deploy | rollback | promote | hotfix
  "environment": "production",
  "ref": "release/1.2",               // what was deployed
  "tag": "v1.2.1",                    // resulting immutable tag (prod)
  "manifest": { "app": "1.0.3", "auth": "1.0.2", "web": "1.1.0" },
  "approver": "amanager",             // required for prod (≠ actor)
  "ticket": "RUP-481",
  "emergency": false,
  "result": "success",
  "commit": "f49a699"
}
```

The Console writes the entry, **signs the commit**, and pushes it as part of the deploy.

**Is a git-committed audit log sufficient?** Yes — as the *primary* record — **when hardened**:

- **Protected branch**: no force-push and no history rewrite on the branch holding the log (and on
  `release/*`). This is what makes git genuinely append-only / tamper-evident — git's commit chain is
  a hash DAG, so altering an old entry breaks every later hash, which is detectable *only if* history
  can't be rewritten.
- **Signed commits & tags** (GPG/SSH) tied to **platform-verified, MFA-backed identities** — so
  authorship can't be spoofed (the bare commit author field can) and any rewrite breaks signatures.
- **Append-only discipline** — entries are only ever added.
- **CloudTrail corroboration** — AWS CloudTrail (with log-file validation / S3 Object Lock, or
  CloudTrail Lake) is an *independent*, tamper-evident record of the actual deploy API calls. It both
  strengthens integrity and provides **completeness assurance**: any production change *without* a
  matching `deploy-audit.jsonl` entry is an exception/finding.

Plain "commit a file" alone is **necessary but not sufficient** (default git history is rewritable;
commit authorship is spoofable). With the four protections above, the git-based trail is audit-grade
— and has real advantages: it's versioned, human-reviewable, and lives beside the releases it
describes.

> Caveat: deploys currently run from an operator's machine (Model A), so the git entry is
> *self-reported* by the Console — CloudTrail corroboration closes the "deployed without logging"
> gap. A central CI/CD pipeline (Model B), where the controls can't be bypassed and every run is
> logged automatically, is the stronger long-term posture for Type 2.

---

## One-time migration

```bash
git fetch origin
# 1. tag what's live now (pick the real current version)
git tag v1.2.0 origin/main && git push origin v1.2.0
# 2. open the current + next release lines
git branch release/1.2 v1.2.0 && git push -u origin release/1.2
git branch release/1.3 release/1.2 && git push -u origin release/1.3
# 3. seed environments.json (committed): production→v1.2.0, staging→release/1.2, dev→release/1.3
```

**Branch protection (GitHub):** require PRs into `release/*` lines, require the unit-test check, and
restrict who can deploy to production. Keep `main` (if used) as a read-only mirror of latest prod.

---

## Quick reference

| I want to…                       | Do this                                                                     |
|----------------------------------|-----------------------------------------------------------------------------|
| Start work                       | branch `<dev>-<date>` off the active `release/X.Y`                          |
| Share my work                    | merge `<dev>-<date>` → `release/X.Y`                                         |
| Open the next version            | `git switch -c release/1.(Y+1) release/1.Y`                                  |
| Send a line to QA                | deploy `release/X.Y` to staging                                             |
| Release to production            | deploy `release/X.Y` to prod → Console auto-tags `vX.Y.Z`                   |
| Fix an urgent prod bug           | `hotfix/*` off the prod **tag** → validate by severity → prod (auto-tag) → **merge forward** |
| Roll back production             | deploy the previous **tag** to prod                                         |
| See what's live everywhere       | Console → Deploy → **Map**                                                  |
| See what a release contains      | Console → Deploy → **Release** → pick the tag                               |

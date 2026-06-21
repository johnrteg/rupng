#
# Slack integration
#

# Objective

Connect an **account's Slack workspace** as a **two-way workflow surface** — the place a team **gets notified**,
**approves**, and **runs commands** against the platform. Two directions, both routed through
**[workflow](../../core/workflow/SPECS.md)**:

* **Outbound (the headline node)** — a workflow **`notify-internal`** node posts to a Slack channel/DM: *"campaign
  X hit its cost cap,"* *"a VIP just replied STOP,"* *"nightly report is ready."* Alerts and team notifications —
  **never** messages to contacts.
* **Inbound (commands + queries)** — Slack **slash commands**, **interactive buttons/modals**, and **@-mentions**
  come *back* into the app: *"`/rumbleup status campaign 123`,"* *"`/rumbleup pause campaign 123`,"* an **Approve /
  Reject** button on a pending send. Slack becomes a **conversational query + command interface**, each command
  backed by a workflow that reads (analytics/campaign) or acts (pause/launch) — **gated by the commanding user's
  role**.

This is **mostly a workflow node** — but a *command-capable* one. The defining design problem isn't transport
(Slack's API is simple); it's **authorization**: a Slack message can *take an action in the app*, so every inbound
command runs **as a mapped RumbleUp user, under that user's [`Access`](../../core/auth/specs/SPECS.md) role** — the
same ladder endpoints use. Slack is a **convenience surface, not an authority bypass.**

**Account-connected, marketplace-governed.** Like [Shopify](../shopify/SPECS.md) and HubSpot-external, Slack is a
**[marketplace](../../core/marketplace/SPECS.md) `IntegrationDefinition`** under the **Zapier governance pattern**
([zapier](../zapier/SPECS.md)) — per-account OAuth, accept-to-enable, metering, egress feature-flag × permission.
*(Distinct from **[monitor](../../core/monitor/SPECS.md)**'s platform-ops alerts to RumbleUp's own Slack — that's
monitor's SNS→Slack path, not this account-facing integration.)*

# Role & boundaries

**Owns:**
* The **Slack surface contract** — outbound message rendering (**Block Kit**), and the inbound **slash-command /
  interactivity / Events API** handlers (verify → normalize → hand to workflow).
* **Request authenticity** — **Slack signing-secret** verification (`X-Slack-Signature` + timestamp replay window)
  on every inbound, and the **3-second ack** dance (ack fast → do work async → respond via `response_url`).
* **Identity link + authorization** — the **Slack user ↔ RumbleUp user** mapping, and resolving each command to
  that user's **`Access` role** so the action/query runs with the right permissions.
* **Command catalog** — the built-in `/rumbleup …` verbs + the binding of **custom slash commands → account
  workflows**.

**Delegates / does NOT do:**

| Concern | Owner |
|---|---|
| **OAuth + bot-token/signing-secret vault + catalog + governance** | **[marketplace](../../core/marketplace/SPECS.md)** (Zapier pattern) |
| **What a command/notification actually does** (the journey, the query) | **[workflow](../../core/workflow/SPECS.md)** (Slack is a trigger source + the `notify-internal` / `approval` target) |
| **Whether the commanding user *may*** do/see it | **[auth](../../core/auth/specs/SPECS.md)** `Access` ladder + per-action `minAccess` ([`Events.canConsume`](../../../packages/endpoint/src/EventTypes.ts)) |
| **The data a query returns** | the owning service ([analytics](../../core/analytics/SPECS.md) / [campaign](../../core/campaign/SPECS.md) / [contact](../../core/contact/SPECS.md)) — Slack just renders it |
| **Messaging contacts** (SMS/email) | the **channels + `canSend()`** — Slack is **internal/team only**, never a contact channel |
| **Platform-ops alerting** to RumbleUp's own Slack | **[monitor](../../core/monitor/SPECS.md)** (SNS→Slack) |
| **Pacing / retry / DLQ** | the shared **connector / dispatch framework** |

> **Convenience, not authority.** Slack never grants access. A command does exactly what the **linked user** could
> do in the app; an **unlinked** Slack user gets a "link your account" prompt and **nothing executes**. Erasure
> follows the [egress erasure boundary](../../../docs/SPECS.md) — stop-posting + disclose, not reach-into-Slack-delete.

# Core concepts

* **Connection (installation)** — an account's connected Slack workspace: the OAuth grant (**bot token** +
  **signing secret**, vaulted in marketplace), the default channel(s), and connection health. Lifecycle =
  marketplace `enable → connect → active → pause → remove` (+ auto-pause on app uninstall / `tokens_revoked`).
* **Notify (outbound)** — a workflow **`notify-internal`** step → a **Block Kit** message to a channel/DM via
  `chat.postMessage` (bot token). Threads, buttons, fields, and **@mentions** supported — a mention resolves a
  RumbleUp **user / email → Slack `<@user_id>`** (reusing the **identity link** or `users.lookupByEmail`); an
  **unresolvable mention passes through best-effort** — Slack renders a valid token as a ping, anything else as
  plain text, and a "bad mention" **never fails the send**. Group mentions (`<!here>` / `<!channel>` /
  `<!subteam^ID>`) pass through as-is.
* **Command (inbound)** — a **slash command** (`/rumbleup …`) → verify → resolve user → **trigger a workflow** →
  reply. **Every** command is a workflow (a slash command is a workflow **trigger node**) — the built-in verbs are
  just **platform-shipped template workflows**, and accounts add their own the same way. **One mechanism, no
  bespoke handlers** — *this is how all commands get built.*
* **Interaction (inbound)** — a **Block Kit** button / modal submit → the **interactivity** endpoint → resumes a
  parked workflow (the **`approval`** / `wait-for-event` node) by its `{instanceId, nodePath, waitKey}` token.
* **Identity link** — a **Slack `user_id` ↔ RumbleUp `userId`** mapping (per account). Established at OAuth
  (installer) + a link flow (`/rumbleup link`, email match, or an auth deep-link). **Every inbound runs as the
  linked user.**
* **Command authorization** — the resolved user's **`Access` role** must satisfy the command's **`minAccess`**
  (query = read floor; action = the action's floor) — reusing the same gating as endpoints + event consumption.

# Architecture & flow

```
 OUTBOUND  (notify / approval — the headline node)
   workflow notify-internal / approval ──► slack connector ──► chat.postMessage (Block Kit, bot token)
        approval posts Approve/Reject buttons carrying the workflow {instanceId, nodePath, waitKey}

 INBOUND  (commands / interactions / events)
   Slack ──slash command / interaction / event──► /slack/* intake (HTTPS)
        • VERIFY signing secret (X-Slack-Signature + timestamp ≤ 5 min)   • ACK within 3s (200, opt. ephemeral "working…")
        └─► resolve Slack user → RumbleUp userId (+ Access role)   [unlinked → "link your account", STOP]
                 └─► AUTHORIZE: role satisfies the command/action minAccess?  [no → ephemeral "not permitted"]
                          └─► emit `slack.command|interaction` → workflow trigger / resume parked instance
                                   └─► workflow reads (analytics/campaign) or acts (pause/launch) — as the user
                                            └─► RESPOND to Slack via response_url (ephemeral if PII/scoped) / chat.postMessage

 AUTH:  per-account Slack OAuth (workspace install) → bot token + signing secret vaulted via marketplace broker
```

* **Ack-fast, work-async.** Slack demands a response in **3 seconds**; we **ack immediately** and do the real work
  in the workflow, replying later via the `response_url` — the same "ACK-fast → enqueue" pattern as the channel
  webhooks. Idempotent on Slack's request/`trigger_id`.
* **Everything inbound is authorized twice** — **authenticity** (signing secret) *and* **authority** (the linked
  user's role). Neither alone is enough.

# Surfaces (Slack capabilities used)

| Direction | Slack surface | Use |
|---|---|---|
| **Out** | `chat.postMessage` (bot token) + **Block Kit** | notifications, alerts, **approval** prompts (buttons), query results |
| **Out** | threads / `chat.update` | update an in-place message (e.g. "approved ✓"), thread a journey's updates |
| **In** | **Slash commands** (`/rumbleup …`) | run a query or action → a workflow |
| **In** | **Interactivity** (buttons / modals / `trigger_id`) | approvals, multi-field input, confirmations |
| **In** | **Events API** (`app_mention`, `message.im`) | mention/DM-driven triggers (later; opt-in scopes) |

# Command & query catalog

**Every slash command is a workflow trigger — there are no bespoke command handlers.** The built-in `/rumbleup`
verbs **ship as platform template workflows** (seeded per connection; an account can clone, customize, or disable
them); account-defined commands are just **more workflows** bound to a verb. Same authoring, same role-gating, same
`Access`/`canSend()` discipline. Representative built-in v1 templates:

| Command | Effect | Floor (`minAccess`) |
|---|---|---|
| `/rumbleup help` | list available commands for *this* user (role-filtered) | any linked user |
| `/rumbleup status [campaign\|account]` | **query** — live counts (sent/delivered/clicked) from [analytics](../../core/analytics/SPECS.md) | `USER` |
| `/rumbleup campaign <id>` | **query** — a campaign's state + KPIs | `USER` |
| `/rumbleup pause campaign <id>` | **action** — pause sends | `ACCOUNT` |
| `/rumbleup resume campaign <id>` | **action** — resume | `ACCOUNT` |
| `/rumbleup link` | link this Slack user to a RumbleUp account (auth deep-link) | — (establishes identity) |
| *(custom)* `/<account-verb> …` | trigger the account's bound **workflow** (query or act) | per the workflow's gate |

> **This is how you build *all* of them.** A `status` command is a trigger → a **read-only workflow**
> (`lookup`/`http-call` → analytics/campaign → Block Kit reply); a `pause` command is a trigger → a workflow that
> calls the pause action. Built-in or custom, query or action — it's **always a workflow**, so the command surface
> grows by **authoring a workflow + binding a verb**, not by shipping connector code. (Built-ins are simply the
> templates we ship.)

# Identity, authorization & PII (the load-bearing security section)

* **Link before act — to an existing login with account access.** A Slack `user_id` maps to an **existing
  RumbleUp `userId`** — the user **authenticates** via an [auth](../../core/auth/specs/SPECS.md) deep-link
  (**no auto-provisioning** of new users from Slack), and must be a **member of the connected account** (the
  account↔user relationship, owned by [account](../../core/account/specs/SPECS.md)) **with a role** sufficient for
  what they invoke. **Unlinked, no login, not-a-member, or under-roled → nothing executes** (link / permission
  prompt). The link is revocable.
* **Runs as the user, at the user's role.** Every command/interaction executes **as the linked user**, and its
  effect is gated by that user's **`Access` role** against the action's **`minAccess`** — the *same* check as the
  REST endpoint or the workflow trigger ([`Events.canConsume`](../../../packages/endpoint/src/EventTypes.ts)). A
  `SENDER` can't pause a campaign from Slack any more than from the app.
* **PII-aware responses.** A Slack **channel may be visible to many** — so a query that returns **PII or scoped
  data replies ephemerally** (visible only to the requester) or via **DM**, never broadcast to the channel. The
  query is also **permission-scoped** — it returns only what the user may see (tenant + role), so Slack can't be
  used to exfiltrate data the user couldn't pull in-app.
* **Signing-secret verification.** Every inbound is HMAC-verified (`v0:timestamp:body`) and **timestamp-fresh**
  (≤ 5 min) — reject replays. Verification happens **before** any user resolution or work.

# Approvals (human-in-the-loop)

The workflow **`approval`** node is Slack's best inbound fit: the connector posts a **Block Kit** message with
**Approve / Reject** buttons carrying the workflow's **`{instanceId, nodePath, waitKey}`** token; the reviewer's
click hits the **interactivity** endpoint → verify → confirm the clicker's **role** → **resume the parked
instance** down the chosen edge. *"This blast costs $4k — approve?"* → a button in Slack → the campaign proceeds or
halts. The approval is **role-gated** (only an authorized reviewer's click counts) and the message is **updated in
place** to show the outcome + who decided (audited).

# Auth & governance

* **Per-account Slack OAuth.** The workspace installs the RumbleUp Slack app; the **bot token** + **signing
  secret** are **vaulted via the [marketplace](../../core/marketplace/SPECS.md) broker**, revocable, with
  least-privilege scopes (`chat:write`, `commands`, `users:read` / `users:read.email` for linking, `im:write` for
  DMs; `app_mentions:read` only if @-mention triggers are enabled).
* **Governance.** Marketplace / **Zapier pattern** — accept-to-enable, metering (messages out / commands in),
  egress feature-flag × the connecting user's permission, **account = controller**.
* **Kill switches** — disable / **dry-run** (log intended posts, send nothing) / pause (AppConfig + marketplace
  lifecycle).

# Reliability

* **3-second ack + async response.** Ack the HTTP request fast; do the work in the workflow; reply via the
  `response_url` (valid ~30 min) or `chat.postMessage`. Never block the command on the workflow.
* **Slack rate limits** — `chat.postMessage` is ~**1 msg/sec/channel** (Tier-based, burst-tolerant); outbound rides
  the shared **token-bucket × per-account fair-share**; 429 honors **`Retry-After`** → requeue → DLQ → auto-pause +
  alert ([monitor](../../core/monitor/SPECS.md)).
* **Idempotent** — dedupe inbound on Slack's request id / `trigger_id`; a re-posted notification keyed so retries
  don't duplicate.

# Out of scope

* **Slack as a *contact* channel** — Slack is **internal/team**, never a way to message end-user contacts (that's
  texting/email + `canSend()`). No customer DMs from here.
* **Replacing in-app admin** — Slack is a *convenience* surface for common queries/actions, not a full console;
  complex flows still live in [web](../../core/web/SPECS.md).
* **Platform-ops alerting** — RumbleUp's own ops alerts to its own Slack are **[monitor](../../core/monitor/SPECS.md)**'s
  SNS→Slack path, not this account integration.
* **Slack Connect / Enterprise Grid org-wide install** — single-workspace install first; Grid later.

# AWS Services and Other Dependencies

**AWS services**
* **API Gateway** — the `/slack/*` intake (slash / interactivity / events, signing-verified) + OAuth callback + config/health.
* **SQS** (+ **DLQ**) — async command work + outbound posts + retry.
* **Kafka (MSK)** — normalized `slack.*` trigger events → workflow.
* **DynamoDB** — connection state · **Slack-user ↔ RumbleUp-user** link · inbound dedupe ids.
* **Redis (ElastiCache)** — outbound throttle (token-bucket × fair-share) + breaker state.
* **Secrets Manager** (+ **KMS**) — bot token + signing secret (**via marketplace**).

**Third-party**
* **Slack API** — Web API (`chat.postMessage`, `users.*`), slash commands, interactivity, Events API; **OAuth v2**.
  **Slack is a sub-processor** (internal/team data, not contact content).

**Internal (`@repo/*`) + services**
* `@repo/services` (Sqs, Kafka, Dynamo, Cache, SecretsManager, Kms), `@repo/endpoint` (`Access`, **`Events`**),
  `@repo/common` (`Type`).
* Composes **marketplace** (OAuth / vault / governance / connector runtime), **workflow** (notify / approval /
  command triggers), **auth** (identity link + `Access`), **analytics / campaign / contact** (query targets),
  **monitor** (health).

# Compliance & standards mapping

How **this Slack integration's** controls map to **OWASP Top 10 (2021)**, **ISO/IEC 27001:2022** (Annex A),
**SOC 2** (TSC), **GDPR**, and **CCPA/CPRA**. Slack is an **account-controlled, command-capable** integration — its
dominant controls are **request authenticity (signing secret)**, **command authorization (run-as-user × role)**,
**PII-in-channel containment**, **secret custody**, and the **egress erasure boundary**. **No PCI / PHI** (➖); not
a contact-messaging channel (no TCPA surface here).

**Legend:** ✅ meets/exceeds · ⚠️ partial / open — see Gaps · ➖ n/a

| Slack control | OWASP T10 | ISO 27001:2022 | SOC 2 (TSC) | GDPR | CCPA | |
|---|---|---|---|---|---|---|
| **Request authenticity** — signing-secret HMAC + timestamp-freshness on every inbound; reject replays | A08 / A01 | A.8.26 / A.5.14 | CC6.1 / CC7.1 | Art 32 | ➖ | ✅ |
| **Command authorization** — runs **as the linked user** at their **`Access` role**; unlinked = no action; same `minAccess` as endpoints | A01 | A.5.15 / A.8.2 | CC6.1 / CC6.3 | Art 32 | ➖ | ✅ |
| **PII-in-channel containment** — PII/scoped results reply **ephemerally / DM**, never broadcast; results permission-scoped | A01 / A04 | A.8.11 / A.5.34 | CC6.1 / (Privacy) | Art 5(1)(c) / 32 | §1798.100 | ✅ |
| **Secret custody** — bot token + signing secret in the **marketplace vault** (Secrets Manager + KMS); reference-only | A02 / A05 | A.8.24 / A.5.17 | CC6.1 | Art 32 | ➖ | ✅ |
| **Least-privilege scopes** — request only the Slack scopes the enabled surfaces need | A01 | A.5.15 | CC6.3 | Art 25 | ➖ | ✅ |
| **Egress erasure boundary** — Slack is the account's workspace; forget = **stop-posting + disclose**, not reach-in-delete | A04 | A.8.10 | (Privacy) | Art 17 | §1798.105 | ✅ |
| **Idempotent + rate-limited** — dedupe inbound; outbound token-bucket × fair-share; 429 `Retry-After` → requeue → DLQ → auto-pause | A08 | A.8.26 | CC7.1 | ➖ | ➖ | ✅ |
| **Audit** — connect / disconnect / identity-link / privileged command (pause/launch) / approval decision audited | A09 | A.8.15 | CC7.2 | Art 30 | ➖ | ✅ |

> **Design-intent mapping** — how the integration is *intended* to satisfy each control, not an attestation.

# Gaps & decisions

*The one review list.* ✅ = resolved/decided · ⚠️ = **open — needs attention**.

1. ✅ **Two-way workflow surface — DECIDED.** Outbound = `notify-internal` / `approval`; inbound = slash commands /
   interactivity / events → workflow. Mostly a node, but command-capable.
2. ✅ **Authorization model — DECIDED: run-as-linked-user × `Access` role.** Inbound runs as the mapped RumbleUp
   user at their role; **unlinked = no action**; same `minAccess` gating as endpoints. Slack is convenience, not
   authority.
3. ✅ **Request authenticity — DECIDED: signing secret + timestamp.** HMAC-verify + ≤5-min freshness before any
   work; reject replays.
4. ✅ **PII containment — DECIDED.** PII/scoped query results reply **ephemerally / DM**, never to a shared
   channel; results are permission-scoped.
5. ✅ **Ack model — DECIDED: ack-fast (3s) → async → `response_url`.** Never block a command on the workflow.
6. ✅ **Approvals — DECIDED.** `approval` node → Block Kit buttons carrying `{instanceId, nodePath, waitKey}` →
   interactivity resumes the parked instance; role-gated; message updated in place + audited.
7. ✅ **Governance — DECIDED: marketplace / Zapier pattern.** Per-account OAuth, accept-to-enable, metering,
   egress feature-flag × permission; account = controller. Distinct from monitor's ops-Slack.
8. ✅ **Not a contact channel — DECIDED.** Internal/team only; no end-user DMs from Slack.
9. ✅ **Identity link — DECIDED: an existing RumbleUp login, with access to the account + the right role.**
   Linking maps a Slack user to an **existing RumbleUp `userId`** — the user **authenticates** via an
   [auth](../../core/auth/specs/SPECS.md) deep-link (**no auto-provisioning** of new users from Slack). To
   query/act against the connected account, that user must be a **member of that account** (the account↔user
   relationship, owned by [account](../../core/account/specs/SPECS.md)) **with a role** that satisfies the
   command's `minAccess`. **No login → can't link; not a member → no access; under-roled → denied.** Slack grants
   nothing the user doesn't already have in the app.
10. ✅ **Command model — DECIDED: every command is a workflow; built-ins are template workflows.** No bespoke
    command handlers — a slash command is a **workflow trigger**; the `/rumbleup` verbs **ship as platform template
    workflows** (clone / customize / disable per account); custom commands are account workflows bound to a verb
    with a declared role floor. The command surface grows by **authoring a workflow**, not shipping connector code.
    *Open sub-point:* the **Slack-side registration mechanic** — one app command (`/rumbleup <verb> …`) with
    sub-verb routing vs per-command Slack registration (Slack caps app commands) — TBD, but it doesn't change the
    workflow model.
11. ⚠️ **@-mention / DM triggers — OPEN (later).** Events-API-driven triggers (mention/DM) add scopes + a noisier
    surface; deferred until slash + interactivity prove out.
12. ✅ **Outbound @mentions — DECIDED: best-effort, fail-soft.** `notify-internal` supports @mentions by resolving
    a RumbleUp **user/email → Slack `<@user_id>`** (reusing the identity link / `users.lookupByEmail` — the
    `users:read.email` scope is already requested for linking, so **no new API access**). We **don't guarantee** a
    mention: an unresolvable one **passes through** and Slack renders it as plain text — a "bad mention" is **never
    a send error**. Group mentions (`<!here>` / `<!channel>` / `<!subteam^ID>`) pass through as-is. *(Note:
    mentioning a user not in the channel won't notify them — Slack's behavior, accepted.)*

# Requirements (traceable register)

The traceable register for the **Slack integration** (IDs **`slack-N.M`**). **Priority:** **A** = MVP, **B** = core
/ hardening, **C** = later. **Boundary:** Slack owns the **surface contract + signing verification + identity link +
authorization + command catalog**; OAuth/vault/governance = marketplace, the journey/query = workflow, who-may =
auth/`Access`, the data = the owning service, ops-Slack = monitor.

## slack-1.0 Connection & auth — A
- **slack-1.1** **Per-account OAuth v2** — bot token + signing secret **vaulted via marketplace**; reference-only; least-privilege scopes (`chat:write` · `commands` · `users:read[.email]` · `im:write`) — A
- **slack-1.2** **Lifecycle** — `enable → connect → active → pause → remove`; auto-pause on uninstall / `tokens_revoked` — A
- **slack-1.3** **Default channel(s)** config for `notify-internal` targets — B

## slack-2.0 Outbound (notify / approval) — A
- **slack-2.1** **`notify-internal` → Slack** — Block Kit `chat.postMessage` to channel/DM (alerts, results); **never** a contact message — A
- **slack-2.2** **`approval` → Slack** — Approve/Reject Block Kit buttons carrying `{instanceId, nodePath, waitKey}`; update message in place on decision *(gap #6)* — A
- **slack-2.3** **Throttle** — token-bucket × fair-share (~1 msg/sec/channel); 429 `Retry-After` → requeue → DLQ → auto-pause + alert — B
- **slack-2.4** **@mentions (best-effort, fail-soft)** — resolve RumbleUp user/email → Slack `<@user_id>` (identity link / `users.lookupByEmail`, `users:read.email` already scoped); unresolvable → pass-through plain text, **never fails the send**; `<!here>`/`<!channel>`/`<!subteam^ID>` pass through *(gap #12)* — B

## slack-3.0 Inbound (commands / interactivity / events) — A
- **slack-3.1** **Signing-secret verification** — HMAC (`v0:timestamp:body`) + ≤5-min freshness; reject replays; **before** any work *(gap #3)* — A
- **slack-3.2** **Ack-fast (3s) → async → `response_url`** — never block the command on the workflow *(gap #5)* — A
- **slack-3.3** **Every slash command → a workflow trigger** — **no bespoke handlers**; built-in `/rumbleup` verbs are **platform template workflows**, account verbs are their own workflows (one mechanism) *(gap #10)* — A
- **slack-3.4** **Interactivity** (buttons/modals) → resume the parked workflow instance via its token *(gap #6)* — A
- **slack-3.5** **Idempotent** — dedupe on Slack request id / `trigger_id` — A
- **slack-3.6** **Events API** (`app_mention` / `message.im`) triggers — **later**, opt-in scopes *(gap #11)* — C

## slack-4.0 Identity & authorization — A
- **slack-4.1** **Link = an existing RumbleUp login with account access** — the Slack user **authenticates** (auth deep-link; **no auto-provisioning**) and must be a **member of the connected account** ([account](../../core/account/specs/SPECS.md) account↔user) with a **sufficient role**; unlinked / no-login / not-a-member / under-roled → no action, prompt only *(gap #9)* — A
- **slack-4.2** **Run-as-user × role** — every inbound executes as the linked user; effect gated by their **`Access`** role vs the action's **`minAccess`** (same as endpoints / `Events.canConsume`) *(gap #2)* — A
- **slack-4.3** **PII-aware responses** — PII/scoped results reply **ephemerally / DM**, never to a shared channel; results permission-scoped *(gap #4)* — A

## slack-5.0 Command & query catalog (all workflows) — B
- **slack-5.1** **Built-ins = platform template workflows** — `/rumbleup help · status · campaign <id> · pause/resume campaign · link` ship as **seeded workflows** an account can clone / customize / disable; each role-gated *(gap #10)* — B
- **slack-5.2** **Queries = read-only workflows** — `lookup`/`http-call` → analytics/campaign → Block Kit reply (one mechanism for query + action) — B
- **slack-5.3** **Custom commands = account workflows** bound to a verb with a declared role floor — **no connector code**, just a workflow *(gap #10)* — B

## slack-6.0 Governance & compliance — A
- **slack-6.1** **Marketplace / Zapier governance** — accept-to-enable · metering · egress feature-flag × permission; **account = controller** — A
- **slack-6.2** **Egress erasure boundary** — forget = stop-posting + disclose, not reach-in-delete — B
- **slack-6.3** **Kill switches** — disable / dry-run / pause (AppConfig) — A
- **slack-6.4** **Audit** — connect/disconnect · identity-link · privileged command · approval decision — B

## slack-7.0 Infra — A
- **slack-7.1** **API Gateway** (`/slack/*` + OAuth) · **SQS + DLQ** · **Kafka** (`slack.*` triggers) · **DynamoDB** (connection / user-link / dedupe) · **Redis** (throttle) · **Secrets Manager + KMS** (via marketplace) — A

# Endpoints (first cut)

A first pass, in [`@repo/endpoint`](../../../packages/endpoint/SPECS.md) style — service-prefixed `/slack/*`.
Inbound is **Slack-driven** (slash / interactivity / events) and **signing-verified**; automation is **workflow**.
**Access column:** **`-`** public/system · **`Slack-sig`** = signing-secret-verified Slack request · account
ladder `USER`<`ACCOUNT` · **`Internal`** = VPC-only S2S.

| Method | URI | Purpose | Access | Req |
|---|---|---|---|---|
| GET | `/slack/oauth/install` | Begin workspace install (redirect to Slack OAuth) | ACCOUNT | slack-1.1 |
| GET | `/slack/oauth/callback` | OAuth callback — exchange, **vault** bot token + signing secret | - (state-verified) | slack-1.1 |
| POST | `/slack/commands` | Slash-command ingress — **verify** → resolve user → authorize → ack (3s) → workflow | Slack-sig | slack-3.1/3.3 |
| POST | `/slack/interactivity` | Button/modal ingress — verify → authorize → **resume** parked instance | Slack-sig | slack-3.4 |
| POST | `/slack/events` | Events API (URL verify + `app_mention`/`message.im`) *(later)* | Slack-sig | slack-3.6 |
| POST | `/slack/link` | Complete the **Slack-user ↔ RumbleUp-user** link (auth deep-link callback) | USER | slack-4.1 |
| GET, PUT | `/slack/connections/{id}/config` | Connection config — default channels · custom-command bindings · dry-run | ACCOUNT | slack-1.3/5.3 |
| GET | `/slack/connections/{id}/status` | Connection health — scopes · queue depth · backpressure · last event | USER | slack-2.3 |
| GET | `/slack/health` | Liveness / readiness (intake + connector) | - | slack-7.1 |

# eof

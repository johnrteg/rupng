#
# Email
#

# Objective

The **email `send` channel** — **transactional + bulk** email delivery, the 1:1 addressed counterpart to
[texting](../texting/SPECS.md) and [print](../print/SPECS.md). It is **not just an SES wrapper**: the hard part of
email is **deliverability + sender reputation** — landing in the inbox, not spam, not throttled — so this service
owns the **send mechanics, provider abstraction, sender authentication, and the feedback loop** that keep the
platform a trusted sender.

It **owns:**
* **Sending** — single + bulk, **templated** (merge tags from contact / account / campaign), **scheduled**, with
  per-message **cost accounting**.
* **Provider abstraction (factory)** — **SES-first**, plus Mailgun / Postmark / SparkPost / `fake` behind one
  adapter; **failover across N providers** within deliverability constraints.
* **Deliverability & reputation** — **DKIM / SPF / DMARC** sending-domain auth, **IP / domain warm-up**, the
  **bounce / complaint feedback loop** (SES → SNS) with **auto-suppression**, and **complaint-rate monitoring**
  (Gmail / Yahoo require **< 0.3%**).
* **Compliance hygiene** — **one-click unsubscribe** and honoring suppression via the shared **`canSend()`** gate.
* **Engagement + the sent record** — **open** (edge pixel) + **click** (via [links](../links/SPECS.md)) tracking
  emitted to analytics; an immutable **sent-content** record.
* **Reliability** — retry → **DLQ**, provider **failover**, pause / halt / cancel mid-send.

It **delegates:** recipients + **suppression / consent** → [contact](../contact/SPECS.md) (`canSend`);
**orchestration** (audience, drip, approvals) → [campaign](../campaign/SPECS.md) / workflow; **fair-share +
pacing** → the **`WorkQueue`** governor ([dispatch](../../../packages/services/DISPATCH.md)); **tracked / unsub
links** → [links](../links/SPECS.md); **attachments** → [media](../media/SPECS.md); **attribution** →
[analytics](../analytics/SPECS.md); the **budget cap** → [campaign → channel cost management](../campaign/SPECS.md);
**billing** → [account](../account/specs/SPECS.md). **Email delivers — it doesn't own the audience or the journey.**

# Provider failover & sender authentication (reference)

Why provider failover is **constrained**, not "point at another provider" (captured for later reference):

* **The from-domain must be authenticated *per provider*.** Inbox placement depends on three DNS checks, each
  provider-specific:
  * **DKIM** — each provider signs with **its own key + selector**; you publish *that provider's* DKIM record.
    SES's DKIM ≠ SendGrid's. A provider that isn't set up → **DKIM fails**.
  * **SPF** — must authorize that provider's sending IPs, **or** its mail fails SPF. **Hard 10-DNS-lookup
    limit** — stacking many providers' `include:` into one record **breaks SPF**.
  * **DMARC** — passes only if SPF **or** DKIM **aligns** with the From domain; configure aligned DKIM per
    provider or DMARC fails → spam / reject.
* **Reputation is per `(domain × IP/infra)`.** A provider you've never sent through has **no warmed reputation**
  for your domain → that batch is filtered harder at volume. Sudden infra/IP changes are exactly what spam
  filters react to; a cold-provider flood can dent the domain's reputation across **both** providers.
* **Clean multi-provider pattern** (if/when adopted): a **per-provider sending subdomain** (`m1.acme.com` via
  SES, `m2.acme.com` via SendGrid) — each with its own clean SPF/DKIM/DMARC alignment, separate reputations, no
  10-lookup problem. **Warm** each provider; don't cold-blast.
* **Stance:** **single-provider (SES) first** — retries + DLQ + dedicated IP pools handle the common failures
  (`email-5`). **Cross-provider failover = outage fallback** to a **pre-authenticated + warmed** provider, not
  routine load-splitting. **Idempotency key** so an A→B failover never double-sends. Verification is **per
  `(domain × provider)`** (`email-4.7`).

# SMTP transport & sending environments (reference)

The provider factory (`email-3.1`) abstracts **ESP *APIs*** (SES, Mailgun, Postmark, SparkPost). A **generic
SMTP transport** is the *other* adapter shape — it speaks plain **SMTP** (nodemailer-style) rather than a vendor
API — and it exists to serve two distinct needs that are NOT the ESP-API path:

1. **Local / non-prod delivery (dev sink).** Dev + test must **never** send real mail. The SMTP transport points
   at either **LocalStack's SES emulation** (which *captures* sends at `GET /_aws/ses` — surfaced in the
   console's **Monitor → Email** viewer) or a **Mailhog** container (catch-all SMTP + a rendered-inbox web UI).
   **Nothing leaves the machine; no DNS / DKIM / IP-warm-up applies.** Mailhog is **dev-only** — **never** in the
   deployed footprint, and **optional even locally** (the LocalStack capture + the console Email viewer already
   read every send). Reach for Mailhog only when you want a real SMTP relay + a full rendered-inbox UI.

2. **External relay — bring-your-own transport (BYO, enterprise edge case).** An account that must route mail
   through **their own SMTP relay / on-prem MTA / corporate ESP**. The platform hands the rendered message to
   *their* relay over SMTP; **deliverability, sender reputation, and authentication become *theirs*** — we do
   **not** manage DKIM / SPF / DMARC / IP-warm-up for a relay we don't own, and **SES→SNS bounce/complaint
   feedback does not exist** on that path (their relay owns that loop; our auto-suppression degrades to whatever
   the relay reports back, if anything).

**Two "bring your own" models — keep them distinct (common confusion):**

* **BYO *domain* (default · white-label).** The client keeps **their from-domain's** reputation, but mail still
  goes through **our SES**: they publish **our** SES DKIM/SPF/DMARC records (`email-4.7`) and **we** own
  deliverability + warm-up + the feedback loop. **This is the norm** — most "use our own domain" requests mean
  this, *not* their own server.
* **BYO *transport* (edge case).** The client routes mail through **their** SMTP relay; **we** render + gate +
  enqueue, **they** own deliverability. **Per-account opt-in**; relay **credentials live in Secrets Manager**
  (never AppConfig); add / change is **`ACCOUNT`-role+ and audited**.

**Transport is resolved by environment ⊕ per-account config — one `provider.send()` seam:**

| Environment | Transport | Real delivery? | Who owns deliverability |
|---|---|---|---|
| local / dev / test | **SMTP → LocalStack capture or Mailhog** | no (captured) | n/a |
| prod (**default**) | **SES** (per-account **verified domain identity**) | yes | **us** (DKIM/SPF/DMARC + warm-up + SES→SNS feedback) |
| prod (account **BYO**) | that account's **external SMTP relay** | yes | **the client** (their relay/reputation) |

The transport is just **another factory adapter + a resolution rule** — adding it doesn't change the send
pipeline. **Compliance is ours regardless of transport:** the **`canSend()` gate** (suppression / consent /
quiet-hours / block-list, `email-4.1`) and the **idempotency key** run on **every** path, including a BYO relay —
a client's own relay does **not** let them bypass platform suppression / unsubscribe.

**Transport abstraction (sketch — design-intent).** A `Transport` is the **wire** a *rendered, already-gated*
message leaves on; the `EmailSendWorker` resolves one per account and calls `.send()`. SES is the default; an
SMTP transport backs both the dev sink and a per-account BYO relay. (Distinct from the ESP-API *provider* —
SES/Mailgun/… — which the factory selects by `message.provider`; the SES provider sends *via* the SES transport,
and `smtp` is its own provider+transport pairing.)

```ts
namespace Email
{
    // A rendered, canSend()-approved message ready to leave the platform.
    export interface Outbound
    {
        idempotencyKey : string;                 // dedup across retries / A→B failover
        accountId      : string;
        from           : string;                 // a VERIFIED sending identity (or the platform system sender)
        to             : string[]; cc? : string[]; bcc? : string[];
        subject        : string;
        html?          : string; text? : string;
        headers?       : Record<string, string>; // List-Unsubscribe (RFC 8058), etc.
        attachments?   : Array<{ filename : string; contentRef : string; contentType : string }>;
    }

    export interface SendResult { ok : boolean; providerMessageId? : string; error? : string; retryable? : boolean; }

    // HOW a message physically leaves. SES (API) or SMTP (nodemailer — dev sink OR external relay).
    export interface Transport
    {
        readonly kind : "ses" | "smtp";
        send( msg : Outbound ) : Promise<SendResult>;
    }

    // Resolves the transport for a send: environment FIRST (non-prod never delivers), then per-account BYO,
    // else the platform SES default. The worker holds NO transport knowledge beyond this call.
    export interface TransportResolver { resolve( accountId : string ) : Promise<Transport>; }
}

// Reference resolution (the ONLY place transport policy lives):
//   1. env !== "production"           → SmtpTransport(devSink)          // LocalStack capture / Mailhog — no real send
//   2. account has a BYO relay (3.6)  → SmtpTransport(secretsBackedCfg) // their relay; their deliverability
//   3. default                        → SesTransport()                  // our SES; our DKIM/SPF/warm-up/feedback
//
// SmtpTransport config = { host, port, secure, auth? }:
//   • dev sink  → host = LocalStack/Mailhog, no auth/TLS (captured, never delivered)
//   • BYO relay → host/port/secure from account config; auth.{user,pass} fetched from Secrets Manager at send
//
// EmailSendWorker (email-14.4), unchanged in shape:
//   render → canSend() → rate/IP-warm gate → (await resolver.resolve(msg.accountId)).send(msg) → send-log + sent-content
// canSend()/suppression/unsubscribe + the idempotency key are applied BEFORE resolve() — so they hold on
// EVERY transport, including a BYO relay.
```

# Compliance & standards mapping

How **this email service's** controls map to **OWASP Top 10 (2021)**, **ISO/IEC 27001:2022** (Annex A), **SOC 2
Type 2** (TSC), **HIPAA** (if PHI), **GDPR**, **CCPA/CPRA**, and **messaging law** (**CAN-SPAM** — unsubscribe,
accurate headers + sender ID, no deceptive subject; **CASL**; Gmail/Yahoo bulk-sender rules). Clause refs are
**indicative**; this is a **design-intent** self-assessment. Email is a **sending channel**, so it **runs the
`canSend()` gate** (suppression / consent / quiet-hours / block-list) **before delivery** and feeds
bounce/complaint **auto-suppression** back to [contact](../contact/SPECS.md). There is **no PCI** surface (no
payment data); **HIPAA** is ➖ (no PHI by [AUP](../account/specs/SPECS.md); content *could* carry it). Tracked
links + short domains are [links](../links/SPECS.md); the engagement lake is
[analytics](../analytics/SPECS.md); fair-share send ordering + IP warming is
[dispatch](../../../packages/services/DISPATCH.md). Identity/RBAC live in [auth](../auth/specs/SPECS.md); residency is the
platform [AWS topology](../../../packages/services/src/aws/SPECS.md).

**Legend:** ✅ meets/exceeds · ⚠️ partial / open — see Gaps · ➖ n/a

| Email control | OWASP T10 | ISO 27001:2022 | SOC 2 (TSC) | HIPAA (if PHI) | GDPR | CCPA | Messaging | |
|---|---|---|---|---|---|---|---|---|
| **Pre-send compliance gate** — `canSend()` (suppression / consent / quiet-hours / block-list) before delivery | A04 | A.5.34 | (Privacy) | ➖ | Art 21 | §1798.120 | CAN-SPAM | ✅ email = channel |
| **One-click unsubscribe** — `List-Unsubscribe` + RFC 8058 one-click | A04 | A.5.34 | (Privacy) | ➖ | Art 21 | §1798.120 | CAN-SPAM / bulk-sender | ✅ |
| **Bounce / complaint feedback** — SES→SNS → **auto-suppress back to contact** | A04 | A.8.16 | CC7.2 | ➖ | Art 21 | §1798.120 | CAN-SPAM | ✅ |
| **Complaint-rate monitoring** — keep < 0.3% (Gmail/Yahoo) or get throttled | A04 | A.8.16 | CC7.2 / A1.2 | ➖ | ➖ | ➖ | bulk-sender | ✅ |
| **Sender authentication** — SPF / DKIM / DMARC on the sending domain | A07 (spoofing) | A.8.24 / A.5.14 | CC6.x | ➖ | Art 32 | ➖ | bulk-sender | ✅ |
| **No PII in tracking URLs** — opaque codes via [links](../links/SPECS.md) | A01 / A04 | A.8.11 | CC6.1 | ➖ | Art 5(1)(c) / 25 | §1798.100 | ➖ | ✅ via links |
| **No PII in the analytics lake** — opaque `contactId` only | A09 | A.5.34 | (Privacy) | ➖ | Art 5(1)(c) | §1798.100 | ➖ | ✅ via analytics |
| **GDPR forget** — email joins the **contact-forget fan-out**: purge/obfuscate PII in **send-logs + bounce/complaint + rendered content** (`contactId` shell retained) | A04 | A.8.10 | (Privacy) | §164.310(d)(2) | Art 17 | §1798.105 | ➖ | ✅ via forget job |
| **Data retention limits** — TTL on send-logs / engagement / rendered content | A09 | A.5.33 / A.8.10 | CC6.x | ➖ | Art 5(1)(e) | §1798.100 | ➖ | ✅ |
| **Sub-processor + EU residency** — providers are Art 28 sub-processors (DPA); EU sends via EU-region infra | A08 | A.5.19–23 | CC9.x | ➖ | Art 28 / 44–49 | §1798.140 | ➖ | ✅ |
| **Content screening** — SHAFT / prohibited + no deceptive headers (part of `canSend()`) | A04 | A.5.34 | CC7.1 | ➖ | ➖ | ➖ | CAN-SPAM | ✅ |
| **Encryption** — in transit (TLS to provider) + at rest (DynamoDB / S3 SSE-KMS) | A02 | A.8.24 | CC6.1 | ➖ | Art 32 | ➖ | ➖ | ✅ |
| **Tenant isolation + per-account rate / IP warming** — send-log partitioned; no account starves others | A01 / A04 | A.8.3 / A.8.6 | CC6.1 / A1.2 | ➖ | Art 32 | ➖ | ➖ | ✅ |
| **Audit** — send-log, pause/cancel, DLQ requeue (who/when) | A09 | A.8.15 | CC7.2 | ➖ | ➖ | ➖ | ➖ | ✅ |

# Gaps & decisions

*The one review list — reconciles the design with platform decisions.* ✅ = resolved/decided · ⚠️ = **open — needs attention**.

1. ✅ **Analytics storage — DECIDED.** Email keeps only an **operational send-log in DynamoDB** (per-message
   status); **engagement analytics is emitted to the [analytics](../analytics/SPECS.md) service** (Kafka → S3
   lake). The notes' "stream to S3 + Athena **in email**" is **superseded** — analytics owns the lake; email
   does not run a parallel Athena store.
2. ✅ **Tracked links + short domains — owned by [links](../links/SPECS.md)** (`links-5` / `links-6`). Email
   **uses** the links mint (same shortener as SMS, tracking optional); it does **not** "create/manage short
   domains" itself. The notes' shortener/short-domain bullets are superseded.
3. ✅ **The "email dispatcher" = the [dispatch](../../../packages/services/DISPATCH.md) fair-share governor**, not a bespoke
   email component. Cross-account fairness + **IP warming** ride it; email is one adopting channel.
4. ✅ **Suppression/consent enforcement — email runs `canSend()`.** As the **channel**, email evaluates the gate
   (suppression / consent / quiet-hours / block-list, per [contact](../contact/SPECS.md) `contact-5`) **before
   delivery**, and bounce/complaint feedback **auto-suppresses back to contact**.
5. ✅ **Open-tracking transport — DECIDED (edge → Kafka, no new service).** The open **pixel** is served at the
   **edge** (CloudFront + a CloudFront Function / Lambda@Edge), fronted by **AWS Shield + WAF** — **IP/abuse
   blocking lives here** (rate-based rules), so it is **not** bypassed, just moved to the right layer (you
   rate-limit + bot-control, you don't denylist the millions of legit mailbox/proxy IPs). The edge **validates
   the tracking token**, **filters bot / Apple-MPP / prefetch** opens (Apple MPP pre-fetches *every* image →
   most "opens" are machine; bucket them separately, don't count as human), and **dedups** repeats — then
   publishes *real* opens to **Kafka** (the existing [analytics](../analytics/SPECS.md) backbone), **not** an
   SQS-message-per-hit and **not** a new tracking service. Kafka absorbs the volume; edge filtering keeps
   garbage/floods off the stream entirely (a DoS hits WAF + an invalid token and **never reaches the workers**).
   **Not** API Gateway (the notes' "API Gateway??" — it would bottleneck + cost on a public firehose). Clicks
   stay on the [links](../links/SPECS.md) redirect path (already token-validated + bot-filtered).
6. ✅ **Sending identities — DECIDED (per-account, 0..N, DNS-verified).** Email sending is **per account**; each
   account has **0..N verified sending identities** (address / domain), **one default**. **Multiple
   from-addresses are a pick-list on the account** — you do **not** need a separate sub-account just to send
   from another address (a sub-account is for true data isolation, not a from-line). The **email service owns
   the sending-identity registry + DNS verification** (per-account config — same ownership pattern as
   [links](../links/SPECS.md) owns short-domains). **DNS validation** lives in **`email-4.7`**: SES-generated
   **ownership TXT + DKIM (CNAME)**, plus **SPF + DMARC**, **not sendable until verified** — same machinery as
   the links whitelabel DNS flow (`links-5.6`) and the web-app whitelabel automation (customer keeps their
   registrar, adds the records). Each identity carries a **`status`** (`verified` / `unverified` / `pending` /
   `failed`), supports **dynamic re-verification** (re-check DNS after a record change), and is **added /
   re-verified / removed only by `ACCOUNT` role and above** (`email-4.6` / `4.7` / `4.11`). **Application /
   root system mail** (password reset, platform notices) uses a
   **separate platform-level sender**, isolated from account sending (`email-4.9`). *(Recipient-side
   validation — a pluggable **3rd-party** email-validation provider, MX/DNS lookups + more — is **`email-4.10`**,
   **stubbed for later development**.)*
7. ✅ **Provider failover — DECIDED (constrained; single-provider-first).** Failover is **not** "point at any
   provider": the from-domain must be **independently authenticated *per provider*** (its own **DKIM** selector,
   **SPF**-authorized IPs, aligned **DMARC**), so you may only fail over to a provider **pre-authenticated *and*
   warmed** for that domain — ideally via a **per-provider sending subdomain** (clean SPF/DKIM/DMARC, sidesteps
   SPF's 10-lookup limit). **Start single-provider (SES)** with retries + DLQ + IP pools (`email-5`); treat
   **cross-provider failover as an outage fallback** (warmed provider B), **not** routine load-splitting; an
   **idempotency key** prevents an A→B retry double-send. Verification is **per `(domain × provider)`**
   (`email-4.7`). Full rationale: *Provider failover & sender authentication (reference)* above.
8. ✅ **Inbound email / replies — DEFERRED (out of scope).** v1 is **send-only**; both **no-reply** and
   **in-platform view + reply** are deferred — see *Out of scope* below. The reply-capable path (**POP3 / IMAP +
   threading**) is the more complicated one, so it waits for a real two-way requirement.
9. ✅ **SMTP transport & environments — DECIDED.** The factory's **ESP-API** providers (SES / Mailgun / …) are
   joined by a **generic SMTP adapter** (`email-3.5`) serving two non-API needs: **(a) the dev sink** — non-prod
   sends go to **LocalStack SES capture** (`/_aws/ses`, shown in the console **Monitor → Email**) or an optional
   **Mailhog** container; **no real delivery**, and **Mailhog is dev-only / never deployed** (`email-3.7`); and
   **(b) external relay (BYO transport)** — an enterprise account may route mail through **its own SMTP relay**
   (`email-3.6`), creds in **Secrets Manager**, where **deliverability/reputation become the client's**.
   **Don't conflate** this with **BYO *domain*** (default white-label — still **our SES**, the client just
   publishes our DKIM/SPF/DMARC, `email-4.6/4.7`). **Transport = environment ⊕ per-account config behind one
   `provider.send()` seam**; **`canSend()` + suppression + unsubscribe run on every transport** (a BYO relay
   can't bypass compliance). Full rationale: *SMTP transport & sending environments (reference)* above.

# Out of scope (deferred — later considerations)

* **Inbound email / replies — deferred (both options).** v1 is **send-only** from the account's verified sending
  identity; the platform does **not** ingest or display inbound mail. Two future paths, **both out of scope for
  now**:
  * a dedicated **no-reply** return address (one-way), **vs**
  * **in-platform view + reply** — a conversation view like SMS — the **more complex** path: it needs an **inbox
    connector (POP3 / IMAP, or a provider inbound-parse webhook)** plus inbound **storage + threading** to the
    original send.

  Until then, replies to a normal sending address simply land in the account's **own external mailbox**. Revisit
  when two-way email is a real requirement.

# Drip campaigns (sequenced sends)

A **drip** is a **time-sequenced series** of messages to a contact (Day 0 → Day 2 → Day 5 …), each enrolled
contact progressing on **their own timeline**, with **exit conditions** (unsubscribe, goal, end).

**The drip engine is orchestration (campaign / workflow), channel-agnostic — not an email feature.** The
sequence definition (steps + delays + branching), enrollment, per-contact scheduling, and exit conditions live
**above** the channel; **email just delivers each step's send** through the normal pipeline (`canSend()` gate →
provider → send-log). This is the **same engine** that drives SMS drips (see [texting](../texting/SPECS.md)
*Drip campaigns*) and **mixed-channel** drips (an email step then an SMS step) — neither channel owns it.

* Each step is **scheduled by the orchestrator** (at scale: a "who's due now?" sweep, not a timer per
  contact-step) and **enqueued as an ordinary send**; **suppression / unsubscribe apply per step** (an
  unsubscribed contact's remaining steps are suppressed via `canSend()`).
* **Drip vs broadcast** — a broadcast sends to a segment at one time; a drip is per-contact over time. Both ride
  the same send pipeline; the difference is the orchestration on top.

# Service & Job topology

**Convention (platform-wide).** Each service layers **framework base → domain base → concrete role**. A **domain
Service base** (`EmailService extends Service`) and a **domain Job base** (`EmailJob extends Job`) hold the
**shared domain code** — the **provider factory** (SES / Mailgun / …), the **render / template** engine,
**sending-domain auth** (DKIM / SPF / DMARC), the **rate / IP-warm gate**, the **`canSend()`** client, and the
**send-log / sent-content** store — so every concrete role inherits it. (Parallels [texting](../texting/SPECS.md),
without carriers / 10DLC.)

```
Application
├── Service (Fastify, long-running — ECS)
│     └── EmailService             (domain base — provider factory · render/template · sending-domain auth · rate/IP-warm gate · canSend · send-log/sent-content store; not deployed alone)
│           └── EmailMainService    (the /email/* API: send-enqueue · templates · sending-domain verify · test-addresses · engagement reads · config/health; non-SES provider feedback-webhook ingress = ACK-fast → enqueue)
└── Job (Lambda, event-driven)
      └── EmailJob                  (domain base — provider factory · render · rate/IP-warm gate · retry/DLQ · idempotency)
            ├── EmailSendWorker      (SQS L2 per-provider — provider-AGNOSTIC: dispatch by provider · render · canSend · rate + IP-warm gate · provider.send · send-log + sent-content (S3); retry → DLQ)
            ├── EmailFeedbackJob     (SNS→SQS — SES bounce/complaint feedback → suppression (contact / account block-list) + status; emit)
            ├── EmailDripJob         (EventBridge/SQS — sequenced drip orchestration)
            └── EmailScheduleJob     (EventBridge — release scheduled campaigns into the send queue)
   (+ EmailOpenPixel — a Lambda@Edge function at the CloudFront open-pixel edge → emits open events to analytics; clicks via the links service)
```

**Services (HTTP, ECS Fargate)**

| Class | Extends | Role |
|---|---|---|
| **`EmailService`** | `Service` | **Domain base** — provider factory · render/template · sending-domain auth · rate/IP-warm gate · `canSend` · send-log/sent-content store; **not deployed alone**. |
| **`EmailMainService`** | `EmailService` | The **`/email/*` API** — send-enqueue, templates, **sending-domain verification** (DKIM/SPF/DMARC), **test-addresses** (`email-1.6`), engagement reads, config/health; **non-SES provider feedback-webhook** ingress (ACK-fast → enqueue). *(SES feedback arrives via **SNS**, not a hosted webhook — so no separate webhook service.)* |

**Jobs (Lambda, event-driven)** — each extends `EmailJob`:

| Class | Trigger | Role | Req |
|---|---|---|---|
| **`EmailSendWorker`** | SQS (**L2 per-provider**) | **Provider-agnostic** — dispatch by `message.provider` via the factory; **render** → **`canSend`** → **rate + IP-warm gate** → `provider.send` → write send-log + **sent-content** (S3); retry → DLQ. *(One factory worker; per-provider queues = HoL isolation — not a worker-per-provider, `email-1.7`.)* | email-1.0 / 1.7 / 5.0 / 12.0 |
| **`EmailFeedbackJob`** | SNS → SQS | Process **bounce / complaint** feedback → **suppression** (contact / account block-list) + status; emit | email-4.0 |
| **`EmailDripJob`** | EventBridge / SQS | **Sequenced drip** orchestration — advance steps, enqueue the next send | email-13.0 |
| **`EmailScheduleJob`** | EventBridge | Release **scheduled campaigns** into the send queue at window open | email-6.0 |

> **Shared modules (not deployables).** The **provider factory**, the **render / template** engine,
> **sending-domain auth**, the **rate / IP-warm gate**, and the **`canSend()`** client (on the `Application`
> base) are reused across the service + jobs. **Queueing is two-level like texting** (`email-1.7`): **L1**
> account fair-share (`WorkQueue` / dispatch) → **L2 per-provider** physical queues for HoL isolation; the
> **`EmailSendWorker` is provider-agnostic** (dispatch by provider via the factory) — adding a provider is a new
> adapter + a queue mapping, not a new worker. The **open-pixel** is a **Lambda@Edge** function at the CloudFront
> edge (behind Shield/WAF) — engagement flows to [analytics](../analytics/SPECS.md); **clicks** are the
> [links](../links/SPECS.md) service, not email.

# AWS Services and Other Dependencies

**AWS services**
* **SES** (+ **SNS** for bounce/complaint feedback) — sending + feedback loop. **SES is the prod default
  transport**; **local/dev sends go to LocalStack's SES capture** (`/_aws/ses`, no delivery — `email-3.7`).
* **Secrets Manager** — **BYO-SMTP relay credentials** for per-account external relays (`email-3.6`); never AppConfig.
* **SQS** (+ **DLQ**) — **two levels** (like texting): **L1** account fair-share intake → **L2 per-provider** physical queues (config-mapped, most-specific-first → shared default) for HoL isolation; **Lambda** job workers + retries.
* **DynamoDB** — the send-log; **S3** — the sent-content (rendered body) store.
* **EventBridge** — scheduled campaigns.
* **CloudFront + Lambda@Edge** (behind **Shield / WAF**) — the open-pixel edge.
* **Kafka** — engagement events → analytics.
* **Redis (ElastiCache)** — pause flags, rate / IP-warm counters.
* **Route 53 / ACM** *(or the customer's registrar)* — sending-domain DNS verification (DKIM/SPF/DMARC).

**Third-party libraries / services**
* **Email providers (factory):** SES (AWS) · `smtp` (generic SMTP, **nodemailer** — `email-3.5`) · Mailgun · Postmark · SparkPost · `fake`. The `smtp` adapter backs both the **dev sink** and the **per-account external relay**.
* **Dev mail sink:** **LocalStack SES capture** (`/_aws/ses` → console **Monitor → Email**); optional **Mailhog** container (SMTP catch-all + inbox UI). **Dev-only — never deployed** (`email-3.7`).
* *(later)* **Recipient-validation provider** — ZeroBounce / NeverBounce / Kickbox (stub, `email-4.10`).

**Internal (`@repo/*`)**
* `@repo/services` (Ses, Sqs, Dynamo, S3, Kafka, Cache, **Secrets** — BYO-SMTP creds), `@repo/endpoint`, `@repo/common`. Consumes **contact** (recipients/suppression) · **links** (tracked links) · **media** (attachments); emits to **analytics**; ordered by **dispatch**.

# Requirements (traceable register)

The traceable requirement register for the **email service** (the Objective + the sections above are the
rationale; this is the coded list). IDs are stable handles (**`email-N.M`**) — cite them in code, tickets, and tests.
**Priority:** **A** = MVP, **B** = core / hardening, **C** = later. One level of sub-requirements; a group's
priority is its floor. **Boundaries:** email owns **send execution, provider abstraction, retry/DLQ,
deliverability, the send-log**; it **delegates** — tracked links + short domains → [links](../links/SPECS.md);
the engagement lake → [analytics](../analytics/SPECS.md); fair-share ordering + IP warming →
[dispatch](../../../packages/services/DISPATCH.md); attachments → [media](../media/SPECS.md); recipients + the
**suppression/consent SoT** → [contact](../contact/SPECS.md) (email *runs* the `canSend()` gate and writes
bounce/complaint suppression **back**).

## email-1.0 Sending — A
- **email-1.1** Single send — A
- **email-1.2** Bulk send from **contact segments** (contact svc) — A
- **email-1.3** **SQS-queued** (single + bulk) → **Lambda** job workers — A
- **email-1.4** **Scheduled delivery** via EventBridge — A
- **email-1.5** Recipient + merge data from the **contact** service — A
- **email-1.6** **Pre-launch test send + test-address library** — a per-account **library of named test email addresses** (`name + address`, **reusable** across campaigns); **send a campaign test to selected test addresses before go-live** (a launch gate — verify rendering / merge / links / unsubscribe first) — A
- **email-1.7** **Two-level queueing (L1 fair-share → L2 per-provider)** — like texting (`texting-1.3.x`): **L1** = an **account fair-share** intake (the **`WorkQueue`** governor / [dispatch](../../../packages/services/DISPATCH.md), so one account's 100k blast can't starve another's 10) that routes to **L2 = per-provider physical queues** (SES / Mailgun / Postmark / SparkPost / SendMail) for **head-of-line isolation** — one provider's backlog / outage / rate-limit can't stall another. The **send worker is provider-agnostic** (dispatches by `message.provider` via the provider factory, `email-3.1`); **per-provider queues = HoL isolation, not capability**. **Config-mapped** (logical → physical, most-specific-first → shared default) — A

## email-2.0 Templates & content — A
- **email-2.1** Template management — A
- **email-2.2** **Merge tags** — contact / account / campaign — A
- **email-2.3** Attachments from the **[media](../media/SPECS.md)** service — B
- **email-2.4** **Tracked links** via [links](../links/SPECS.md) (same shortener as SMS; tracking optional) — B
- **email-2.5** **Sanitize HTML (XSS/JS)** — template + rendered-body HTML run through the **shared `Application.sanitizeHtml(html, "email")`** (allowlist; strip `script`/`style`/`on*`; constrain `a`/`img` URLs to `https:` + our CDN + tracked-links), **on store *and* render** — protects recipient inboxes, not just our UI *(see [`@repo/services` → Shared HTML sanitizer](../../../packages/services/README.md), web-6.7 = client backstop)* — A

## email-3.0 Provider abstraction (factory) — A
- **email-3.1** Provider **factory** — SES, SendMail, Mailgun, Postmark, SparkPost, **`fake`** — A
- **email-3.2** **SES** primary — custom domain, SPF/DKIM/DMARC, feedback — A
- **email-3.3** **`fake`** provider — simulate success/failure/open/click/unsub at scale (config thresholds) — B
- **email-3.4** **Multi-provider failover** *(outage fallback)* — only to a provider **pre-authenticated + warmed** for the from-domain; **idempotency key** prevents an A→B double-send; **single-provider-first** (SES) is the default *(gap #7)* — B
- **email-3.5** **Generic SMTP transport (adapter)** — a plain **SMTP** adapter in the factory (nodemailer-style), distinct from the ESP-API providers; the shared shape behind both the **dev sink** (`email-3.7`) and the **external relay** (`email-3.6`). Honors the same `provider.send()` contract + idempotency key *(gap #9, SMTP transport reference)* — B
- **email-3.6** **Per-account external SMTP relay (BYO transport)** *(enterprise edge case)* — an account may route its mail through **its own SMTP relay / MTA / corporate ESP**: host/port/security + **credentials in Secrets Manager** (never AppConfig); **`canSend()` + suppression + unsubscribe still apply**; **deliverability/reputation/auth + bounce feedback become the client's** (no platform DKIM/SPF/warm-up/SES→SNS on this path). **Opt-in, `ACCOUNT`-role+, audited.** Distinct from **BYO *domain*** (still our SES, `email-4.6/4.7`) *(gap #9)* — C
- **email-3.7** **Local / non-prod transport (dev sink)** — outside prod the SMTP transport targets **LocalStack SES capture** (`GET /_aws/ses`, shown in the console **Monitor → Email**) or an optional **Mailhog** container; **no real delivery**, no DNS/DKIM/warm-up. **Mailhog is dev-only — never deployed**, and optional (the LocalStack capture covers reads) *(gap #9)* — B

## email-4.0 Deliverability & reputation — A
- **email-4.1** **Pre-send `canSend()` gate** (suppression / consent / quiet-hours / block-list) before delivery — A
- **email-4.2** **One-click unsubscribe** (`List-Unsubscribe` / RFC 8058) — A
- **email-4.3** **Bounce/complaint feedback** (SES→SNS) → **auto-suppress back to contact** — A
- **email-4.4** **Complaint-rate monitoring** (< 0.3% Gmail/Yahoo) — A
- **email-4.5** **New-IP warming** ramp (via [dispatch](../../../packages/services/DISPATCH.md)) — B
- **email-4.6** **Per-account sending identities** — 0..N addresses/domains, each with a **`status`** (`verified` / `unverified` / `pending` / `failed`), **one default**; campaigns may only pick **verified** ones *(gap #6)* — B
- **email-4.7** **Sending-identity DNS verification** — ownership **TXT** + **DKIM (CNAME)** + **SPF** + **DMARC**, **per `(domain × provider)`** (each provider has its own DKIM selector / SPF alignment); **not sendable until `verified`**; a **per-provider sending subdomain** keeps alignment clean + dodges SPF's 10-lookup limit. Same DNS-proof machinery as [links](../links/SPECS.md) `links-5.6`. Supports **dynamic re-verification** — re-check DNS on demand (e.g. after a DNS change), updating `status` — A
- **email-4.8** **Multiple from-addresses without a sub-account** (pick-list); a **sub-account** is only for true data isolation *(gap #6)* — B
- **email-4.9** **Application / root system sender** — a **separate platform-level identity** for system mail (reset, notices), isolated from account sending — A
- **email-4.10** **Recipient address validation** *(stubbed — later development)* — a **pluggable 3rd-party validation provider** (factory, like the sending-provider factory; e.g. ZeroBounce / NeverBounce / Kickbox) for syntax + **MX / DNS** lookups + disposable / role-account detection to cut bounces. **Stub the interface now**; build later. Also usable at [contact](../contact/SPECS.md) import — C
- **email-4.11** **Manage sending identities** — **add** / **re-verify** (dynamic DNS re-check) / **remove**; restricted to **`ACCOUNT` role and above** (account admins · `APPLICATION` · `ROOT`); each action audited — B

## email-5.0 Retry, failure & DLQ — A
- **email-5.1** Retry queue — config N attempts, **exponential backoff** → DLQ — A
- **email-5.2** **Permanent/legit failures not retried** — A
- **email-5.3** **Visibility-timeout** + **max-receives** → DLQ — A
- **email-5.4** **DLQ → normal-queue requeue** — manual **API**, by batch / accountId — B

## email-6.0 Pause / halt / cancel — A
- **email-6.1** **Redis pause flag** — by **account and/or campaign**; the job checks before each send — A
- **email-6.2** Move paused items to a **`/pause` queue** — B

## email-7.0 Engagement tracking — B
- **email-7.1** **Open** (edge pixel) + **click** (via [links](../links/SPECS.md)) capture — B
- **email-7.2** **Edge ingest** — CloudFront + Lambda@Edge behind **Shield + WAF** (rate-limit / abuse at the edge); return the 1×1, fire-and-forget — B
- **email-7.3** **At the edge: validate token + filter bot / Apple-MPP / prefetch + dedup**; bucket machine opens separately — B
- **email-7.4** Publish *real* opens to **Kafka** (analytics backbone) — **not** SQS-per-hit, **no new service** *(gap #5)* — B

## email-8.0 Logs & analytics — A
- **email-8.1** **Operational send-log in DynamoDB** (delivered / opened / clicked / bounced / optout) — A
- **email-8.2** Engagement analytics **emitted to analytics** (Kafka → S3 lake) — **not** an email-owned Athena store *(gap #1)* — B
- **email-8.3** **No PII** in events/logs — opaque `contactId` — A
- **email-8.4** **Per-message cost accounting** → emit to **billing**; **meter against the campaign budget cap** ([campaign → Channel cost management](../campaign/SPECS.md), the cross-channel cost authority) — A

## email-9.0 Visibility & fair-share (the "email dispatcher") — B
- **email-9.1** Cross-account **send visibility** (volume gantt) — B
- **email-9.2** Fair-share ordering + IP warming via the **[dispatch](../../../packages/services/DISPATCH.md)** governor *(gap #3)* — B

## email-10.0 Privacy & compliance — A
- **email-10.1** **GDPR erasure (Art 17)** — on the [contact](../contact/SPECS.md) `contact-forget` **SQS** message, email **obfuscates the `to` address + the rendered body** in the sent-content store (tombstone, e.g. *"Purged for GDPR forget-me request on DATE"*) and purges PII in **send-logs + bounce/complaint records** (`contactId` shell retained for aggregates) — B
- **email-10.2** **No PII in tracking URLs** (opaque codes via links) — A
- **email-10.3** **No PHI** by [AUP](../account/specs/SPECS.md) — A
- **email-10.4** **Tenant isolation** + per-account rate limits — A
- **email-10.5** **Retention limits (Art 5(1)(e))** — configurable **TTL** on send-logs / engagement / rendered content (storage limitation) — B
- **email-10.6** **Sub-processor + residency (Art 28 / 44–49)** — sending providers (SES / …) are **sub-processors** (DPA required); **EU-market sends ride EU-region provider infra** (no cross-region, per the [AWS topology](../../../packages/services/src/aws/SPECS.md)) — A
- **email-10.7** **Access / portability (Art 15 / 20)** — contribute email **send + engagement history** to a contact's data export (via [contact](../contact/SPECS.md) / [analytics](../analytics/SPECS.md)) — B
- **email-10.8** **Lawful basis for open/click tracking** — engagement tracking ties to a person; rely on consent / legitimate-interest + first-party only (no third-party share) — B

## email-11.0 Infra footprint — A
- **email-11.1** **SES** (+ SNS feedback), **SQS** (+ DLQ), **Lambda** workers — A
- **email-11.2** **DynamoDB** (send-log), **EventBridge** (schedule), **Redis** (pause flag, rate/warm-up) — A
- **email-11.3** **CloudFront / Lambda@Edge** (open/click edge) — B
- **email-11.4** Consumes **contact** (recipients / suppression), **links** (tracked links), **media** (attachments); **emits to analytics**; ordered by **dispatch** — A

## email-12.0 Sent-content record — A
- **email-12.1** Retain the **rendered sent body** per **`(campaign × contact)`** — **viewable** like text-messaging history (campaign surfaces the view) — A
- **email-12.2** Stored in **S3** (large bodies), keyed by campaign + contact; the channel owns it (mirrors texting; campaign *views*, doesn't store the email body) — B
- **email-12.3** **GDPR forget** obfuscates the **`to` address + body** with a tombstone on the `contact-forget` SQS (`email-10.1`) — B

## email-13.0 Drip / sequenced campaigns (delegated) — B
- **email-13.1** **Drip = orchestration (campaign/workflow), not an email engine** — sequence (steps + delays + branching) + enrollment + per-contact scheduling + exit conditions live **above** the channel; **email delivers each step** via the normal send pipeline — B
- **email-13.2** **Per-step send obeys the pipeline** — each step runs `canSend()` (suppression / unsubscribe) + send-log like any send; an **unsubscribed** contact's remaining steps are **suppressed** — B
- **email-13.3** **Channel-agnostic** — the **same drip engine** drives **[texting](../texting/SPECS.md)** + **mixed-channel** drips (email step → SMS step); email only delivers — B

## email-14.0 Service & Job topology — B
- **email-14.1** **Domain bases** — `EmailService extends Service` + `EmailJob extends Job` hold the shared code (provider factory · render/template · sending-domain auth · rate/IP-warm gate · `canSend` · send-log/sent-content store); **concrete roles extend the domain base** — B
- **email-14.2** **`EmailMainService`** — the `/email/*` API (send-enqueue · templates · sending-domain verify · test-addresses · engagement reads); non-SES provider feedback-webhook ingress — A
- **email-14.3** **Jobs extend `EmailJob`** — `EmailSendWorker` / `EmailFeedbackJob` / `EmailDripJob` / `EmailScheduleJob` — A
- **email-14.4** **`EmailSendWorker`** — **provider-agnostic** (SQS **L2 per-provider**, dispatch by `provider` via the factory): render · `canSend` · rate/IP-warm gate · `provider.send` · send-log + sent-content; retry → DLQ. One factory worker; per-provider queues = HoL isolation (`email-1.7`) — A
- **email-14.5** **`EmailFeedbackJob`** (SNS→SQS) — bounce/complaint → suppression + status — A
- **email-14.6** **Open-pixel = Lambda@Edge** (CloudFront edge) → engagement to analytics; clicks via [links](../links/SPECS.md) — B

# Endpoints (first cut)

A first pass at the endpoint surface, in [`@repo/endpoint`](../../../packages/endpoint/SPECS.md) style — all
service-prefixed **`/email/*`**. Email has **two planes**: a public/edge tracking surface (open pixel,
unsubscribe — latency-critical, behind Shield/WAF) and the authed/S2S control plane. **Sending is S2S** —
[campaign](../campaign/SPECS.md) / workflow / transactional callers enqueue; email doesn't expose a
user-facing "blast" route. **Click tracking is the [links](../links/SPECS.md) redirect**, not an email endpoint.

**Access column:** recommended **`minAccess`** on the `Access` ladder — **`-`** = public · account ladder
**`SENDER`<`USER`<`BILLING`<`ACCOUNT`** · staff ladder **`SUPPORT`<`APPLICATION`<`ROOT`** · **`⬆`** = also
step-up · **`Internal`** = VPC-only S2S · **`Provider-sig`** = signature-verified provider/SNS webhook. A senior
role satisfies any junior minimum.

### Send (S2S — campaign / workflow / transactional) (email-1)
| Method | URI | Purpose | Access | Req |
|---|---|---|---|---|
| POST | `/email/send` | Enqueue a **single** send (job-id pointer → SQS) | Internal | email-1.1/1.3 |
| POST | `/email/send/bulk` | Enqueue a **bulk** send from a contact segment | Internal | email-1.2 |
| POST | `/email/send/test` | Send a **test** to the composer (self) — render + deliver one | USER | email-1.1/2.2 |
| GET, POST | `/email/test-addresses` | List / add a **named test address** (`name + address`) — account library | USER | email-1.6 |
| DELETE | `/email/test-addresses/{id}` | Remove a test address | USER | email-1.6 |
| POST | `/email/campaigns/{campaignId}/test` | **Pre-launch test** — send the campaign to selected **test addresses** | USER | email-1.6 |

### Templates (email-2)
| Method | URI | Purpose | Access | Req |
|---|---|---|---|---|
| GET | `/email/templates` | List templates | USER | email-2.1 |
| POST | `/email/templates` | Create a template | USER | email-2.1 |
| GET | `/email/templates/{id}` | Get a template | USER | email-2.1 |
| PATCH | `/email/templates/{id}` | Update a template | USER | email-2.1 |
| DELETE | `/email/templates/{id}` | Archive a template | USER | email-2.1 |
| POST | `/email/templates/{id}/preview` | Render with merge data (preview) | USER | email-2.2 |

### Sending identities — DNS-verified (email-4.6/4.7/4.11)
| Method | URI | Purpose | Access | Req |
|---|---|---|---|---|
| GET | `/email/identities` | List sending identities + `status` (verified/unverified/…) | USER | email-4.6 |
| POST | `/email/identities` | Add an address/domain → returns DNS records to set | ACCOUNT | email-4.11 |
| POST | `/email/identities/{id}/verify` | **(Re-)verify** DNS on demand (DKIM/SPF/DMARC) → update `status` | ACCOUNT | email-4.7/4.11 |
| PUT | `/email/identities/{id}/default` | Set the account **default** identity | ACCOUNT | email-4.6 |
| DELETE | `/email/identities/{id}` | Remove a sending identity | ACCOUNT | email-4.11 |

### Providers — platform config (email-3)
| Method | URI | Purpose | Access | Req |
|---|---|---|---|---|
| GET | `/email/providers` | List configured providers + status | APPLICATION | email-3.1 |
| PUT | `/email/providers/{id}` | Configure a provider (factory: SES / Mailgun / … / `fake` / `smtp`) | APPLICATION ⬆ | email-3.1/3.2/3.5 |

### Transport — per-account external SMTP relay, BYO (email-3.6)
| Method | URI | Purpose | Access | Req |
|---|---|---|---|---|
| GET | `/email/accounts/{accountId}/smtp` | Read the account's BYO-SMTP relay config (host/port/security; **secret-ref only**, never the credential) | ACCOUNT | email-3.6 |
| PUT | `/email/accounts/{accountId}/smtp` | Set / update the relay (creds stored in **Secrets Manager**) — audited | ACCOUNT ⬆ | email-3.6 |
| POST | `/email/accounts/{accountId}/smtp/test` | Send a **test** through the relay to confirm connectivity/auth | ACCOUNT | email-3.6 |
| DELETE | `/email/accounts/{accountId}/smtp` | Remove the relay → fall back to the platform default (SES) | ACCOUNT ⬆ | email-3.6 |

### Messages — send-log, status & sent content (email-8, email-12)
| Method | URI | Purpose | Access | Req |
|---|---|---|---|---|
| GET | `/email/messages` | Query the send-log (by campaign / account / status) | USER | email-8.1 |
| GET | `/email/messages/{id}` | Single message status | USER | email-8.1 |
| GET | `/email/messages/{id}/content` | View the **rendered sent body** (per campaign × contact) | USER | email-12.1 |

### Pause / halt / cancel (email-6)
| Method | URI | Purpose | Access | Req |
|---|---|---|---|---|
| POST | `/email/campaigns/{campaignId}/pause` | Set the Redis pause flag — stop further sends | ACCOUNT | email-6.1 |
| POST | `/email/campaigns/{campaignId}/resume` | Resume a paused campaign | ACCOUNT | email-6.1 |
| POST | `/email/campaigns/{campaignId}/cancel` | Cancel remaining sends | ACCOUNT | email-6.1 |
| POST | `/email/accounts/{accountId}/pause` | **Account-wide** pause (ops / compliance hold) | APPLICATION ⬆ | email-6.1 |

### Retry / DLQ (email-5)
| Method | URI | Purpose | Access | Req |
|---|---|---|---|---|
| GET | `/email/dlq` | List DLQ items (by account / type) | APPLICATION | email-5.4 |
| POST | `/email/dlq/requeue` | Requeue DLQ items — by batch / accountId | APPLICATION ⬆ | email-5.4 |

### Public / edge — tracking & unsubscribe (email-4.2, email-7)
| Method | URI | Purpose | Access | Req |
|---|---|---|---|---|
| GET | `/email/o/{token}` | **Open pixel** (1×1) — edge (CloudFront/Lambda@Edge) behind Shield/WAF; validate + bot/MPP-filter → Kafka | - | email-7.1/7.2 |
| GET | `/email/unsubscribe/{token}` | One-click unsubscribe landing (`List-Unsubscribe`) | - | email-4.2 |
| POST | `/email/unsubscribe/{token}` | RFC 8058 one-click POST → suppress (→ contact) | - | email-4.2 |

### Webhooks & internal / ops
| Method | URI | Purpose | Access | Req |
|---|---|---|---|---|
| POST | `/email/webhook/{provider}` | Provider **bounce / complaint / delivery** feedback (SES→SNS, …) → auto-suppress | Provider-sig | email-4.3 |
| POST | `/email/internal/erase` | S2S forget hook — obfuscate `to` + body, purge log PII (`contact-forget` fan-out) | Internal | email-10.1 |
| GET, PUT | `/email/config` | Read / set the service's own runtime config (AppConfig-backed) | ROOT | email-11.2 |
| GET | `/email/health` | Liveness / readiness of the worker fleet | - | email-11.1 |

# eof


#
# Shopify integration
#

# Objective

Connect an **account's Shopify store** as an **inbound trigger source**: turn the commerce events Shopify
emits — **new orders, paid, fulfilled, cancelled, refunds, abandoned checkouts, new/updated customers** —
into **normalized events on the platform bus** that an account's **[workflow](../../core/workflow/SPECS.md)**
acts on. *"A customer placed an order → send a thank-you text + start a post-purchase journey."* *"A checkout
was abandoned → fire an abandoned-cart recovery sequence."* This is **mainly a trigger** — Shopify is the
**stimulus**, the platform's channels are the **engagement**.

It is also the platform's **first-class conversion source**: a Shopify **`order.placed` / `order.paid`** is the
**commerce/goal event** [analytics](../../core/analytics/SPECS.md) attributes back to the channel touches that
earned it (the analytics **conversion contract**, `analytics-6.5` — *"integration commerce/goal event first… a
Shopify `order.placed`"*). So the same order both **triggers** a workflow and **closes the loop** on attribution.

**Direction = inbound (Shopify → us).** This is the **mirror of [HubSpot](../hubspot/SPECS.md)** (which is
outbound push). Shopify is **account-connected** (the merchant connects *their* store), so it lives under
**[marketplace](../../core/marketplace/SPECS.md)** governance — **per-account OAuth**, the **Zapier governance
pattern** ([zapier](../zapier/SPECS.md): accept-to-enable · cross-border gate · metering · egress feature-flag ×
permission). **The account is the controller.** Secondary **outbound actions** (tag a customer, create a discount)
are available as workflow **action nodes**, but the headline is **inbound triggers**.

This is **not a new data plane**: ingest rides the platform **incoming-webhook intake** (verify → SQS); the
**connector runtime** normalizes; triggers ride the **Kafka backbone** into workflow; engagement rides the
**channels behind `canSend()`**; secrets ride the **marketplace vault**.

# Role & boundaries

**Owns:**
* The **Shopify event contract** — which **webhook topics** map to which **normalized events**, and the
  **payload → context** shape each carries (order total / line items / customer ref, etc.).
* **Webhook verification + connector normalization** — verify the Shopify **HMAC** (per-shop secret), dedupe on
  the Shopify webhook id, and **normalize** the vendor payload into a platform event (the
  [marketplace](../../core/marketplace/SPECS.md) **`MarketplaceConnectorJob`** pattern).
* **Customer → contact resolution + consent mapping** — resolve the Shopify customer (email / phone) to a RumbleUp
  **`contactId`** ([contact](../../core/contact/SPECS.md) lookup), store the Shopify id in **`externalRefs`**, and
  map Shopify's **marketing-consent** state onto our consent.
* **Abandoned-checkout correlation** — derive **`checkout.abandoned`** from a checkout with no matching order
  inside a window.
* **Outbound actions** *(secondary)* — the typed Shopify **action nodes** (tag customer · add note · create
  discount · cancel) the connector executes for a workflow `integration-action`.

**Delegates / does NOT do:**

| Concern | Owner |
|---|---|
| **OAuth + credential vault + catalog + cross-border gate + metering** | **[marketplace](../../core/marketplace/SPECS.md)** (Zapier governance pattern) |
| **Webhook intake edge** (HTTPS endpoint → SQS) | the platform **incoming-webhook intake** |
| **The trigger graph / what to do next** | **[workflow](../../core/workflow/SPECS.md)** (these events are its **trigger nodes**) |
| **The engagement send** (SMS / email / …) + **consent / suppression / quiet-hours** | the **channel** + **`canSend()`** ([texting](../../core/texting/SPECS.md) / [email](../../core/email/SPECS.md)) |
| **Conversion attribution math** | **[analytics](../../core/analytics/SPECS.md)** (Shopify order = the conversion event it credits) |
| **Contact identity + suppression + the stable `contactId`** | **[contact](../../core/contact/SPECS.md)** |
| **Pacing / retry / DLQ / fair-share** of inbound + outbound | the shared **connector / dispatch framework** |

> **No PII reach-down; the account is controller.** Shopify is the **account's** system. When a contact is
> forgotten, erasure here = **stop-ingesting + stop-acting + disclose**, not reach-in-delete (the
> [egress erasure boundary](../../../docs/SPECS.md)). Shopify's **mandatory privacy webhooks** are honored (below).

# Core concepts

* **Connection (installation)** — an account's connected Shopify store: the OAuth grant (vaulted in marketplace),
  the shop domain, the registered webhook subscriptions, and connection health. One per store; lifecycle is the
  marketplace `enable → connect → active → pause → remove` (+ **auto-pause** on `app/uninstalled`).
* **Trigger event** — a Shopify webhook **normalized** into a platform event (`shopify.order.placed`, …). These
  are **dynamic integration trigger events** (marketplace-contributed) — *not* entries in the static core
  [`Events`](../../../packages/endpoint/src/EventTypes.ts) vocabulary — matched by an account's **workflow trigger
  bindings**, exactly like any [marketplace](../../core/marketplace/SPECS.md) integration trigger node.
* **Customer ↔ contact** — the Shopify customer is resolved to a RumbleUp **`contactId`** (by normalized email /
  E.164 phone); the Shopify customer id is stored in the contact's **[`externalRefs`](../../core/contact/src/model/ContactModel.ts)**
  (`{ shopify: { customerId, shop } }`). **Unknown customer** → auto-create (an account-configurable choice) or an
  **opaque `anonId`** (same rule as [analytics](../../core/analytics/SPECS.md) identity resolution).
* **Marketing consent** — Shopify's `email_marketing_consent` / `sms_marketing_consent` (state + opt-in level +
  timestamp) maps onto RumbleUp **consent** on the resolved contact. **It does not bypass `canSend()`** — any
  engagement still passes the channel's consent / suppression / quiet-hours gate.
* **Conversion** — an `order.placed` / `order.paid` is emitted **both** as a workflow trigger **and** as the
  analytics **conversion event** (value + currency + `contactId`) for multi-touch attribution.
* **Action node** *(outbound)* — a typed Shopify call a workflow `integration-action` invokes with the account's
  vaulted token (tag customer, add note, create discount, cancel order).

# Architecture & flow

```
 INBOUND TRIGGERS  (the headline)
   Shopify store ──webhook (topic + HMAC)──► incoming-webhook intake (HTTPS)
        • verify HMAC (per-shop secret) · dedupe on X-Shopify-Webhook-Id · ACK fast (200)
        └─► SQS ──► shopify CONNECTOR (normalize)
                 • map topic → normalized event ; resolve customer → contactId (+ externalRefs) ; map consent
                 └─► emit `shopify.<event>` on the Kafka backbone
                          ├─► workflow TRIGGER router ── match account bindings → start / signal instances
                          │        └─► engagement: send-text / send-email …  (ALWAYS via canSend())
                          └─► analytics (order events → the `converted` conversion contract → attribution)

 ABANDONED CHECKOUT  (a correlation, not a raw webhook)
   checkouts/create ──► open a checkout-pending wait (EventBridge Scheduler, N hours)
        orders/create for that checkout BEFORE the window → cancel the wait (it converted)
        window elapses with NO order            → emit `shopify.checkout.abandoned`  → recovery workflow

 OUTBOUND ACTIONS  (secondary — a workflow node)
   workflow integration-action ──► shopify connector ──► Shopify Admin API (account's vaulted OAuth token)
        throttled to Shopify's leaky-bucket / GraphQL cost limit ; retry → DLQ

 AUTH:  per-account Shopify OAuth (app install) → tokens minted + vaulted via the marketplace broker
 PRIVACY: Shopify mandatory webhooks (customers/data_request · customers/redact · shop/redact) handled
```

* **Inbound-first, idempotent.** Shopify **retries** webhooks and can **duplicate** them; the connector dedupes on
  **`X-Shopify-Webhook-Id`** and every downstream effect is idempotent — a redelivered order doesn't double-trigger
  or double-count a conversion.
* **No new engine.** Intake = the shared webhook intake; normalize = the marketplace connector runtime; trigger =
  workflow; send = the channels + `canSend()`; throttle = the shared framework. Shopify adds a **connector +
  event map**, not infrastructure.

# Trigger catalog — what Shopify emits → what we do

The Shopify webhook **topics** the connector subscribes to, the **normalized event** each becomes, and the
**engagement** it typically drives. The subscribed set is **config** (add a topic = a map entry).

| Shopify topic(s) | Normalized event | Typical engagement |
|---|---|---|
| `orders/create` | **`shopify.order.placed`** | order-confirmation text/email; start post-purchase journey; **conversion** (attribution) |
| `orders/paid` | `shopify.order.paid` | payment confirmation; **conversion** |
| `orders/fulfilled` · `fulfillments/create` · `fulfillments/update` | `shopify.order.fulfilled` / `shopify.fulfillment.updated` | **shipping / tracking** notification (carrier + tracking #) |
| `orders/cancelled` | `shopify.order.cancelled` | cancellation acknowledgment |
| `refunds/create` | `shopify.refund.created` | refund acknowledgment |
| `checkouts/create` · `checkouts/update` (+ no order in window) | **`shopify.checkout.abandoned`** | **abandoned-cart recovery** (the headline win) |
| `customers/create` | `shopify.customer.created` | **welcome** series; consent capture |
| `customers/update` · `customers/enable` · `customers/disable` | `shopify.customer.updated` | sync attributes + **marketing-consent** state |
| `products/create` · `products/update` *(later)* | `shopify.product.updated` | back-in-stock / new-product (needs inventory signals) |
| `app/uninstalled` | `shopify.app.uninstalled` | **auto-pause** the connection (lifecycle) |
| `customers/data_request` · `customers/redact` · `shop/redact` | privacy webhooks (below) | **GDPR/CCPA obligations** — mandatory, not engagement |

> **Engagement composes in workflow.** Each normalized event is a **trigger node**; the *journey* (wait, branch,
> send, upsell, A/B) is authored in [workflow](../../core/workflow/SPECS.md). Shopify just says *what happened* +
> *to whom* (`contactId`) + *the facts* (order total, items, tracking) in the trigger context.

# Customer resolution & consent

* **Resolve → `contactId`.** The connector normalizes the Shopify customer's **email** (lowercased) / **phone**
  (E.164) and asks [contact](../../core/contact/SPECS.md) for the `contactId`; the Shopify id is written to the
  contact's **`externalRefs.shopify`**. Unknown customer → **auto-create** (account-config) or an **`anonId`**.
* **Consent mapping — Shopify state → RumbleUp consent.** `sms_marketing_consent` / `email_marketing_consent`
  (state + opt-in level + consent timestamp + source) map onto the contact's consent record, so a customer who
  opted into SMS marketing on Shopify is consented here. **Crucially: this is a *signal*, not a bypass** — every
  triggered send still runs **`canSend()`** (consent · suppression · STOP · quiet-hours · 10DLC), so a Shopify
  "accepts marketing" flag never overrides a platform opt-out.
* **No raw PII on the bus.** The normalized event carries **`contactId`** + commerce facts (totals, item ids,
  tracking), **not** raw email/phone — PII stays in contact (same discipline as analytics events).

# Conversion & attribution

* A Shopify **order** is the platform's **v1 conversion event** (`analytics-6.5`): the connector emits the order
  as a [analytics](../../core/analytics/SPECS.md) **`converted`** with **value + currency + `contactId`**, and
  analytics attributes it to the contact's prior channel touches (email → SMS → … → order) within the lookback
  window, by the account's chosen attribution model.
* **One event, two consumers** — the same `shopify.order.placed` both **triggers** a workflow (thank-you / journey)
  and **feeds** attribution. They don't compete; the connector emits once, both subscribe.

# Outbound actions (secondary)

Workflow `integration-action` nodes the connector executes against the **Shopify Admin API** with the account's
vaulted token. **v1 set (gap #11):** **tag customer** · **add customer/order note** · **create discount code** ·
**cancel order** · **find-or-create customer** — needing scopes `write_customers · write_orders · write_discounts`.
Throttled to Shopify's **leaky-bucket / GraphQL cost** limit; retry → DLQ. These make journeys two-way (*"VIP order
→ tag customer `vip` in Shopify + send a thank-you"*) but are **not** the focus — Shopify is primarily a **trigger**.

# Auth, webhooks & privacy

* **Per-account OAuth.** The merchant installs the RumbleUp Shopify app; tokens are **minted + vaulted via the
  [marketplace](../../core/marketplace/SPECS.md) OAuth broker**, auto-refreshed, revocable — the
  [zapier](../zapier/SPECS.md) auth model. The connector holds a **reference**, never the token.
* **Least-privilege scopes (v1).** Reads for the triggers — `read_orders · read_customers · read_checkouts ·
  read_fulfillments` (+ `read_products` when product triggers land); writes for the v1 action set —
  `write_customers · write_orders · write_discounts`. Request only what the enabled triggers + actions need.
* **Webhook HMAC.** Every inbound webhook is **HMAC-verified** (per-shop secret) at the intake edge before it's
  trusted; failures are dropped + alerted. Dedupe on **`X-Shopify-Webhook-Id`**.
* **Mandatory privacy webhooks** *(Shopify app requirement)* — `customers/data_request` (surface what we hold for
  a shopper → DSAR), `customers/redact` (erase a shopper's data → contact forget fan-out), `shop/redact` (erase
  the shop's data after uninstall). These are **required to ship** a Shopify app and tie into the platform forget
  flow.
* **Kill switches** — disable / **dry-run** (log intended triggers + actions, do nothing) / pause the connection
  (AppConfig + the marketplace lifecycle).

# Governance (marketplace / Zapier pattern)

Shopify is a **[marketplace](../../core/marketplace/SPECS.md) `IntegrationDefinition`** under the **Zapier
governance pattern** ([zapier](../zapier/SPECS.md)): **accept-to-enable**, **per-account OAuth**, the
**`dataJurisdiction` cross-border gate** (an EU shop's data stays in-region), **metering** (events ingested /
actions executed), and **egress = feature-flag × the connecting user's permission**. The **account is the
controller** on both ends. The connector **contributes trigger + action nodes** to workflow scoped to what the
account connected — it does not own the catalog, OAuth, or the vault.

# Reliability

* **Idempotent ingest** — dedupe on `X-Shopify-Webhook-Id`; downstream effects keyed so a redelivery is a no-op
  (no double-trigger, no double-count).
* **No backfill at launch — new events only.** We act on what Shopify emits **after** connect (forward); we do
  **not** replay history. A bounded historical **bulk import** ("go back in time" — seed past orders/customers)
  is a **deferred future task** of uncertain value to a forward engagement engine; if ever built it's
  rate-limited + **consent-aware** (gap #10).
* **Throttle + backpressure** — outbound actions ride the shared **token-bucket × per-account fair-share**
  (Shopify's leaky-bucket / GraphQL cost); 429 / 5xx → **computed-delay requeue** → DLQ → **auto-pause + alert**
  ([monitor](../../core/monitor/SPECS.md)) — reused, not reinvented.
* **Webhook re-subscription** — on connect (and a periodic reconcile) ensure the topic subscriptions exist;
  re-register if Shopify dropped them.

# Out of scope

* **Full Shopify POS / inventory / fulfillment management** — we **consume** commerce events; we don't run a
  store backend.
* **Storefront / theme / checkout UI** — Shopify owns the buying experience; we engage **after** the event.
* **Two-way customer-record sync** (a HubSpot-style continuous mirror) — Shopify here is **trigger-in + light
  action-out**, not a CRM mirror; a deep sync is a separate, deferred surface.
* **Product recommendations / merchandising ML** — later, if inventory/catalog signals are ingested.

# AWS Services and Other Dependencies

**AWS services**
* **API Gateway** — the Shopify **webhook intake** (HMAC-verified) + the small `/shopify/*` config / health surface.
* **SQS** (+ **DLQ**) — webhook ingest buffering + outbound-action workers + retry.
* **Kafka (MSK)** — the **normalized trigger events** (to workflow + analytics).
* **EventBridge Scheduler** — the **abandoned-checkout** window + periodic webhook-subscription reconcile.
* **DynamoDB** — connection state · webhook-dedupe ids · checkout-pending correlation (Shopify ids live on the
  contact's **`externalRefs`**, not a separate store).
* **Redis (ElastiCache)** — outbound throttle (token-bucket × fair-share) + breaker state.
* **Secrets Manager** (+ **KMS**) — the per-account OAuth tokens + per-shop webhook secret (**via marketplace**).

**Third-party**
* **Shopify Admin API + Webhooks** (REST + GraphQL) — **Shopify is a sub-processor** of the account's data.

**Internal (`@repo/*`) + services**
* `@repo/services` (Sqs, Kafka, Dynamo, Cache, SecretsManager, Kms), `@repo/endpoint` (`Access`), `@repo/common` (`Type`).
* Composes **marketplace** (OAuth / vault / catalog / governance / connector runtime), **workflow** (trigger +
  action nodes), **contact** (resolution / consent / `externalRefs`), **analytics** (conversion), **texting /
  email + `canSend()`** (engagement), **monitor** (health / backpressure).

# Compliance & standards mapping

How **this Shopify integration's** controls map to **OWASP Top 10 (2021)**, **ISO/IEC 27001:2022** (Annex A),
**SOC 2** (TSC), **GDPR**, **CCPA/CPRA**, and **messaging law**. Shopify is an **account-controlled inbound
integration** — its dominant controls are **webhook authenticity (HMAC)**, **OAuth secret custody**,
**consent fidelity** (Shopify state → `canSend()`), **no-PII-on-the-bus**, the **egress erasure boundary**, and
**Shopify's mandatory privacy webhooks**. **No PCI** (we never touch card data — Shopify owns checkout); **no PHI**.

**Legend:** ✅ meets/exceeds · ⚠️ partial / open — see Gaps · ➖ n/a

| Shopify control | OWASP T10 | ISO 27001:2022 | SOC 2 (TSC) | GDPR | CCPA | Messaging | |
|---|---|---|---|---|---|---|---|
| **Webhook authenticity** — HMAC-verify every inbound at the edge; drop + alert on failure | A08 / A01 | A.8.26 / A.5.14 | CC6.1 / CC7.1 | Art 32 | ➖ | ➖ | ✅ |
| **OAuth secret custody** — per-account tokens + per-shop secret in the **marketplace vault** (Secrets Manager + KMS); reference-only | A02 / A05 | A.8.24 / A.5.17 | CC6.1 | Art 32 | ➖ | ➖ | ✅ |
| **Consent fidelity** — Shopify marketing-consent maps to our consent but **`canSend()` always governs**; a Shopify flag never overrides a platform opt-out | A04 | A.5.34 | CC6.1 | Art 6 / 7 | §1798.120 | **TCPA / opt-in** | ✅ |
| **No PII on the bus** — normalized events carry **`contactId`** + commerce facts, not raw email/phone | A09 | A.8.11 | (Privacy) | Art 5(1)(c) | §1798.100 | ➖ | ✅ |
| **Idempotent ingest** — dedupe on `X-Shopify-Webhook-Id`; no double-trigger / double-count | A08 | A.8.26 | CC7.1 | ➖ | ➖ | ➖ | ✅ |
| **Egress erasure boundary** — Shopify is the account's system; forget = **stop-ingest + stop-act + disclose** | A04 | A.8.10 | (Privacy) | Art 17 | §1798.105 | ➖ | ✅ |
| **Mandatory privacy webhooks** — `customers/data_request` · `customers/redact` · `shop/redact` handled (DSAR + forget fan-out) | A04 | A.5.34 / A.8.10 | (Privacy) | Art 15 / 17 | §1798.105 | ➖ | ✅ |
| **Cross-border gate** — EU shop's data stays in-region (marketplace `dataJurisdiction`) | A08 | A.5.14 | CC6.7 | Art 44–49 | ➖ | ➖ | ✅ |
| **Outbound throttle + backpressure** — Shopify leaky-bucket/GraphQL-cost; 429 → requeue → DLQ → auto-pause + alert | A08 | A.8.26 | CC7.1 | ➖ | ➖ | ➖ | ✅ |
| **Least-privilege scopes** — request only the OAuth scopes the trigger/action set needs | A01 | A.5.15 / A.8.2 | CC6.1 / CC6.3 | Art 25 | ➖ | ➖ | ✅ |
| **Audit** — connect / disconnect / config change + manual resync audited | A09 | A.8.15 | CC7.2 | Art 30 | ➖ | ➖ | ✅ |

> **Design-intent mapping** — how the integration is *intended* to satisfy each control, not an attestation.

# Gaps & decisions

*The one review list.* ✅ = resolved/decided · ⚠️ = **open — needs attention**.

1. ✅ **Direction — DECIDED: inbound trigger-first.** Shopify → normalized events → **workflow triggers**
   (+ analytics conversion). Outbound **action nodes** are secondary; a continuous CRM-style mirror is out of scope.
2. ✅ **Governance — DECIDED: marketplace / Zapier pattern.** Per-account OAuth, accept-to-enable, cross-border
   gate, metering, egress feature-flag × permission; **account = controller**. Mirror of [HubSpot](../hubspot/SPECS.md)'s
   external flavor, opposite direction.
3. ✅ **Events are dynamic integration triggers — DECIDED.** `shopify.*` events are **marketplace-contributed**
   trigger nodes the workflow router matches — **not** entries in the static core `Events` vocabulary.
4. ✅ **Identity — DECIDED: resolve to `contactId` upstream.** Connector resolves customer (email/E.164) →
   `contactId` via contact; Shopify id in **`externalRefs`**; unknown → auto-create (config) or `anonId`. No raw
   PII on the bus.
5. ✅ **Consent — DECIDED: map but never bypass.** Shopify marketing-consent maps onto our consent as a **signal**;
   **`canSend()` always governs** the actual send (TCPA / STOP / quiet-hours / 10DLC).
6. ✅ **Conversion — DECIDED.** Order = the analytics **`converted`** event (value + currency + `contactId`),
   `analytics-6.5`; one emit, two consumers (workflow + analytics).
7. ✅ **Abandoned checkout — DECIDED: a windowed correlation.** `checkouts/create` opens a Scheduler window;
   matching order before it elapses cancels it; no order → **`shopify.checkout.abandoned`**.
8. ✅ **Idempotency — DECIDED.** Dedupe on `X-Shopify-Webhook-Id`; all downstream effects idempotent.
9. ✅ **Privacy webhooks — DECIDED: handled.** `customers/data_request` · `customers/redact` · `shop/redact` are
   implemented (required to ship a Shopify app) and wired to the forget flow.
10. ✅ **Backfill — DECIDED: none at launch; act on new events only.** We're a **forward-looking engagement
    engine** — we react to what Shopify emits *after* connect, we don't replay history. **Going back in time**
    (bulk-importing past orders/customers) is a **deferred future task** whose relevance is **uncertain** for an
    engagement engine; if ever built it's a bounded, rate-limited, **consent-aware** seed (`shopify-8.1`). Bonus:
    go-forward-only keeps the privacy story simple (we never ingest historical PII we weren't invited to).
11. ✅ **Outbound action set — DECIDED (v1).** Action nodes: **tag customer · add customer/order note · create
    discount code · cancel order · find-or-create customer**. **OAuth scopes** follow the set (least-privilege —
    request only what the enabled triggers + actions need): reads `read_orders · read_customers · read_checkouts ·
    read_fulfillments`; writes `write_customers · write_orders · write_discounts`.

# Requirements (traceable register)

The traceable register for the **Shopify integration** (IDs **`shopify-N.M`**). **Priority:** **A** = MVP,
**B** = core / hardening, **C** = later. **Boundary:** Shopify owns the **event contract + connector normalize +
customer/consent resolution + abandoned-checkout correlation + outbound actions**; OAuth/vault/governance =
marketplace, triggers/automation = workflow, sends + consent = channels/`canSend()`, attribution = analytics.

## shopify-1.0 Connection & auth — A
- **shopify-1.1** **Per-account OAuth** (app install) — tokens minted + **vaulted via marketplace**; connector holds a reference, never the token *(gap #2)* — A
- **shopify-1.2** **Lifecycle** — `enable → connect → active → pause → remove`; **auto-pause** on `app/uninstalled`; **least-privilege OAuth scopes** (reads `read_orders/customers/checkouts/fulfillments`; writes `write_customers/orders/discounts` — only what the enabled triggers+actions need) — A
- **shopify-1.3** **Webhook subscription management** — register the configured topics on connect + **periodic reconcile** (re-register if dropped) — A

## shopify-2.0 Inbound webhooks & normalization — A
- **shopify-2.1** **HMAC verification** at the intake edge (per-shop secret); drop + alert on failure — A
- **shopify-2.2** **Idempotent ingest** — dedupe on **`X-Shopify-Webhook-Id`**; ACK-fast (200) → SQS → connector — A
- **shopify-2.3** **Normalize topic → event** — the connector maps each subscribed topic to a **`shopify.<event>`** with a payload→context shape; subscribed set is **config** — A
- **shopify-2.4** **No raw PII on the bus** — events carry **`contactId`** + commerce facts, never raw email/phone — A

## shopify-3.0 Trigger catalog — A
- **shopify-3.1** **Orders** — `order.placed` / `paid` / `fulfilled` / `cancelled`; `fulfillment.updated`; `refund.created` — A
- **shopify-3.2** **Abandoned checkout** — `checkout.abandoned` via a **Scheduler window** (checkout with no matching order in time) *(gap #7)* — A
- **shopify-3.3** **Customers** — `customer.created` / `updated` (+ enable/disable) carrying **marketing-consent** state — A
- **shopify-3.4** **Products** *(later)* — `product.updated` for back-in-stock / new-product (needs inventory signals) — C
- **shopify-3.5** **Triggers are dynamic** marketplace nodes matched by **workflow** bindings (not the static `Events` catalog) *(gap #3)* — A

## shopify-4.0 Customer resolution & consent — A
- **shopify-4.1** **Resolve customer → `contactId`** (normalized email / E.164) via [contact](../../core/contact/SPECS.md); store Shopify id in **`externalRefs.shopify`** — A
- **shopify-4.2** **Unknown customer** → **auto-create** (account-config) or opaque **`anonId`** — B
- **shopify-4.3** **Consent mapping** — Shopify `sms/email_marketing_consent` → our consent **as a signal**; **`canSend()` always governs** the send *(gap #5)* — A

## shopify-5.0 Conversion & attribution — A
- **shopify-5.1** **Order → analytics `converted`** (value + currency + `contactId`), the `analytics-6.5` conversion contract; one emit feeds **both** workflow + analytics *(gap #6)* — A

## shopify-6.0 Outbound actions (secondary) — B
- **shopify-6.1** **Action nodes (v1)** via workflow `integration-action` — **tag customer · add customer/order note · create discount code · cancel order · find-or-create customer** — executed with the vaulted token; scopes `write_customers · write_orders · write_discounts` *(gap #11)* — B
- **shopify-6.2** **Throttle** — Shopify leaky-bucket / GraphQL cost → token-bucket × fair-share + backpressure requeue → DLQ → auto-pause + alert — B

## shopify-7.0 Governance & privacy — A
- **shopify-7.1** **Marketplace / Zapier governance** — accept-to-enable · **`dataJurisdiction` cross-border gate** · metering · egress feature-flag × permission; **account = controller** *(gap #2)* — A
- **shopify-7.2** **Mandatory privacy webhooks** — `customers/data_request` (DSAR) · `customers/redact` (forget) · `shop/redact` — handled + wired to the forget flow *(gap #9)* — A
- **shopify-7.3** **Egress erasure boundary** — pushed records are downstream; forget = **stop-ingest + stop-act + disclose**, not reach-in-delete — A
- **shopify-7.4** **Kill switches** — disable / **dry-run** (log intent, do nothing) / pause (AppConfig) — A
- **shopify-7.5** **Audit** — connect / disconnect / config change / manual resync — B

## shopify-8.0 Reliability — B
- **shopify-8.1** **No backfill at launch — new events only** (forward engagement engine). Historical bulk import ("go back in time") is a **deferred future task** of uncertain relevance; if built: bounded · rate-limited · **consent-aware** *(gap #10)* — C
- **shopify-8.2** **Backpressure + retry + DLQ + auto-pause** on both ingest and outbound; **idempotent** throughout — B

## shopify-9.0 Infra — A
- **shopify-9.1** **API Gateway** (webhook intake + `/shopify/*`) · **SQS + DLQ** · **Kafka** (normalized events) · **EventBridge Scheduler** (abandoned-checkout + reconcile) · **DynamoDB** (connection / dedupe / checkout-pending) · **Redis** (throttle) · **Secrets Manager + KMS** (via marketplace) — A

# Endpoints (first cut)

A first pass, in [`@repo/endpoint`](../../../packages/endpoint/SPECS.md) style — service-prefixed `/shopify/*`.
**Ingest is webhook-driven** (Shopify → intake → SQS → connector), and **automation is workflow** — so the HTTP
surface is **OAuth callback + webhooks + config/health + operator resync**, no per-record public API.
**Access column:** **`-`** public/system · **`Provider-sig`** = HMAC-verified Shopify webhook · account ladder
`USER`<`ACCOUNT` · **`Internal`** = VPC-only S2S.

| Method | URI | Purpose | Access | Req |
|---|---|---|---|---|
| GET | `/shopify/oauth/install` | Begin app install (redirect to Shopify OAuth) | ACCOUNT | shopify-1.1 |
| GET | `/shopify/oauth/callback` | OAuth callback — exchange code, **vault** token, register webhooks | - (state-verified) | shopify-1.1/1.3 |
| POST | `/shopify/webhook/{topic}` | Shopify webhook ingress — **HMAC-verify** → dedupe → ACK → SQS | Provider-sig | shopify-2.1/2.2 |
| POST | `/shopify/webhook/privacy/{kind}` | Mandatory privacy webhooks (`data_request` / `customers_redact` / `shop_redact`) | Provider-sig | shopify-7.2 |
| GET, PUT | `/shopify/connections/{id}/config` | Connection config — subscribed topics · auto-create · dry-run · abandoned-checkout window | ACCOUNT | shopify-2.3/7.4 |
| POST | `/shopify/connections/{id}/resync` | Operator/account resync — **re-register webhooks** (no historical backfill at launch) | ACCOUNT | shopify-1.3 |
| GET | `/shopify/connections/{id}/status` | Connection health — subscriptions · queue depth · backpressure · last event | USER | shopify-8.2 |
| GET | `/shopify/health` | Liveness / readiness (intake + connector) | - | shopify-9.1 |

# eof

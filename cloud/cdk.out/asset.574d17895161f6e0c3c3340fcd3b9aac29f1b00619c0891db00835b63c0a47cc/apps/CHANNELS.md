#
# Channels — the omnichannel model (discussion)
#

# Vision

One platform that composes, targets, schedules, sends, and measures across **every outbound channel**
— SMS/MMS, email, push, WhatsApp/RCS, voice, **direct mail**, and **social** — plus **inbound** where
the channel supports it (SMS replies, social DMs/comments). A **centralized hub**: build once, reach a
contact (or an audience) on the right channel, and see all the engagement in one place.

This is a discussion of how the channels *differ*, what we can *unify*, and the hard parts to decide
before we generalize beyond SMS + email.

# The core insight — there are TWO outbound primitives, not one

The biggest mistake would be to treat "post to TikTok" like "text a contact." They're different shapes:

* **`send(recipient, message)`** — **1:1, addressed, consent-bound.** You send to a *known address*
  (phone, email, postal address, device token, WhatsApp number). Per-recipient consent, suppression,
  delivery receipts, and (sometimes) replies. → SMS/MMS, email, push, WhatsApp, voice, **direct mail**.
* **`publish(audience, post)`** — **1:many, broadcast, public.** You publish to *your account's
  audience* (a Facebook Page's followers, an X timeline) — you **don't pick recipients**, there's **no
  per-recipient consent**, the content is public, and "engagement" is impressions/likes/shares/comments.
  → Facebook, Instagram, X, TikTok, LinkedIn **posts**.
* **(the hybrid)** social **DMs** (Messenger, Instagram DM) are 1:1 *inside* a social platform — closer
  to `send`, but bound by platform rules (e.g. a 24-hour reply window), not your own consent list.

Forcing social posts into the per-recipient send model breaks consent, addressing, and analytics. The
platform needs **both primitives** as first-class — a campaign/workflow can use either.

# Channel taxonomy

| Channel | Primitive | Address | Consent regime | Inbound | Partner/provider | Lead time |
|---|---|---|---|---|---|---|
| **SMS / MMS** | send | phone (E.164) | TCPA, opt-in, **STOP**, quiet hours, **10DLC** | **two-way** (replies, STOP) | Twilio / Bandwidth | seconds |
| **Email** | send | email | CAN-SPAM, unsubscribe, **domain auth** (DKIM) | replies, bounces, complaints | SES / Mailgun / SendGrid | seconds |
| **Push** | send | device token | app opt-in (OS permission) | open/dismiss | FCM / APNs | seconds |
| **WhatsApp / RCS** | send (1:1) | phone | **opt-in + template approval + 24h window** | two-way (in-session) | Meta / provider | seconds |
| **Voice** | send | phone | TCPA, DNC, calling hours | DTMF / call events | provider / IVR | seconds |
| **Direct mail** | send | **postal address** | minimal opt-in; **NCOA / CASS / deceased / DMA** suppression | effectively one-way (**QR / PURL** to respond) | **PostGrid / Lob** | **days** (print + postal) |
| **Social posts** | **publish** | *none* (your page/handle) | platform ToS + content policy; **no per-recipient consent** | comments, mentions, reactions | Meta (FB/IG), X, TikTok, LinkedIn | seconds–minutes (+ approval) |
| **Social DMs** | send (1:1) | platform handle/scoped id | platform messaging policy (windows) | two-way (in-window) | Meta, etc. | seconds |

The columns are the point: **address type, consent regime, inbound model, partner, and lead time all
differ** — so "a channel" is an interface with per-channel implementations, not one code path.

# What we can unify (and what we can't)

**Unify — the `Channel` adapter.** Mirror the dispatch provider-adapter pattern: a typed `Channel`
interface each implementation satisfies, exposing its **capabilities** (primitive, address type,
media support, max size, supports-inbound), a **send/publish** method, a **cost/throughput** profile,
and a **normalized status/engagement event** stream. New channels = new adapters; callers stay generic.

* **dispatch** keeps owning **pacing / throughput / fallback / retry / DLQ** — but per channel: carrier
  TPS (SMS), reputation/warmup (email), API rate limits (social), **batch + lead time** (direct mail).
* Each **channel service** (texting, email, and new: **print**, **social**) owns its provider formats +
  operational reactions; **analytics** is the central historian (normalized events, channel-specific attrs).
* **marketplace** owns the **account's connections/credentials** — social is per-account **OAuth** (their
  FB Page, their X account); print/email-ESP are API keys; messaging is carrier/provider.

**Can't unify — pretend channels are interchangeable.** Content, consent, addressing, and inbound are
genuinely different. The unification is the *interface and the hub UX*, not the semantics.

# Per-channel notes

* **Direct mail (PostGrid / Lob).** Render a real artifact (postcard/letter/check) → PDF with an
  **address block + physical dimensions**; **verify/normalize the address** (CASS/NCOA, drop deceased);
  it's **slow and physical** — *no real-time delivery*, days of lead time, **per-piece cost** (gate on
  budget), undeliverable/returns handling, and a **proof/preview** before a run. "Inbound" is indirect:
  **QR codes / personalized URLs (PURLs)** that turn a scan into a tracked digital event.
* **Social posts (Meta / X / TikTok / LinkedIn).** **Account-scoped, not contact-scoped** — you publish
  as the brand to followers, you can't target individuals. Per-platform **content formats** (X ≤ 280 +
  media, IG image/reel-first, TikTok video, LinkedIn article), **media specs**, **rate limits**, and
  **review/approval**. Schedule + publish; then ingest **comments/mentions/reactions** as inbound. (Paid
  **ads** — boosting, lead-gen forms, audience targeting — is a *related but distinct* surface; treat as
  its own thing, not "a post.")
* **WhatsApp / RCS.** 1:1 but with **pre-approved templates** and a **24-hour session window** for
  free-form replies — a consent + content model unlike SMS.
* **Email / SMS / MMS / push / voice.** The 1:1 workhorses we've largely specced (texting, email,
  dispatch); they set the `send` baseline the others extend or diverge from.

# Inbound & the unified inbox

Inbound is wildly uneven, and a single **unified inbox** spanning it is high-value but hard:

* **SMS** — true two-way (replies, **STOP/HELP**); drives suppression + conversations.
* **Social DMs** — two-way **within platform windows**; per-platform threading + identity.
* **Social comments/mentions** — public, 1:many inbound → **moderation + routing**, not a private thread.
* **Email** — replies + bounces/complaints (operational, → suppression).
* **Direct mail / push / voice** — effectively **one-way** (PURL/QR, open, DTMF as proxies).

A real cross-channel inbox must reconcile different **identities** (a social handle rarely maps to your
contact), **windows**, **threading**, and **public-vs-private** — a substantial sub-system on its own.

# Cross-channel orchestration

This is where the hub pays off — **workflow** sequences channels with fallback/escalation:

> *email → if no open in 3 days → SMS → if converts → thank-you **postcard**; retarget non-openers with
> a **social** audience.*

Needs: a **channel-preference + fallback** model per contact (preferred channel, last-engaged, allowed
channels by consent), **content renditions** per channel on one campaign, and **cross-channel
attribution** (which touch earned the conversion). A `send` node picks the channel; a `publish` node
posts to social — both already fit the workflow node model.

# E-commerce is NOT a channel — it's the trigger / data / conversion layer

Shopify (and BigCommerce, WooCommerce, Stripe, …) are **not channels** — you don't "send a Shopify."
A channel *delivers* to a person; an e-commerce platform *provides the context* that decides what to
deliver, to whom, and whether it worked. It plugs in through **marketplace** (the account's connection)
and **workflow** (integration nodes) — **not** as a `Channel` adapter.

> **E-commerce is just the clearest example of a general pattern.** *Any* integration in the
> marketplace **drives or uses** the channels/workflows the same way — fundraising (an **ActBlue
> donation** = a conversion + a thank-you trigger), CRM (a **HubSpot deal stage** change = a trigger;
> "create lead" = an action), support (a **Zendesk ticket** = a trigger), calendar, accounting, etc.
> Read "Shopify" below as the exemplar; the trigger/data/action/conversion roles generalize to every
> connector. The platform is the **hub**; integrations are the *sources and sinks* around the channels.

> **Surveys are the same shape, the other direction.** A **survey** isn't a channel either — it's a
> structured **interaction delivered over** the channels (a conversational SMS survey, an emailed form
> link, an IVR) and a **collection flow** for the replies, native or via an integration (SurveyMonkey /
> Typeform). A completed survey is a **conversion + trigger**, just like an order. See
> `apps/core/survey`. (The conversational version *is* a workflow of `collect-input` steps — the survey
> service defines it and reuses that machinery, it doesn't add a channel.)

Three roles (illustrated with commerce):

* **Trigger** *(input → workflow)* — commerce events are the **highest-intent triggers** on the
  platform: `order.placed`, `checkout.started`, **`cart.abandoned`**, `fulfillment.shipped`,
  `refund.created`, `subscription.renewed`. These start journeys that then use the **channels**
  (abandoned cart → SMS; order → email receipt + thank-you **postcard**; delivered → review request).
* **Data** *(enrich + segment)* — customers / orders / products feed **targeting + personalization
  across every channel**: segment by LTV, last purchase, category, RFM; merge order details into the
  message; sync a customer segment to a **social ad audience** (commerce data → social surface).
* **Action** *(workflow → integration)* — `create discount code`, `tag customer`, `add to segment`,
  `create draft order` — the integration **action** nodes (marketplace connector, account creds).

So the layering is: **commerce event → workflow → channel send/publish → commerce conversion**. The
channels are the *reach*; e-commerce is the *why, who, and did-it-work*.

### Where commerce and channels genuinely overlap (worth designing for)
* **Conversion attribution closes the loop here.** The Shopify **order** is the `converted` event that
  ends a multi-channel funnel — this is the concrete **source** for analytics' conversion event (the
  open gap in the analytics spec): a purchase, attributed back to the email/SMS/postcard/social touch.
* **Click-to-buy / shoppable.** Channel content links to commerce — tracked links in SMS/email to a
  Shopify checkout, **QR/PURL on a postcard** to a product page, and platform-native **social commerce**
  (Instagram Shopping, TikTok Shop, WhatsApp catalog) where the channel itself sells. The *channel*
  delivers; the *commerce platform* fulfills.
* **Audience sync.** Push a commerce-derived segment to a channel's targeting (e.g. Meta Custom
  Audiences for retargeting) — commerce data driving the (paid) social surface.

> Net: **no new channel work** for e-commerce — it rides the existing **integration trigger/action
> nodes + marketplace connectors**, and it *supplies* the triggers/data/conversions that make the
> channels worth orchestrating. The one thing it unlocks elsewhere is a real **conversion source** for
> attribution.

# Things to consider (the hard parts)

1. **Two primitives, not one.** Model `send` (1:1, addressed, consent-bound) and `publish` (1:many,
   public, no per-recipient consent) as distinct — don't shoehorn social into per-recipient sends.
2. **Consent is per-channel and not uniform.** TCPA/STOP (SMS), CAN-SPAM/unsubscribe (email),
   NCOA/deceased/DMA (mail), platform ToS (social posts — *no* per-recipient consent), template+window
   (WhatsApp). One global consent model won't fit; suppression lists differ per channel.
3. **Identity across channels is unsolved.** A contact has phone/email/postal/handles/device tokens;
   resolving one person across them — and the fact that **social audiences are largely anonymous to
   you** — limits true 1:1 personalization on social.
4. **Latency & economics differ by orders of magnitude.** Carrier TPS (sec) vs email reputation/warmup
   vs social API quotas vs **direct-mail batch lead time (days) + per-piece cost**. Dispatch must model
   each; scheduling/SLA expectations differ per channel.
5. **Content can't auto-port.** A 280-char post ≠ a postcard ≠ an HTML email. Compose **per-channel
   renditions**; channel-aware previews; address blocks/dimensions for print, media specs for social.
6. **Inbound is uneven.** Two-way (SMS), windowed (social DMs/WhatsApp), public 1:many (comments),
   one-way (mail/push). A unified inbox is a real project — threading, identity, windows, moderation.
7. **Provider/credential models differ.** Social = per-account **OAuth** (marketplace), with token
   refresh + per-platform rate limits + content review; print = platform/BYO API key; messaging =
   carrier (10DLC/brand registration gates SMS). Each connects differently.
8. **Compliance & approval gates differ.** 10DLC (SMS), domain auth (email), template approval
   (WhatsApp), platform review (social), content policy (SHAFT for SMS) — per-channel preconditions
   before a channel can go live (the registration/sandbox model already anticipates this).
9. **Analytics normalization has limits.** sent/delivered/opened/clicked map across most channels, but
   social adds impressions/shares/comments and mail adds scan/USPS-tracking — normalize the common verbs,
   keep channel-specific attrs (the analytics spec's single-event-schema approach).
10. **Ads ≠ organic social.** Boosting/lead-gen/audience-targeting is a separate paid surface with its
    own model and billing — don't conflate it with publishing an organic post.
11. **E-commerce is the trigger/data/conversion layer, not a channel.** Commerce events are the best
    triggers and the **order is the conversion** that closes cross-channel attribution — so it rides the
    integration nodes + marketplace, and *supplies* the missing conversion source, rather than adding a
    channel.

# Boundaries — where this lives

* **`Channel` adapter interface** + per-channel **services** (texting, email, **print**, **social**) —
  own provider formats + operational reactions.
* **dispatch** — per-channel pacing/throughput/fallback/retry.
* **marketplace** — account connections/credentials (social OAuth, ESP/print keys, **e-commerce**).
* **campaign / workflow** — multi-channel composition + orchestration (`send`/`publish` nodes,
  **commerce triggers/actions**).
* **analytics** — normalized cross-channel engagement history + **commerce conversions**.
* **contact** — channel addresses + per-channel consent/suppression; **account** — block list.

# Open decisions

1. **`publish` home** — **DECIDED:** a **`social` channel service** (`apps/core/social`) using
   marketplace-vaulted OAuth, surfaced to campaign/workflow as a `publish` node. Remaining: which
   platforms ship first.
2. **Unified inbox scope** — SMS-only first, then social DMs, then public comments? Or design the inbox
   abstraction up front?
3. **Direct-mail artifact pipeline** — specced in **`apps/core/print`** (PostGrid/Lob, CASS/NCOA,
   render→proof→batch→track, QR/PURL inbound). Remaining there: PostGrid vs Lob, provider-vs-our
   rendering, NCOA cadence, default mail class.
4. **Channel-preference & fallback model** — where the "preferred/allowed channel per contact" lives
   (contact service) and how workflow consumes it.
5. **Cross-channel attribution** — **specced in analytics** (owns it — it's a computation over the
   cross-channel event lake): default last-touch + lookback window, multi-touch selectable. See
   `apps/core/analytics/SPECS.md` "Attribution". (Channels just *emit* touches; analytics assigns credit.)
6. **Paid ads** — in scope as its own surface, or out of scope for the messaging hub?

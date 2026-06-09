#
# Social Service (the `publish` channel)
#

# Objective

The **`publish` channel** — post **organic** content to the account's connected social accounts
(Facebook Page, Instagram, X, TikTok, LinkedIn) and ingest the resulting **inbound** engagement
(comments, mentions, DMs). This is the platform's **1:many broadcast** primitive — the counterpart to
the 1:1 `send` channels (texting/email/print) — surfaced to campaign/workflow as a `publish` node.

See `apps/CHANNELS.md` for why social is a different primitive than `send`.

# Role & boundaries (read this first)

Social is a **channel service** — it owns the *publish mechanics + provider formats + inbound
ingestion*, nothing more.

What it **owns**:
* The **`publish`** operation — adapt one piece of content into each platform's format and post it.
* **Per-platform rendition** (text limits, media specs, hashtags, mentions, link handling).
* **Scheduling** of posts; status (published / failed + platform post id).
* **Inbound ingestion** — comments, mentions, reactions, DMs → normalized → unified inbox + analytics.

What it **delegates / does NOT do**:

| Concern | Owner |
|---|---|
| The account's **connection + OAuth tokens** (their FB Page, X account) | **marketplace** (per-account OAuth, vaulted, refreshed) |
| **Rate-limit pacing / retry / backoff** per platform | **dispatch** |
| Multi-step / cross-channel **orchestration** | **workflow / campaign** (`publish` node) |
| **Engagement history + attribution** | **analytics** (this service emits normalized events) |
| Stored **media** (images/video) | **media** |
| **Paid ads** (boosting, lead-gen, audience targeting) | a separate **ads** surface — *not here* (see below) |

> **No per-recipient consent / addressing.** You publish *as the brand to followers* — you don't pick
> recipients and there's no opt-in list. Consent here is **platform ToS + content policy**, not TCPA.

# Out of scope (deferred)

* **Paid ads** — boosting a post, lead-gen forms, Custom Audiences/targeting is a distinct paid surface
  with its own model + billing. Organic publish ≠ ads. (Audience *sync* to ad platforms is a commerce/
  data concern — see CHANNELS.md.)
* **Full social listening / sentiment** — start with engagement on *our* posts + direct mentions; broad
  brand-monitoring is later.
* **A built social inbox UI** — this service produces normalized inbound; the inbox UX is **web**.

# Core concepts

* **ConnectedAccount** — an account's link to one social destination (a FB Page, IG business account, X
  handle, TikTok account, LinkedIn org), authorized via **marketplace** OAuth. Tokens live in the vault;
  this service references them.
* **Post** — the content to publish: body + media + per-platform options + the **targets** (which
  connected accounts) + schedule.
* **Rendition** — the post adapted to one platform's rules (length, media, format).
* **PublishedPost** — the result on one platform: the **platform post id** + status; the handle for
  later engagement + inbound correlation.
* **Engagement** — metrics on a published post (impressions, likes, shares, comments, link clicks),
  pulled/streamed and normalized to analytics.
* **Inbound** — a comment / mention / reaction / **DM** arriving from a platform → unified inbox.

# Platforms

Each is a **provider adapter** behind the channel interface; they differ a lot:

| Platform | API | Content | Notable limits |
|---|---|---|---|
| **Facebook (Page)** | Meta Graph | text / link / image / video | Page access token; review for some features |
| **Instagram (Business)** | Meta Graph | image / carousel / **Reel** (video-first) + caption | container→publish 2-step; media hosted-URL flow |
| **X / Twitter** | X API v2 | **≤ 280 chars** + media; threads | tiered rate limits / cost |
| **TikTok** | Content Posting API | **video-first** (+ cover, caption) | review; video specs |
| **LinkedIn** | LinkedIn (org pages) | post / article + media | org-admin scopes |

The columns are the point — **one content idea, many renditions**; the adapter encapsulates each
platform's format + 2-step media flows + rate limits.

# Content & rendition

* **Per-platform renditions** of one Post — X trimmed to 280, IG caption + hashtags + first-comment,
  TikTok video + cover, LinkedIn long-form — authored/derived per target, with a **preview per platform**.
* **Media** comes from the **media** service (hosted URLs / uploads the platforms require); video specs
  (TikTok/Reels) validated before publish.
* **Hashtags / mentions / links** handled per platform (e.g. link unfurling vs link-in-bio).

# Scheduling & throughput

* **Schedule** a post for a future time (per timezone / "best time") via **EventBridge Scheduler**.
* **Rate limits + retries** per platform are **dispatch**'s job (each platform's quota differs widely);
  a failed publish surfaces as a `Type.Result` error + a failed-status event, not a throw.

# Inbound (comments · mentions · DMs)

Inbound is **uneven and platform-specific** — ingested via each platform's **webhooks** (preferred) with
**polling** as a reconciliation fallback:

* **Comments / mentions / reactions** — public, 1:many → normalized → **unified inbox** (moderation +
  routing) + analytics. Not a private thread.
* **DMs** (Messenger, Instagram DM) — 1:1 but bound by a platform **reply window** (e.g. 24h); closer to
  a conversation. Identity is a **platform-scoped id/handle**, which **rarely maps to a known contact**.
* Goes through the platform's **incoming-webhook intake → SQS → worker** (same fair-share pattern as the
  other channels), normalized to the analytics event schema (channel-specific attrs).

# Events to analytics

Publish + engagement emit normalized events (`sent`/`published`, plus channel-specific
`impression`/`like`/`share`/`comment`/`click`) keyed by account + campaign — but **attribution is at the
campaign/audience level**, not per-contact: social posts are anonymous broadcast (see analytics
"Attribution" → identity caveat).

# Data model (sketch)

```
ConnectedAccount  pk=ACCOUNT#<id>  sk=SOCIAL#<platform>#<connectionId>
  { platform, handle, marketplaceConnectionId (OAuth in the vault), scopes, status }

Post              pk=ACCOUNT#<id>  sk=POST#<postId>
  { body, mediaKeys[], targets[: { platform, connectionId, rendition }], scheduleAt, status }

PublishedPost     pk=ACCOUNT#<id>  sk=PUB#<postId>#<platform>
  { platformPostId, status: published|failed, error?, publishedAt }
  // engagement snapshots + inbound items stream to analytics / the inbox, not stored as state here
```

# Open decisions

1. **Paid ads** — confirm out of scope for this service (separate ads surface), in vs out for v1.
2. **Webhooks vs polling** per platform — which support real-time inbound; polling cadence for the rest.
3. **Unified-inbox depth** — DMs + comments + mentions all at once, or DMs first?
4. **Best-time-to-post** — schedule heuristics now or later.
5. **Engagement freshness** — push (platform webhooks) vs periodic pull of post metrics into analytics.
6. **Approval workflow** — does a post need internal review before publishing (regulated accounts)?

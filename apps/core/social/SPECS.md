#
# Social Service (the `publish` channel)
#

# Objective

The **`publish` channel** — post **organic** content to the account's connected social accounts
(Facebook Page, Instagram, X, TikTok, LinkedIn) and ingest the resulting **inbound** engagement
(comments, mentions, DMs). This is the platform's **1:many broadcast** primitive — the counterpart to
the 1:1 `send` channels (texting/email/print) — surfaced to campaign/workflow as a `publish` node.

Each network is integrated **natively** (its own API + OAuth) behind a provider-agnostic adapter — **we
implement** the publish + inbound mechanics ourselves, **not** via a posting aggregator.
**[Ayrshare](https://www.ayrshare.com)** is used only as a **reference benchmark** for the capability
surface (see *Provider strategy*). **Phase 1** networks are FB / Instagram / X / TikTok / LinkedIn;
**Phase 2** adds **Reddit, Pinterest, YouTube, Snapchat, Threads**.

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
* **RSS auto-post** — auto-publishing from an external RSS feed source; not a v1 authoring path.
* **AI content generation (compose assist)** — AI-drafted post copy / variants. Our v1 AI is the on-demand
  **inbound summary** (analytics-owned), **not** authoring. *(Reference: Ayrshare "Max Pack".)*
* **Post import / external history** — tracking / importing posts made outside the platform.
* **DM auto-responders** — automated / canned message replies + read-receipt / reaction sync (see Inbound).

# Core concepts

* **ConnectedAccount** — an account's link to one social destination (a FB Page, IG business account, X
  handle, TikTok account, LinkedIn org). An account may hold **several of the same network** (2 Pages, 3
  handles) up to a **plan quota** (see *Profiles-per-network quota*). **BYO credentials** — the account
  supplies **its own provider app keys / OAuth**; they live in **marketplace**'s vault, this service
  references them. **The account owns the provider tier** — any paywall / rate limit / paid stream (e.g. X)
  is **theirs to select + pay for**; we don't absorb it, we **alert** them when a provider returns an error
  / limit.
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

# Provider strategy — native adapters (Ayrshare as the reference)

Each network is integrated **natively** — its own API, OAuth, formats, 2-step media flows, and rate
limits — behind the **provider-agnostic** channel interface (see *Service & Job topology*). We **build the
adapters ourselves**; we do **not** depend on a third-party posting aggregator.

**[Ayrshare](https://www.ayrshare.com)** — a mature social API spanning ~15 networks — is used purely as a
**reference benchmark**: its capability surface is the feature bar our native implementation should meet.

> **Verify per platform at build time.** Platform APIs change often (especially X's access tiers); the
> capabilities below are the design intent, confirmed per provider when each adapter is built.

**Capability parity target** (what a mature social API offers → we implement natively, per platform):
* **Unified publish** — one piece of content → **per-network renditions** in one publish operation (text +
  media + per-network options: first comment, title, board, subreddit, thumbnail, visibility, …).
* **Scheduling** — post at a future time via our **EventBridge Scheduler** + best-time recommendation.
* **Media** — hosted URLs / uploads per platform (from our **[media](../media/SPECS.md)** service);
  per-network video-spec validation.
* **Analytics** — per-post + per-account engagement pulled/streamed → normalized to our events.
* **Comments** — read + reply + delete on our posts → inbox (comments / mentions); **DMs where the platform
  allows** (Meta yes; X/TikTok/LinkedIn limited — see the delivery-by-provider table).
* **Webhooks + poll reconcile** — real-time where a platform pushes, poll where it doesn't.

**Connection / OAuth is ours (BYO).** Each account connects its **own** per-network app credentials / OAuth;
tokens are vaulted in **[marketplace](../marketplace/SPECS.md)**, and **the account owns the provider tier +
cost** (X's paid tiers, etc.) — we **alert** on provider errors / limits, we don't absorb them. (An
aggregator would centralize that cost on the platform, which is one reason we implement natively instead —
see gap #11.)

## Profiles-per-network quota — plan-configurable
An account may connect **multiple profiles of the same network** (e.g. two Facebook Pages, three X
handles). **How many is a plan entitlement**, configured per plan and enforced at connect time:

* **Entitlement** — a per-plan limit, ideally **per network** (`maxProfiles[network]`) with an optional
  **overall** cap; **owned by [account](../account/SPECS.md)** (plans / entitlements), **read** by social.
* **Enforced on connect** — `POST /social/connections` checks the account's current count for that network
  against the entitlement; over-limit is **rejected** with an upgrade hint (not silently dropped).
* **Downgrade** — if a plan change lowers the limit below what's already connected, existing connections
  keep working but **new connects are blocked** until the account is back under the cap (don't auto-sever a
  live connection). Surface the over-cap state to the account.

## Network coverage & phased rollout
We integrate networks in phases (**verify each platform's API + required per-network fields at build time**
— the platforms + their access tiers change often):

| Phase | Networks |
|---|---|
| **Phase 1 (MVP)** | Facebook (Page), Instagram (Business), X / Twitter, TikTok, LinkedIn |
| **Phase 2** | **Reddit, Pinterest, YouTube, Snapchat, Threads** |
| **Later (candidates)** | Google Business Profile, Bluesky, Telegram — as demand + each platform's API warrant |

Each Phase-2 network carries **network-specific required fields** (its own API's post params) the rendition
layer must supply — e.g. **YouTube** (video + `title`, visibility), **Pinterest** (`board` + image/link),
**Reddit** (`subreddit` + `title`), **Snapchat** (media specs), **Threads** (text / media). Each is a **new
provider adapter behind the same interface** — **rendition + adapter work, not new architecture**;
`SocialPublishWorker` stays provider-agnostic.

# Feature comparison — our service vs Ayrshare + like products

A capability scan of our `social` service against **[Ayrshare](https://www.ayrshare.com)** (our reference)
and comparable posting products — **[Upload-Post](https://www.upload-post.com/)**,
**[Blotato](https://www.blotato.com/)**, **[Zernio](https://zernio.com/)**,
**[Post Bridge](https://www.post-bridge.com/)** — to sanity-check scope + spot gaps.

**Our column = roadmap** (`MVP` / `Later` / `No`); the others = **does the product offer it** (✅ yes ·
~ partial/unclear · ❌ no · — n/a). *Point-in-time scan — these products (and Ayrshare) change fast;
**verify before relying on any cell.** Post Bridge's site blocked automated fetch, so its column is from
public info + is the least certain.*

| Feature | Our social | Ayrshare | Upload-Post | Blotato | Zernio | Post Bridge |
|---|---|---|---|---|---|---|
| Networks (breadth) | phased (10 → +5) | ~13 | 12 | 9+ | 15+ | ~9 |
| Multi-network publish (organic) | **MVP** | ✅ | ✅ | ✅ | ✅ | ✅ |
| Per-platform rendition / customization | **MVP** | ✅ | ✅ | ✅ | ~ | ~ |
| Scheduling | **Later** | ✅ | ✅ | ✅ | ✅ | ✅ |
| Best-time recommendation | **Later** | ~ | ❌ | ~ | ❌ | ~ |
| Media — image / video (hosted) | **MVP** | ✅ | ✅ | ✅ | ✅ | ✅ |
| Post formats — Stories / short-form (Reels/Shorts) | **Later** | ✅ | ~ | ✅ | ~ | ✅ |
| Inbound — comments / mentions | **Later** | ✅ | ✅ | ❌ | ✅ | ❌ |
| Inbound — DMs | **Later** | ✅ | ✅ | ❌ | ✅ | ❌ |
| Inbound — reviews (GBP / FB) | **Later** | ✅ | ❌ | ❌ | ❌ | ❌ |
| Unified inbox + tagging + sentiment | **Later** | ~ (API only) | ❌ | ❌ | ❌ | ❌ |
| Analytics — per-post engagement | **MVP** | ✅ | ✅ | ❌ | ✅ | ~ |
| Analytics — account / audience (followers, demographics) | **Later** | ✅ | ~ | ❌ | ✅ | ❌ |
| Approval workflow (N approvals) | **Later** | ❌ | ❌ | ❌ | ❌ | ❌ |
| AI content generation (compose) | **No** (deferred) | ✅ | ❌ | ✅✅ (core) | ❌ | ~ |
| AI summary of inbound | **Later** | ~ | ❌ | ❌ | ❌ | ❌ |
| Webhooks (status / inbound) | **Later** | ✅ | ❌ | ~ | ❌ | ❌ |
| RSS auto-post | **No** | ✅ | ❌ | ~ (scrape) | ❌ | ❌ |
| Link shortening | via **links** svc | ✅ | ❌ | ❌ | ❌ | ❌ |
| Paid ads / boosting | **No** (out of scope) | ✅ (FB) | ❌ | ❌ | ✅ (multi-network) | ❌ |
| Connection auth — **BYO** app keys / OAuth, vaulted | **MVP** (BYO) | ~ (managed; BYO opt.) | — | — | — | — |
| Multi-tenant / white-label (per-account profiles) | **MVP** | ✅ | ✅ | ~ | ❌ | ~ |
| Profiles-per-network quota (plan entitlement) | **MVP** | plan-tier | — | — | — | — |
| Public developer API / MCP | internal svc | ✅ | ✅ | ✅ | ✅ | ✅ |

**Reading of the landscape:**
* **Ayrshare & Zernio** are the closest to our *full* surface (publish + inbound comments/DMs + analytics),
  and **Zernio** is the only comparable with **first-class multi-network ads** (we defer ads). Both are
  developer APIs — same abstraction we're building, which validates the native-adapter interface.
* **Upload-Post** is a lean publish/analytics API (comments/DMs via MCP), **no AI authoring, no webhooks**.
* **Blotato** is **AI-authoring-first** (viral-post generation) with publishing bolted on — the opposite
  emphasis from us (we *defer* AI compose; inbound/approval/compliance are our differentiators).
* **Post Bridge** is a low-cost creator scheduler — publish + schedule, thin on inbound/analytics/ads.
* **Our differentiators** (rare across this set): **reviews** ingestion, a **unified inbox with
  keyword tagging + sentiment**, an **approval workflow**, **BYO-vaulted per-account credentials**, and
  **plan-based profile quotas** — none of the pure API products offer the inbox/approval/governance layer.
* **Our deliberate gaps** vs the field: **AI content generation** (Blotato/Ayrshare have it — we defer),
  **paid ads** (Ayrshare/Zernio — out of scope), and **RSS auto-post** (Ayrshare — deferred).

# Content & rendition

* **Per-platform renditions** of one Post — X trimmed to 280, IG caption + hashtags + first-comment,
  TikTok video + cover, LinkedIn long-form — authored/derived per target, with a **preview per platform**.
* **Post format is part of the rendition** — a target may be a **feed post**, an **ephemeral Story**
  (IG / FB), or **short-form video** (Instagram **Reels** / TikTok / YouTube **Shorts** / Snapchat
  **Spotlight**); each has its own media specs + required fields. The rendition picks the format per
  platform (feed = default; Story / short-form when chosen **and** the platform supports it). *(Reference:
  Ayrshare exposes Reels / Stories / Spotlight as post types.)*
* **Media** comes from the **media** service (hosted URLs / uploads the platforms require); video specs
  (TikTok/Reels) validated before publish.
* **Hashtags / mentions / links** handled per platform (e.g. link unfurling vs link-in-bio).

# Per-platform media specs (reference)

Per-platform media constraints + metadata fields — the inputs the **[media](../media/SPECS.md)** service
must validate / transcode against and the **rendition** layer must supply. One table per platform (Phase 1
then Phase 2).

> **⚠ Verify every value at build time.** Platform limits change often + differ by post type / API tier /
> account level; the numbers below are the *as-designed* targets, not a contract. `≈` = approximate.
> Treat these as the **defaults the media pipeline codes to**, overridable per adapter.

## Quick-scan matrix
The hard limits at a glance (details in the per-platform tables below) — **platforms across the top,
attributes down the side**.

| Attribute | Facebook | Instagram | X / Twitter | TikTok | LinkedIn | Reddit | Pinterest | YouTube | Snapchat | Threads |
|---|---|---|---|---|---|---|---|---|---|---|
| **Image max** | 30 MB | 8 MB | 5 MB (GIF 15) | photo mode | 10 MB | 20 MB | 20 MB | thumb ≤ 2 MB | — | ≈8 MB |
| **Video max size** | 10 GB | ≈1 GB | 512 MB | 4 GB | 5 GB | 1 GB | 2 GB | 256 GB | ≈1 GB | — |
| **Video max length** | 240 min · Reel 90 s | Reel 90 s · Story 15 s | 140 s (Premium+) | 10 min | 30 min | 15 min | 15 min | 12 h · Short ≤ 3 min | Spotlight 60 s | 5 min |
| **Aspect(s)** | 1.91:1 · 1:1 · 4:5 · 9:16 | 4:5–1.91:1 · **9:16** | 16:9 · 1:1 | **9:16** (1:1,16:9) | 1.91:1 · 1:1 · portrait | flexible | **2:3** · 9:16 · 1:1 | 16:9 · **9:16** | **9:16** (mandatory) | portrait · landscape · square |
| **Text limit** | 63,206 | 2,200 | **280** | ≈2,200 | 3,000 | 40,000 body | 500 desc | 5,000 desc | limited | 500 |
| **Title** | — | — | — | — | article | **req** ≤ 300 | ≤ 100 | **req** ≤ 100 | — | — |
| **Tags / hashtags** | hashtags | ≤ 30 | hashtags | in caption | hashtags | n/a | keywords / alt | tags ≤ 500 | topics | 1 tag |

## Facebook — Page (Meta Graph)
| Attribute | Spec |
|---|---|
| Post types | Feed (text/link/photo/video), Reel |
| Image formats | JPG, PNG (GIF) |
| Image size | ≤ 30 MB; min 600×315; recommended 1200×630 (link) / 1080×1080 (square) |
| Image aspect | 1.91:1 (link), 1:1, up to 4:5 |
| Video formats | MP4, MOV (H.264 + AAC) |
| Video size / length | ≤ 10 GB / ≤ 240 min feed; **Reel** ≤ 90 s |
| Video dims / aspect | ≥ 1280×720; feed 4:5–16:9, **Reel 9:16** |
| Thumbnail / cover | Custom video cover / Reel cover |
| Text (caption) | ≤ 63,206 (practical: short) |
| Title | n/a (link title from Open Graph) |
| Hashtags / mentions | supported (no hard cap) |
| Link / SEO | link preview from **Open Graph** (`og:title/description/image`) |

## Instagram — Business/Creator (Meta Graph)
| Attribute | Spec |
|---|---|
| Post types | Feed (image/carousel/video), **Reel**, **Story** |
| Image formats | JPG, PNG |
| Image size | ≤ 8 MB; width 320–1440 (recommend 1080w) |
| Image aspect | feed 1.91:1–4:5 (1:1 common); Reel/Story **9:16** |
| Video formats | MP4, MOV |
| Video size / length | feed ≈ 100 MB–1 GB; **Reel** ≤ 90 s; **Story** 15 s/segment |
| Video dims / aspect | 1080×1920 (Reel/Story 9:16); feed 4:5–1.91:1 |
| Thumbnail / cover | Reel cover image |
| Text (caption) | ≤ 2,200 |
| Hashtags / mentions | ≤ 30 hashtags |
| Link / SEO | no clickable caption links (link-in-bio); carousel ≤ 10 items |
| Notable | 2-step **container → publish**; media must be a **hosted URL** |

## X / Twitter (API v2)
| Attribute | Spec |
|---|---|
| Post types | Post (text + up to 4 images / 1 video / GIF) |
| Image formats | JPG, PNG, WEBP, GIF |
| Image size | photo ≤ 5 MB, GIF ≤ 15 MB; ≤ 4096×4096 |
| Image aspect | 16:9, 1:1 (recommend 1600×900) |
| Video formats | MP4, MOV (H.264 + AAC) |
| Video size / length | ≤ 512 MB / ≤ 140 s (Premium: longer, up to hours) |
| Video dims / aspect | 32×32–1920×1200; 16:9 or 1:1 (range 1:3–3:1) |
| Thumbnail | auto or custom |
| Text | **280 chars** (Premium ≈ 25,000) |
| Hashtags / mentions | supported |
| Link / SEO | `t.co` wrap; **Twitter Card** meta on the destination |

## TikTok (Content Posting API)
| Attribute | Spec |
|---|---|
| Post types | Video; **Photo mode** (carousel) |
| Video formats | MP4, MOV, WEBM |
| Video size / length | ≤ 4 GB / 3 s–10 min |
| Video dims / aspect | ≥ 720×1280; **9:16** (also 1:1, 16:9) |
| Cover / thumbnail | selectable cover frame |
| Image (photo mode) | JPG, WEBP |
| Text (caption) | ≈ 2,200 |
| Title | n/a |
| Hashtags / mentions | in caption |
| Link / SEO | none in-post |
| Notable | app **audit** required for direct publish; strict video specs |

## LinkedIn — Organization page
| Attribute | Spec |
|---|---|
| Post types | Post (text/link/image/video), Article, Document |
| Image formats | JPG, PNG, GIF |
| Image size | ≤ 10 MB; recommend 1200×627 (link) / 1200×1200 |
| Image aspect | 1.91:1, 1:1 |
| Video formats | MP4 (H.264 + AAC) |
| Video size / length | 75 KB–5 GB / 3 s–30 min |
| Video dims / aspect | 256×144–4096×2304; portrait–landscape (1:2.4–2.4:1) |
| Text | ≤ 3,000 (post); Article longer |
| Title | Article title |
| Hashtags / mentions | supported |
| Link / SEO | link preview from **Open Graph** |
| Notable | org-admin OAuth scopes |

## Reddit
| Attribute | Spec |
|---|---|
| Post types | Text (self), Link, Image, Video, Gallery |
| Image formats | JPG, PNG, GIF |
| Image size | ≤ 20 MB |
| Video formats | MP4, MOV |
| Video size / length | ≤ 1 GB / ≤ 15 min |
| Aspect | flexible |
| **Title** | **required**, ≤ 300 chars |
| Body | ≤ 40,000 chars (self post) |
| Target | **subreddit required**; **flair** often required (per-sub rules) |
| Hashtags | n/a (not used) |
| Link / SEO | link posts; per-subreddit content rules |

## Pinterest
| Attribute | Spec |
|---|---|
| Post types | Pin (image / video) |
| Image formats | JPG, PNG, WEBP |
| Image size / aspect | ≤ 20 MB; **2:3** recommended (1000×1500); also 1:1, 9:16 |
| Video formats | MP4, MOV, M4V |
| Video size / length | ≤ 2 GB / 4 s–15 min |
| Video aspect | 2:3, 9:16, 1:1 |
| **Title** | ≤ 100 chars |
| **Description** | ≤ 500 chars |
| Target | **board required** |
| Link / SEO | destination URL + **keywords / alt text** — Pinterest is a **visual search engine** (SEO-heavy) |

## YouTube (Data API)
| Attribute | Spec |
|---|---|
| Post types | Video, **Short** |
| Video formats | MP4, MOV, AVI, WMV, FLV, WEBM |
| Video size / length | ≤ 256 GB or 12 h; **Short** ≤ 3 min, **9:16** |
| Video dims / aspect | up to 4K/8K; 1920×1080 (16:9) standard; Short 1080×1920 |
| **Thumbnail** | JPG/PNG, ≤ 2 MB, **1280×720** (16:9), min 640w |
| **Title** | **required**, ≤ 100 chars |
| **Description** | ≤ 5,000 chars |
| **Tags** | ≤ 500 chars total |
| SEO | title / description / tags / captions **drive discovery**; category, chapters |
| Notable | visibility (public/unlisted/private), made-for-kids flag |

## Snapchat (Marketing / Creative API)
| Attribute | Spec |
|---|---|
| Post types | Spotlight, Story, Ad creative |
| Image formats | JPG, PNG |
| Video formats | MP4, MOV (H.264) |
| Aspect | **9:16 (1080×1920) mandatory** — vertical, with safe zones |
| Video size / length | ≈ ≤ 1 GB; Spotlight ≤ 60 s |
| Caption / text | limited overlay text |
| Tags / topics | topics / hashtags for Spotlight discovery |
| Notable | vertical-only; **safe-zone** margins for UI; API-gated |

## Threads (Meta / Threads API)
| Attribute | Spec |
|---|---|
| Post types | Text, Image, Video, Carousel |
| Image formats | JPG, PNG |
| Image size | ≈ ≤ 8 MB (IG-like) |
| Video formats | MP4, MOV |
| Video length | ≤ 5 min |
| Aspect | portrait / landscape / square |
| Text | ≤ 500 chars |
| Hashtags | **one tag** per post (tag feature) |
| Link / SEO | links allowed |
| Notable | carousel ≤ 10 media |

## What this implies for the media service (no spec change — just the drivers)
The tables above define what **[media](../media/SPECS.md)** must be able to do so `social` can hand each
adapter a compliant asset:
* **Validate** on ingest + before publish — container/codec, byte size, dimensions, aspect ratio, duration
  against the *target* platform+format (reject early with a clear error, not a provider failure).
* **Transcode / re-encode** to each platform's codec (H.264/AAC MP4 is the safe common target) and
  **resize / crop / pad** to the required aspect (feed 4:5–1.91:1, story/short **9:16**, Pinterest **2:3**).
* **Thumbnail / cover generation** — pick or generate a cover frame (YouTube 1280×720, Reel/TikTok covers).
* **Hosted-URL delivery** — several APIs (IG, TikTok) fetch media by **public URL**, not upload → media
  must expose a stable, time-boxed hosted URL.
* **Metadata fields** carried alongside the asset/rendition — **title** (YouTube/Pinterest/Reddit),
  **description**, **tags/keywords + alt text** (YouTube/Pinterest SEO), and per-platform **text limits**.
* **Safe-zone / aspect awareness** for vertical formats (Snapchat/Stories) so overlays/crops don't clip.

# Scheduling & throughput

* **Schedule** a post for a future time (per timezone) via **EventBridge Scheduler**.
* **Best-time recommendation** — *when per-provider best-time data is available* (a provider's audience-insights
  API, or derived from our own engagement history per account × platform), surface it as a **scheduling
  recommendation** — the user still picks the time, we just suggest. No data → no recommendation (don't guess).
* **Rate limits + retries** per platform are **dispatch**'s job (each platform's quota differs widely);
  a failed publish surfaces as a `Type.Result` error + a failed-status event, not a throw.

# Approval workflow (optional, per account)

Pre-publish review — **off by default, configurable per account**. The account sets **how many approvals**
a post needs before it can publish; **0 = publish directly** (today's flow), **N ≥ 1** routes every post through
review. The **status chain changes** when approval is required:

```
 approvalsRequired = 0:   draft ─────────────────────────────► scheduled / published
 approvalsRequired = N:   draft ─submit─► pending_review ─(N approvals)─► approved ─► scheduled / published
                                               ▲   │
                                               └───┘  reject / changes-requested → back to draft (with comments)
```

* **0–N approvals** — required count is **account config**; snapshot onto the Post at submit (so changing the
  policy later doesn't retro-alter in-flight posts). It reaches `approved` once **N distinct approvals** land.
* **Approvals recorded** — each approve / reject carries **who + when** (+ the decision); a reject sends it back
  to `draft` for revision.
* **Review comments** — other users can **comment** on a post under review (a review thread); each comment is
  **flaggable resolved** (who + when) so authors can track what's been addressed.
* **Audit trail** — an **append-only** log of every action (submit / approve / reject / comment / resolve /
  schedule / publish) with **actor + timestamp** — the record of who did what, when.

Publishing is **gated on `approved`** when `approvalsRequired ≥ 1` — a post can't be scheduled / published
straight from `draft` if the account requires review.

# Inbound (comments · mentions · DMs)

Inbound is **uneven and platform-specific** — ingested via each platform's **webhooks** (preferred) with
**polling** as a reconciliation fallback:

* **Comments / mentions / reactions** — public, 1:many → normalized → **unified inbox** (moderation +
  routing) + analytics. Not a private thread.
* **DMs** (Messenger, Instagram DM) — 1:1 but bound by a platform **reply window** (e.g. 24h); closer to
  a conversation. Identity is a **platform-scoped id/handle**, which **rarely maps to a known contact**.
  *(DM **auto-responders** + read-receipt / reaction sync are **deferred** — v1 DMs are human-handled in
  the inbox within the reply window.)*
* **Reviews** (Google Business Profile, Facebook ratings) — a **distinct inbound type** (`review`) with a
  **reply-to-review** response; ingested + normalized like comments but carry a rating. **Ships with the
  networks that have reviews** (e.g. GBP — a later-phase network), not in the Phase-1 set.
* Goes through the platform's **incoming-webhook intake → SQS → worker** (same fair-share pattern as the
  other channels), normalized to the analytics event schema (channel-specific attrs).

## Engagement freshness — webhook-first, poll where required

**Policy:** if a provider offers a **webhook**, use it (real-time, no quota burn). If a surface is
**pull-only**, poll it on a **per-account configurable schedule** + offer an **on-demand "Refresh" button** (so a
user can force a pull without waiting for the next cycle). Polling burns rate limit — keep cadence conservative
and let dispatch pace it.

* **Configurable poll schedule** — per account: a **window** (e.g. work hours) + a **cadence** (~hourly default).
  Outside the window / between cycles, no automatic pull.
* **BYO credentials → the account owns the cost + limits.** Pulls run under the **account's own provider keys**;
  if their tier rate-limits or paywalls a pull, that's **their** constraint — we **surface the error / limit**
  back to them (alert), we don't pay around it.
* **On-demand "Refresh" — abuse-guarded.** A pull is **asynchronous** (fetch + normalize + tag takes time), so
  the button is **locked while a pull is in flight** — *the next manual pull cannot start until the prior one has
  finished processing* — **plus a configurable cooldown** after completion to slow mashing. A click while
  locked / cooling down is **rejected** (returns the current state + when it'll be available), not queued.

**Delivery method by provider** — *which surfaces push (webhook) vs require a pull.* **Provider APIs change
often (especially X's access tiers) — verify per provider at build time;** this is the as-designed intent:

| Provider | Comments / mentions | DMs | Notable limits |
|---|---|---|---|
| **Facebook (Page)** | **Webhook** (`feed` — comments, mentions) | **Webhook** (Messenger) | App review / advanced access; page subscription; **24h** messaging window |
| **Instagram (Business)** | **Webhook** (`comments`, `mentions`) | **Webhook** (IG messaging via Messenger API) | Business/Creator acct + linked FB Page; app review; **24h** messaging window |
| **X / Twitter (v2)** | **Pull** (or **paid** filtered-stream for mentions) | **Pull** (Account Activity is legacy; v2 DM polling) | Tier **pricing/cost**; tight rate limits; real-time = paid product |
| **TikTok** | **Pull** (comment API access **restricted**) | **n/a** (no general business DM API) | Heavy app review; limited comment access; no public DM messaging |
| **LinkedIn (org)** | **Pull** (social-actions APIs) | **Restricted** (partner/Sales-Nav only) | Partner program for deeper access; polling model; strict rate limits |

> **Takeaway:** **Meta (FB + IG) is fully webhook-driven** for both comments and DMs; **X / TikTok / LinkedIn
> are poll-driven** (with X's real-time being a separate paid product, and TikTok/LinkedIn DMs largely
> unavailable). So the **per-account poll cadence + on-demand Refresh** matter most for X / TikTok / LinkedIn.

**Consent on inbound — narrow, platform-scoped, time-bound.** When someone comments on / DMs the brand, the
implicit permission (via **platform ToS** + the act of engaging) covers **being seen and replied to, on that
platform, in that thread** — and the platforms enforce the scope (DM **reply windows**, e.g. 24h). It is **NOT**:
* **TCPA / cross-channel consent** — a Facebook comment is never consent to SMS/email them; promoting an inbound
  author to a messageable **contact requires a separate, explicit opt-in**.
* **A basis to merge** the platform-scoped handle into contact records / marketing audiences — keep it
  **separate** from contacts unless an explicit opt-in links them (it "rarely maps to a known contact" anyway).

Lawful basis for *responding in-context* = legitimate interest / the platform contract; storing + profiling +
repurposing needs its own basis, and **right-to-erasure (GDPR Art 17) applies regardless.**

## Inbox: triage, tagging & sentiment

The inbox is a real triage surface (the **UX is [web](../web/SPECS.md)**; social **persists + serves** the
inbound slice + enrichment). **DMs ship first**, then comments/mentions.

* **Persisted & queryable** — normalized inbound is stored (DynamoDB) so the inbox can **filter** by **type**
  (DM / comment / mention / reaction), **provider**, **time window**, and **tag**. *(This revises the earlier
  "not stored as state here" stance — a filterable/taggable inbox needs persistence.)*
**Two layers — cheap-per-item (keyword) + on-demand AI (batch).** Never AI every comment.

* **Per-item tagging — keyword only, real-time, on every item.** Floor = a binary **`bad` / `!bad`** (`!bad` =
  good / neutral) from a wordlist; richer **`good` · `rude` + account-defined** tags layer on the same keyword
  engine as wordlists exist. **Account-configurable keyword→tag map**, **manually overridable** in the inbox.
  Deterministic + cheap — **no model calls.** *(Wordlists are per-locale — the `bad` list needs localization for
  multi-market accounts.)*
* **Per-item sentiment = that keyword signal** (`bad` / `!bad`) — **no AI per item.** This is what feeds the
  trend below.
* **Sentiment trend over time** *(analytics)* — trending across **one or more campaigns**, computed from the
  **cheap keyword score** (no per-item AI) — an **[analytics](../analytics/SPECS.md)** time-series read.
* **AI campaign-feedback summary — on-demand, batched, user-triggered.** A **"Summarize" button** runs a
  campaign's inbound corpus through a model **once, when asked** (not a per-comment stream) → overall
  summary / sentiment + **recommendations to improve messaging**. **Owned by analytics / AI.** Cost controls:
  **async job** (submit → result, like a report), **map-reduce** for large corpora (chunk → partial → reduce,
  cap/sample with a visible "summarized N of M"), and **cache** keyed by `(campaign, window, corpus-hash)` so an
  unchanged corpus returns the prior summary instead of paying again.

## Forget / erasure of inbound PII

**Don't design around providers sending forget requests — they mostly don't.** A commenter / DM-sender never
authorized *our* app, so there's no per-end-user erasure signal from **X / TikTok / LinkedIn**. **Meta** has a
**Data Deletion Request callback**, but it's scoped to **app-authorized users** (Facebook-Login / app authorizers
— the account owner connecting their Page), **not arbitrary commenters**. So erasure rests on **our** mechanisms,
not theirs:

1. **Honor source deletions** — a deleted comment / account drops out via the **webhook delete event** (Meta) or
   **reconcile-on-poll** (X / TikTok / LinkedIn — an item gone at source is removed on the next pull). *(primary)*
2. **Retention TTL on inbound** — `InboundItem` carries a **TTL** (DynamoDB per-item); inbound is **not kept
   forever**, which bounds exposure and meets platform-ToS retention limits — independent of any external signal.
3. **`social-forget` responder** — on **our** contact / user forget (SQS, consistent with auth/contact),
   **best-effort** obfuscate matching inbound (the platform handle rarely maps to a known contact).
4. **Meta data-deletion callback** — implemented (Platform-Terms obligation for app users); routed into the same
   delete path.

# Events to analytics

Publish + engagement emit normalized events (`sent`/`published`, plus channel-specific
`impression`/`like`/`share`/`comment`/`click`) keyed by account + campaign — but **attribution is at the
campaign/audience level**, not per-contact: social posts are anonymous broadcast (see analytics
"Attribution" → identity caveat).

Beyond per-post engagement, **account-level metrics** — **follower count + audience demographics /
insights** per connected account — are pulled on the poll cadence and emitted as **account-scoped**
analytics (distinct from campaign attribution; the profile's audience, not any contact).

# Data model (sketch)

```
ConnectedAccount  pk=ACCOUNT#<id>  sk=SOCIAL#<platform>#<connectionId>   // multiple per platform (plan quota)
  { platform, handle, marketplaceConnectionId (BYO keys/OAuth in the vault), scopes, status,
    pull: { window?, cadence, cooldownSeconds,           // per-account poll schedule + refresh cooldown
            lastPullAt?, status: idle|in_flight,         // in_flight => manual Refresh is locked
            cooldownUntil?, lastError? } }                // lastError surfaced to the account (alert)

Post              pk=ACCOUNT#<id>  sk=POST#<postId>
  { body, mediaKeys[], targets[: { platform, connectionId, rendition }], scheduleAt,
    status: draft|pending_review|approved|scheduled|published|failed,   // review states only when approvalsRequired>=1
    approvalsRequired,                                   // snapshot of account policy at submit
    approvals[: { by, at, decision: approve|reject }] }  // who + when; N approvals => approved

ReviewComment     pk=ACCOUNT#<id>  sk=POST#<postId>#RC#<commentId>
  { by, at, text, resolved?: { by, at } }                // review-thread comment; flag resolved (who + when)

ReviewAudit       pk=ACCOUNT#<id>  sk=POST#<postId>#AUD#<seq>
  { action: submit|approve|reject|comment|resolve|schedule|publish, by, at, detail? }  // append-only trail

PublishedPost     pk=ACCOUNT#<id>  sk=PUB#<postId>#<platform>
  { platformPostId, status: published|failed, error?, publishedAt }
  // engagement snapshots stream to analytics (not stored as state here)

InboundItem       pk=ACCOUNT#<id>  sk=INBOX#<receivedAt>#<itemId>
  { type: dm|comment|mention|reaction|review, platform, authorHandle (platform-scoped),
    text, rating?,                                       // rating present when type=review (GBP/FB)
    campaignId?, publishedPostId?, replyWindowExpiresAt?,
    tags[: good|bad|rude|…], sentiment, status: open|handled,
    receivedAt, ttl }                                    // DynamoDB per-item TTL — inbound not kept forever
  // persisted to back the inbox filters/tagging; also emitted (tagged+scored) to analytics
  // erasure: source-delete (webhook/reconcile) · TTL · best-effort social-forget · Meta data-deletion callback
```

# Service & Job topology

**Convention (platform-wide).** Each service layers **framework base → domain base → concrete role**. A **domain
Service base** (`SocialService extends Service`) and a **domain Job base** (`SocialJob extends Job`) hold the
**shared domain code** — the **connection** model, the **provider adapter factory** (Meta / X / TikTok /
LinkedIn), **publish-compose / rendition**, the **inbox + keyword-tagging + sentiment** logic, the
**OAuth-token read** (from [marketplace](../marketplace/SPECS.md)'s vault — tokens are **not** stored here), and
**analytics emit** — so every concrete role inherits it. Social's distinctive trait: **inbound is asymmetric** —
**Meta pushes via webhook**, **X / TikTok / LinkedIn must be polled** — so it needs both a webhook ingress and a
poll job.

```
Application
├── Service (Fastify, long-running — ECS)
│     └── SocialService           (domain base — connection model · provider adapter factory · publish-compose/rendition · inbox + keyword-tag + sentiment · OAuth-token read (marketplace vault) · analytics emit · audit; not deployed alone)
│           ├── SocialMainService  (the /social/* API: connections · post compose/CRUD · scheduling · INBOX (DMs/comments/mentions · filters · tags) · approval workflow · AI-summary trigger (→ analytics) · config/health)
│           └── SocialWebhookService (provider INBOUND webhook intake (Meta) — webhook-sig verified, ACK-fast → enqueue; provider-facing, scales apart)
└── Job (Lambda, event-driven)
      └── SocialJob                (domain base — provider adapter factory · normalize · retry/DLQ · idempotency)
            ├── SocialPublishWorker (SQS — provider-AGNOSTIC publish: dispatch by platform · container→publish (Meta 2-step) · rate-pace (dispatch) · write PublishedPost · emit; retry/DLQ)
            ├── SocialInboundJob    (SQS from webhook intake — normalize comments/mentions/DMs → inbox · keyword tag (good/bad/rude) · sentiment score · emit)
            ├── SocialPollJob       (EventBridge + on-demand — poll providers WITHOUT webhooks (X/TikTok/LinkedIn) for inbound/engagement; in-flight lock + cooldown on on-demand refresh)
            └── SocialScheduleJob   (EventBridge — fire scheduled posts at target time → enqueue to the publish worker)
```

**Services (HTTP, ECS Fargate)**

| Class | Extends | Role |
|---|---|---|
| **`SocialService`** | `Service` | **Domain base** — connection model · provider adapter factory · publish-compose/rendition · inbox + keyword-tag + sentiment · OAuth-token read (marketplace vault) · analytics emit · audit; **not deployed alone**. |
| **`SocialMainService`** | `SocialService` | The **`/social/*` API** — **connections**, post **compose / CRUD**, **scheduling**, the **inbox** (DMs / comments / mentions · filters · **tags**), **approval workflow**, **AI-summary trigger** (delegated to [analytics](../analytics/SPECS.md)), config/health. |
| **`SocialWebhookService`** | `SocialService` | Provider **inbound webhook intake** (Meta) — **webhook-sig verified, ACK-fast → enqueue**; provider-facing, **scales apart** from the user API. *(Only the webhook providers; pollers go through `SocialPollJob`.)* |

**Jobs (Lambda, event-driven)** — each extends `SocialJob`:

| Class | Trigger | Role | Req |
|---|---|---|---|
| **`SocialPublishWorker`** | SQS | **Provider-agnostic publish** — dispatch by platform via the adapter, run the **container→publish** (Meta 2-step), **rate-pace** via [dispatch](../../../packages/services/DISPATCH.md), write `PublishedPost`, emit; retry / DLQ | social-2.0 |
| **`SocialInboundJob`** | SQS (from webhook intake / poll) | Normalize **comments / mentions / DMs** → inbox; **keyword tag** (good / bad / rude); **sentiment** score; emit → analytics | social-4.0 |
| **`SocialPollJob`** | EventBridge + on-demand | **Poll** providers without webhooks (**X / TikTok / LinkedIn**) for inbound / engagement; **in-flight lock + cooldown** guards the on-demand refresh button from abuse | social-4.0 |
| **`SocialScheduleJob`** | EventBridge | Fire **scheduled posts** at their target time (per-timezone) → enqueue to `SocialPublishWorker` | social-3.0 |

> **Shared modules (not deployables).** The **provider adapter factory** (Meta / X / TikTok / LinkedIn —
> webhook-vs-poll capability per provider), **publish-compose / rendition**, the **inbox + keyword-tagging +
> sentiment** logic, and the **OAuth-token read** (from marketplace's vault — **never stored in social**) live on
> the bases and are reused across the services + jobs. **Inbound is asymmetric by provider** — `SocialWebhookService`
> handles push (Meta); `SocialPollJob` handles poll (the rest); both feed the same `SocialInboundJob` normalize +
> tag + sentiment pipeline. **AI summary is analytics-owned** — social only triggers it.

# AWS Services and Other Dependencies

**AWS services**
* **DynamoDB** — `ConnectedAccount` · `Post` · `PublishedPost` (account-scoped).
* **EventBridge Scheduler** — fire scheduled posts at their target time (per-timezone).
* **SQS** (+ DLQ) — publish workers + inbound-intake workers (same fair-share pattern as the other channels).
* **Kafka (MSK)** — emit normalized publish / engagement / inbound events to **analytics**.
* **API Gateway** (or service HTTP, **webhook-sig** verified) — public **inbound-webhook intake** per platform.
* **KMS** — encryption at rest. **OAuth tokens are NOT here** — they live in **marketplace**'s vault.

**Third-party libraries / services** (the native provider adapters)
* **Meta Graph API** — Facebook Page + Instagram Business (container→publish 2-step).
* **X API v2** · **TikTok Content Posting API** · **LinkedIn (org pages) API**.
* **Phase 2 (native):** **Reddit API** · **Pinterest API** · **YouTube Data API** · **Snapchat Marketing/Creative
  API** · **Threads API** — each a new adapter behind the same channel interface.
* **OAuth / token lifecycle** — delegated to **marketplace** (grant/arctic + vault, refresh).
* **Reference only (NOT a dependency):** **[Ayrshare](https://www.ayrshare.com)** — a mature social API used as a
  **capability benchmark**; we implement the equivalent natively.

**Internal (`@repo/*`)**
* `@repo/services` (Dynamo, Sqs, Kafka, Scheduler, Kms, Cache), `@repo/endpoint` (`Access`), `@repo/common` (`Type`).
* **[marketplace](../marketplace/SPECS.md)** — per-account connection + vaulted OAuth tokens (the SoT for auth).
* **[dispatch](../../../packages/services/DISPATCH.md)** — per-platform rate-limit pacing / retry / backoff.
* **[media](../media/SPECS.md)** — hosted assets (the platforms' hosted-URL / upload flows).
* **[analytics](../analytics/SPECS.md)** — consumes the normalized events (campaign/audience-level attribution).
* **workflow / campaign** — drives the `publish` node (S2S).

# Compliance & standards mapping

How **this social channel's** controls map to **OWASP Top 10 (2021)**, **ISO/IEC 27001:2022** (Annex A),
**SOC 2 Type 2** (TSC), **HIPAA** (if PHI), **GDPR**, and **CCPA/CPRA**. Social is **1:many broadcast** — there
is **no per-recipient consent / TCPA surface** (you publish *as the brand to followers*); the governing consent
is **platform ToS + content policy**. Dominant controls are **delegated OAuth (tokens vaulted in marketplace,
never here)**, **inbound-webhook authenticity**, and **tenant isolation**. **No PCI** (paid ads / billing is a
separate, out-of-scope surface). **HIPAA** is ➖ (no PHI by [AUP](../account/specs/SPECS.md)). Inbound carries
some PII (comment/DM author handles, message text) — mostly **forwarded, not retained as state here**.

**Legend:** ✅ meets/exceeds · ⚠️ partial / open — see Gaps · ➖ n/a

| Social control | OWASP T10 | ISO 27001:2022 | SOC 2 (TSC) | HIPAA (if PHI) | GDPR | CCPA | |
|---|---|---|---|---|---|---|---|
| **BYO credentials, vaulted** — account supplies its **own** provider keys/OAuth; live in **marketplace**'s vault; social references, never stores secrets; account owns the provider **tier / limits** | A02 / A07 | A.5.17 / A.8.24 | CC6.1 | ➖ | Art 32 | ➖ | ✅ |
| **Tenant isolation** — `ConnectedAccount` / `Post` / `PublishedPost` are account-scoped; a connection / post never crosses accounts | A01 | A.8.3 | CC6.1 | ➖ | Art 32 | §1798.100 | ✅ |
| **Inbound-webhook authenticity** — every platform webhook is **signature-verified** (Meta / X / TikTok / LinkedIn) before intake | A08 | A.8.26 | CC6.1 / CC7.1 | ➖ | Art 32 | ➖ | ✅ |
| **Publish audit** — who published what, as which brand, when (+ platform post id) | A09 | A.8.15 | CC7.2 | ➖ | Art 30 | ➖ | ✅ |
| **Inbound PII** — comment/DM author + text; erasure via **source-delete (webhook/reconcile) + retention TTL + best-effort social-forget + Meta deletion callback** (providers don't push per-commenter forgets) | A02 / A04 | A.8.10 | (Privacy) | ➖ | Art 17 / 32 | §1798.105 | ✅ |
| **Inbound consent scope** — engaging implies **on-platform, in-thread** reply permission only (platform ToS + reply window); **not** TCPA / cross-channel; no auto-merge to contacts without explicit opt-in | ➖ | A.5.34 | (Privacy) | ➖ | Art 6 / 17 | §1798.100 | ✅ by design |
| **Platform ToS & content policy** — publish honors each platform's policy, content + rate rules (pacing via dispatch) | A05 | A.5.34 | (Privacy) | ➖ | Art 6 | ➖ | ✅ |
| **Encryption** — DynamoDB at rest (KMS) + TLS in transit (provider + webhook) | A02 | A.8.24 | CC6.1 | §164.312(e) | Art 32 | ➖ | ✅ |
| **No PHI** by AUP — channel carries no PHI | ➖ | A.5.34 | (Privacy) | §164.502 (AUP) | Art 9 | ➖ | ✅ |
| **No per-recipient consent** — broadcast to followers; consent = platform ToS, **not TCPA** | ➖ | A.5.34 | ➖ | ➖ | Art 6 | ➖ | ✅ by design |

> **Design-intent mapping** — how the channel is *intended* to satisfy each control, not an attestation. The
> system of record for identity/RBAC is [auth](../auth/specs/SPECS.md); for connection auth, [marketplace](../marketplace/SPECS.md).

# Gaps & open decisions

*The one review list.* ✅ = resolved/decided · ⚠️ = **open — needs attention**.

1. ✅ **Paid ads — DECIDED: out of scope (v1).** Boosting / lead-gen / Custom Audiences is a **distinct paid
   surface** with its own model + billing. Organic `publish` only. (See *Out of scope*.)
2. ✅ **Webhooks-first + poll reconcile — DECIDED (pattern).** Inbound is ingested via each platform's
   **webhooks (preferred)** with **polling as a reconciliation fallback** — same shape as
   [registration](../registration/SPECS.md). *(Remaining detail: the per-platform support matrix + poll cadence
   — an adapter impl detail, not an architecture question.)*
3. ✅ **Inbox depth — DECIDED: DMs first.** Then comments / mentions. Social **persists** normalized inbound
   (DynamoDB) so the inbox (UX = **web**) can **filter** by type (DM / comment / mention / reaction), provider,
   time window, and tag; items are **keyword-tagged** (`good` / `bad` / `rude` + account-defined, manually
   overridable) and carry a **sentiment** classification — `social-4.5/4.6/4.7`.
4. ✅ **Best-time-to-post — DECIDED: recommendation when data exists.** Explicit `scheduleAt` is v1; *when*
   per-provider best-time data is available (provider insights or derived from our engagement history), surface
   it as a **scheduling recommendation** (user still chooses). No data → no guess — `social-3.3`.
5. ✅ **Engagement freshness — DECIDED: webhook-first, poll where required.** Use webhooks where a provider
   offers them; **pull-only** surfaces poll on a **per-account schedule** (**window**, e.g. work hours +
   **cadence** ~hourly) + an **on-demand "Refresh"** button. The Refresh button is **abuse-guarded**: a pull is
   async, so it's **locked while in flight** (no new manual pull until the prior finishes processing) + a
   **configurable cooldown**; a click while locked is **rejected with current state**, not queued — `social-4.8/4.9`.
   See the **delivery-by-provider table** (Meta = webhook; X / TikTok / LinkedIn = pull).
10. ✅ **Provider credentials — DECIDED: BYO, account owns cost/limits.** Each account supplies its **own**
    provider app keys / OAuth (vaulted in marketplace); **the account selects + pays for the provider tier** —
    any paywall / rate limit is **theirs**. We don't absorb cost; we **alert** them on provider error / limit —
    `social-1.4/1.5`.
6. ✅ **Approval workflow — DECIDED: configurable, per account.** **0–N required approvals** (0 = publish
   directly); `N ≥ 1` routes through `draft → pending_review → approved → scheduled/published` (reject → back to
   draft). Each approval is recorded (**who + when**); **review comments** by other users, each **flaggable
   resolved**; an **append-only audit trail** of every action. Publishing is **gated on `approved`** when review
   is required — `social-8.0`.
7. ✅ **Inbound PII / forget — DECIDED.** Social **retains** inbound (to back the inbox), so erasure rests on
   **our** mechanisms — **not** provider forget requests (providers mostly don't send them; Meta's deletion
   callback covers **app users**, not commenters). Paths: **(1)** honor source deletions (webhook delete /
   reconcile-on-poll), **(2)** a **retention TTL** on `InboundItem`, **(3)** a best-effort **`social-forget`**
   SQS responder on our contact/user forget, **(4)** implement **Meta's data-deletion callback** → same delete
   path. See *Forget / erasure of inbound PII* — `social-6.4`.
   *(✅ sub-decided: **inbound consent is platform/thread-scoped + time-bound** — never TCPA / cross-channel, and
   the platform handle is **not auto-merged** into contacts without an explicit opt-in — `social-6.7`. The
   remaining ⚠️ is purely the retain-vs-forward + forget-responder mechanics.)*
8. ✅ **AI summary — APPROACH DECIDED (build later).** **On-demand, batched, user-triggered** ("Summarize"
   button) — runs a campaign's corpus through a model **once when asked**, never per-comment. **Owned by
   [analytics](../analytics/SPECS.md) / AI.** Cost controls: **async job**, **map-reduce** for large corpora
   (cap/sample with a visible "N of M"), **cache** keyed by `(campaign, window, corpus-hash)`. *(Remaining: model
   choice + recommendation prompt — analytics' call.)*
9. ✅ **Sentiment trend — APPROACH DECIDED (build later).** Rides the **cheap keyword score** (`bad` / `!bad`),
   **no per-item AI**; an **analytics** time-series read across one or more campaigns. Social emits the per-item
   keyword score; analytics owns the windowing/aggregation.
11. ✅ **Native adapters vs aggregator — DECIDED: native.** We **implement** each network directly (its own API +
    OAuth; **BYO credentials vaulted in marketplace**, account owns the tier + cost — gap #10). A posting **aggregator
    (e.g. [Ayrshare](https://www.ayrshare.com)) is a reference benchmark only, not a dependency** — adopting one would
    centralize provider cost on the platform + hold the network tokens off-platform, which we avoid. — `social-10.1`
12. ✅ **Profiles-per-network quota — DECIDED: plan entitlement.** How many profiles of a network an account may
    connect is a **per-plan limit** (ideally `maxProfiles[network]` + optional overall cap), **owned by account**,
    **enforced by social at connect** (over-limit rejected with an upgrade hint); a downgrade keeps live connections
    but blocks new connects until under the cap — `social-11.4/11.5/11.6`.
13. ⚠ **Capability gap-check vs the Ayrshare reference — folded in.** Reviewing Ayrshare's API surface surfaced
    capabilities we hadn't modeled; decisions: **(a)** **post formats** (Story / short-form Reels/Shorts/Spotlight)
    are a **rendition axis** — `social-2.6` (C); **(b)** **reviews** (GBP / FB ratings) are a distinct inbound
    `review` type with reply — `social-4.10` (C, ships with those networks); **(c)** **account/audience analytics**
    (followers / demographics) — `social-5.5` (C); **(d)** **deferred** (Out of scope): **RSS auto-post**, **AI
    compose assist** (our AI is inbound-summary only), **post import / external history**, **DM auto-responders +
    read-receipt / reaction sync**. Ads already deferred (gap #1); URL shortening stays ours (links). *(Ayrshare is
    reference-only; each capability is implemented **natively** per platform — verify at build time.)*

# Requirements (traceable register)

The traceable requirement register for the **social channel** (the sections above are the rationale; this is
the coded list). IDs are stable handles (**`social-N.M`**) — cite them in code, tickets, and tests.
**Priority:** **A** = MVP, **B** = core / hardening, **C** = later. One level of sub-requirements; a group's
priority is its floor. **Boundaries:** social owns **publish mechanics + per-platform rendition + inbound
ingestion**; **marketplace** owns connection OAuth, **dispatch** owns pacing, **media** owns assets, **analytics**
owns attribution, **workflow/campaign** owns orchestration.

## social-1.0 Connections — A
- **social-1.1** **ConnectedAccount** per (account × platform × destination) — references the **marketplace** connection; tokens stay vaulted, never stored here — A
- **social-1.2** Connect / disconnect a destination (initiated here, **OAuth via marketplace**); track `status` (connected / expired / revoked) — A
- **social-1.3** Connection management is **ACCOUNT**-gated; expiry / revocation surfaces back from marketplace — A
- **social-1.4** **BYO credentials** — the account supplies its **own** provider app keys / OAuth (vaulted in marketplace); **the account owns the provider tier** — paywall / rate limit / paid stream is theirs to select + pay for *(gap #10)* — A
- **social-1.5** **Alert on provider error / limit** — surface a provider error / rate-limit / paywall back to the account (we don't absorb it); the connection's `lastError` is visible *(gap #10)* — A

## social-2.0 Publish — A
- **social-2.1** **`publish`** one Post to its targets — adapt content into each platform's **rendition** and post — A
- **social-2.2** **Per-platform rendition** — text limits (X ≤ 280), media specs, hashtags / mentions / link handling; **preview per platform** — A
- **social-2.3** **Provider adapters** behind the channel interface — Meta (FB Page + IG 2-step), X v2, TikTok, LinkedIn — A
- **social-2.4** A failed publish surfaces as a **`Type.Result` error + failed-status event** (not a throw); **pacing/retry is dispatch** — A
- **social-2.5** Media comes from **[media](../media/SPECS.md)** (hosted URLs / uploads); video specs (TikTok / Reels) **validated before publish** — A
- **social-2.6** **Post format is part of the rendition** — **feed** / **Story** (IG / FB) / **short-form video** (Reels / Shorts / Spotlight); selected per platform where supported, with its own media specs + required fields *(gap #13)* — C

## social-3.0 Scheduling — B
- **social-3.1** **Schedule** a post for a future time via **EventBridge Scheduler** (per-timezone) — B
- **social-3.2** Cancel / reschedule a scheduled post before it fires — B
- **social-3.3** **Best-time recommendation** — *when* per-provider best-time data exists (provider insights or our engagement history per account × platform), suggest a time; **user still chooses**; **no data → no guess** *(gap #4)* — C

## social-4.0 Inbound ingestion — B
- **social-4.1** **Webhooks-first + poll reconcile** per platform; **signature-verify** every inbound webhook *(gap #2)* — B
- **social-4.2** Normalize **comments / mentions / reactions** (public, 1:many) → unified inbox + analytics — B
- **social-4.3** Normalize **DMs** (1:1, bound by the platform **reply window**); identity = platform-scoped handle (**rarely maps to a known contact**) — B
- **social-4.4** Intake path = **webhook → SQS → worker** (fair-share), normalized to the analytics event schema — B
- **social-4.5** **Persist + serve inbound** (DynamoDB) for the inbox; **DMs first**, then comments/mentions; **filter** by type / provider / time window / tag *(gap #3)* — B
- **social-4.6** **Keyword tagging** — every item, real-time, **no AI**; floor = binary **`bad` / `!bad`** (`!bad` = good/neutral), richer **`good` · `rude` + account-defined** tags layered on; account-configurable keyword→tag map (**per-locale**) + **manual** override — B
- **social-4.7** **Per-item sentiment = the keyword signal** (`bad` / `!bad`); attached + emitted; **no per-item model calls** — this is what the trend reads — B
- **social-4.8** **Engagement freshness — webhook-first, poll where required** — use webhooks where offered; pull-only surfaces poll on a **per-account schedule** (window e.g. work hours + cadence ~hourly) + an **on-demand "Refresh"**; see the delivery-by-provider table (Meta = webhook; X / TikTok / LinkedIn = pull) *(gap #5)* — B
- **social-4.9** **Refresh abuse-guard** — manual pull is **async**; **locked while in flight** (no new pull until the prior finishes processing) + a **configurable cooldown**; a click while locked is **rejected with current state**, not queued *(gap #5)* — B
- **social-4.10** **Reviews** — ingest + **reply to** platform reviews (Google Business Profile / Facebook ratings) as a distinct inbound **`review`** type (carries a rating); ships **with the networks that have reviews** (later phase) *(gap #13)* — C

## social-5.0 Events to analytics — A
- **social-5.1** Emit normalized `published` + channel-specific `impression` / `like` / `share` / `comment` / `click` events, keyed by **account + campaign** — A
- **social-5.2** **Attribution is campaign/audience-level, not per-contact** — posts are anonymous broadcast — A
- **social-5.3** **Engagement freshness** — push (webhook) where available vs periodic pull *(gap #5)* — B
- **social-5.4** Emit **keyword-tagged + sentiment-scored** inbound so **[analytics](../analytics/SPECS.md) / AI** can build the **on-demand AI summary + recommendations** *(gap #8)* and the **keyword-driven sentiment trend** *(gap #9)* — social emits signal, analytics aggregates; **AI is on-demand/batch, never per-item** — C
- **social-5.5** **Account/audience analytics** — pull **follower count + audience demographics / insights** per connected account (poll cadence); emit **account-scoped** (not per-contact) *(gap #13)* — C

## social-6.0 Compliance & privacy — A
- **social-6.1** **Delegated OAuth** — tokens vaulted in **marketplace**, never stored here — A
- **social-6.2** **Tenant isolation** — connections / posts are account-scoped, never cross accounts — A
- **social-6.3** **Publish audit** — who published what, as which brand, when (+ platform post id) — A
- **social-6.4** **Inbound PII erasure** — social **retains** inbound (for the inbox); erasure rests on **our** mechanisms, **not** provider forget requests *(gap #7)* — B
  - **social-6.4.1** **Honor source deletions** — webhook delete event (Meta) / **reconcile-on-poll** (X / TikTok / LinkedIn) drops items gone at source — B
  - **social-6.4.2** **Retention TTL** on `InboundItem` (DynamoDB per-item) — inbound not kept forever; bounds exposure + meets platform-ToS retention — A
  - **social-6.4.3** **`social-forget` SQS responder** — on **our** contact/user forget, **best-effort** obfuscate matching inbound (handle rarely maps to a contact) — B
  - **social-6.4.4** **Meta data-deletion callback** — implement (Platform-Terms; app-users only) → routed into the same delete path — B
- **social-6.5** **No per-recipient consent / TCPA** — outbound publish consent = platform ToS + content policy — A
- **social-6.7** **Inbound consent is platform/thread-scoped + time-bound** — engaging implies on-platform reply permission only (reply window); **not** TCPA / cross-channel; the platform-scoped handle is **not auto-merged** into contacts / audiences without a **separate explicit opt-in**; erasure (Art 17) applies regardless — A
- **social-6.6** **No PHI** by [AUP](../account/specs/SPECS.md); encryption at rest (KMS) + TLS — A

## social-7.0 Architecture & infra — A
- **social-7.1** DynamoDB (ConnectedAccount / Post / PublishedPost / ReviewComment / ReviewAudit); **Kafka** events; **SQS** (+ DLQ) workers; **EventBridge Scheduler** — A
- **social-7.2** Social owns **no connection secrets and no source attribution** — publish + rendition + inbound only — A

## social-8.0 Approval workflow (optional, per account) — B
- **social-8.1** **Configurable 0–N required approvals** per account — **0 = publish directly**; `N ≥ 1` routes through review; the required count is **snapshot onto the Post at submit** *(gap #6)* — B
- **social-8.2** **Status chain** — `draft → pending_review → approved → scheduled/published`; **reject / changes-requested → back to draft**; publishing is **gated on `approved`** when `approvalsRequired ≥ 1` — B
- **social-8.3** **Approvals recorded** — each approve / reject carries **who + when** (+ decision); **N distinct approvals → `approved`** — B
- **social-8.4** **Review comments** — other users comment on a post under review; each comment is **flaggable resolved** (who + when) — B
- **social-8.5** **Audit trail** — **append-only** log of submit / approve / reject / comment / resolve / schedule / publish, with **actor + timestamp** — B

## social-9.0 Service & Job topology — B
- **social-9.1** **Domain bases** — `SocialService extends Service` + `SocialJob extends Job` hold the shared code (connection model · provider adapter factory · publish-compose/rendition · inbox + keyword-tag + sentiment · OAuth-token read (marketplace vault) · analytics emit); **concrete roles extend the domain base** — B
- **social-9.2** **`SocialMainService`** — the `/social/*` API (connections · compose/CRUD · scheduling · inbox · approval workflow · AI-summary trigger) — A
- **social-9.3** **`SocialWebhookService`** — provider **inbound webhook intake** (Meta; webhook-sig + ACK-fast → enqueue); **scales apart** from the user API — A
- **social-9.4** **Jobs extend `SocialJob`** — `SocialPublishWorker` / `SocialInboundJob` / `SocialPollJob` / `SocialScheduleJob` — A
- **social-9.5** **`SocialPublishWorker` is provider-agnostic** — dispatch by platform via the adapter (container→publish 2-step for Meta), rate-paced by dispatch — A
- **social-9.6** **Inbound is asymmetric** — `SocialWebhookService` (push: Meta) **+** `SocialPollJob` (poll: X/TikTok/LinkedIn, in-flight lock + cooldown) both feed one `SocialInboundJob` normalize + tag + sentiment pipeline — A
- **social-9.7** **OAuth tokens are read from [marketplace](../marketplace/SPECS.md)'s vault, never stored in social**; **AI summary is analytics-owned** (social triggers) — A

## social-10.0 Native provider adapters (Ayrshare = reference only) — A
- **social-10.1** Each network is integrated **natively** — its own API + OAuth + formats — behind the **provider-agnostic** channel interface; **no third-party posting-aggregator dependency**; **[Ayrshare](https://www.ayrshare.com)** is a **capability benchmark only** *(gap #11)* — A
- **social-10.2** **Capability-parity target** — mirror a mature social API's surface, implemented per platform: unified publish (per-network renditions in one op), scheduling, media, analytics, comments read/reply, webhooks + poll reconcile — B
- **social-10.3** **Connection/OAuth is BYO + marketplace-vaulted** — the account owns the provider tier + cost; social stores **no** provider secrets *(unchanged — gap #10; see 1.4/6.1)* — A
- **social-10.4** **Provider abstraction preserved** — no platform-SDK types leak past the adapter; adding a network doesn't touch publish-compose / inbox / analytics — A

## social-11.0 Network rollout + per-network profile quota — A
- **social-11.1** **Phase 1** networks: Facebook (Page), Instagram (Business), X / Twitter, TikTok, LinkedIn — A
- **social-11.2** **Phase 2** networks: **Reddit, Pinterest, YouTube, Snapchat, Threads** — each a **new native adapter** behind the same interface, supplying its own **per-network required fields** in the rendition layer — C
- **social-11.3** **Later candidates**: Google Business Profile, Bluesky, Telegram — as demand + each platform's API warrant — C
- **social-11.4** **Profiles-per-network quota is a plan entitlement** — a per-plan limit, ideally **per network** (`maxProfiles[network]`) + optional overall cap; **owned by [account](../account/SPECS.md)**, **read** by social — A
- **social-11.5** **Enforced on connect** — `POST /social/connections` checks the account's current count for that network against the entitlement; **over-limit is rejected with an upgrade hint**, not silently dropped — A
- **social-11.6** **Downgrade is non-destructive** — a plan change below the current count **keeps live connections** but **blocks new connects** until back under the cap; the over-cap state is surfaced to the account — B

# Endpoints (first cut)

A first pass, in [`@repo/endpoint`](../../../packages/endpoint/SPECS.md) style — service-prefixed `/social/*`.
**Inbound is not these endpoints** — platform engagement arrives via **signed webhooks** (`/social/webhooks/*`)
→ SQS → worker.

**Access column:** **`minAccess`** — **`-`** public · account ladder **`SENDER`<`USER`<`BILLING`<`ACCOUNT`** ·
staff **`SUPPORT`<`APPLICATION`<`ROOT`** · **`Internal`** = VPC-only S2S · **`Webhook-sig`** = provider-signed.

| Method | URI | Purpose | Access | Req |
|---|---|---|---|---|
| GET | `/social/connections` | List the account's connected destinations + status (+ remaining quota per network) | USER | social-1.1 |
| POST | `/social/connections` | Connect a destination (initiates **marketplace** OAuth) — **409** if over the plan's per-network profile quota | ACCOUNT | social-1.2/11.5 |
| DELETE | `/social/connections/{connectionId}` | Disconnect a destination | ACCOUNT | social-1.2 |
| GET, POST | `/social/posts` | List / create (+ schedule) a post | SENDER | social-2.1/3.1 |
| GET | `/social/posts/{postId}` | Read a post + its `PublishedPost` results | SENDER | social-2.1 |
| DELETE | `/social/posts/{postId}` | Cancel a scheduled (un-published) post | SENDER | social-3.2 |
| GET | `/social/posts/{postId}/renditions` | Per-platform rendition **preview** | SENDER | social-2.2 |
| POST | `/social/posts/{postId}/publish` | Publish now (skip / override schedule) — **gated on `approved`** if review required | SENDER | social-2.1/8.2 |
| POST | `/social/posts/{postId}/submit` | Submit for review (`draft → pending_review`) | SENDER | social-8.2 |
| POST | `/social/posts/{postId}/approvals` | Record an **approve / reject** decision (who + when) | USER | social-8.3 |
| GET, POST | `/social/posts/{postId}/comments` | List / add **review comments** | SENDER | social-8.4 |
| PATCH | `/social/posts/{postId}/comments/{commentId}` | **Resolve / unresolve** a comment | SENDER | social-8.4 |
| GET | `/social/posts/{postId}/audit` | The post's **append-only audit trail** | USER | social-8.5 |
| POST | `/social/internal/publish` | S2S — the campaign/workflow **`publish` node** | Internal | social-2.1 |
| POST | `/social/webhooks/{platform}` | Inbound intake (comments / mentions / DMs) — **signature-verified** | Webhook-sig | social-4.1 |
| POST | `/social/data-deletion/meta` | **Meta data-deletion callback** (app users) — signed; returns confirmation URL + code | Webhook-sig | social-6.4.4 |
| GET | `/social/inbox` | List inbound — filter `type` / `provider` / `from`,`to` (time window) / `tag` / `campaign` | USER | social-4.5 |
| PATCH | `/social/inbox/{itemId}` | Update an item — set/clear **tags**, `status` (open/handled) | USER | social-4.6 |
| POST | `/social/inbox/refresh` | **On-demand pull** of pull-only providers now — **409** if a pull is in flight / cooling down (returns `cooldownUntil`) | USER | social-4.8/4.9 |
| GET | `/social/posts/best-time` | Best-time **recommendation** for a target (when data exists) | SENDER | social-3.3 |
| GET, PUT | `/social/config` | Runtime config (poll **window** + **cadence**, refresh **cooldown**, approval on/off) | ACCOUNT | social-4.8/4.9 |
| GET | `/social/health` | Liveness / readiness (adapters + scheduler + intake) | - | social-7.1 |

# eof

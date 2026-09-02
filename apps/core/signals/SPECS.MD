#
# Signals Service
#

# Objective

**Signals** watches the outside world on an account's behalf and turns raw noise into **triaged
intelligence**. An account defines what matters — a **campaign, company, competitor, industry / sector,
product, or person** associated with them — by giving Signals **keywords, links, images, and aliases**. The
account then picks **1-or-more channels to monitor** (news sites, Reddit, RSS feeds, social platforms, web
search, …). Every new mention that shows up on a watched channel is run through **AI**: how closely does this
relate to the target (**affinity**), is it **positive or negative**, what's it about, and — **the part that
makes this more than a listening dashboard** — **what should we do about it**. Signals doesn't stop at
"here's a mention"; it **recommends** (or, gated behind approval, **drafts**) the next action: log it as
gathered intelligence, ready a **social post**, a **press release**, an **email**, a **text message**, or
escalate it to a human. It **signals action**.

The load-bearing ideas:
* **watch by intent, not by keyword list** — a `Target` is a durable definition of *what* to protect/track
  (a campaign, a competitor, a person, …); the keywords/links/images/aliases are how it's *found*, not the
  thing itself, so a target survives a rewrite of its search terms;
* **federate the listening, don't build a crawler** — v1 leans on **RSS, News/Search APIs, Reddit's API, and
  the platform's own connected social accounts** ([marketplace](../marketplace/SPECS.md)) — Signals is not in
  the business of running a general-purpose web crawler (cost, ToS/legal exposure, and it's a solved,
  buyable problem — see *Provider strategy*);
* **AI triages, humans approve** — every mention gets an **affinity score + sentiment + summary +
  recommended action** from AI, but Signals **never sends anything on its own** — a recommended action becomes
  a **draft** in the owning channel service ([social](../social/SPECS.md) / [email](../email/SPECS.md) /
  [texting](../texting/SPECS.md) / [print](../print/SPECS.md)) or a document in
  [media](../media/SPECS.md)/[report](../report/SPECS.md), routed through **that service's own approval
  workflow** — Signals proposes, a person disposes;
* **signal ≠ mention** — most mentions are noise; a **Signal** is a `Finding` that crosses an
  account-configured **threshold** (affinity × sentiment × source weight) and is worth a human's attention —
  keeping the triage queue and the "am I alarmed right now" question small;
* **an event, not just a UI** — every `Signal` is a **Kafka event** ([workflow](../workflow/SPECS.md) /
  [analytics](../analytics/SPECS.md) consume it), so "negative signal on Target X" can drive account-built
  automation, not just a bell icon.

# Role & boundaries (read this first)

Signals answers **"is anything happening out there that I should know about or act on?"** for a defined set of
watched things. It owns the **watch definitions, the listening, the AI triage, and the recommend/draft
hand-off** — nothing past that line.

What it **owns**:
* **`Target`** definitions — what's being watched (campaign / company / competitor / sector / product / person)
  and the keywords / links / images / aliases that identify it.
* **`Channel` + `Source` configuration** — which listening surfaces are active per target, and the concrete
  feeds/queries/subreddits/handles under each.
* **Ingestion** — polling / webhook intake of each source, normalized into a `Mention`, deduped.
* **AI triage** — affinity score, sentiment, summary, extracted entities, and a **recommended action**, per
  `Mention` → `Finding`.
* **Threshold gating** — deciding which `Finding`s become an actionable **`Signal`** (and notifying).
* **Action hand-off** — turning a recommended action into a **draft** in the owning channel/document service
  (never a direct send) and tracking that draft's status back to the `Signal`.
* **The triage queue / inbox** — findings and signals a human reviews, dismisses, or approves-into-action.

What it **delegates / does NOT do**:

| Concern | Owner |
|---|---|
| The **entity being watched** — the actual `Campaign` record, the account's own company profile, a `Contact` | **[campaign](../campaign/SPECS.md)** / **[account](../account/SPECS.md)** / **[contact](../contact/SPECS.md)** — Signals just *references* it by id + a free-text label; it doesn't own campaign/company/product data |
| **OAuth / connected accounts** (a connected X or Reddit account used for listening) | **[marketplace](../marketplace/SPECS.md)** — vaulted, per-account |
| **Actually publishing** a drafted social post / press release / email / text | **[social](../social/SPECS.md)** / **[email](../email/SPECS.md)** / **[texting](../texting/SPECS.md)** / **[print](../print/SPECS.md)** — Signals hands off a **draft**; that service's own compose + approval + send owns the rest |
| **Our own post/campaign engagement** (comments/mentions/DMs on things *we* published) | **[social](../social/SPECS.md)`s inbound** — that's *reactive* listening on our own channel; Signals is *proactive* listening across the open web/other channels about a target, ours or not |
| **Aggregation / trend charts / share-of-voice over time** | **[analytics](../analytics/SPECS.md)** — Signals emits the events; analytics builds the graphs |
| **Multi-step orchestration** beyond "hand off a draft" | **[workflow](../workflow/SPECS.md)** — a `Signal` event is a valid workflow trigger for anything fancier |
| **Media storage** for images used as watch input or captured screenshots of a mention | **[media](../media/SPECS.md)** |
| **Operational health** of Signals' own jobs/queues | **[monitor](../monitor/SPECS.md)** |

> **Signals is the *proactive, outward-facing* listening plane; social's inbound is the *reactive, our-own-post*
> listening plane.** Same AI-triage instinct (affinity/sentiment), different aperture — see *Out of scope* on
> the social side (`apps/core/social/SPECS.md` explicitly defers "full social listening / broad brand
> monitoring" to here).

# Out of scope (deferred)

* **A general-purpose web crawler.** v1 federates to **provider APIs, search APIs, and RSS** — it does not
  fetch/render arbitrary pages at scale. A source that truly needs raw crawling is a **case-by-case native
  adapter**, not a general crawl engine (see *Provider strategy*).
* **Premium listening-data aggregators as a dependency** (Meltwater / Brandwatch / Talkwalker / Brand24 /
  Mention.com) — used only as a **capability benchmark**, same posture as social's Ayrshare reference. A
  **marketplace connector** to one of these (buy the firehose, keep our own triage/scoring on top) is a
  plausible **v2**, not a v1 dependency *(gap #1)*.
- **Reverse-image / logo detection** — catching a brand mention *inside* an image or video frame (not just
  attached text). Image/link input today only seeds keyword extraction (e.g. OCR/caption an uploaded logo to
  derive search terms) — it doesn't power ongoing visual search *(gap #12)*.
* **Auto-send of a recommended action.** Signals never publishes; every recommended action becomes a **draft**
  gated by the owning channel's own approval workflow. A fully unattended "AI decides and it goes out" mode is
  explicitly not v1 (see *AI triage & action*).
* **Cross-source story clustering / dedup beyond exact-normalize.** v1 dedupes identical URLs/text; grouping
  50 outlets covering the *same* story into one "story" card is a v2 refinement *(gap #5)*.
* **Its own translation engine.** Non-English mentions are passed to the AI classify step as-is (the chat
  model natively handles many languages); a dedicated translation pipeline / UI is later *(gap #7)*.
* **Anomaly / volume-spike detection as a first-class alarm type.** v1 gates purely on **per-finding**
  affinity × sentiment × source-weight; a **baseline-vs-current volume** alarm (crisis/spike detection) is a
  natural analytics-side extension, not v1 *(gap #3 — but see Competitive landscape: this is table-stakes
  for the category sooner than "later" implies)*.

# Competitive landscape & SWOT

Signals enters an established **media-monitoring / social-listening / PR-intelligence** category. Four
clusters of incumbent, each with a different center of gravity:

| Cluster | Players | Center of gravity |
|---|---|---|
| **Enterprise media & social intelligence** | Meltwater, Brandwatch, Talkwalker (now part of Hootsuite) | Broad source coverage, deep historical/audience analytics, board-level reporting |
| **SMB / budget social listening** | Brand24, Mention, Awario, Determ | Fast setup, boolean keyword control, affordable per-seat pricing |
| **PR / comms intelligence + outreach** | Cision, Muck Rack, Signal AI, Onclusive | Journalist/influencer databases, pitch outreach, generative executive summaries |
| **Predictive virality & crisis** | NewsWhip | Velocity/predictive scoring, real-time crisis spike alerts, Slack/Teams push |

**SWOT (Signals vs. the category, not any single competitor):**

| | Assessment |
|---|---|
| **Strengths** | **We're the only one that closes the loop to a channel-native draft.** Every incumbent above stops at "here's the mention + a score" (or, at best, Muck Rack's journalist-pitch *research* assist) — none of them **drafts the social post / press release / email / text** in the actual sending system and routes it through that system's own approval workflow. Because Signals is **built on the same platform as the send channels** (social/email/texting/print) and the workflow engine, "recommend → draft → approve → send" is a same-platform hand-off, not an export/copy-paste into a separate tool. We also inherit the platform's existing **account/role model, approval workflows, and event bus** for free — an incumbent selling a standalone SaaS tool has to build all of that from scratch, or leaves it to the customer to bolt on. |
| **Weaknesses** | **Source breadth and history are the moat we don't have yet.** Meltwater/Brandwatch/Talkwalker have spent years buying data-licensing deals (Twitter/X firehose, Facebook/Instagram Crowd-Tangle-successor access, print/broadcast transcripts, global-language coverage) that a v1 federated-adapter approach (RSS/News-API/Reddit/marketplace-social/web-search) cannot match on day one. Brandwatch's **historical depth** (years of indexed social history for trend research) and Talkwalker's **visual/image recognition** are both multi-year investments we explicitly deferred (*gap #12*, no crawler). We also have **no journalist/influencer database** (Cision/Muck Rack's core asset) — "who should we pitch this to" isn't answerable yet. |
| **Opportunities** | **Everything below is a gap in the incumbents we can target, not just parity we owe them:** (1) none of them ship **cross-channel action drafting** — pure whitespace, see Strengths; (2) NewsWhip's **velocity/predictive scoring** (rate-of-change, not just a raw count) is a sharper crisis signal than a flat threshold-gate and is a natural addition to `SignalsClassifyJob`'s scoring, not a new pipeline; (3) Awario's **own-crawler + strict boolean query control** at a fraction of Brandwatch's price shows a federated, API-first approach can still compete on **query precision** even without owning a crawler — invest in the `Target` keyword model's boolean expressiveness; (4) Muck Rack's new "Agents" (AI that recommends *who* to pitch) validates that **agentic, recommend-and-act AI** is where the category is heading, not just dashboards — reinforces Signals' own recommend→draft posture as the right long-term bet, not a v1 shortcut. |
| **Threats** | **An incumbent adds action-drafting before we add source breadth.** Muck Rack shipping "Agents" and Signal AI's generative `AIQ` summaries show the big players are already moving toward agentic recommendations — the "we draft the action" differentiator has a shelf life if we're slow to ship it well. Conversely, a customer evaluating us **side-by-side on raw coverage** (languages, historical depth, TV/radio transcripts, X/Twitter firehose access) will see the gap immediately — Signals should be positioned as *"listen + act for the things that matter to a campaign"*, not *"replace your enterprise media-monitoring subscription"*, until source breadth catches up. |

**Requirement changes this drives** (folded into the sections below, not left as narrative):
* **Boolean query builder** on `Target` keywords (AND/OR/NOT/phrase groups), not just must/should/exclude —
  table-stakes per Awario/Brand24/Mention — **signals-1.6**.
* **Velocity/predictive scoring — MVP, not a v-next nice-to-have** — a per-target, per-sentiment
  rate-of-change metric, **weighted by source credibility** (`Source.weight`) so a pile of low-credibility
  noise can't fake a trend that a handful of major-outlet hits would — inspired by NewsWhip, sharpened with
  our own source-weighting — **signals-1.7 / 3.7 / 3.8**.
* **Push alert channels** (Slack / Teams / generic webhook) alongside email for escalation + digest — every
  competitor above ships this — **signals-4.7**.
* **Competitor share-of-voice is core, not a "someday" idea** — every enterprise + SMB competitor leads with
  it; Signals already has the `COMPETITOR` target type and event stream, so this is an analytics-side
  requirement to prioritize, not a new capability — **signals-5.5**.
* **Journalist/influencer identification + pitch drafting** as a new, longer-horizon `Action` — competitive
  answer to Muck Rack/Cision's core asset, scoped as a `MediaContact` lookup + `PITCH_JOURNALIST` action,
  explicitly gated behind having (or integrating) a contacts/journalist database — **signals-9.0** *(gap #18)*.

# Core concepts

* **`Target`** — the durable thing being watched: `type` (`CAMPAIGN` / `COMPANY` / `COMPETITOR` / `PRODUCT` /
  `SECTOR` / `PERSON` / `TOPIC`), an optional reference to an existing platform entity (`campaignId`,
  `contactId`, …) when one exists, a human `label`, and the **identifying material**: a **boolean `query`**
  (AND/OR/NOT groups + exact-phrase terms over `keywords`/`aliases` — table-stakes precision control per
  Awario/Brand24/Mention, not a flat must/should/exclude list), `links` (a homepage, a competitor's site, a
  product page), and `images` (a logo/product shot — seeds keyword extraction, see *Out of scope*). A
  `Target` also carries **sensitivity** (how aggressive the threshold is) and **notify / escalation** routing.
* **`Channel`** — *where* to listen: `NEWS` · `RSS` · `REDDIT` · `SOCIAL` (per network, reusing
  marketplace-connected accounts) · `WEB_SEARCH` · `FORUM` · `BLOG` · `REVIEW_SITE` · `PODCAST` ·
  `NEWSLETTER` (both typically feed-based, same `RSS` adapter — kept as distinct channel *labels* since an
  account thinks of them as different surfaces even when the mechanics are shared). A `Target` opts into
  1-or-more channels.
* **`Source`** — a concrete origin under a channel: a specific RSS feed URL, a subreddit, a saved search
  query, a news outlet, a review-site listing. Sources can be **shared across targets** (the same RSS feed
  feeds many watches) or **target-specific** (a bespoke search query built from that target's keywords). Every
  `Source` carries a **`weight`** (0.0–1.0, **MVP**) — its relative credibility/reach (a major outlet vs an
  obscure blog) — defaulted by channel (`NEWS` > `SOCIAL`/`REDDIT` > `WEB_SEARCH`, tunable) and
  operator-overridable per source; this is **not cosmetic** — it's a direct input to both a `Finding`'s
  severity and the target's velocity metric (below), so a spike of low-weight noise doesn't read the same as
  a handful of high-weight hits.
* **`Mention`** — one raw, normalized, **deduplicated** item pulled from a `Source`: url/permalink, published
  time, author/outlet, title/body excerpt (short — see *Compliance*, not a full reproduction), and which
  `Target`(s) it matched.
* **`Finding`** — a `Mention` after **AI triage**: `affinityScore` (0-100, how closely this actually relates
  to the target — a keyword hit isn't automatically relevant), `sentiment` (`POSITIVE` / `NEUTRAL` /
  `NEGATIVE` + a confidence), a short `summary`, extracted `entities` (people/orgs/products named), and a
  `recommendedAction` + `confidence`.
* **`Signal`** — a `Finding` that **crosses the target's threshold** — the actionable subset. Carries its own
  lifecycle (`new → reviewed → actioned/dismissed`), triggers notification, and is what's emitted as an event.
* **`Velocity`** (**MVP** — see *AI triage & action*) — a **per-target, per-sentiment** rolling metric: the
  **rate of change** in **source-weight-adjusted** mention volume for `POSITIVE` / `NEUTRAL` / `NEGATIVE`
  findings, each against that bucket's own trailing baseline. Three independent numbers per target (a target
  can be **trending positive** and **spiking negative** at the same time — they don't net against each
  other), computed from `Finding`s as they land, not a separate ingestion path. This is what turns "one bad
  mention" into "this is accelerating" — the earliest, cheapest signal of something actually happening, and a
  direct input to threshold/severity alongside a single `Finding`'s own affinity score.
* **`Action`** — the disposition: `INTEL_ONLY` (just log it, no draft), `DRAFT_SOCIAL_POST` /
  `DRAFT_PRESS_RELEASE` / `DRAFT_EMAIL` / `DRAFT_TEXT`, `ALERT` (notify only, no draft), `ESCALATE` (routes to
  a named role/channel regardless of the target's usual notify routing), and — **longer-horizon, see
  *Competitive landscape*** — `PITCH_JOURNALIST` (identify + draft outreach to a reporter/influencer covering
  the story, our answer to Cision/Muck Rack's core asset; gated behind a `MediaContact` lookup that doesn't
  exist yet, *gap #18*). A `Signal`'s action is **AI-recommended, human-confirmed** — dismissing, overriding,
  or accepting the recommendation is a first-class part of triage.
* **`Draft`** — the record of a hand-off: which `Signal` produced it, which owning service/entity it became
  (`social.postId`, `email.draftId`, …), and its last-known status pulled back from that service (best-effort,
  event-driven — Signals doesn't own the draft's lifecycle after hand-off).

# Provider / channel strategy — federate, don't crawl

Same posture as [social](../social/SPECS.md)'s *native adapters* and [media](../media/SPECS.md)'s *Browse*
providers: each channel is a **thin, provider-specific adapter** behind one interface
(`search(query, since) → Array<RawMention>`), not a scraped-HTML crawler.

| Channel | v1 mechanism | Notes |
|---|---|---|
| **RSS** | Generic feed parser against an account-supplied feed URL | Keyless; any standard RSS/Atom feed |
| **NEWS** | A news/search API (e.g. GDELT, a news-API provider) keyed by keywords | One or a few interchangeable providers behind the adapter |
| **REDDIT** | Reddit's public search + subreddit listing API | OAuth app-token; **not** per-account marketplace OAuth (a platform-level Reddit app is enough for read-only search) |
| **SOCIAL** | Reads through the account's **own marketplace-connected** accounts' search/listen surface, where the platform's API allows keyword search (X, LinkedIn, …) | **Reuses [marketplace](../marketplace/SPECS.md)'s vault** — Signals never stores a token; explicitly distinct from social's *inbound* (which listens on *our own* posts only) |
| **WEB_SEARCH** | A search-engine API (Google/Bing/SerpAPI-style) for broad keyword sweep across the open web | The closest thing to "the whole web" v1 offers, without running a crawler |
| **FORUM / BLOG / REVIEW_SITE** | Per-source RSS/API where the site exposes one; otherwise **not supported v1** (no headless-render scraping) | A site with no feed/API is out of reach until it's worth a bespoke adapter |

**v2 candidate:** a **marketplace connector to a premium listening aggregator** (Meltwater / Brandwatch /
Talkwalker / Brand24) as an *additional* channel — buy the raw firehose + broader coverage, keep Signals' own
`Finding`/`Signal` triage on top, so switching/adding an aggregator doesn't touch scoring or the action
pipeline *(gap #1)*.

# Architecture & flow

```
 CONFIGURE
   account defines a Target (type + keywords/aliases/links/images + sensitivity + notify routing)
        └─► compiled into one-or-more per-Channel queries → bound to Source(s)

 INGEST (per source, on its own cadence — EventBridge Scheduler)
   SignalsIngestJob ──poll/search──► provider adapter ──► RawMention
        └─► normalize + DEDUPE (hash of normalized url/text) ──► Mention  ──► SQS ──► classify

 CLASSIFY (AI triage)
   SignalsClassifyJob ◄──SQS── Mention
        └─► AiFactory (CHAT modality, structured output) ──► affinity · sentiment · summary · entities ·
              recommendedAction + confidence ──► Finding  (persist + emit `signals.finding`)
        └─► VELOCITY UPDATE — bump the target's rolling (sentiment × source.weight)-adjusted counter for
              this Finding's sentiment bucket; recompute rate-of-change vs that bucket's trailing baseline
        └─► THRESHOLD GATE (target's sensitivity: affinity × sentiment × source.weight, OR'd with a velocity
              breach on any sentiment bucket — a single high-affinity hit AND an accelerating trend can each
              fire alone)
                 │ below                          │ crosses
                 ▼                                ▼
              stop (Finding stays browsable,   create Signal (status=new, carries the triggering Finding
              not a Signal)                    +/- the current Velocity snapshot) → notify (email/Slack/
                                                Teams/webhook fan-out) → emit `signals.signal`

 ACT (human-gated)
   human reviews the Signal in the triage queue → accept / override / dismiss the recommended Action
        └─► accept a DRAFT_* action ──► SignalsActionJob ──S2S──► owning channel service creates a DRAFT
              (social post / press release doc / email / text) in **that service's own draft + approval state**
        └─► Draft status is read back (best-effort, via that service's CRUD event) and reflected on the Signal
```

* **Ingestion cadence is per-source, not global** — a fast-moving Reddit search polls tighter than a
  low-traffic RSS feed; each `Source` carries its own cadence + backoff, guarded the same way social's
  `SocialPollJob` guards on-demand refresh (in-flight lock + cooldown) so a manual "check now" can't hammer a
  provider.
* **Dedup is at ingest, not at classify** — never spend an AI call re-scoring a mention already seen (cost
  control), whether it re-arrives on the same source or a different one covering the same story.
* **AI never auto-fires an action** — `recommendedAction` is *advisory*; a `Signal`'s action only becomes a
  real `Draft` after a human accepts it (or an account explicitly opts a *specific, low-risk* combination —
  e.g. `INTEL_ONLY` on a low-sensitivity target — into auto-accept; see *Gaps*, #8).
* **The event is the integration point** — `signals.signal` (and `signals.finding`) on Kafka let
  [workflow](../workflow/SPECS.md) build account-specific automation (Slack ping, CRM task, …) without Signals
  needing to know about it.

# AI triage & action

* **Modality: `AiRouting.Modality.CHAT`** via the platform's `AiFactory` — same **provider-agnostic AI
  routing** every service uses ([`AiRouting`](../../../packages/api/src/ai/model/AiRouting.ts):
  `config/ai` profile picks the provider/model; Signals just requests the `CHAT` modality with a
  **structured-output** schema).
* **One call, structured output** — a single classify call returns `{ affinityScore, sentiment,
  sentimentConfidence, summary, entities[], recommendedAction, actionConfidence }`; no per-field extra calls.
* **Target-scoped prompt** — the target's `label`, `type`, keywords/aliases, and a short **house style /
  brand-voice hint** (reused if/when a draft is generated) are folded into the classify prompt, so "affinity"
  and "recommended action" are judged *for this target specifically*, not generically.
* **Low-confidence → always human triage.** A `Finding`/`Signal` below a confidence floor is **never**
  eligible for auto-accept regardless of account settings — it lands in the queue same as any other, just
  flagged low-confidence.
* **Cost control** — classify is **rate/cost-governed per account** (a configurable AI-call budget/window in
  `config/ai` or a Signals-specific settings profile), because ingestion volume (esp. `WEB_SEARCH` /
  `SOCIAL`) can otherwise scale AI spend unpredictably *(gap #6)*.
* **Human feedback loop** — a thumbs-up/down on a `Finding`'s verdict (wrong affinity, wrong sentiment, wrong
  action) is captured and available to tune the target's prompt hints / keyword weights over time — not a
  model fine-tune, a **per-target calibration signal** *(gap #9)*.
* **Velocity is computed, not AI-classified — and it's MVP.** After each `Finding` is scored, a lightweight
  (non-AI, cheap) bookkeeping step bumps that target's rolling **per-sentiment** counter by
  `1 × source.weight` and recomputes the rate-of-change against that bucket's own trailing baseline —
  `Velocity.positive` / `.neutral` / `.negative`, independent of each other. **Source weight is the multiplier
  that makes the metric trustworthy**: without it, ten low-credibility forum posts and one major-outlet story
  would move the needle identically, which is exactly the false-alarm failure mode a raw spike-count metric
  has. This runs **inline in `SignalsClassifyJob`**, not a separate AI call — no incremental AI cost to add
  it.
* **Velocity feeds the threshold gate directly, alongside per-finding affinity.** A target can cross into a
  `Signal` two ways: one high-affinity, high-source-weight `Finding` on its own, **or** an accelerating
  negative (or positive — a viral win is also worth surfacing) trend even if no single `Finding` is
  individually alarming. The two paths are `OR`'d, not blended into one number, so a genuine trend isn't
  diluted by averaging against a pile of ordinary mentions.

# Ideas to expand Signals further (beyond v1 — candidates, not commitments)

* **Story clustering** — group near-duplicate coverage of the same underlying story across many outlets into
  one card with an outlet count, instead of N separate `Signal`s for one event *(gap #5)*. (Distinct from
  velocity/source-weight, which are now MVP — see *AI triage & action* — clustering is about **deduplicating**
  what feeds the counters, not weighting them.)
* **Competitor share-of-voice (promoted to signals-5.5, not just an "idea" anymore)** — since competitors are
  just another `Target.type`, analytics can compare mention volume + sentiment across an account's own target
  and its named competitors over time — every incumbent leads with this, so it's a near-term analytics
  priority, not a someday extension.
* **Journalist / influencer identification + pitch drafting** — Muck Rack/Cision's core asset; answer it with
  a `MediaContact` lookup (who's covering this story / topic) feeding a new `PITCH_JOURNALIST` action,
  drafted the same way a social/email/text action is — explicitly gated behind acquiring or integrating a
  journalist/contacts database *(gap #18)*.
* **Digest cadence + push delivery (promoted to signals-4.7, not just "email" anymore)** — a configurable
  daily/weekly rollup **and** real-time escalation delivered to **Slack / Microsoft Teams / a generic
  webhook**, not just email — every competitor surveyed ships chat-tool push *(gap #10)*.
* **Escalation routing by severity** — configurable notify targets by severity tier (e.g. high-affinity
  negative → ACCOUNT admin + Slack immediately; low-urgency → digest only), reusing the `Target`'s notify
  routing but keyed off the `Signal`'s computed severity, not just a flat per-target setting *(gap #11)*.
* **Confidence-gated limited auto-action** — allow an account to opt a **specific** (target, action) pair —
  e.g. `INTEL_ONLY` findings on a low-sensitivity competitor watch — into auto-accept, while every
  `DRAFT_*`/`ESCALATE` action always stays human-gated regardless of confidence *(gap #8)*.
* **Org/agency-level shared watchlists** — a `Target` defined at a parent/organization scope, visible (read)
  across an agency's sub-accounts, so one team monitoring many client brands doesn't recreate the same
  competitor/industry watches per account — depends on account's org model existing *(gap #15)*.
* **Backfill on target creation** — optionally look back N days across newly-bound sources when a `Target`
  is first created, so the triage queue isn't empty/cold on day one *(gap #17)*.
* **Source health surfaced to ops** — a source that goes stale (no new mentions past its own historical
  cadence) or a poll job erroring repeatedly is worth an operator knowing about, via
  [monitor](../monitor/SPECS.md), before an account notices "nothing's coming through" *(gap #16)*.
* **Trend + sentiment-over-time views** — handed to [analytics](../analytics/SPECS.md) once the event stream
  exists; Signals just needs to keep emitting a consistent, well-typed event, not build the charts.
* **Person-target guardrails** — monitoring a **person** (an executive, a public figure associated with the
  account) raises PII/defamation exposure the other target types don't; treat `PERSON` targets with tighter
  retention + an explicit consent/legitimate-interest note at creation time (see *Compliance*).

# Data model (sketch)

```
Target         { id, accountId, type, label, refId?, query(booleanGroups), aliases[], links[], images[],
                sensitivity, notifyRouting, status(active/paused), createdAt }
Source         { id, channel, config(feedUrl|query|subreddit|network…), sharedAcrossTargets(bool), cadence,
                weight(0.0-1.0, channel-defaulted + overridable), lastPolledAt, lastError? }
TargetSource   { targetId, sourceId }                       // many-to-many binding
Mention        { id, sourceId, targetIds[], url, publishedAt, outlet/author, excerpt, dedupeHash, createdAt }
Finding        { id, mentionId, targetId, affinityScore, sentiment, sentimentConfidence, sourceWeight,
                summary, entities[], recommendedAction, actionConfidence, feedback?(up/down), createdAt }
VelocityBucket { targetId, sentiment, windowStart, weightedCount }   // rolling time-bucketed counter (1/source.weight
                per Finding); current-window vs trailing-baseline ratio = that sentiment's Velocity
Signal         { id, findingId?, targetId, trigger(finding|velocity), severity, velocitySnapshot?,
                status(new/reviewed/actioned/dismissed), notifiedAt, actorUserId?, decidedAt? }
Draft          { id, signalId, action, ownerService, ownerRef(id), lastKnownStatus, createdAt }
```

`Finding.sourceWeight` is a **snapshot** of the contributing `Source.weight` at classify time — a source's
weight can change later (an override, a channel-default retune) without silently reinterpreting history.
A `Signal` triggered purely by a velocity breach (no single alarming `Finding`) carries `trigger=velocity`
and no `findingId`; the sentiment bucket that breached is on `velocitySnapshot`.

All rows are **account-scoped** (`accountId` on `Target`; everything else traces back to it via
`targetId`/`sourceId`). `Source` rows shared across targets carry no `accountId` of their own beyond the
binding table, so one RSS feed's poll cost isn't duplicated per watching account.

# Service & Job topology

**Convention (platform-wide).** Framework base → domain base → concrete role. **`SignalsService extends
Service`** and **`SignalsJob extends Job`** hold the shared domain code — the `Target`/`Source`/`Mention`/
`Finding`/`Signal` models, the **channel provider-adapter factory**, the **AI classify** call (`AiFactory`,
`CHAT` modality, structured output), the **threshold-gate** logic, and **Kafka emit** — so every concrete role
inherits it.

```
Application
├── Service (Fastify, long-running — ECS)
│     └── SignalsService        (domain base — target/source/mention/finding/signal models · provider adapter
│                                  factory · AI classify · threshold gate · Kafka emit · audit; not deployed alone)
│           └── SignalsMainService  (the /signals/* API: targets · sources · findings/signals read + triage ·
│                                     accept/override/dismiss action · draft hand-off trigger · config/health)
└── Job (Lambda, event-driven)
      └── SignalsJob            (domain base — provider adapter factory · normalize · retry/DLQ · idempotency)
            ├── SignalsIngestJob    (EventBridge, per-source cadence — poll/search a Source → normalize → dedupe → Mention; SQS-buffered)
            ├── SignalsClassifyJob  (SQS ← ingest — AI classify a Mention → Finding; threshold gate → Signal + notify)
            ├── SignalsActionJob    (SQS — a human-accepted action → S2S hand-off to the owning channel service → Draft)
            └── SignalsDigestJob    (EventBridge — per-target digest rollup, where configured)
```

**Services (HTTP, ECS Fargate)**

| Class | Extends | Role |
|---|---|---|
| **`SignalsService`** | `Service` | **Domain base** — target/source/mention/finding/signal models · provider adapter factory · AI classify · threshold gate · Kafka emit · audit; **not deployed alone**. |
| **`SignalsMainService`** | `SignalsService` | The **`/signals/*` API** — `Target` + `Source` CRUD, the **triage queue** (findings/signals list + filter), **accept / override / dismiss** an action, trigger the **draft hand-off**, digest config, config/health. |

**Jobs (Lambda, event-driven)** — each extends `SignalsJob`:

| Class | Trigger | Role | Req |
|---|---|---|---|
| **`SignalsIngestJob`** | EventBridge, per-`Source` cadence | Poll/search a `Source` via its channel adapter, normalize, **dedupe**, write `Mention`; enqueue to classify. **In-flight lock + cooldown** on manual "check now" | signals-2.0 |
| **`SignalsClassifyJob`** | SQS ← ingest | **AI classify** (`AiFactory`, `CHAT`, structured output) → `Finding`; **threshold gate** → create `Signal` + notify when crossed; emit `signals.finding`/`signals.signal` | signals-3.0 |
| **`SignalsActionJob`** | SQS ← human accept | **S2S hand-off** of an accepted `DRAFT_*` action to the owning channel service (social/email/texting/print) → write `Draft`; track status back (best-effort, event-consumed) | signals-4.0 |
| **`SignalsDigestJob`** | EventBridge, per-target cadence | Roll up findings/signals since last digest into a summary → email/Slack, where a target has digest configured | signals-4.0 |

> **Shared modules (not deployables).** The **channel provider-adapter factory** (RSS / News / Reddit / social
> / web-search — each a `search(query, since) → RawMention[]`), the **AI classify** call, and the
> **threshold-gate** live on the bases and are reused by every concrete role. **Ingestion, classify, and
> action are three separate SQS-buffered stages** — a burst of mentions never blocks classify, and a slow AI
> provider never blocks ingest.

# AWS Services and Other Dependencies

**AWS services**
* **DynamoDB** — `Target` · `Source` · `TargetSource` · `Mention` · `Finding` · `Signal` · `Draft`
  (account-scoped; `Source` shared-across-target rows keyed independently of account).
* **EventBridge Scheduler** — per-source ingest cadence + per-target digest cadence.
* **SQS** (+ DLQ) — ingest → classify → action, three independently-scaled stages.
* **Kafka (MSK)** — emit `signals.mention` / `signals.finding` / `signals.signal` (consumed by
  [workflow](../workflow/SPECS.md) / [analytics](../analytics/SPECS.md)).
* **Bedrock / Anthropic (via `AiFactory`)** — the `CHAT` modality classify call; provider/model chosen by
  the account's `config/ai` routing, same as every other AI-using service.
* **S3** — optional short-excerpt/screenshot capture for a `Mention` (never a full page reproduction — see
  *Compliance*).
* **KMS** — encryption at rest.

**Third-party / external APIs** (the channel adapters)
* **RSS/Atom** — generic feed parsing, keyless.
* **A news/search-index API** (e.g. GDELT or an equivalent news API) for the `NEWS` channel.
* **Reddit API** — platform-level app token (read-only search/listing), not per-account OAuth.
* **A web-search API** (Google/Bing/SerpAPI-style) for the `WEB_SEARCH` channel.
* **Reference only (v2 candidate, not a dependency):** Meltwater / Brandwatch / Talkwalker / Brand24 —
  capability benchmarks for a possible future aggregator connector *(gap #1)*.

**Internal (`@repo/*`)**
* `@repo/services` (Dynamo, Sqs, Kafka, Scheduler, Kms), `@repo/endpoint` (`Access`), `@repo/common` (`Type`),
  `@repo/ai` (`AiFactory`, `AiRouting`).
* **[marketplace](../marketplace/SPECS.md)** — vaulted OAuth for the `SOCIAL` channel's listen surface.
* **[social](../social/SPECS.md) / [email](../email/SPECS.md) / [texting](../texting/SPECS.md) /
  [print](../print/SPECS.md)** — draft hand-off targets for a `DRAFT_*` action.
* **[media](../media/SPECS.md)** — stores an uploaded target `image`; hosts a captured excerpt/screenshot.
* **[report](../report/SPECS.md)** — a `DRAFT_PRESS_RELEASE` action may land as a document here instead of a
  channel-service draft, when it's not going out any single send channel.
* **[analytics](../analytics/SPECS.md) / [workflow](../workflow/SPECS.md)** — consume the emitted events.
* **[monitor](../monitor/SPECS.md)** — source health / job error visibility.

# Compliance & standards mapping

* **Excerpt, don't reproduce.** A `Mention` stores a **short excerpt** (title + a snippet) and a link back to
  the source, never a full-text copy of a paywalled/copyrighted article — fair-use posture, and it keeps
  Signals from becoming a mirror of someone else's content.
* **Respect source ToS / robots.txt.** Every channel adapter is a **sanctioned API or a published feed** — no
  headless-browser scraping of a site that disallows it. A site with no feed/API is simply out of reach v1
  (see *Provider strategy*), not a scraping target.
* **`PERSON` targets carry extra weight.** Monitoring a person (vs a company/product) is closer to
  processing personal data about an individual — v1 requires an explicit note at `Target` creation
  (legitimate interest — e.g. an exec's public reputation monitoring) and applies **tighter retention** on
  `Mention`/`Finding` rows tied to a `PERSON` target.
* **Retention TTL** on `Mention` (and by extension `Finding`) — not an indefinite archive; bounds exposure
  the same way social's `InboundItem` does.
* **Erasure** — deleting a `Target` removes/redacts its `Mention`/`Finding`/`Signal` rows; a **person's own
  erasure request** (via [contact](../contact/SPECS.md)/auth's forget flow) triggers a best-effort scrub of
  any `PERSON`-target rows referencing them, same posture as social's `social-forget` responder.
* **AI opinion is advisory, not published.** A `recommendedAction`/sentiment verdict is internal triage
  input; nothing derived from it reaches an external audience without passing through the owning channel
  service's own compose + approval + send — Signals carries no direct publish/send capability of its own.
* **No PHI** by [AUP](../account/specs/SPECS.md); encryption at rest (KMS) + TLS.

# Gaps & open decisions

1. **Premium aggregator connector (Meltwater/Brandwatch/Talkwalker/Brand24)** — buy broader coverage as a v2
   channel on top of the same triage pipeline, or stay federation-only indefinitely? Leaning: v2 marketplace
   connector once native channels prove the triage/action loop.
2. **Own crawler, ever?** — a bespoke adapter for a specific high-value source with no feed/API is
   conceivable case-by-case; a *general* crawler is not planned.
3. **Volume/anomaly (spike) detection** — worth a dedicated alarm type distinct from per-finding threshold
   gating, or is it purely an analytics-side chart? Leaning: a lightweight baseline check in
   `SignalsClassifyJob` (cheap, no extra AI call) feeding a distinct `signals.spike` event.
4. **Source weight source-of-truth (mechanism, not whether — that's decided, see signals-1.7/3.7).** v1
   defaults `Source.weight` by **channel** (a static, coded table); is a **per-outlet override table**
   (curated by us) or a **live domain-authority API** worth it before launch, or is the channel-level default
   + operator override (signals-1.7) good enough for v1?
5. **Story clustering** — needs a similarity measure (embedding-based near-dup?) beyond exact-hash dedupe;
   scoped as v2.
6. **Multi-account cost governance** — where does the per-account AI-call budget live: a Signals-specific
   settings profile, or folded into the platform's existing `config/ai` routing? Leaning: a Signals
   `config/settings` field (`classifyBudgetPerDay`), read the same way `logLevel` is.
7. **Multi-language** — rely on the chat model's native multilingual handling (no separate translation step)
   until evidence says otherwise.
8. **Confidence-gated limited auto-action** — which (target, action) combinations, if any, are safe to
   auto-accept without a human, and how is that opted into per target vs a platform-wide default (opt-in,
   never opt-out, given the reputational risk of a wrong auto-drafted press release)?
9. **Feedback-loop mechanics** — a thumbs-up/down is easy to capture; turning it into an actual prompt/keyword
   adjustment per target needs a defined (manual review vs automatic re-weight) policy before it's more than
   a logged signal.
10. **Digest delivery channel** — email only, or also Slack/webhook (reusing whatever
    [monitor](../monitor/SPECS.md)'s alarm fan-out already has for SNS/Slack)?
11. **Escalation routing storage** — same shape as `AuthModel`'s per-tier `RiskPolicy` (signal → action map)?
    Worth reusing that pattern rather than inventing a new one.
12. **Reverse-image / logo detection** — deferred; would need a vision-capable AI call per candidate image
    across sources, a materially different cost profile than text classify.
13. **Draft hand-off contract** — does each owning channel service need a **new S2S endpoint**
    (`POST /social/internal/draft-from-signal`, …) purpose-built for Signals, or can it reuse an existing
    internal compose endpoint? Likely a **small, new internal endpoint per channel** that just creates a draft
    in that service's existing draft/approval state, keeping Signals' action job uniform.
14. **`PERSON` target consent capture** — a checkbox/attestation at creation, or a formal legitimate-interest
    record tied to the account's own compliance posture? Needs input from whoever owns AUP/DPA language.
15. **Org/agency shared watchlists** — blocked on account's org/parent-account model existing; revisit once
    that lands.
16. **Source-health surfacing** — a stale/erroring `Source` is worth an operator knowing about via
    [monitor](../monitor/SPECS.md); needs a "no new mentions past its own historical cadence" definition
    before it can fire reliably (a naturally-quiet source shouldn't false-alarm).
17. **Backfill lookback bound** — how many days back is reasonable on target creation, and does it vary by
    channel (a news API's history window is very different from a subreddit search's)? Bounded by whatever
    each provider's own API actually allows.
18. **Journalist/influencer pitch (`PITCH_JOURNALIST`)** — needs a **`MediaContact`** model (who covers this
    beat/topic, their outlet, contact info) that doesn't exist anywhere in the platform today. Build our own
    (scoped, small — enough to answer "who's writing about X"), integrate a third-party journalist database
    (Cision/Muck Rack-style — cost + data-licensing to evaluate), or leave `PITCH_JOURNALIST` as a
    recommendation with **no draft** (surface the suggestion, let the human find the contact elsewhere) until
    one of the first two is worth building? Leaning: ship the **recommendation without a draft** first (cheap,
    high value on its own), revisit a real `MediaContact` model only if demand shows up.

# Requirements (traceable register)

The traceable requirement register for **signals** (the sections above are the rationale; this is the coded
list). IDs are stable handles (**`signals-N.M`**) — cite them in code, tickets, and tests. **Priority:** **A**
= MVP, **B** = core / hardening, **C** = later. **Boundaries:** signals owns **target/source definitions +
ingestion + AI triage + threshold gating + draft hand-off**; the **owning channel service** owns actually
sending; **marketplace** owns connected-account OAuth; **analytics**/**workflow** own downstream aggregation
and automation.

## signals-1.0 Targets & channels — A
- **signals-1.1** **`Target`** CRUD — `type` (campaign/company/competitor/product/sector/person/topic),
  optional reference to an existing platform entity, `label`, `keywords`/`aliases`/`links`/`images`,
  `sensitivity`, notify routing, `status` (active/paused) — A
- **signals-1.2** **`Channel`** opt-in per target — NEWS / RSS / REDDIT / SOCIAL / WEB_SEARCH / FORUM / BLOG /
  REVIEW_SITE — A
- **signals-1.3** **`Source`** CRUD — concrete origin under a channel (feed URL, saved query, subreddit,
  network); may be **shared across targets** or target-specific — A
- **signals-1.4** Target/source management is **USER**-gated; deleting a target retires (doesn't hard-delete)
  its findings/signals per retention — A
- **signals-1.5** An **uploaded image** on a target is stored via [media](../media/SPECS.md) and used only to
  seed keyword extraction (no ongoing visual search v1) — A
- **signals-1.6** **Boolean query builder** on a target's identifying material — AND/OR/NOT groups + exact
  phrase, not just a flat must/should/exclude list — table-stakes precision control per Awario/Brand24/Mention
  *(Competitive landscape)* — A
- **signals-1.7** **`Source.weight`** (0.0–1.0) — **channel-defaulted** (`NEWS` > `SOCIAL`/`REDDIT` >
  `WEB_SEARCH`, coded defaults v1) and **operator-overridable per source**; the credibility/reach input to
  both `Finding` severity (signals-3.3) and `Velocity` (signals-3.7) *(gap #4)* — A

## signals-2.0 Ingestion — A
- **signals-2.1** **`SignalsIngestJob`** polls/searches each bound `Source` on its **own configured cadence**
  via the channel's provider adapter — A
- **signals-2.2** **Dedupe at ingest** — a normalized url/text hash prevents the same item reaching classify
  twice, across sources — A
- **signals-2.3** **Manual "check now"** is guarded with an **in-flight lock + cooldown** per source, same
  posture as social's on-demand refresh — B
- **signals-2.4** A source's **connected-account listen** (the `SOCIAL` channel) reads through
  [marketplace](../marketplace/SPECS.md)'s vault — signals stores no OAuth token itself — A
- **signals-2.5** **Backfill on target creation** — optionally pull N days of history across newly-bound
  sources so triage isn't cold on day one *(gap: bounded by provider API history limits)* — C

## signals-3.0 AI triage — A
- **signals-3.1** **`SignalsClassifyJob`** calls `AiFactory` (`AiRouting.Modality.CHAT`, structured output)
  once per `Mention` → `affinityScore` · `sentiment`(+confidence) · `summary` · `entities[]` ·
  `recommendedAction`(+confidence) — A
- **signals-3.2** The classify prompt is **target-scoped** — folds in the target's label/type/keywords/aliases
  so affinity and recommendation are judged for that specific target — A
- **signals-3.3** **Threshold gate — per-finding path** — a `Finding` becomes a `Signal` (`trigger=finding`)
  when `affinityScore × sentiment weight × Finding.sourceWeight` crosses the target's configured
  sensitivity — A
- **signals-3.4** **Low-confidence findings are never auto-actionable**, regardless of any auto-accept
  configuration (signals-4.8) — A
- **signals-3.5** **Per-account AI-call budget** governs classify volume; a mention arriving over-budget is
  queued/delayed, never silently dropped *(gap #6)* — B
- **signals-3.6** **Human feedback** (thumbs up/down) captured per `Finding` verdict, surfaced for future
  per-target calibration *(gap #9)* — B
- **signals-3.7** **`Velocity`, computed inline (no extra AI call) — MVP.** Every `Finding` bumps its
  target's rolling **per-sentiment** `VelocityBucket` counter by `1 × Finding.sourceWeight`; recompute that
  bucket's current-window-vs-trailing-baseline rate-of-change on every bump. `POSITIVE` / `NEUTRAL` /
  `NEGATIVE` velocities are tracked **independently** — a target can trend positive and spike negative at the
  same time — NewsWhip's playbook, adapted with our own source-weighting *(Competitive landscape, gap #3)* — A
- **signals-3.8** **Threshold gate — velocity path** — a target's configured sensitivity also defines a
  **velocity breach** per sentiment bucket (a rate-of-change ceiling); breaching it creates a `Signal`
  (`trigger=velocity`, `velocitySnapshot` attached) **even with no single alarming `Finding`** — this path is
  **`OR`'d** with signals-3.3, not blended into one score, so an accelerating trend isn't diluted by averaging
  against ordinary mentions — A

## signals-4.0 Signals, triage & action hand-off — A
- **signals-4.1** The **triage queue** — list/filter `Finding`/`Signal` by target, status, sentiment, date
  range, severity — A
- **signals-4.2** **Accept / override / dismiss** a `Signal`'s recommended action — recorded with actor +
  timestamp — A
- **signals-4.3** Accepting a `DRAFT_*` action enqueues **`SignalsActionJob`**, which makes an **S2S**
  call to the owning channel service to create a **draft** (never a direct send) — A
- **signals-4.4** The resulting `Draft`'s status is read back **best-effort** (via that service's CRUD event)
  and reflected on the originating `Signal` — B
- **signals-4.5** **`SignalsDigestJob`** rolls up findings/signals since the last digest per target, where a
  target has a digest cadence configured, and sends it — B
- **signals-4.6** **Escalation** — an `ESCALATE` action (or a severity crossing a separate, higher escalation
  threshold) notifies a configured role/channel immediately, bypassing the target's normal digest cadence
  *(gap #11)* — B
- **signals-4.7** **Push delivery channels** — digest + escalation notify can target **email, Slack, Microsoft
  Teams, or a generic webhook**, per target/account config, not email-only — every competitor surveyed ships
  chat-tool push *(Competitive landscape, gap #10)* — B
- **signals-4.8** **Confidence-gated limited auto-accept** — an account may opt a **specific (target, action)**
  pair into auto-accept (e.g. `INTEL_ONLY` on a low-sensitivity watch); `DRAFT_*`/`ESCALATE` always stay
  human-gated regardless of confidence or configuration; **opt-in only, never a platform default**
  *(gap #8)* — C

## signals-5.0 Events — A
- **signals-5.1** Emit `signals.mention` on new deduped `Mention` — A
- **signals-5.2** Emit `signals.finding` on every AI-classified `Finding` (whether or not it crosses
  threshold) — A
- **signals-5.3** Emit `signals.signal` when a `Finding` **or** a velocity breach crosses threshold into a
  `Signal` (`trigger` on the payload distinguishes the two) — this is the **workflow trigger + analytics
  ingest point** — A
- **signals-5.4** Emitting **is best-effort** (log a miss, never fail the ingest/classify pipeline) — A
- **signals-5.5** **`COMPETITOR`-type targets are tagged for comparison** — every emitted event carries
  `target.type`, so [analytics](../analytics/SPECS.md) can build **share-of-voice** (mention volume +
  sentiment, the account's own target vs its named competitors, over time) without any new ingestion; every
  competitor surveyed leads with this — treat as a near-term analytics priority, not a someday extension
  *(Competitive landscape)* — B
- **signals-5.6** Emit `signals.velocity` on every `VelocityBucket` recompute (not only on a breach) — the
  continuous per-sentiment trend line, distinct from the discrete `signals.signal` breach event, for
  [analytics](../analytics/SPECS.md)' trend charts — B

## signals-6.0 Compliance & privacy — A
- **signals-6.1** **Excerpt-only storage** — no full-text reproduction of a source article/post — A
- **signals-6.2** **Sanctioned sources only** — every channel adapter uses a published API or feed; no
  ToS-violating scraping — A
- **signals-6.3** **Retention TTL** on `Mention`/`Finding`, tighter for `PERSON`-type targets — A
- **signals-6.4** **Erasure** — deleting a `Target` retires its findings/signals; a person's platform-wide
  forget request best-effort scrubs matching `PERSON`-target rows — B
- **signals-6.5** **`PERSON` targets require an explicit legitimate-interest note** at creation — A
- **signals-6.6** **No autonomous external action** — every recommended action is human-gated before it
  becomes a draft, and draft→send is gated again by the owning channel's own approval workflow — A
- **signals-6.7** **Tenant isolation** — targets/findings/signals are account-scoped; shared `Source` rows
  carry no account data of their own — A
- **signals-6.8** **No PHI**; encryption at rest (KMS) + TLS — A

## signals-7.0 Service & Job topology — A
- **signals-7.1** **Domain bases** — `SignalsService extends Service` + `SignalsJob extends Job` hold the
  shared code (models · channel adapter factory · AI classify · threshold gate · Kafka emit); concrete roles
  extend the domain base — A
- **signals-7.2** **`SignalsMainService`** — the `/signals/*` API (targets · sources · triage · action ·
  config/health) — A
- **signals-7.3** **Jobs extend `SignalsJob`** — `SignalsIngestJob` / `SignalsClassifyJob` /
  `SignalsActionJob` / `SignalsDigestJob`, each **SQS-buffered + DLQ** where consuming a queue — A
- **signals-7.4** **Three independently-scaled pipeline stages** (ingest / classify / action) — a burst in one
  never blocks another — A

## signals-8.0 Channel provider adapters — A
- **signals-8.1** Each channel is a **thin adapter** (`search(query, since) → RawMention[]`) behind one
  interface — RSS / News / Reddit / Social(marketplace-read) / Web-search — A
- **signals-8.2** **No general crawler** — a channel with no sanctioned API/feed is out of reach until a
  bespoke, reviewed adapter is added — A
- **signals-8.3** **Social channel reuses marketplace's vault** — no duplicate OAuth storage — A
- **signals-8.4** **v2 candidate:** a premium aggregator connector (Meltwater/Brandwatch/…) as an additional
  channel, same interface *(gap #1)* — C

## signals-9.0 Journalist / influencer pitch (competitive answer to Cision/Muck Rack) — C
- **signals-9.1** **`PITCH_JOURNALIST`** recommended action — surfaced on a `Finding`/`Signal` when the AI
  identifies the mention as press coverage worth pitching (a reporter/outlet actively covering the story) —
  C
- **signals-9.2** **v1 ships the recommendation only, no draft** — "here's who's writing about this" is
  useful on its own without a `MediaContact` model; drafting an actual pitch waits on signals-9.3 *(gap
  #18)* — C
- **signals-9.3** **`MediaContact` lookup** (own scoped model, or an integrated third-party journalist
  database) — required before `PITCH_JOURNALIST` can produce a real `Draft` the way `DRAFT_EMAIL`/`DRAFT_TEXT`
  do *(gap #18)* — C

# Endpoints (first cut)

A first pass, in [`@repo/endpoint`](../../../packages/endpoint/SPECS.md) style — service-prefixed
`/signals/*`. **Access column:** **`minAccess`** — **`-`** public · account ladder
**`SENDER`<`USER`<`BILLING`<`ACCOUNT`** · staff **`SUPPORT`<`APPLICATION`<`ROOT`** · **`Internal`** =
VPC-only S2S.

| Method | URI | Purpose | Access | Req |
|---|---|---|---|---|
| GET, POST | `/signals/targets` | List / create a `Target` | USER | signals-1.1 |
| GET, PATCH, DELETE | `/signals/targets/{targetId}` | Read / update (incl. pause) / retire a `Target` | USER | signals-1.1/1.4 |
| GET, POST | `/signals/targets/{targetId}/sources` | List / bind `Source`s (create new or attach shared) to a target | USER | signals-1.2/1.3 |
| DELETE | `/signals/targets/{targetId}/sources/{sourceId}` | Unbind a source from a target | USER | signals-1.3 |
| PATCH | `/signals/sources/{sourceId}/weight` | Override a shared/target source's credibility `weight` | ACCOUNT | signals-1.7 |
| GET | `/signals/targets/{targetId}/velocity` | Current + trailing `Velocity` (positive/neutral/negative rate-of-change) for a target | USER | signals-3.7 |
| GET | `/signals/findings` | List/filter `Finding`s — by target, sentiment, date range | USER | signals-4.1 |
| GET | `/signals/signals` | List/filter `Signal`s — by target, status, severity, date range | USER | signals-4.1 |
| GET | `/signals/signals/{signalId}` | Read one `Signal` + its `Finding` + `Draft` (if any) | USER | signals-4.1 |
| POST | `/signals/signals/{signalId}/action` | **Accept / override / dismiss** the recommended action | USER | signals-4.2/4.3 |
| POST | `/signals/findings/{findingId}/feedback` | Thumbs up/down on an AI verdict | USER | signals-3.6 |
| GET, PUT | `/signals/config` | Runtime config — per-source cadence bounds, check-now cooldown, AI budget, digest defaults, push-delivery targets (Slack/Teams/webhook), auto-accept opt-ins | ACCOUNT | signals-2.3/3.5/4.5/4.7/4.8 |
| GET | `/signals/health` | Liveness / readiness (adapters + queues + scheduler) | - | signals-7.1 |

# eof

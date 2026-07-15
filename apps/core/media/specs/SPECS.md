#
# Media Service
#

# Objective

The platform's **media plane** — the one place every account's **files** (images, video, audio, documents, and
generated artifacts) are **stored, secured, processed, served, and expired**. Other services *use* media —
[campaign](../campaign/SPECS.md) and the channels embed it in sends, [survey](../survey/SPECS.md) and
[print](../print/SPECS.md) render with it, [report](../report/SPECS.md) deposits artifacts — but **none of them
own bytes on disk**: they hold a **media reference** and let media handle storage, access control, transformation,
and lifecycle. Media's job is to make "a file" a **first-class, account-scoped, access-controlled, derivable
object** rather than a blob someone dropped in a bucket.

The shape of the problem: bytes are **big, cacheable, and expensive to move**, but access to them is
**per-account and role-gated**, and the useful form is rarely the uploaded one (a 4K source isn't an MMS clip or a
mobile thumbnail). So media separates **the bytes (S3) from the truth about them (DynamoDB)** and **decisions
about them (the endpoint) from the serving of them (CloudFront / S3)**.

> **Related:** [BROWSE.md](./BROWSE.md) — **Media : Browse**, the third-party asset marketplace (search /
> download / purchase across pluggable providers + AI generators; imports land here as library assets with
> provenance). Requirements continue the media register at `media-12.x`.
>
> **UI surfaces (web nav → Media):** **Library** (owned assets) · **Browse** (acquire EXISTING third-party
> assets — BROWSE.md) · **AI Gen** (create NEW assets from prompts) · **Studio** (post-creation editing).
> **AI Gen** is deliberately its OWN surface, not part of Browse: Browse *finds what exists*, AI Gen *makes
> what doesn't*. It has one sub-tab per generative modality — **Image · Video · Voice · Sound** — each routed
> to a provider by the account's `config/ai` routing (`AiRouting`, keys from the platform Secrets; see
> BROWSE.md `media-17`). Generated outputs save to the Library as assets with `source.origin = generated`
> (vs Browse's `provider`), so provenance, licensing, and dedup stay uniform across both surfaces.

The load-bearing ideas:
* **S3 holds bytes, DynamoDB holds the truth** — raw files live in **per-account S3 buckets**
  (`:accountId/{public|protected|private}/:guid`); a DynamoDB record is the **index** (guid · filename · mime ·
  size · `accessRole` · status · **parent** for variants · version · TTL · type-specific meta) and the **source of
  truth** for what exists, who may see it, and when it expires;
* **never direct S3 — the endpoint decides, the CDN serves** — private / protected files resolve through an
  **access-controlled endpoint** that checks role + **logs access**, then hands back a **time-limited pre-signed
  URL** (it issues the *decision*, it does **not** stream the bytes); public files ride **CloudFront with Origin
  Access Control** so the bucket is never public and the endpoint is hit only on **cache miss**;
* **safe-by-default ingest** — uploads go **direct to S3 via pre-signed URL**, an S3-created event fans through
  **SQS → dispatcher**, and a file is **`uploading → scanning → processing → ok`** (virus scan via a **factory**,
  ClamAV / Sophos) — **quarantined** files are never servable;
* **derive, don't mutate — the original is immutable** — variants are produced on **account rules** (image
  renditions via **Sharp**; video transcode / compression via **MediaConvert** or self-hosted **ffmpeg**,
  including the **EVT** "compress small enough to send as an MMS" pipeline) and reference the source via
  `parent.uid`; the original is **always retained**;
* **cost + lifecycle are first-class** — **CDN caching** for public paths, **Glacier** for cold (last-accessed)
  files, **TTL + soft-delete-then-sweep** for expiry, and **per-account bandwidth + API rate limits** (Redis) so
  one account can't run up another's bill.

# Video compression (EVT — video texting)

A specific video variant: **compress a video small enough to send as a text (MMS)** — target **≤ 45 s** and
**< ~750 KB**. Today this is a **self-hosted ffmpeg** pipeline (`bkjs-evt`); the managed-AWS equivalent is at the
end.

**Pipeline (in order):**
1. **Upload** — source `.mp4` → S3 (rate-limited, e.g. 10/day/account).
2. **Preprocess** — download + **`ffprobe`** (validate it's real media), build a **preview thumbnail**, write a
   **job descriptor**.
3. **Process** — a **dedicated container** reads the job, drives the transcode, reports **progress**.
4. **Transcode** — fetch source; *optionally* stitch a **lead frame** and/or **burn subtitles**; run the
   encoder; store the winning output + a **screenshot**.
5. **Attach** — bind the compressed video to the project / action.
6. **Finalize** — mark done/error, progress 100, notify.

**Input requirements:** must be **video** with a usable **video and/or audio** stream (video must report a
width); `ffprobe` extracts length / width / height / codecs / bitrates / sample-rate / channels / **SAR / DAR**
(DAR via GCD if absent) — these drive geometry.

**Targets (configurable):** **maxSize ~750 KB** (hard cap the output must fit under), **duration 45 s** (trim if
longer), **AAC** audio, a **quality ladder** of presets tried in order. Carries an **EVT surcharge** (e.g. $0.04).

**Encode (fixed):** **HEVC `libx265`** (main10, `hvc1`) — or **H.264** (`avc1`) on a flag; `yuv420p`, **BT.709**,
ffmpeg **`veryslow`**; audio **mono**, ~22 kHz, bitrate per preset; **resolution chosen from the source aspect**
(square → 640×640; landscape ≤854×480 → 480p else nHD; portrait → ⅔ downscale); filters: scale + `setdar`,
denoise, unsharp.

**Size-cap strategy — CRF ladder, trial-and-error:** try presets **1→4**, stop at the **first output that fits
under maxSize**. The ladder trades quality for size monotonically (CRF 32→38 · audio 64k→22k · fps 15→12 ·
denoise/sharpen light→aggressive). If **none** fit → **fail** ("unable to compress under cap").

**AWS-managed equivalent — AWS Elemental MediaConvert:** the managed transcoder — **S3 in/out**, reusable **job
templates + output presets**, HEVC/H.264, resolution scaling, **EventBridge** job-state events for progress.
The difference is **how the size cap is met**: MediaConvert targets a **computed bitrate** (≈ `maxSize·8 /
duration`, minus audio) via **QVBR** (quality-defined VBR) with a **max-bitrate cap** (or 2-pass), rather than
the ffmpeg **CRF-retry ladder**. So a MediaConvert path replaces the *encode* step (self-hosted ffmpeg → managed
job) and swaps **CRF-retry → bitrate-target/QVBR**, keeping the same pipeline shape.

**MediaConvert vs ffmpeg — when each wins.** Not strictly "better" — different trade-offs. **ffmpeg (self-hosted,
current) fits EVT** because the core algorithm is a **hard byte-cap via CRF-retry** + a **custom filtergraph**
(lead-frame stitch, denoise/unsharp, burned subtitles) — MediaConvert can't natively retry-until-under-cap and
is less flexible on arbitrary filters; clips are tiny so compute is cheap. **MediaConvert wins** on
**ops-offload** (no encoder fleet to run/patch — ffmpeg/codecs are a real CVE surface), **HEVC patent
licensing** (its price includes the royalties self-hosted x265 makes *you* responsible for), **burst scale**,
and pro formats (HLS/DASH/DRM). **Recommendation:** keep **ffmpeg for EVT**; consider MediaConvert for general
transcoding or if HEVC-licensing / ops / scale dominate. **ffmpeg runtime:** use a **native binary in a
container/layer built with `libx265` + `libfdk_aac`** (`--enable-gpl --enable-nonfree`) — the vanilla
`ffmpeg-static` npm build often **lacks** those; drive it from Node (`fluent-ffmpeg` / `child_process`).
**`ffmpeg.wasm` is NOT suitable** here (too slow, memory-bound, and its default build omits libx265/libfdk_aac).

**ffmpeg-container vs MediaConvert — at a glance:**

| | self-hosted **ffmpeg (container)** | **AWS MediaConvert** |
|---|---|---|
| Hard byte-cap | **CRF-retry ladder** → guaranteed under cap | QVBR / 2-pass to a **computed bitrate** (≈ cap — verify) |
| Custom filters (stitch · denoise · burn-subs) | **full filtergraph** | limited preset filters |
| Ops burden | you run / patch the fleet + image | **fully managed** |
| HEVC patent licensing | **your** responsibility (x265) | **included** in the price |
| Cost model | per task-second (**Spot-cheap** at scale) | **per output-minute** |
| Scale / burst | autoscale tasks on queue depth | **elastic, managed** |
| Best for | **EVT** (precise cap + custom filters) | general transcode, scale, licensing offload |

**Architecture — ffmpeg in a container.** The encode runs as a **stateless worker container**, fed by the same
S3-event → SQS → dispatch path as other media jobs:

```
upload → S3 (source)
  └─ S3 "created" event → SQS  (dispatch fair-shares per account)
        └─ ffmpeg worker (container) pulls the job:
             1. read job descriptor (DDB/S3) + download source to ephemeral disk
             2. ffprobe  → validate + geometry
             3. ffmpeg encode — CRF ladder (presets 1→4) until output < maxSize
             4. upload winning output + screenshot → S3
             5. update status/progress (DDB); delete SQS msg  (→ DLQ on failure)
```

* **Image:** base (Debian / AL2) + **ffmpeg/ffprobe built with `libx265` + `libfdk_aac`** + the Node
  orchestration, pushed to **ECR** — codecs baked in, built once.
* **Compute — `ECS Fargate` (default):** serverless tasks, **no fleet to manage**, **no 15-min cap** (the
  multi-preset `veryslow` ladder can run long), scale by **task count on SQS depth**. **`ECS on EC2 + Spot`**
  when cost at scale dominates (encode is **retryable → Spot-friendly**; compute-optimized or NVENC-GPU). A
  **Lambda container image** only if an encode reliably fits **< 15 min** (tight for the 4-preset veryslow loop).
* **Stateless + isolated:** all state lives in **S3** (source/output) + **DDB** (job/status) + **SQS**; the
  worker holds the file only on **ephemeral disk** during the job. ffmpeg parses **untrusted media** (a real CVE
  surface) → run it **locked-down** (egress limited to S3, CPU/mem + **timeout** caps to kill runaway encodes) —
  which is also why **scan / quarantine** (`media-5`) gates serving.
* **Scaling + fairness:** autoscale workers on **queue depth**; the **[dispatch](../../../packages/services/DISPATCH.md)**
  governor meters **per-account** so one account's batch can't starve others (the "media dispatcher").

# Compliance & standards mapping

How **this media service's** controls map to **OWASP Top 10 (2021)**, **ISO/IEC 27001:2022** (Annex A), **SOC 2
Type 2** (TSC), **HIPAA** (if PHI), **GDPR**, and **CCPA/CPRA**. Media is **account-scoped object storage +
delivery** (upload, variants, CDN). Clause refs are **indicative**; this is a **design-intent** self-assessment.
There is **no PCI** surface (no payment data) and **no messaging-law** surface. **HIPAA** is ➖ (no PHI by
[AUP](../account/specs/SPECS.md); an upload *could* carry it → AUP gate). **No direct S3** — all access is via
the endpoint / CDN with access control + audit logging; fair-share processing rides
[dispatch](../../../packages/services/DISPATCH.md). Identity/RBAC live in [auth](../auth/specs/SPECS.md); residency is the
platform [AWS topology](../../../packages/services/src/aws/SPECS.md).

**Legend:** ✅ meets/exceeds · ⚠️ partial / open — see Gaps · ➖ n/a

| Media control | OWASP T10 | ISO 27001:2022 | SOC 2 (TSC) | HIPAA (if PHI) | GDPR | CCPA | |
|---|---|---|---|---|---|---|---|
| **Tenant isolation** — per-account S3 prefixes (`:accountId/…`) + DynamoDB `PK accountId`; never cross-account | A01 | A.8.3 | CC6.1 | ➖ | Art 32 | §1798.100 | ✅ |
| **No direct S3** — all reads via the **endpoint / CDN** with access control + **access logging** | A01 / A05 | A.8.3 / A.8.20 | CC6.1 / CC6.6 | ➖ | Art 32 | ➖ | ✅ |
| **Per-object access tiers** — `public` / `protected` / `private` + `accessRole` (CDN public; authed otherwise) | A01 | A.5.15 / A.8.3 | CC6.1 / CC6.3 | ➖ | Art 32 | ➖ | ✅ |
| **CloudFront OAC** — bucket has **no public access**; CDN-only origin | A05 | A.8.9 | CC6.6 | ➖ | ➖ | ➖ | ✅ |
| **Time-limited pre-signed URLs** — decide access + hand off; **never stream bytes** through the service | A01 / A04 | A.8.20 | CC6.6 | ➖ | Art 32 | ➖ | ✅ |
| **Malware scan on upload + quarantine** — SQS scan stage wired; **stub now, engine (ClamAV/Sophos) later** | A08 | A.8.7 / A.8.26 | CC7.1 | ➖ | ➖ | ➖ | ⚠️ engine later — see Gaps |
| **Upload validation** — MIME / extension / size limits | A03 / A04 | A.8.26 | CC7.1 | ➖ | ➖ | ➖ | ✅ |
| **Access audit** — who / when / region (endpoint + CloudFront logs), centralized | A09 | A.8.15 / A.8.16 | CC7.2 | ➖ | Art 30 | ➖ | ✅ |
| **Encryption** — at rest (SSE-KMS) + in transit (HTTPS) | A02 | A.8.24 | CC6.1 | §164.312(a)(2)(iv) | Art 32 | ➖ | ✅ |
| **GDPR erasure + retention** — soft-delete → sweep; **opaque `guid` keys** (no PII in the path); TTL + Glacier tiering | A04 | A.5.33 / A.8.10 | (Privacy) | §164.310(d)(2) | Art 17 / 5(1)(e) | §1798.105 | ⚠️ contact-link scope — see Gaps |
| **Bandwidth / rate limits** — per-account (Gateway + Redis); abuse / DoS resistance | A04 | A.8.6 | CC6.6 / A1.2 | ➖ | ➖ | ➖ | ✅ |
| **No PHI** by AUP — uploads could carry it; prohibited | ➖ | A.5.34 | (Privacy) | §164.502 (AUP gate) | Art 9 | ➖ | ✅ AUP no-PHI |

# Gaps & decisions

*The one review list — the working notes above are the rationale; this is what's settled vs open.* ✅ = resolved/decided · ⚠️ = **open — needs attention**.

1. ✅ **Delivery model — DECIDED.** **No direct S3.** Public assets via **CloudFront + OAC** (no public bucket);
   `protected` / `private` behind the **endpoint** (auth + access log). The service **decides access + hands off
   a time-limited pre-signed URL / CDN URL — it never streams the bytes**. New version → new URL
   (`/public/:guid/:version`).
2. ✅ **"Media dispatcher" = the [dispatch](../../../packages/services/DISPATCH.md) fair-share governor**, not a bespoke
   component — upload/scan/process work is fair-shared per account (same as the email/SMS dispatchers).
3. ✅ **Malware scanning — DECIDED (stub now, engine later).** Wire the **SQS scan stage + worker now**, but the
   **stub worker no-ops** — it **returns done, updates `status` (→ `ok`), and advances** the item — so the
   upload → scan → quarantine **plumbing is end-to-end today**. The **real scan engine** (factory — ClamAV
   Lambda/ECS · Sophos) is a **later phase** that drops into the same stage (`media-5.1` / `5.2`). **Interim
   posture** follows from the stub: items **pass through (marked `ok`)** until the engine ships.
4. ✅ **Variant generation — DECIDED (configurable, both modes).** **Both** strategies are supported and chosen
   by config: an **application-layer default**, **overridable per-account by an account admin** (`ACCOUNT`+) —
   there's a real use case for each (**pre-process** = predictable/warm for known sizes; **on-demand at the edge
   + cache** = cheaper, no wasted variants). Always keep the **original** (`media-4.3`).
5. ✅ **GDPR erasure scope — DECIDED.** Media is **account-owned assets** (templates, images), **not tied to a
   contact** — so **`contact-forget` does not touch media**; only **account deletion** purges an account's media
   (opaque `guid` keys, no PII in the path). **Note for later:** if media ever becomes **contact-tagged**
   (per-person PII), wire it into the contact-forget fan-out (`media-8.3`).
6. ✅ **Cold-tier archival — DECIDED (later phase).** Move **unused** assets to **Glacier** based on the asset's
   **`lastAccessedAt`**, with the threshold a **TTL configured system-wide (platform default) + overridable
   per-account**. **Later-phase** development (`media-6.1`); exact default numbers tune at build time.

# Service & Job topology

**Convention (platform-wide).** Each service layers **framework base → domain base → concrete role**. A **domain
Service base** (`MediaService extends Service`) and a **domain Job base** (`MediaJob extends Job`) hold the
**shared domain code** — the **object index / model**, the **S3 + presign** logic, the **signed-URL / OAC**
delivery, the **scan-status gate** (no deliver/process before clean), the **processing + scan provider
factories**, and **audit** — so every concrete role inherits it. The shape is **upload → scan → process →
deliver**: one API service + a pipeline of workers; delivery is **CloudFront** (edge), not the service.

```
Application
├── Service (Fastify, long-running — ECS)
│     └── MediaService            (domain base — object index/model · S3 + presign · signed-URL/OAC · scan-status gate · scan/process factories · audit; not deployed alone)
│           └── MediaMainService   (the /media/* API: presigned upload init/complete · object CRUD/metadata · variant requests · signed-URL issuance · config/health)
└── Job (Lambda / Fargate, event-driven)
      └── MediaJob                 (domain base — object index · S3 · scan/process factories · idempotency)
            ├── MediaScanJob        (SQS from S3-event — malware scan (ClamAV/Sophos factory) → QUARANTINE on detection; clean → mark scanned + trigger processing)
            ├── MediaProcessJob     (SQS — image processing (Sharp): resize/crop/convert/thumbnail/variants → write outputs + update index)
            ├── MediaVideoJob       (SQS / MediaConvert — video transcode (ffmpeg / MediaConvert; EVT video-texting compression) submit + completion)
            └── MediaLifecycleJob   (EventBridge — lifecycle/cost: Glacier tiering · expiry · orphan cleanup · quota rollup)
   (+ MediaVariantEdge — a Lambda@Edge function at the CloudFront edge for ON-DEMAND variants)
```

**Services (HTTP, ECS Fargate)**

| Class | Extends | Role |
|---|---|---|
| **`MediaService`** | `Service` | **Domain base** — object index/model · S3 + presign · signed-URL/OAC delivery · scan-status gate · scan/process factories · audit; **not deployed alone**. |
| **`MediaMainService`** | `MediaService` | The **`/media/*` API** — presigned **upload** init / complete, object **CRUD / metadata**, **variant** requests, **signed-URL** issuance (delivery is via CloudFront), config/health. The user + S2S surface (consumed by email / campaign / web). |

**Jobs (Lambda / Fargate, event-driven)** — each extends `MediaJob`:

| Class | Trigger | Role | Req |
|---|---|---|---|
| **`MediaScanJob`** | SQS (S3-event → dispatch) | **Malware scan** (ClamAV / Sophos factory) — **quarantine** on detection; on **clean** → mark scanned + **trigger processing** (the security gate before anything is processed or delivered) | media-5.0 |
| **`MediaProcessJob`** | SQS | **Image processing** (Sharp) — resize / crop / convert / thumbnail / variants → write processed outputs + update the object index | media-4.0 |
| **`MediaVideoJob`** | SQS / MediaConvert | **Video transcode** (ffmpeg / **MediaConvert**; the EVT video-texting compression) — submit + handle completion (heavy work on Fargate / managed transcode) | media-10.0 |
| **`MediaLifecycleJob`** | EventBridge (scheduled) | **Lifecycle / cost** — Glacier tiering, expiry, **orphan cleanup**, quota rollup | media-6.0 |

> **Shared modules (not deployables).** The **processing factory** (Sharp images · ffmpeg/MediaConvert video) and
> the **scan provider factory** (ClamAV / Sophos), plus the **object-index model** and **presign / signed-URL /
> OAC** logic, live on the bases and are reused across the API + workers. **On-demand variants** are a
> **Lambda@Edge** function at the CloudFront edge (not a standing Job); fair-share over the processing pipeline
> rides [dispatch](../../../packages/services/DISPATCH.md). **Scan gates processing** — nothing is processed or delivered
> until `MediaScanJob` clears it.

# AWS Services and Other Dependencies

**AWS services**
* **S3** (+ lifecycle / **Glacier**) — raw files + processed outputs.
* **DynamoDB** — the object index.
* **CloudFront** (+ **OAC**, + **Lambda@Edge** for on-demand variants) — delivery.
* **SQS** — S3-event → dispatch → scan / process → quarantine.
* **Lambda / ECS Fargate** — scan + processing workers; **ECR** — worker images.
* **AWS Elemental MediaConvert** — managed video transcode (alternative to self-hosted ffmpeg).
* **Redis (ElastiCache)** — rate limits; **KMS** — SSE-KMS.

**Third-party libraries / services**
* **Sharp** — image resize / crop / convert.
* **ffmpeg / ffprobe** — video (build with `libx265` + `libfdk_aac`).
* **ClamAV / Sophos** — malware scan (factory; later phase).

**Candidate libraries / services (to evaluate — not yet decided)**
* **Remotion** ([remotion.pro](https://www.remotion.pro/)) — programmatic, React-based video creation/editing;
  candidate for **integrated, templated video editing** (data-driven renders, per-account branded video, an
  in-app editor) rather than raw transcode. Renders via a headless-Chromium pipeline; note licensing (Remotion
  is free for individuals/small teams, **paid company license** at scale) and that its render fleet is separate
  compute from the ffmpeg/MediaConvert transcode path.
* **GStreamer** ([gstreamer.freedesktop.org](https://gstreamer.freedesktop.org/)) — a pipeline-based multimedia
  framework; candidate **ffmpeg alternative** for transcode/compression. Pluggable element graph (LGPL core;
  codec plugins carry their own licensing — same HEVC/patent considerations as ffmpeg), suited to streaming /
  live pipelines. Evaluate vs. the self-hosted-ffmpeg vs. MediaConvert trade-offs above (ops surface, filters,
  size-cap retry) before adopting.
* **Shotstack** ([shotstack.io](https://shotstack.io/)) — a **hosted, API-first video editing / rendering**
  service (JSON edit spec → rendered MP4, templates, a Studio SDK for in-app editing). Candidate for
  **integrated, templated video editing** without running our own render fleet — the managed alternative to
  Remotion. Fully SaaS (usage-priced, bytes leave our VPC to a third party — weigh against the data-residency /
  PII posture in media-8), so evaluate vs. self-hosted Remotion on cost-at-scale, template flexibility, and
  whether renders can stay in-region.
* **Creatomate** ([creatomate.com](https://creatomate.com/)) — a **hosted video/image generation + editing
  API** (template-driven, data-merge renders, MP4/GIF output, a template editor). Same class as Shotstack: an
  integrated, templated video-edit candidate with no render infrastructure to operate. Compare the two head to
  head (template model, editor UX, API ergonomics, pricing, region/residency) and both against self-hosted
  Remotion before deciding.
* **ffmpeg.wasm** ([ffmpegwasm.netlify.app](https://ffmpegwasm.netlify.app/)) — ffmpeg compiled to
  WebAssembly; candidate for **client-side / in-browser** trim, transcode, and thumbnailing. Attractive for
  light edits that never leave the browser (no source upload, no server compute), but note the hard limits:
  large WASM payload, single-threaded / memory-capped (≈2–4 GB, no true hardware accel), and the same
  **HEVC/patent** considerations as native ffmpeg. Best framed as an **edge/preview** complement to the server
  transcode path — media-10.9 keeps the heavy encode on the **native binary**, explicitly *not* `ffmpeg.wasm` —
  so evaluate it for previews, quick trims, and offloading trivial jobs, not as the primary encoder.

**Internal (`@repo/*`)**
* `@repo/services` (S3, Dynamo, Cache, Sqs, Kms), `@repo/endpoint` (`Access`), `@repo/common` (`Type`). Fair-shared by **[dispatch](../../../packages/services/DISPATCH.md)**; consumed by **email / campaign / web**.

# Requirements (traceable register)

The traceable requirement register for the **media service** (the working notes above are the rationale; this
is the coded list). IDs are stable handles (**`media-N.M`**) — cite them in code, tickets, and tests.
**Priority:** **A** = MVP, **B** = core / hardening, **C** = later. One level of sub-requirements; a group's
priority is its floor. **Boundaries:** media owns **account media — storage, the object index, access/delivery,
upload, processing, lifecycle**; fair-share processing rides [dispatch](../../../packages/services/DISPATCH.md); plan limits
(quota) come from [account](../account/specs/SPECS.md) `ResolvedEntitlements`; consumed by **email / campaign /
web** (attachments + assets).

## media-1.0 Storage & object model — the ENVELOPE (media-22) — A

A media **Asset is an ENVELOPE** — a package of content, not a single file. The envelope carries the
library-level metadata (name, tags, kind, ownership, provenance) and holds a set of **items** (media files):
the **original** plus all **derived media** produced from it. This is the single model for every media surface
(upload, Browse import, AI Gen, transcode, transcribe, Studio outputs).

- **media-1.1** **Envelope = the library object** (`Media.Asset`): `name`, `tags`, `kind` (= the **original's**
  kind, denormalized for list/filter), `scope` (`ACCOUNT`|`USER`), `accessRole`, `tier`, `campaignIds`,
  `source` (origin/provenance — see 1.7), `createdBy`, `createdAt`, `status` (rollup — see 1.8), `ttl`, and
  **`items: Array<Media.Item>`**. Every envelope has exactly one item with `usage = ORIGINAL`. — A
- **media-1.2** **Item = a contained media file** (`Media.Item`): `id`, **`usage`** (category enum), `profile?`
  (discriminator within a usage — e.g. `tiktok`/`mobile`/`mms`), **`kind`** (the item's OWN media kind — a
  VIDEO envelope may hold an IMAGE poster, an AUDIO track, a DOCUMENT transcript), `mime`, `extension`, `size`,
  `version` (bumps on replace), `status`/`ready`, **`meta`** (per-kind metrics union — see 1.6), `derivation?`
  (the job + params that produced a derived item), `createdAt`, `modifiedAt`. — A
- **media-1.3** **Usage is a typed category; `profile` names the specific one.** `Media.Usage` =
  `ORIGINAL · DISPLAY · THUMBNAIL · POSTER · COMPRESSED · AUDIO · TRANSCRIPT · PLATFORM · GENERATED · RENDER`
  (closed set). The **item key is `usage[.profile]`** — unique within the envelope. Valid usages per original
  kind are catalogued (`Media.USAGE_CATALOG`): image → display/thumbnail/platform; video →
  compressed/audio/transcript/poster/platform; audio → transcript/compressed. Some usages are **single**
  (`original`, `poster`), others **multi / 0-N** (`compressed`, `platform`). — A
- **media-1.4** **Re-run = replace + version by `(usage, profile)`** — deriving the same key **replaces** the
  current item and **bumps its `version`** (S3 versioning keeps history); the **original is never replaced**.
  Each item records its **current S3 `versionId`**; the prior bytes stay in S3's version history. The UI can
  **list an item's versions** (`GET /media/assets/{guid}/versions?item=<usage[.profile]>`, newest first) and
  **revert** to one (`POST /media/assets/{guid}/revert` `{ item, versionId }`) — revert copies that version
  back onto the current key (a NEW latest version; nothing is destroyed) and bumps the item's `version`. The
  S3 facade wraps this as `s3.listVersions` / `s3.restoreVersion`. — A
- **media-1.5** **S3 layout** — one prefix per envelope: `acct/<accountId>/media/<guid>/<usage[.profile]>.<ext>`
  (owner roots per the `S3.Domain` registry; adding a root edits the enum). — A
- **media-1.6** **Per-kind item metrics** — `meta` is a discriminated union by the item's `kind`: **image**
  (w/h/format/space/…), **video** (w/h/duration/fps/codec/bitrate/…), **audio** (duration/bitrate/sampleRate),
  **document/text** (length; a TRANSCRIPT item's meta holds the `text` + timed `segments`). — A
- **media-1.7** **Provenance** — `source` on the **envelope** describes the object's ORIGIN (upload / provider /
  generated + url / license / cost / prompt); a **derived item** carries its own `derivation` (producing job +
  params) so it can be reproduced / re-run. — A
- **media-1.8** **Status is per-item** (derivations complete independently — AI-gen candidates, transcribe,
  compress each flip `ready` on their own); the **envelope `status`** is the original's readiness (gates
  delivery) plus a rollup. — A
- **media-1.9** **DDB: one row per envelope, items embedded** (`PK accountId`, `SK guid`) — keeps the package in
  one place. Caveat: the 400 KB item limit — if an envelope's item count ever explodes, move items to child
  rows; typical envelopes (original + a few derived) stay well under. Versioning keeps the **original**. — A
- **media-1.10** **Soft delete → sweep**; **TTL** (default / account / env). — B
- **media-1.11** **Ownership vs. campaign use** — the envelope is owned by an **account** (or a **user**, for an
  avatar): `scope` = `ACCOUNT` | `USER` only. It is **used by 0..N campaigns** — a many-to-many association,
  not ownership: `campaignIds` is a **denormalized filter**; the **source of truth is the campaign**. **An
  envelope cannot be deleted while `campaignIds` is non-empty** (409 until every referencing campaign
  detaches). — A
- **media-1.12** **Studio alignment** — a Studio project is an envelope of editor **source** items + produced
  **outputs** (`usage = RENDER`, `profile = lowres`/`highres`); the same envelope model carries editor assets →
  final work (svg→jpeg, midi, video editor). — B

## media-2.0 Access & delivery — A
- **media-2.1** **No direct S3** — all access via the **endpoint / CDN** with access control + **access logging** — A
- **media-2.2** **Per-object tiers** — `public` (CDN) / `protected` / `private` (authed) + `accessRole` gate — A
- **media-2.3** **CloudFront + OAC** for public paths (no public bucket access); cache; endpoint hit only on miss/expiry — A
- **media-2.4** **Time-limited access hand-off — never stream bytes** — the service decides access, then hands off a **time-limited URL**: an **S3 pre-signed URL** (single object) or a **CloudFront signed URL / signed cookies** (CDN-delivered protected content, e.g. multi-file video) *(gap #1)* — A
- **media-2.5** **Access audit** — who / when / region (endpoint + CloudFront logs), centralized — B

## media-3.0 Upload — A
- **media-3.1** **Direct-to-S3** via pre-signed **POST/PUT** URL — A
- **media-3.2** S3 created event → **SQS → [dispatch](../../../packages/services/DISPATCH.md) (media)** → scan/process job — A
- **media-3.3** **Status lifecycle** — `uploading` → `scanning` → `processing` → `ok` / `failed` / `quarantined` — A
- **media-3.4** **Upload validation** — MIME / extension / size limits — B

## media-4.0 Processing & variants — B
- **media-4.1** **Image variants** (mobile / tablet / desktop) via **Sharp** (resize / crop / convert) — B
- **media-4.2** **Video** transcode / compress / format via **AWS Elemental MediaConvert** (ffmpeg/ffprobe tooling); the **EVT video-texting** compression variant → `media-10` — B
- **media-4.3** Always retain the **original** — A
- **media-4.4** **Variant strategy is configurable** — **application-layer default**, **account-admin override** (`ACCOUNT`+): **pre-process** all variants **or** **on-demand at the edge** (CloudFront + Lambda@Edge) + cache; both supported *(gap #4)* — B
- **media-4.5** Process per **account rules** — B
- **media-4.6** **Named variant profiles (`VariantSpec`) — media is a generic engine; consumers own the specs.**
  A `VariantSpec` = `{ mime, label?, width?, height?, fit?, format?, maxBytes?, quality? }` — a render target
  matched to a source by **`mime`** (`"image/*"` / exact). A **profile** is a NAME → `Array<VariantSpec>`, so
  one profile spans media types + placements: e.g. `"instagram"` = `[ {mime:"image/*", label:"feed", 1080²},
  {mime:"image/*", label:"story", 1080×1920}, {mime:"video/*", label:"reel", …} ]`. The processor selects the
  specs matching the asset's mime and produces one variant each, **named `<profile>[.<label>]`** (the S3
  variant stem, e.g. `instagram.feed`). **Media doesn't know platforms** — the generic **`display`** profile is
  media's own; **platform profiles live in `MediaConfig` and are owned/seeded by their consumer** (social's
  per-platform matrix is social's single source). Consumers discover them via **`GET /media/variant-specs`** and
  request processing per profile (confirming their platform fit). `maxBytes` also serves the EVT video size-cap. — B

## media-5.0 Security scanning — B
- **media-5.1** **Scan pipeline — stubbed now (SQS).** An **SQS scan stage + worker** in the upload flow; the **stub worker no-ops — returns done and updates `status` (→ `ok`)** and advances the item, wiring the upload → scan → quarantine plumbing **end-to-end** so the engine drops in later *(gap #3)* — A
- **media-5.2** **Scan engine — later phase.** Replace the stub with a **factory** (ClamAV Lambda/ECS · Sophos); **quarantine** on detection, serve only `status = ok` *(gap #3)* — C

## media-6.0 Lifecycle & cost — B
- **media-6.1** **Cold tier → Glacier — later phase.** Move **unused** assets to Glacier based on the asset's **`lastAccessedAt`**; the threshold is a **TTL configured system-wide (platform default) + overridable per-account** *(gap #6)* — C
- **media-6.2** TTL expiry → soft-delete → **sweep** — B

## media-7.0 Limits & throttling — B
- **media-7.1** **Per-account bandwidth limits** (via Gateway) — B
- **media-7.2** **API throttle / rate limits** (Redis, periodic reset); CDN files not limited (accepted) — B
- **media-7.3** **Plan-gated storage / quota** via [account](../account/specs/SPECS.md) `ResolvedEntitlements` — B

## media-8.0 Privacy & compliance — A
- **media-8.1** **Tenant isolation** — per-account buckets + DDB `PK`; never cross-account — A
- **media-8.2** **Encryption** — at rest (SSE-KMS) + in transit (HTTPS) — A
- **media-8.3** **GDPR erasure** — media is **account-owned, not contact-linked**: **account deletion** purges its media; **`contact-forget` does not touch media** (no per-contact media); opaque `guid` keys (no PII in path). *(Revisit if media ever becomes contact-tagged — gap #5)* — B
- **media-8.4** **Retention (Art 5(1)(e))** — TTL + Glacier tiering — B
- **media-8.5** **No PHI** by [AUP](../account/specs/SPECS.md) — A

## media-9.0 Infra footprint — A
- **media-9.1** **S3** (+ lifecycle / Glacier), **DynamoDB** (object index), **CloudFront** (+ OAC) — A
- **media-9.2** **SQS** (S3-event → dispatch → scan/process → quarantine), **Lambda / ECS** (scan), **MediaConvert** (video) — A
- **media-9.3** **Redis** (rate limits), **Sharp** / **ffmpeg** / **ffprobe** (image/video tooling) — A
- **media-9.4** Consumed by **email / campaign / web** (attachments + assets); fair-shared by **dispatch** — A
- **media-9.5** **Runtime config (AppConfig).** Non-secret operational policy in a single `MediaConfig` model
  (`@repo/api`), served from the AppConfig `config/settings` profile and **seeded on boot with
  `MediaConfig.DEFAULT`** (Console-editable, `SCHEMA`-linted, tunable **without a redeploy**):
  **`upload`** (`maxSizeMb` + per-kind override · `allowedMime` allow-list · `presignTtlSec`) → PostUpload;
  **`variants`** (`strategy` pre-process|on-demand [media-4.4] · `profiles` name→`VariantSpec[]`, incl. platform
  profiles seeded by consumers [media-4.6]) → the pipeline + GET variant-specs; **`delivery`** (`signedUrlTtlSec`
  · `defaultTier`) → GetMediaUrl / PostUpload; **`lifecycle`** (`glacierAfterDays` [media-6.1] ·
  `softDeleteSweepDays` [media-6.2] · `defaultTtlDays` → asset TTL); **`scan`** (`enabled` — the [media-5.1]
  stub gate switch); **`limits`** (`apiRatePerMinute` [media-7.2]). **NOT here:** plan/storage **quota**
  (account `ResolvedEntitlements` [media-7.3]) and any **secrets** (Secrets Manager). — A

## media-10.0 Video compression (EVT — video texting) — B
- **media-10.1** **Goal** — compress video to **MMS-sendable**: **≤ 45 s** + **< ~750 KB** (both configurable) — B
- **media-10.2** **Pipeline** — upload → preprocess (`ffprobe` validate + preview thumbnail + job descriptor) → process (dedicated container, progress) → transcode → attach → finalize (notify) — B
- **media-10.3** **Input validation** — must be video with a usable video/audio stream (video needs a width); probe geometry/codecs (SAR/DAR, DAR via GCD) — B
- **media-10.4** **Encode** — HEVC `libx265` (main10/`hvc1`) or H.264 on a flag; `yuv420p`, BT.709, `veryslow`; **mono** ~22 kHz audio; **resolution from source aspect** (square 640²; landscape 480p/nHD; portrait ⅔) — B
- **media-10.5** **Size-cap strategy** — CRF **quality ladder** (presets 1→4: CRF 32→38 · audio 64k→22k · fps 15→12), stop at the **first output `< maxSize`**; **fail** if none fit — B
- **media-10.6** **Optional add-ons** — lead-frame stitch · burned subtitles (transcript → SRT) · tile preview + screenshot — C
- **media-10.7** **Rate limit + surcharge** — per-account cap (e.g. 10/day) + **EVT surcharge** (e.g. $0.04) — B
- **media-10.8** **AWS-managed path (later option)** — MediaConvert (job templates, **QVBR / 2-pass to a computed bitrate** ≈ `maxSize·8/duration`, EventBridge progress) replaces the ffmpeg encode; **CRF-retry → bitrate-target** — C
- **media-10.9** **ffmpeg runtime** — **native binary** in a container/layer built with **`libx265` + `libfdk_aac`** (`--enable-gpl --enable-nonfree`), driven from Node (`fluent-ffmpeg`); **not `ffmpeg.wasm`**. Mind **HEVC patent licensing** (MediaConvert covers it; x265 self-host does not) — B
- **media-10.10** **General compression variant + distribution targets** — beyond MMS, a user can **compress the
  original video to a named distribution target** and keep the result as a **`compressed.<target>` variant**
  (the original is always retained, media-1.3). Runs as the async **`MediaVideoJob`** (media-11.5) off a queue
  (media-19), emitting `media.job` stage events. The user picks **how small / what target**; the job applies
  the CRF **quality ladder** (media-10.5) to hit the goal.
  - **Targets are config** (`MediaConfig.videoTargets`, Console-editable) — each a named goal:
    `{ maxSizeKb?, maxSeconds?, maxWidth?, fpsCap?, codec (h264|hevc), audioKbps? }`. Seed a sensible set:

    | Target | Goal (guideline) | Use |
    |---|---|---|
    | `mms` | ≤ 45 s · < 750 KB · ≤ 480 px · H.264 · mono 22 kHz | MMS / SMS (media-10.1) |
    | `mobile` | ≤ 720 px · ~2 Mbps · H.264 | phones, chat apps, social DMs |
    | `web-sd` | ≤ 480 px · ~1 Mbps · H.264 | fast web / email preview |
    | `web-hd` | ≤ 1080 px · ~5 Mbps · H.264 | web embed, landing pages |
    | `hevc-hd` | ≤ 1080 px · ~3 Mbps · HEVC | modern devices (smaller at equal quality) |

  - **Guidelines the job encodes to** (media-10.4/10.5): pick **H.264 (`libx264`) for maximum compatibility**
    (MMS/older devices), **HEVC (`libx265`) only where supported** (smaller files, but licensing — media-10.9);
    `yuv420p` + BT.709; **resolution scales from source aspect** capped at the target's `maxWidth`; **fps capped**
    (e.g. 30→24/15) for size; audio downmixed to the target's `audioKbps`. When a **`maxSizeKb`** goal is set,
    run the **CRF ladder** and take the first output under the cap (2-pass/QVBR to a computed bitrate
    `≈ maxSizeKb·8/duration` on the MediaConvert path, media-10.8); if none fit, surface a **failed** stage with
    the smallest achieved size so the user can loosen the goal.
  - **Endpoint** — `POST /media/assets/:guid/compress { target }` (or a custom `{ maxSizeKb, maxWidth, codec }`)
    → enqueues `media-video`; the variant appears when the job completes (poll `GET /assets/:guid` / stage events).

## media-11.0 Service & Job topology — B
- **media-11.1** **Domain bases** — `MediaService extends Service` + `MediaJob extends Job` hold the shared code (object index/model · S3 + presign · signed-URL/OAC · scan-status gate · scan/process factories · audit); **concrete roles extend the domain base** — B
- **media-11.2** **`MediaMainService`** — the `/media/*` API (presigned upload init/complete · object CRUD/metadata · variant requests · signed-URL issuance) — A
- **media-11.3** **Jobs extend `MediaJob`** — `MediaScanJob` / `MediaProcessJob` / `MediaVideoJob` / `MediaLifecycleJob` — A
- **media-11.4** **`MediaScanJob` gates the pipeline** — scan first; **quarantine on detection**, clean → trigger processing; nothing is processed or delivered before clean — A
- **media-11.5** **`MediaVideoJob`** — heavy transcode on **Fargate / MediaConvert** (not Lambda) — B
- **media-11.6** **On-demand variants = Lambda@Edge** at the CloudFront edge (not a standing Job); delivery is CloudFront, not the service — B

## media-19.0 Async processing — everything heavy is a Job, and every Job emits Kafka stage events — A

**Rule (applies to ALL current and future media processing): any operation that is CPU-heavy, long-running,
or bound to an external API MUST run as an SQS-queued Job, never inline in an API request.** This covers
transcode/conversion, audio/frame **extraction**, image variants, malware scan, AI **generation** (image /
video / voice / sound), and **transcription** (audio→text) — and anything added later. The API endpoint stays
**thin**: validate → create/mark the asset (`status: processing`) → **enqueue** → return `202 + guid`. A
**Job** (Lambda in prod; drained by `MediaMainService` locally — same `MediaPipeline` code) does the work.
This is what lets the platform scale under many concurrent users (held connections + gateway timeouts + a
tipping fleet are the failure mode of doing it inline).

- **media-19.1** **One queue per heavy operation** (auto-DLQ): `media-scan`, `media-process`, and new work
  gets its own queue — `media-generate`, `media-transcribe`, … Consumers are Jobs; MAIN drains them locally.
- **media-19.2** **Every Job emits Kafka STAGE events** — a Job publishes a `media.job` event at each stage
  (`queued → started → running[progress%] → completed | failed`) via the standard `Events.Envelope`
  (`@repo/system`), keyed by the asset `guid`. This is the single source the **UI subscribes to for live
  progress** (over websockets, later) and the substrate **workflows** consume to sequence steps. Stage events
  are best-effort (a bus miss is logged, never fails the Job). Documented in
  [packages/system/EVENTS.md](../../../packages/system/EVENTS.md).
- **media-19.3** **Status + stage** — the asset's `status` is the coarse lifecycle (`scanning`/`processing`/
  `ok`/`failed`); the `media.job` stage stream is the fine-grained per-operation progress. The client polls
  `GET /assets/:guid` today; the stage events replace polling once websockets land.
- **media-19.4** **Terminal outcome** — a Job ends by writing the result to the asset (variant / transcript /
  generated bytes) + a `completed`/`failed` stage event; failures set `status: failed` + a reason.
- **media-19.5** **Idempotent + retry-safe** — keyed by `guid` (+ operation), so an SQS redelivery re-runs
  cleanly; DLQ captures the poison-pill after `maxReceiveCount`.

## media-21.0 Studio — compose & edit — B

Studio is the creation surface (`/media/studio/*`): named PROJECTS (image | video | audio) under a campaign,
each with a saved CANVAS (S3) + lightweight metadata (DDB `studio_projects`). Two editors today — a tldraw
IMAGE editor and a multi-track VIDEO editor — both read-only by default with an Edit toggle (the Edit button
lives in the studio banner, on the title line) and two-tier autosave (localStorage + low-cadence server sync).
Export renders to a library asset (create-or-replace).

- **media-21.1** **Image editor** (tldraw) — page frame (size/DPI), add-from-library/providers, PNG/JPEG export
  to a library IMAGE (update-in-place); inserted images parent into the page frame so z-order works vs text.
- **media-21.2** **Video timeline model** — `StudioProject.VideoDoc`: TRACKS (array order = paint order;
  mute/hide) + CLIPS (absolute `startSec`/`durationSec`, `trimStartSec`, `sourceDurationSec`, per-clip
  `volume`/`fadeIn`/`fadeOut`, text geometry `xPct/yPct/fontPct/align`). Single source of truth for BOTH the
  Remotion `<Player>` preview AND the ffmpeg render. Legacy sequential scene docs migrate on load.
- **media-21.3** **Editing** — drag move (across tracks), edge trim/resize (never past the source length —
  audio/video carry `sourceDurationSec` and drop in at FULL length, trim shorter only), **split at playhead**,
  add clips (library image/video/audio + kind/campaign filters, provider stock images, mp3 upload, text),
  per-clip **audio waveforms** (Web Audio decode → cached peaks), playhead scrub + zoom.
- **media-21.4** **Transitions** — per-clip **fade in/out** (opacity + audio volume, matched in preview &
  render); crossfade by overlapping clips on separate tracks.
- **media-21.5** **Multi-format** — author one master format + auto-generate a per-DESTINATION variant
  (YouTube / Reels / TikTok / IG / …); relatively-positioned overlays reflow across aspect ratios.
- **media-21.6** **Render** — `PostStudioRender` → `studio-render` SQS → `MediaMainService` consumer →
  `MediaAnalyzer.renderComposite`: ONE ffmpeg `filter_complex` graph (base canvas + per-clip cover-fit / trim /
  `setpts` / `overlay` with `enable` time-windows in paint order + `drawtext` text + alpha `fade` + `afade` /
  `amix` audio) → saves the master as the ORIGINAL + a COMPRESSED variant per destination. Runs **in-process on
  the media Node service** (`ffmpeg-static`), NOT Lambda/Chromium. UNVERIFIED at author time; `drawtext` needs a
  runtime font; needs a LocalStack redeploy of the `studio-render` queue.

- **media-21.8** **Transition library** — a per-clip entry `transitionIn` OBJECT (`{ type, durationSec }`,
  `StudioProject.Transition`) on `TimelineClip`, distinct from the manual fades of media-21.4: **dissolve**,
  **wipe** (L/R/up/down), **slide** (L/R/up/down). Semantics: the incoming clip's Sequence starts EARLIER by
  `durationSec` so it overlaps the previous clip and reveals over that window. **Preview** (`StudioVideoComposition`
  `ClipLayer` + `transitionStyle`) animates the true reveal via CSS (opacity / `clip-path inset` / `translate`).
  **Render** (`runStudioRender`) approximates ALL types as a dissolve/crossfade — start-earlier + alpha `fade`
  in over `durationSec` — because the `overlay` graph has no moving mask; wipe/slide export as a dissolve
  (preview-only fidelity). Inspector control is in `StudioClipInspector` (non-audio clips). BACKLOG: true
  ffmpeg `xfade` / moving-mask wipes & slides; circle/radial, pixelize, fade-to-color; transition on EXIT.

- **media-21.9** **Text & graphics — styling** (first slice of the Text & graphics section): a `TextStyle`
  object (`StudioProject.TextStyle`) on `TimelineClip.style` / `VideoOverlay.style` — **fill color**, **outline**
  (`{ color, widthPct }`), **drop shadow** (on/off), **background box** (`{ color, opacity, padPct }`), plus
  **font family** (`TextFont` enum: sans/serif/mono) and **bold**. Widths/padding are fractions of the font
  size so they scale across destination formats. **Preview** (`StudioVideoComposition.textStyleCss`) maps to
  CSS (color / `WebkitTextStroke` / `textShadow` / background box); **render** (`MediaAnalyzer.drawtextStyleOptions`)
  maps the SAME fields to ffmpeg drawtext (`fontcolor` / `borderw`+`bordercolor` / `shadowcolor` / `box`+`boxcolor`),
  so preview and export match. `DEFAULT_TEXT_STYLE` (white fill + shadow + sans + bold) keeps existing/unstyled
  text unchanged. Colors are free-form CONTENT hex values (NOT app theme tokens). Inspector controls in
  `StudioClipInspector.textFields`. CAVEAT: `fontFamily`/`bold` are PREVIEW-fidelity — the server render uses its
  single bundled drawtext font until matching font files are bundled. BACKLOG (rest of Text & graphics): text-in
  animations (typewriter, slide/fade), title & lower-third templates, logo/watermark overlay, editable
  outline-width / background-opacity controls, and auto-captions from the transcription adapters (word highlight).

- **media-21.10** **Text & graphics — entry animations** (second slice): a `TextAnimateIn` object
  (`StudioProject.TextAnimation` enum: fade / typewriter / slide L·R·up·down / pop) on `TimelineClip.animateIn`,
  played over the text clip's first `durationSec`. Distinct from a clip {@link Transition} (which overlaps the
  PREVIOUS clip) — this animates the text itself IN, in place. **Preview**: `StudioVideoComposition.ClipLayer`
  computes progress from the sequence-local frame and applies `textAnimateStyle` (opacity for fade; opacity+scale
  for pop; opacity+translate for slides) to the wrapper, and `typewriterSlice` reveals characters left→right for
  typewriter; transition + animation transforms compose. **Render** (`runStudioRender`): every type is
  approximated as an alpha **fade-in** over its duration (max'd with any manual fade) — slide/pop/typewriter have
  no drawtext equivalent in the overlay graph, so they export as a fade (preview-only fidelity, mirroring the
  transition wipe/slide→dissolve approach). Inspector: "Animate in" select + duration in
  `StudioClipInspector.textFields`. BACKLOG: true render fidelity for slide/pop (Remotion/xfade-style),
  typewriter-in-render (per-char enable windows), animate-OUT.

- **media-21.11** **Text & graphics — logo / watermark** (third slice): a DOC-LEVEL `Watermark`
  (`StudioProject.Watermark` on `VideoDoc.watermark`) — a library IMAGE burned over the WHOLE timeline
  (top-most). Fields: `assetGuid` (durable ref the render resolves bytes from) + `src` (time-limited preview
  URL), `corner` (`WatermarkCorner` enum), `scalePct` (width ÷ frame width), `opacity` (0..1), `marginPct`
  (edge inset ÷ frame width) — fractions so it scales across destination formats. `DEFAULT_WATERMARK` seeds the
  placement (bottom-right, 15%, 80%, 3% margin) when an image is picked. **Preview**
  (`StudioVideoComposition.watermarkCss`) renders a corner-anchored `<Img>` above all tracks. **Inspector**:
  a Watermark section in `StudioClipInspector.compositionSettings` (nothing-selected panel) — pick from library,
  corner select, size/opacity sliders, replace/remove; the editor opens a `StudioLibraryPickerDialog` scoped to
  `WATERMARK_KINDS` (image only) and stores the pick via `onSetWatermark`. **Render**
  (`MediaAnalyzer.renderComposite` `CompositeWatermark`): the watermark is the last ffmpeg input (looped),
  scaled to its width, alpha'd via `colorchannelmixer=aa`, and `overlay`-composited in its corner over the whole
  duration (after text → top-most); `runStudioRender` resolves the bytes ONCE (shared across all output formats).

- **media-21.12** **Text & graphics — title / lower-third templates** (fourth slice): built-in text LAYOUTS
  (`StudioProject.TextTemplate` enum + `TEXT_TEMPLATES` defs: Title, Title+subtitle, Lower third, Caption bar)
  — each a set of `TextTemplateLayer`s (relative geometry + baseline `TextStyle` + placeholder text). Pure
  composition of the existing model: the timeline's "Add text" `ButtonIcon` became a `ButtonIconDropdown`
  (`StudioTimeline.ADD_TEXT_CHOICES`: "Plain text" + each template); `StudioVideoEditor.addTextTemplate`
  materializes each layer into a normal editable TEXT clip on the overlay track at the playhead (shared start).
  NO render changes — templates produce ordinary styled text clips (media-21.9/.10 handle their draw/animation).
- **media-21.13** **Text & graphics — auto-captions** (fifth slice): `StudioVideoEditor.generateCaptions`
  turns a video/audio clip's speech transcript into timed caption TEXT clips. Reuses the existing transcription
  pipeline (media-18/19): fetches the source asset (`GetAsset`), reads its TRANSCRIPT item's
  `meta.document.transcript.segments`; each segment → a caption clip on the overlay track, offset by the clip's
  timeline position minus its trim in-point and CLAMPED to the clip's visible window (blank/out-of-window
  segments skipped), styled with `StudioProject.CAPTION_GEOMETRY` + `CAPTION_STYLE` (boxed bottom-center). If
  the asset has no transcript yet, it POSTs `PostAssetTranscribe` and snackbars "try again in a moment" (the
  transcribe Job is async). Trigger: a "Generate captions" button in `StudioClipInspector.mediaFields`
  (video/audio clips). Captions are plain caption-styled TEXT clips, so they render/burn like any other text —
  no render changes. BACKLOG: live word-highlight, re-sync/regenerate on edit, caption track management.

- **media-21.14** **Per-clip transform + Ken Burns**: a `ClipTransform` (`StudioProject.ClipTransform` on
  `TimelineClip.transform`) for IMAGE/VIDEO layers — `xPct`/`yPct` position offset (fraction of frame from
  center), `scale` (zoom, 1 = base fit), `rotation` (deg), `opacity`, and `fit` (`FitMode` cover/contain) — plus
  a `KenBurns` (`TimelineClip.kenBurns`) animated pan/zoom (from→to scale + center offset), offered as named
  `KEN_BURNS_PRESETS` (zoom in/out, pan L·R·up·down). **Preview** (`StudioVideoComposition.visualTransformStyle`)
  composes the static transform with the frame-interpolated Ken Burns into the layer wrapper's CSS
  transform/opacity, and `renderClip` honors `fit` via `objectFit`. **Inspector**
  (`StudioClipInspector.transformFields`, shown for IMAGE/VIDEO): fit select, scale/rotation/opacity + offset
  X/Y sliders, and a Ken Burns preset select. **Render** (`MediaAnalyzer.renderComposite`): transformed layers
  take a generalized path — fit (cover=increase / contain=decrease) → user `scale` → `rotate` → `format=yuva`
  +`colorchannelmixer=aa` (opacity) → `fade` alpha → `overlay` CENTERED + offset (frame clips overflow); the
  fast cover-crop path is unchanged for untransformed clips (no regression). Ken Burns exports as a STATIC
  MIDPOINT zoom/offset — the animated pan/zoom is preview-only fidelity (consistent with the transition/text-
  animation approximations). BACKLOG: true animated Ken Burns render via `zoompan`, crop,
  background/solid clips, speed/slow-mo/reverse, freeze frame, blend modes.
- **media-21.15** **Effects / filters**: a `ClipFilters` (`StudioProject.ClipFilters` on `TimelineClip.filters`)
  for IMAGE/VIDEO layers — `brightness` (-1..1, 0 neutral), `contrast`/`saturation` (0..2, 1 neutral),
  `grayscale`, `blur` (0..1 → `FILTER_BLUR_MAX` px), `vignette`. **Preview**
  (`StudioVideoComposition.clipFilterCss`) maps to CSS `filter` (brightness/contrast/saturate/grayscale/blur) on
  the media element; a `vignette` is a separate radial-gradient overlay (`withVignette`). **Inspector**
  (`StudioClipInspector.effectsFields`, IMAGE/VIDEO): brightness/contrast/saturation/blur sliders + grayscale &
  vignette switches (saturation disabled while grayscale is on). **Render** (`MediaAnalyzer.videoFilterChain`):
  the SAME fields map to ffmpeg `eq=brightness:contrast:saturation` (grayscale = saturation 0), `gblur=sigma`,
  `vignette`, spliced into BOTH the fast cover-crop path AND the transform generalized path — full-fidelity, no
  approximation. BACKLOG: LUTs, gradients, per-effect keyframing.
- **media-21.16** **Audio — detach + background-music loop**: (a) **Detach audio** — `StudioVideoEditor.detachAudio`
  splits a VIDEO clip's soundtrack into its own AUDIO clip on the audio track (same asset + timing) and silences
  the source video's audio (volume 0, so it drops from the render's `amix`); button in
  `StudioClipInspector.mediaFields` for VIDEO clips. (b) **Loop** — `TimelineClip.loop` (audio) loops the source
  to fill the clip's timeline duration (background music); preview via Remotion `<Audio loop>`, render via a
  `-stream_loop -1` input option (the existing `atrim=duration` cuts it to length); switch in `mediaFields` for
  AUDIO clips. Per-clip volume + fades already existed (media-21.4). BACKLOG: **ducking** (music under voice via
  sidechaincompress), volume envelope / keyframes, background-music trim UI, waveform-based sync.

- **media-21.17** **Editing UX — undo/redo + duplicate + keyboard shortcuts** (first Editing-UX slice, editor
  state only — no model/render change): `StudioVideoEditor` keeps a `historyRef` (`past`/`future` doc-snapshot
  stacks + `lastAt`); `mutate()` records the pre-change doc, but rapid bursts COALESCE (a snapshot is pushed only
  when the previous commit was > `HISTORY_COALESCE_MS` ago) so a continuous drag = ONE undo step; `HISTORY_LIMIT`
  caps depth. `undo`/`redo` swap via a history-neutral `applyDoc`; `canUndo`/`canRedo` surface through
  `historyState`. `duplicateSelected` clones the selected clip immediately after itself. Keyboard (while editing,
  ignored when typing in a field): ⌘/Ctrl+Z undo, ⇧+Z or ⌘/Ctrl+Y redo, ⌘/Ctrl+D duplicate, Delete/Backspace
  remove selected, Space play/pause. Toolbar gains Undo / Redo / Duplicate `ButtonIcon`s in `StudioTimeline`.
  BACKLOG (rest of Editing UX): copy/paste across projects, multi-select, snapping (playhead / edges / grid),
  ripple delete/trim, same-track overlap prevention.

- **media-21.18** **Render engine — config-selectable ffmpeg vs Remotion/Chromium**: the render Job is now
  engine-pluggable via config. `MediaConfig.RenderEngine` (`FFMPEG | REMOTION`) + `MediaConfig.render.engine`
  (DEFAULT `FFMPEG`; optional in SCHEMA so older configs tolerate drift, `withDefaults` fills it) — switchable
  WITHOUT a redeploy. **Two queues, two consumers, one payload**: `enqueueStudioRender` reads the config and
  routes to `studio-render` (ffmpeg) or `studio-render-remotion` (Chromium); `MediaMainService` drains both
  (`startStudioRenderConsumer` / `startStudioRenderRemotionConsumer`), each calling `runStudioRender(…, engine)`.
  `runStudioRender` branches: FFMPEG → the existing `filter_complex` gather + `renderComposite`; REMOTION →
  `MediaAnalyzer.renderCompositeRemotion` (skips the ffmpeg S3-byte gather — Remotion renders from the doc as
  inputProps). Both save via `saveRenderedVideo` and emit the same `studio-render` `media.job` events, so the
  client/UI is engine-agnostic. The new queue auto-provisions from `CloudManifest.queues` (CDK
  `ServiceStack.makeQueue`) — **needs a LocalStack/CDK redeploy of the media stack** to create it.
  **GATED / UNVERIFIED (the Chromium path):** `renderCompositeRemotion` lazy-loads `@remotion/bundler` +
  `@remotion/renderer` via NON-LITERAL dynamic imports (so the media build compiles and the ffmpeg engine works
  WITHOUT the heavy Chromium deps), and imports a shared composition entry `@repo/studio-composition`
  (`registerRoot` + a `<Composition>` wrapping `StudioVideoComposition`, which today lives only in the web app).
  Until the render worker image installs those deps, the remotion path returns null (Job fails cleanly) — keep
  the config on `FFMPEG`. TODO to make it live: (1) ✅ DONE — `StudioVideoComposition` extracted into the shared
  `@repo/studio-composition` package (one component drives both the web `<Player>` preview and the render
  worker; the package's `Root` = `registerRoot` + `<Composition id="studio">`, `ENTRY_POINT`/`COMPOSITION_ID`
  exported for the bundler); (2) install `@remotion/bundler`/`@remotion/renderer` on a Chromium-capable worker
  image; (3) refresh each clip's signed `src` into the doc before enqueueing a remotion render (URLs must be
  valid at render time).

- **media-21.19** **Playback speed (slow-mo / fast-motion)**: a per-clip `TimelineClip.speed` (VIDEO/AUDIO;
  1 = normal, <1 slow-mo, >1 fast). The clip's TIMELINE duration is unchanged — speed changes how much SOURCE
  is consumed (`durationSec × speed`). **Preview**: `playbackRate` on Remotion `<OffthreadVideo>` / `<Audio>`.
  **Render**: video consumes `duration × speed` of source then `setpts=(PTS-STARTPTS)/speed` compresses/stretches
  it back (both the fast cover-crop and transform paths); audio consumes the same and an `atempoChain` (pitch-
  preserving, decomposed into [0.5,2.0] factors so 0.25→0.5,0.5 and 4→2,2 work) brings it to length before the
  fades/mix. Inspector: a Speed slider (0.25–4×) in `StudioClipInspector.mediaFields`. Full-fidelity both sides.
  BACKLOG: reverse + freeze-frame (need whole-clip buffering — `reverse`/`areverse`), speed ramps/keyframes.

- **media-21.20** **Editing UX — snapping** (magnetic drag): dragging a clip's body or either edge now snaps
  to nearby MAGNETIC TARGETS — other clips' start/end (any track, excluding the dragged clip), the playhead, and
  0 — within an `SNAP_PX` (8px) radius, else falls back to the grid. `StudioTimeline.snapEdge` collects the
  targets + returns the nearest with its delta; MOVE snaps whichever of the clip's two edges locks on closer,
  RESIZE_RIGHT snaps the out edge, RESIZE_LEFT snaps the in edge (then re-clamps to source/duration bounds).
  Pure client-side (timeline drag math) — no model/render change. BACKLOG: visual snap guide-line, snap toggle.

- **media-21.21** **Track reorder (z-order)**: up/down controls in each track's gutter row reorder the tracks
  array — which IS the paint order (index 0 = top lane, composites ON TOP), so moving a track up brings its
  clips forward in the z-stack. `StudioVideoEditor.moveTrack(id, delta)` splices the track (clamped to the ends,
  recorded in undo history); `StudioTimeline` gutter shows ↑/↓ `ButtonIcon`s (disabled at first/last). Both
  preview and render already paint by track order, so no render change.
- **media-21.22** **Copy / paste**: a one-clip clipboard buffer (`StudioVideoEditor.clipboard` ref). `copySelected`
  stashes the selected clip; `pasteClip` drops a fresh-id clone at the PLAYHEAD (read via `currentSecRef` to
  avoid a stale closure) on its original track. Keyboard: ⌘/Ctrl+C / ⌘/Ctrl+V (in the existing shortcut handler,
  ignored while typing). Complements duplicate (media-21.17) with paste-at-playhead + persistence across
  selection. BACKLOG: cross-project paste, multi-clip clipboard.

- **media-21.23** **Export quality presets**: `VideoDoc.quality` (`StudioProject.VideoQuality`: DRAFT / STANDARD
  / HIGH) maps via `VIDEO_QUALITY` to an x264 `crf` + `preset` (draft 30/veryfast, standard 23/medium, high
  18/slow). `runStudioRender` resolves it from the doc and passes `{ crf, preset }` to
  `MediaAnalyzer.renderComposite`, which emits `-crf`/`-preset` in the ffmpeg output options (applies to every
  format variant). Inspector: an "Export quality" select in `StudioClipInspector.compositionSettings`
  (nothing-selected panel). EXPORT-ONLY — no preview effect. BACKLOG: explicit bitrate targets, GIF export,
  poster/thumbnail pick, per-destination quality; the remotion engine currently ignores the preset (its
  renderMedia can take a crf later).

- **media-21.24** **Blend modes**: `TimelineClip.blend` (`StudioProject.BlendMode`: normal/multiply/screen/
  overlay/darken/lighten/difference) → CSS `mix-blend-mode` on the preview layer; inspector select in
  `transformFields`. PREVIEW-ONLY fidelity — the ffmpeg overlay graph composites `normal` (documented).
- **media-21.25** **Solid / background color clips**: a `VideoSceneKind.SOLID` clip with a `color` fill.
  Preview renders a colored `AbsoluteFill`; render adds a lavfi `color` source input (no bytes) composited like
  any layer. Added via the timeline "Add" dropdown ("Solid color") → `addSolid` (base track); inspector shows a
  color picker. Full-fidelity both sides.
- **media-21.26** **Editing UX — ripple delete + overlap prevention + cross-project paste**: (a) `rippleDeleteSelected`
  removes the clip and slides later same-track clips left (⇧+Delete). (b) `moveClip` clamps a drag into the gap
  between same-track neighbors (no overlap; resize-overlap still backlog). (c) copy/paste is backed by
  localStorage (`CLIPBOARD_KEY`) so it works ACROSS projects, remapping the clip's track by kind if absent.
- **media-21.27** **Explicit bitrate**: `VideoDoc.bitrateKbps` (0 = CRF) → render emits `-b:v/-maxrate/-bufsize`
  (ABR) instead of `-crf`; inspector numeric field. Complements the quality presets (media-21.23).
- **media-21.28** **Reverse**: `TimelineClip.reverse` → render `reverse` (video) / `areverse` (audio). Inspector
  switch in `mediaFields`. EXPORT-accurate; the preview plays FORWARD (Remotion has no negative playback —
  documented). **Freeze-frame DEFERRED**: needs `tpad` frame-hold + has no Remotion preview path (low value).
- **media-21.29** **Poster + GIF export**: `VideoDoc.posterSec` extracts that frame from the master render
  (`MediaAnalyzer.extractPosterFrame`) → a POSTER item; `VideoDoc.gif` converts the master to an animated GIF
  (`MediaAnalyzer.toGif`, palettegen/paletteuse) → a `gif`-profile COMPRESSED item. Both saved alongside the
  video variants in `saveRenderedVideo`. Inspector: "Poster @ playhead" + "Also export GIF" switches.
- **media-21.30** **Multi-select**: selection is now an ARRAY (`selection`) with the PRIMARY (last) driving the
  inspector + single-clip ops (drag/duplicate/copy) via a derived `selectedClipId` + shim setter — so the whole
  single-select flow is unchanged. Shift/⌘-click toggles a clip (`toggleSelect`); the timeline highlights the
  full set; Delete bulk-removes all selected (`removeSelected`). GROUP-DRAG deferred (a drag still moves the
  primary only).
- **CROP DEFERRED (by design)**: for cover-fit, the per-clip transform (scale + x/y offset, media-21.14) already
  covers zoom/pan into a region; a true arbitrary-aspect source-rect crop needs a wrapping/clip approach for
  modest marginal value — revisit if a hard crop rect is needed.
- **REMOTION go-live (infra, remaining)**: media-21.18 items 2–3 — install `@remotion/bundler`/`@remotion/renderer`
  on a Chromium-capable render worker image (+ build `@repo/studio-composition`'s `bin/`), and refresh signed
  clip `src` URLs into the doc before enqueueing a remotion render. Not code-completable in this repo alone.

- **media-21.31** **Inspector layout — accordion**: the clip properties panel (`StudioClipInspector`) is split
  into collapsible `AccordionSection`s (Text / Color / Media / Transform / Effects / Timing) with the clip header
  (kind + start/duration + track) always visible on top and Remove at the bottom; one section open at a time
  (`section` state). Fades + transition moved into a "Timing" section. Within the Text section, the styling has
  labeled dividers — Style / Background / Animation — each laying its switch + color picker in a column row
  (outline/background show their color picker beside the on/off switch).

- **media-21.32** **SVG shape / graphic overlays**: a `VideoSceneKind.SHAPE` clip carrying a `shape`
  (`StudioProject.SHAPE_LIBRARY` key — rectangle/rounded/circle/triangle/diamond/hexagon/pentagon/star/badge/
  heart/arrow/bubble) + `shapeStyle` (fill, stroke color + width). `buildShapeSvg` composes a self-contained,
  recolored SVG shared by preview + render. **Preview**: a data-URI `<img>` positioned/scaled/rotated by the
  clip TRANSFORM (SHAPE is now a "visual" for transform). **Render**: `MediaAnalyzer.rasterizeSvg` (sharp →
  transparent PNG) turns it into an image layer composited through the transform (alpha-aware) path — so it's
  FULL-fidelity, not an approximation; the Remotion engine renders the SVG natively. Inspector: a "Shape"
  section (library select + Fill + Stroke) with geometry in the Transform section; added via the "Add" dropdown
  → `addShape` (centered ~40% rectangle default, contain fit). One mechanism spans simple geometry AND a badge/
  icon library. BACKLOG: account-uploaded SVGs (as media assets) to extend the library; multi-color recolor.

**media-21.7 Video editing BACKLOG (remaining — infra / deferred-by-design only):**
- **Group-drag for multi-select**, resize-overlap prevention, freeze-frame, crop — see media-21.24–21.30 notes.
- **Audio** — volume envelope / keyframes, **ducking** (music under voice), background-music trim UI (loop +
  detach done in media-21.16).
- **Export** — burn-in captions per destination (quality/bitrate in media-21.23/.27; GIF + poster in media-21.29).
- **Fidelity fork** — arbitrary keyframed motion graphics via the **Remotion server render** (plumbing +
  shared composition done, media-21.18; the Chromium worker image is the remaining infra).

## media-23.0 Profile avatars — B

A user PROFILE AVATAR built on the media plane (USER scope): the user selects/uploads a photo, PANS/ZOOMS it
under a circular overlay to frame it, and the service keeps the ORIGINAL and derives a set of square variants
from LARGE → very small for the profile view, the nav / menu bar, and the UserChip widget.

- **media-23.1** **Original kept** — the uploaded photo is a USER-scoped `Media.Asset` (ORIGINAL item), like any
  library item; nothing is destroyed by cropping (re-framing is non-destructive).
- **media-23.2** **Crop framing** — the client captures a normalized crop RECT (centerX / centerY / zoom, or
  x/y/size as fractions of the original) from the pan/zoom + circle overlay, stored on the asset (item meta) so
  the crop is re-editable and the variants are reproducible.
- **media-23.3** **Variants** — a Job crops to a SQUARE at the framed region and resizes to a fixed avatar size
  set (`xl` 512 · `lg` 256 · `md` 128 · `sm` 64 · `xs` 32) via `sharp` (`extract` + `resize`), stored as
  `Usage.AVATAR` items keyed by profile. The circle is a UI mask (CSS `border-radius`), so variants stay square.
- **media-23.4** **Reference & resolution** — the user/profile model carries the avatar asset `guid`; a single
  reusable web widget **`UserAvatar`** (`size` prop → `xl`/`lg`/`md`/`sm`/`xs`) resolves the correct variant via
  `GET /media/{guid}/variants/avatar-<size>` and renders the circular MUI Avatar with an **initials fallback**
  when unset. Every surface uses it — profile view (`lg`/`xl`), nav / menu bar (`sm`), UserChip (`xs`/`sm`) — so
  variant selection lives in ONE place.
- **media-23.5** **Update-in-place** — re-framing or replacing re-runs the crop+resize Job and bumps the variant
  versions (same guid), so every surface updates without changing the stored reference.

# Endpoints (first cut)

A first pass at the endpoint surface, in [`@repo/endpoint`](../../../packages/endpoint/SPECS.md) style — all
service-prefixed **`/media/*`**. **No direct S3** — uploads go to S3 via a **pre-signed URL**; reads resolve to
a **time-limited URL / CDN redirect** (the service decides access + hands off, **never streams bytes**).

**Access column:** recommended **`minAccess`** on the `Access` ladder — **`-`** = public · account ladder
**`SENDER`<`USER`<`BILLING`<`ACCOUNT`** · staff ladder **`SUPPORT`<`APPLICATION`<`ROOT`** · **`⬆`** = also
step-up · **`Internal`** = VPC-only S2S. Per-object **`accessRole`** + tier (`public`/`protected`/`private`)
gate delivery on top of the ladder.

### Upload (media-3)
| Method | URI | Purpose | Access | Req |
|---|---|---|---|---|
| POST | `/media/uploads` | Request a **pre-signed POST/PUT** URL (returns `guid` + upload target); client PUTs **direct to S3** | USER | media-3.1 |

> Processing is **event-driven** — the S3 created event → SQS → dispatch → scan/process; no client "complete" call.

### Assets — index & metadata (media-1)
| Method | URI | Purpose | Access | Req |
|---|---|---|---|---|
| GET | `/media/assets` | List account assets (filter: **scope · campaignId** · kind / mime · status) | USER | media-1.2/1.5 |
| GET | `/media/assets/{guid}` | Asset metadata | USER | media-1.2 |
| GET | `/media/assets/{guid}/status` | Processing status (`uploading`…`ok`/`quarantined`) | USER | media-3.3 |
| PATCH | `/media/assets/{guid}` | Update tags / metadata | USER | media-1.2 |
| DELETE | `/media/assets/{guid}` | **Soft delete** — **409** while used by any campaign (`campaignIds` non-empty) | USER | media-1.4/1.5 |
| POST | `/media/assets/{guid}/restore` | Restore a soft-deleted asset | USER | media-1.4 |
| GET | `/media/assets/{guid}/versions` | List an **item's** S3 version history (`?item=<usage[.profile]>`, newest first) | USER | media-1.4 |
| POST | `/media/assets/{guid}/revert` | **Revert** an item to a prior version (`{ item, versionId }`) — copies it back as a new latest version | USER | media-1.4 |
| GET | `/media/variant-specs` | List variant **profiles** (name → `VariantSpec[]`); consumers fetch to process an asset for their platform | USER | media-4.6 |

### Access / delivery (media-2, media-4)
| Method | URI | Purpose | Access | Req |
|---|---|---|---|---|
| GET | `/media/{guid}` | Resolve to a delivery URL — **302 to CDN / pre-signed** (access per tier + `accessRole`; logged) | - / role | media-2.1/2.2 |
| GET | `/media/{guid}/{version}` | A specific **version** | - / role | media-1.3 |
| GET | `/media/{guid}/variants/{name}` | A **variant** (size); on-demand-generated at the edge if so configured | - / role | media-4.1/4.4 |

### Variant strategy (media-4.4)
| Method | URI | Purpose | Access | Req |
|---|---|---|---|---|
| GET, PUT | `/media/settings/variants` | Read / set variant strategy (**pre-process** vs **on-demand+cache**) — account-admin override | ACCOUNT | media-4.4 |

### Profile avatar (media-23)
| Method | URI | Purpose | Access | Req |
|---|---|---|---|---|
| POST | `/media/avatar` | Set/replace the acting user's avatar from an uploaded/library image + a normalized crop rect → creates/keeps the ORIGINAL (USER scope) and **enqueues** square crop+resize variant generation; returns the asset `guid` | USER | media-23.1/23.3 |
| GET | `/media/{guid}/variants/avatar-{size}` | Resolve a specific avatar size (`xl`/`lg`/`md`/`sm`/`xs`) — served like any variant (media-4) | - / role | media-23.4 |

> The avatar `guid` is stored on the user/profile record (auth service owns the user); `UserAvatar` (web) picks the size per surface.

### Video compression — EVT (media-10)
| Method | URI | Purpose | Access | Req |
|---|---|---|---|---|
| POST | `/media/evt` | Submit a video for **EVT compression** (≤45 s / <~750 KB); returns a job id | USER | media-10.1/10.2 |
| GET | `/media/evt/{jobId}` | EVT job **status / progress** | USER | media-10.2 |

### Admin / ops & internal
| Method | URI | Purpose | Access | Req |
|---|---|---|---|---|
| GET | `/media/quarantine` | List quarantined assets (when the scan engine ships) | APPLICATION | media-5.2 |
| POST | `/media/assets/{guid}/rescan` | Re-trigger scan | APPLICATION | media-5.1 |
| GET | `/media/internal/assets/{guid}` | S2S metadata fetch (email / campaign attach) | Internal | media-9.4 |
| POST | `/media/internal/erase` | S2S: purge an **account's** media on account deletion | Internal | media-8.3 |
| GET, PUT | `/media/config` | Read / set the service's own runtime config (AppConfig-backed) | ROOT | media-9.1 |
| GET | `/media/health` | Liveness / readiness | - | media-9.1 |

# eof
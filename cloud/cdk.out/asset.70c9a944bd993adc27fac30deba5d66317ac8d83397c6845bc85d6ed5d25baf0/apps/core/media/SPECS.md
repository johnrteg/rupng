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

## media-1.0 Storage & object model — A
- **media-1.1** Raw files in **S3**, per-account prefixes under a root bucket (`:accountId/{public|protected|private}/:guid`) — A
- **media-1.2** **DynamoDB object index** (`PK accountId`, SK guid) — guid, filename, mime, extension, size, `accessRole`, `status`, tags, S3 `version`, `parentUid` (variants), createdAt, lastAccessedAt, meta (image w/h/quality · video frame) — A
- **media-1.3** **Versioning** — a new version gets a **new URL** (`/public/:guid/:version`); always keep the **original** — A
- **media-1.4** **Soft delete → sweep**; **TTL** (default / account / env) — B

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

## media-11.0 Service & Job topology — B
- **media-11.1** **Domain bases** — `MediaService extends Service` + `MediaJob extends Job` hold the shared code (object index/model · S3 + presign · signed-URL/OAC · scan-status gate · scan/process factories · audit); **concrete roles extend the domain base** — B
- **media-11.2** **`MediaMainService`** — the `/media/*` API (presigned upload init/complete · object CRUD/metadata · variant requests · signed-URL issuance) — A
- **media-11.3** **Jobs extend `MediaJob`** — `MediaScanJob` / `MediaProcessJob` / `MediaVideoJob` / `MediaLifecycleJob` — A
- **media-11.4** **`MediaScanJob` gates the pipeline** — scan first; **quarantine on detection**, clean → trigger processing; nothing is processed or delivered before clean — A
- **media-11.5** **`MediaVideoJob`** — heavy transcode on **Fargate / MediaConvert** (not Lambda) — B
- **media-11.6** **On-demand variants = Lambda@Edge** at the CloudFront edge (not a standing Job); delivery is CloudFront, not the service — B

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
| GET | `/media/assets` | List account assets (filter: tag / mime / status) | USER | media-1.2 |
| GET | `/media/assets/{guid}` | Asset metadata | USER | media-1.2 |
| GET | `/media/assets/{guid}/status` | Processing status (`uploading`…`ok`/`quarantined`) | USER | media-3.3 |
| PATCH | `/media/assets/{guid}` | Update tags / metadata | USER | media-1.2 |
| DELETE | `/media/assets/{guid}` | **Soft delete** | USER | media-1.4 |
| POST | `/media/assets/{guid}/restore` | Restore a soft-deleted asset | USER | media-1.4 |

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
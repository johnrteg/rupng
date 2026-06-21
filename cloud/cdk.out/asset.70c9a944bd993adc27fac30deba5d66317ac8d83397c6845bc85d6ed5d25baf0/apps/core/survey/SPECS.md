#
# Survey Service
#

# Objective

Collect **structured responses** from contacts — NPS/CSAT, polls, intake, feedback, RSVPs — delivered
over the platform's channels (**text, email, and later phone**) either **natively** (we run the survey)
or by **integrating external survey tools** (SurveyMonkey, Typeform, Qualtrics, …). Responses attach to
the contact, score into attributes/tags, and flow to analytics.

# Is a survey a channel? **No.**

Like e-commerce (see `apps/CHANNELS.md`), a survey is **not a channel** — you don't "send a survey" the
way you send an SMS. A survey is an **interaction/content type** *delivered over* channels and a
**collection flow** for the replies. It **uses** the channels; it isn't one.

* **Distribution** rides the existing channels — SMS (`send`), email (`send` + a form link), phone (IVR).
* **Response capture** rides **channel inbound** — an SMS reply, a web-form POST, an IVR DTMF/speech turn.
* So a conversational SMS survey is, mechanically, a **workflow** of `collect-input` / `classify-reply`
  steps — the survey service shouldn't reinvent two-way capture, it should *define* the survey and reuse
  that machinery (see Boundaries).

# One definition, per-channel runners (the core design)

A single **channel-agnostic Survey definition** (questions + logic + scoring) is the **source of
truth**. Each channel has a **runner** that renders/executes *that same definition*, and every response
normalizes back to the same **Survey + Question ids**. That's what makes a survey **coordinated across
channels**: the same questions on SMS and email (and phone), **unified results**, and a contact mapped
to the same scores no matter how they answered. Author once → run anywhere.

| Channel | Runner | How |
|---|---|---|
| **SMS** | **internal — workflow** | **compile** the definition to `collect-input` / `classify-reply` steps (one question per turn, keyword answers, branch). STOP / quiet-hours apply. This is *ours*, no external service. |
| **Email / web** | **a form service** | render the definition as a **hosted form** (our form service, or an external provider) linked from the email; one submission with rich widgets. |
| **Phone / IVR** | **a service (later)** | voice prompts + DTMF/speech, same definition. |

* **SMS = native + workflow** (decided): a conversational survey *is* a workflow of `collect-input`
  steps the survey service generates — we don't hand SMS surveys to an external tool.
* **Email = a service** (decided): the email runner renders the shared definition as a hosted form;
  that form service may be **ours** or an **external provider** (SurveyMonkey/Typeform via marketplace) —
  either way it consumes the **same definition** and writes back the **same Question ids**.
* **External survey tools are an *email/web runner implementation*** (or a definition import), **not a
  separate model** — they slot in behind the form runner via marketplace, so results still unify.

# Role & boundaries

What Survey **owns**:
* The **Survey definition** — questions, types, **logic/branching**, scoring (NPS/CSAT/CES).
* **Distribution** intent (which audience, which channel, schedule) + **Response** collection + scoring.
* **Results** — per-contact responses + aggregates, emitted to analytics.

What it **delegates**:

| Concern | Owner |
|---|---|
| Actually **delivering** the invite/questions | **texting / email / voice** channels (via **dispatch**) |
| **Two-way capture** of SMS answers | **workflow** (`collect-input` / `wait-for-response` / `classify-reply`) |
| **External** survey tools (SurveyMonkey, Typeform, …) | **marketplace** connectors (+ their completion as a trigger) |
| Attaching scores/answers to the person | **contact** (custom fields, tags, NPS score) |
| **Audience** selection | **contact** (segments) / **campaign** |
| Response rates, score trends, **completion as a conversion** | **analytics** |

> A survey **completion** is a great **conversion / trigger** (the same pattern as a commerce order):
> "survey submitted → tag + thank-you + route detractors to support."

# Core concepts

* **Survey** — definition: ordered **questions**, branching logic, scoring config, status (draft/published), version.
* **Question** — typed: **NPS** (0–10), **CSAT** (1–5), **CES**, rating/scale, single/multi-select,
  ranking, open text, yes/no. Each renders per channel (SMS keyword vs web widget).
* **Distribution** — a send of the survey to an audience over a channel, on a schedule (a campaign of type
  "survey"). Carries the **`anonymous`** flag (per-send; **account-default**) — anonymous drops the token /
  contact link / per-contact scoring.
* **Response** — one contact's answers (+ partials), channel, the computed score, and **lifecycle + timing**:
  `status` (`in_progress` / `completed` / `abandoned`), **`lastQuestionId`** (where they stopped — the
  abandonment step), `startedAt` / `completedAt` / `abandonedAt`, and a derived **duration** (time-to-complete
  or time-to-abandon). `abandoned` is set when an `in_progress` response goes idle past a configurable timeout.
* **Result** — aggregates: response rate, score distribution, NPS/CSAT over time, by segment.

# Question / score types (first-class)

`nps` · `csat` · `ces` · `rating` (n-star) · `scale` (1–n) · `single_select` · `multi_select` ·
`ranking` · `open_text` · `yes_no`. NPS/CSAT/CES compute a **standard score** that lands on the contact
(e.g. `contact.nps = 9 → promoter`) and drives segmentation + follow-up branching.

# External providers (behind the email/web form runner)

Top-tier connectors (the *Forms/Surveys* marketplace category): **SurveyMonkey · Typeform · Qualtrics ·
Google Forms · Jotform · Alchemer**; NPS-specialists **Delighted / GetFeedback**; enterprise **Medallia**.
They're an **implementation of the email/web runner** — two shapes: **distribute-link + ingest-results**
(send their hosted survey over our channels, their webhook returns completion mapped to our Question
ids), or **import-definition** (pull their questions into our shared definition, then run via any runner).
Either way responses land on the **same Survey/Question ids**, so an externally-collected email response
still aggregates with the internal SMS responses.

# Boundaries with workflow (important)

A **native conversational survey IS a workflow** — don't build a second two-way engine:

* The survey service **compiles** a Survey definition into the workflow primitives (`collect-input` per
  question, `classify-reply`/`switch` for branching, `update-contact` to store the score).
* Equivalently, a `survey` **node** in a workflow runs a survey inline; a survey **completion** is a
  workflow **trigger**. (**Decided:** SMS = compile-to-workflow, not a separate engine.)
* The **email/phone runners do NOT go through workflow** — they're a form/IVR service rendering the
  shared definition; only the SMS conversational runner compiles to workflow steps.

# Consent & compliance

Surveys over SMS/email are **still channel sends** — full consent + **STOP** + quiet-hours + suppression
apply (a "survey" is not a loophole around TCPA/CAN-SPAM). Responses are PII → contact tombstone/GDPR rules.

# Service & Job topology

**Convention (platform-wide).** Each service layers **framework base → domain base → concrete role**. A **domain
Service base** (`SurveyService extends Service`) and a **domain Job base** (`SurveyJob extends Job`) hold the
**shared domain code** — the **survey definition** model + **question / score types**, the **scoring engine**,
the **runner-compile** logic (SMS → workflow `collect-input`), the **public-form render / validate + bot
protection**, the **external-connector** factory, and **analytics emit** — so every concrete role inherits it.
Survey is **not a channel** — it delegates sending to the channels (via dispatch / workflow) and owns the
**definition + capture + scoring + results**.

```
Application
├── Service (Fastify, long-running — ECS)
│     └── SurveyService           (domain base — definition model · question/score types · scoring engine · runner-compile · public-form render/validate + bot-protection · connector factory · analytics emit · audit; not deployed alone)
│           ├── SurveyMainService  (the /survey/* API: survey CRUD/definition · distribution setup · results/reads · config/health — authed)
│           └── SurveyFormService  (the PUBLIC hosted-form capture ingress behind CloudFront + WAF: submit/validate · bot protection (CAPTCHA) · pseudonymous/anonymous token; unauthenticated, abuse-hardened — scales apart)
└── Job (Lambda, event-driven)
      └── SurveyJob                (domain base — response/scoring engine · connector factory · idempotency)
            ├── SurveyResponseJob   (SQS — process captured responses: score · partial/abandonment tracking · land scores/tags on contact · emit response/completed → analytics + workflow trigger)
            ├── SurveyIngestJob     (SQS — external-result ingestion (SurveyMonkey/Typeform/… via marketplace) → normalize → Response)
            └── SurveyDistributionJob (EventBridge/SQS — scheduled distributions: hand invites/questions to the channels (dispatch); SMS runner compiles to workflow collect-input)
```

**Services (HTTP, ECS Fargate)**

| Class | Extends | Role |
|---|---|---|
| **`SurveyService`** | `Service` | **Domain base** — definition model · question/score types · scoring engine · runner-compile · public-form render/validate + bot-protection · connector factory · analytics emit · audit; **not deployed alone**. |
| **`SurveyMainService`** | `SurveyService` | The **authed `/survey/*` API** — survey **CRUD / definition**, **distribution** setup, **results / reads**, config/health. |
| **`SurveyFormService`** | `SurveyService` | The **public hosted-form capture ingress** behind **CloudFront + WAF** — submit / validate, **bot protection** (CAPTCHA), **pseudonymous / anonymous token** handling. **Unauthenticated, abuse-hardened** → **scales apart** from the authed API. (The SPA form itself is rendered by [web](../web/SPECS.md).) |

**Jobs (Lambda, event-driven)** — each extends `SurveyJob`:

| Class | Trigger | Role | Req |
|---|---|---|---|
| **`SurveyResponseJob`** | SQS | Process captured responses — **score**, **partial / abandonment** tracking (status · lastQuestionId · timing · TTL), **land scores / tags on the [contact](../contact/SPECS.md)**, emit **`response` / `completed`** → analytics + **workflow trigger** | survey-4.0 / 5.0 |
| **`SurveyIngestJob`** | SQS | **External-result ingestion** — pull / receive results from external providers (SurveyMonkey / Typeform / … via [marketplace](../marketplace/SPECS.md)) → normalize → `Response` | survey-6.0 |
| **`SurveyDistributionJob`** | EventBridge / SQS | **Scheduled distributions** — hand invites / questions to the **channels** (via [dispatch](../../../packages/services/DISPATCH.md)); the **SMS runner compiles to workflow `collect-input`** (don't rebuild two-way capture) | survey-3.0 |

> **Shared modules (not deployables).** The **definition model + question/score types**, the **scoring engine**,
> the **runner-compile** (SMS → workflow), the **external-connector factory** (marketplace), and the
> **bot-protection** live on the bases and are reused across the services + jobs. Survey **never sends** — the
> channels deliver (consent via `canSend()`); survey **captures + scores + emits**. The **public form** is the
> abuse-exposed tier (CAPTCHA + WAF), isolated from the authed admin API.

# AWS Services and Other Dependencies

**AWS services**
* **DynamoDB** — `Survey` definition · `Distribution` · `Response` (account-scoped).
* **Kafka (MSK)** — emit `response` / `completed` events to analytics + as a **workflow trigger**.
* **SQS** (+ DLQ) — response-processing + external-result ingestion workers (fair-share).
* **EventBridge Scheduler** — scheduled distributions.
* **CloudFront + WAF** (+ **API Gateway**) — the **public hosted-form** surface + **bot protection**.
* **S3** — form assets / response exports. **KMS** — encryption at rest.

**Third-party libraries / services**
* **External survey tools** (behind the email/web form runner, via **marketplace**) — **SurveyMonkey ·
  Typeform · Qualtrics · Google Forms · Jotform · Alchemer**; NPS — **Delighted / GetFeedback**; enterprise
  **Medallia**.
* **Bot protection** for the public form — a CAPTCHA / challenge (e.g. Turnstile / hCaptcha) + WAF.

**Internal (`@repo/*`)**
* `@repo/services` (Dynamo, Kafka, Sqs, Scheduler, Kms, Cache), `@repo/endpoint` (`Access`), `@repo/common` (`Type`).
* **workflow** — SMS runner compiles to `collect-input` / `classify-reply` (don't rebuild two-way capture).
* **[texting](../texting/SPECS.md) / [email](../email/SPECS.md) / voice** channels (via **[dispatch](../../../packages/services/DISPATCH.md)**) — deliver the invite/questions; **`canSend`** consent gate.
* **[contact](../contact/SPECS.md)** — scores / tags / custom fields land on the person; segments for audience.
* **campaign** — audience + a "survey" distribution. **[analytics](../analytics/SPECS.md)** — results / completion-as-conversion.
* **[marketplace](../marketplace/SPECS.md)** — external form connectors. **[web](../web/SPECS.md)** — renders the public hosted form.

# Compliance & standards mapping

How **this survey service's** controls map to **OWASP Top 10 (2021)**, **ISO/IEC 27001:2022** (Annex A),
**SOC 2 Type 2** (TSC), **HIPAA** (if PHI), **GDPR**, **CCPA/CPRA**, and **messaging law** (TCPA / CAN-SPAM /
CASL). A survey is **not a channel** — but surveys ride **SMS/email sends**, so the **channel `canSend` gate
(consent / STOP / quiet-hours / suppression) fully applies** (a "survey" is **not** a TCPA/CAN-SPAM loophole).
Responses are **PII** (and a **public form** is an internet-facing input surface), so the dominant controls are
**send-consent**, **response-PII erasure**, and **public-form hardening (bot protection + validation)**. **No
PCI** (no payment). **HIPAA** ➖ (no PHI by [AUP](../account/specs/SPECS.md)).

**Legend:** ✅ meets/exceeds · ⚠️ partial / open — see Gaps · ➖ n/a

| Survey control | OWASP T10 | ISO 27001:2022 | SOC 2 (TSC) | HIPAA (if PHI) | GDPR | CCPA | Messaging | |
|---|---|---|---|---|---|---|---|---|
| **Send-consent** — survey sends ride the channel **`canSend`** gate (consent / STOP / quiet-hours / suppression); not a loophole | A01 / A04 | A.5.34 / A.8.3 | CC6.1 | ➖ | Art 6 / 21 | §1798.120 | **TCPA / CAN-SPAM / CASL** | ✅ |
| **Response PII erasure** — responses attach to the contact; **contact-forget propagates** (tombstone) + retention | A02 / A04 | A.8.10 | (Privacy) | ➖ | Art 17 / 32 | §1798.105 | ➖ | ✅ |
| **Public-form hardening** — internet-facing render/submit: **bot protection (CAPTCHA/WAF)**, input validation, accessibility | A03 / A04 / A05 | A.8.26 / A.8.28 | CC6.1 / CC7.1 | ➖ | Art 32 | ➖ | ➖ | ✅ |
| **Tenant isolation** — surveys / responses / results are account-scoped; never cross accounts | A01 | A.8.3 | CC6.1 | ➖ | Art 32 | §1798.100 | ➖ | ✅ |
| **Anonymous-response option** — **per-send** flag (account-default): anonymous = **no token / no contact link / no scoring** (aggregates only) | A01 | A.8.10 | (Privacy) | ➖ | Art 5 / 25 | §1798.100 | ➖ | ✅ |
| **External provider = sub-processor** — an external form runner **splits PII** to a third party → DPA / sub-processor + write-back mapping | A08 | A.5.19 / A.5.20 | CC9.2 | ➖ | Art 28 | §1798.140 | ➖ | ✅ |
| **PURL / submission-token integrity** — the token tying an anonymous submission to a contact is signed + scoped, not guessable | A01 / A08 | A.8.3 | CC6.1 | ➖ | Art 32 | ➖ | ➖ | ✅ |
| **Encryption** — DynamoDB at rest (KMS) + TLS in transit | A02 | A.8.24 | CC6.1 | §164.312(e) | Art 32 | ➖ | ➖ | ✅ |
| **No PHI** by AUP — surveys carry no PHI | ➖ | A.5.34 | (Privacy) | §164.502 (AUP) | Art 9 | ➖ | ➖ | ✅ |

> **Design-intent mapping** — how the service is *intended* to satisfy each control, not an attestation.
> Identity/RBAC is [auth](../auth/specs/SPECS.md); the send-consent gate is the channel's (`canSend`).

# Gaps & open decisions

*The one review list.* ✅ = resolved/decided · ⚠️ = **open — needs attention**.

1. ✅ **One definition, per-channel runners — DECIDED.** A single **channel-agnostic definition** is the SoT;
   **SMS runs internally as a workflow** (`collect-input`), **email/web runs through a form service**, **phone**
   later. Author once → run anywhere; all responses normalize to the same Survey/Question ids.
2. ✅ **Email form service — DECIDED: BUILD (lean), external as an optional runner.** Unification + data
   ownership win: an external form reintroduces a per-provider **schema-mapping seam** and **splits PII** to a
   third party (vs our GDPR tombstone). The hard part (question model / branching / NPS-CSAT scoring) is already
   ours, so the email runner is *"render our definition as a form + collect a POST."* External providers slot in
   as a **secondary** marketplace runner. *Caveat:* a public form still needs **accessibility + mobile + bot
   protection** — don't under-scope "lean" *(see gap #3)*.
3. ✅ **Hosted-form surface — DECIDED.** The public **form-render** lives in **[web](../web/SPECS.md)** + a
   **public submit API** here. **Bot protection (CAPTCHA + WAF) is required** (`survey-7.2`, priority A — not
   polish), and a **signed PURL / submission token** ties the submission back to the contact (`survey-7.3`).
   Accessibility + mobile are committed **build** requirements, not open questions *(compliance rows 3 + 7)*.
4. ✅ **Response identity — DECIDED: per-send option, account-default.** Each **survey send (`Distribution`)**
   chooses **anonymous or not**; the **default is account-configurable**. **Not anonymous** = pseudonymous
   (tokenized PURL maps to a known contact, scores land on them — `survey-7.3`). **Anonymous** = **no token
   binding**, no contact link, **no per-contact scoring** — aggregates only, and falls outside contact-forget
   (no personal data to erase) — `survey-4.4`.
5. ✅ **Partials / abandonment — DECIDED: track it.** **Store partials.** A `Response` carries `status`
   (`in_progress` / `completed` / `abandoned`), **`lastQuestionId`** (the step where they stopped), and
   **timing** (`startedAt` / `completedAt` / `abandonedAt` → **time-to-complete or time-to-abandon**). A
   response flips to `abandoned` after a **configurable inactivity timeout**; a **retention TTL** ages out stale
   partials. **Drop-off-by-step + timing** feed analytics. *(Re-prompt is an optional follow-up — it's another
   send, so it rides `canSend` / quiet-hours.)* — `survey-4.3`.
6. ✅ **Completion as conversion — DECIDED: yes.** A survey **completion** emits an analytics
   **conversion / workflow trigger** (mirrors the commerce-order pattern): "submitted → tag + thank-you + route
   detractors to support."

# Requirements (traceable register)

The traceable requirement register for the **survey service** (the sections above are the rationale; this is
the coded list). IDs are stable handles (**`survey-N.M`**) — cite them in code, tickets, and tests.
**Priority:** **A** = MVP, **B** = core / hardening, **C** = later. One level of sub-requirements; a group's
priority is its floor. **Boundaries:** survey owns the **definition + distribution-intent + response/scoring +
results**; **channels** deliver (via dispatch, gated by `canSend`), **workflow** runs SMS two-way capture,
**contact** holds scores, **campaign** picks audience, **analytics** owns trends, **marketplace** brings external tools.

## survey-1.0 Definition — A
- **survey-1.1** **Channel-agnostic Survey definition** — ordered questions + **branching logic** + scoring config; the **SoT** all runners share — A
- **survey-1.2** **Question types** — `nps` · `csat` · `ces` · `rating` · `scale` · `single_select` · `multi_select` · `ranking` · `open_text` · `yes_no` — A
- **survey-1.3** **Scoring** — NPS / CSAT / CES compute a **standard score** that lands on the contact + drives branching/segmentation — A
- **survey-1.4** **Versioning + status** (`draft` / `published`) — responses pin the version they answered — B

## survey-2.0 Channel runners — A
- **survey-2.1** **SMS = compile-to-workflow** — generate `collect-input` / `classify-reply` steps; **don't rebuild two-way capture** *(gap #1)* — A
- **survey-2.2** **Email/web = form service (BUILD, lean)** — render the shared definition as a **hosted form**; collect a POST *(gap #2)* — A
- **survey-2.3** **External provider runner** — an **optional** email/web runner via marketplace (distribute-link+ingest, or import-definition) → same Survey/Question ids *(gap #2)* — B
- **survey-2.4** **Phone / IVR runner** — voice prompts + DTMF/speech, same definition — C
- **survey-2.5** All runners **normalize responses to the same Survey/Question ids** (unified results) — A

## survey-3.0 Distribution — A
- **survey-3.1** Distribute a survey to an **audience** over a **channel** on a **schedule** (a "survey" campaign) — A
- **survey-3.2** Audience = **[contact](../contact/SPECS.md)** segments / **campaign**; delivery via the channel + **dispatch** — A

## survey-4.0 Response capture & scoring — A
- **survey-4.1** Capture one contact's answers (+ **partials**), `startedAt` / `completedAt`, channel, computed score — A
- **survey-4.2** **Score lands on the contact** (e.g. `contact.nps = 9 → promoter`) → segmentation + follow-up — A
- **survey-4.3** **Track partials / abandonment** — **store partials**; `status` (`in_progress` / `completed` / `abandoned`), **`lastQuestionId`** (drop-off step), `startedAt` / `completedAt` / `abandonedAt` → **time-to-complete / time-to-abandon**; flip to `abandoned` after a **configurable inactivity timeout**; **retention TTL** on stale partials *(gap #5)* — B
  - **survey-4.3.1** **Re-prompt (optional)** — nudge an abandoned partial; it's **another send** → rides `canSend` / quiet-hours — C
- **survey-4.4** **Response identity — per-send option, account-default** — each `Distribution` is **anonymous or not**; default **account-configurable**. Anonymous = **no token binding / no contact link / no per-contact scoring** (aggregates only, outside contact-forget) *(gap #4)* — B

## survey-5.0 Results & events — A
- **survey-5.1** **Aggregates** — response rate, score distribution, NPS/CSAT over time, by segment, **drop-off-by-step** (abandonment funnel), **time-to-complete / time-to-abandon** → **analytics** — B
- **survey-5.2** **Completion = conversion / trigger** — emit a workflow trigger + analytics conversion on submit *(gap #6)* — A

## survey-6.0 External providers — B
- **survey-6.1** External tools are an **email/web runner implementation** (or definition import), **not a separate model** — B
- **survey-6.2** **Sub-processor** — external runner is a third-party **DPA / sub-processor**; PII split is disclosed; results map back to our ids — B

## survey-7.0 Consent & compliance — A
- **survey-7.1** Survey sends ride the channel **`canSend`** gate (consent / STOP / quiet-hours / suppression) — **not a loophole** — A
- **survey-7.2** **Public-form hardening** — bot protection (CAPTCHA + WAF), input validation, accessibility, mobile *(gap #3)* — A
  - **survey-7.2.1** **Sanitize HTML (XSS/JS)** — any author-supplied / rendered HTML (question content, hosted-form markup, open-text answers echoed back) runs through the **shared `Application.sanitizeHtml`** (allowlist; strip `script`/`style`/`on*`; constrain URLs) on **store + output** — the public form is internet-facing *(see [`@repo/services` → Shared HTML sanitizer](../../../packages/services/README.md))* — A
- **survey-7.3** **PURL / signed submission token** — ties an **unauthenticated** submission to a **known** contact (**pseudonymous**, not anonymous); signed + scoped, not guessable. A **truly anonymous** survey (gap #4) uses **no token binding** — A
- **survey-7.4** **Response PII erasure** — contact-forget propagates (tombstone) + retention; **no PHI** by AUP — A

## survey-8.0 Architecture & infra — A
- **survey-8.1** DynamoDB (Survey / Distribution / Response); **Kafka** events; **SQS** (+ DLQ) workers; **EventBridge Scheduler**; **CloudFront + WAF** for the public form — A
- **survey-8.2** Survey **is not a channel** and owns **no two-way engine** — it defines + distributes + collects + scores, reusing workflow/channels — A

## survey-9.0 Service & Job topology — B
- **survey-9.1** **Domain bases** — `SurveyService extends Service` + `SurveyJob extends Job` hold the shared code (definition model · question/score types · scoring engine · runner-compile · public-form render/validate + bot-protection · connector factory · analytics emit); **concrete roles extend the domain base** — B
- **survey-9.2** **`SurveyMainService`** — the authed `/survey/*` API (CRUD/definition · distribution · results) — A
- **survey-9.3** **`SurveyFormService`** — the **public hosted-form capture ingress** (CloudFront + WAF + CAPTCHA, pseudonymous/anonymous token); **unauthenticated, abuse-hardened**, **scales apart** from the authed API — A
- **survey-9.4** **Jobs extend `SurveyJob`** — `SurveyResponseJob` / `SurveyIngestJob` / `SurveyDistributionJob` — A
- **survey-9.5** **`SurveyResponseJob`** — score · partial/abandonment tracking · land scores/tags on contact · emit `response`/`completed` → analytics + workflow trigger — A
- **survey-9.6** Survey **never sends** — `SurveyDistributionJob` hands off to the channels (dispatch); SMS runner = workflow `collect-input` — A

# Endpoints (first cut)

A first pass, in [`@repo/endpoint`](../../../packages/endpoint/SPECS.md) style — service-prefixed `/survey/*`.
The **public hosted form** is rendered by **[web](../web/SPECS.md)**; these are the definition / distribution /
results APIs + the **public** form fetch/submit + the external-provider webhook.

**Access column:** **`minAccess`** — **`-`** public · account ladder **`SENDER`<`USER`<`BILLING`<`ACCOUNT`** ·
staff **`SUPPORT`<`APPLICATION`<`ROOT`** · **`Internal`** = VPC-only S2S · **`Webhook-sig`** = provider-signed ·
**`Token`** = signed PURL / submission token.

| Method | URI | Purpose | Access | Req |
|---|---|---|---|---|
| GET, POST | `/survey/surveys` | List / create a survey definition | USER | survey-1.1 |
| GET, PUT | `/survey/surveys/{surveyId}` | Read / update a definition | USER | survey-1.1 |
| POST | `/survey/surveys/{surveyId}/publish` | Publish (`draft → published`) | USER | survey-1.4 |
| POST | `/survey/distributions` | Distribute to an audience / channel / schedule | SENDER | survey-3.1 |
| GET | `/survey/distributions/{distId}` | Distribution status | SENDER | survey-3.1 |
| GET | `/survey/surveys/{surveyId}/responses` | List responses (incl. partials) | USER | survey-4.1 |
| GET | `/survey/surveys/{surveyId}/results` | Aggregates (rate, score distribution, by segment) | USER | survey-5.1 |
| GET | `/survey/forms/{token}` | **Public** — fetch the form to render (PURL/token-scoped) | Token | survey-2.2/7.3 |
| POST | `/survey/forms/{token}` | **Public** — submit answers (**bot-protected + validated**) | Token | survey-2.2/7.2 |
| POST | `/survey/internal/responses` | S2S — ingest a response (workflow `collect-input` / channel inbound) | Internal | survey-4.1 |
| POST | `/survey/webhooks/{provider}` | External provider completion → mapped to our Question ids | Webhook-sig | survey-2.3 |
| GET, PUT | `/survey/config` | Account defaults — **anonymity default**, partial-response policy | ACCOUNT | survey-4.4 |
| GET | `/survey/health` | Liveness / readiness | - | survey-8.1 |

# eof

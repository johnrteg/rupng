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
* **Distribution** — a send of the survey to an audience over a channel, on a schedule (a campaign of type "survey").
* **Response** — one contact's answers (+ partials), `startedAt`/`completedAt`, channel, the computed score.
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

# Open decisions

1. ~~Native vs external-first / compile-to-workflow~~ — **DECIDED:** one **channel-agnostic definition**;
   **SMS runs internally as a workflow** (`collect-input`), **email/web runs through a form service**
   (ours or an external provider). Remaining: build *our* form service vs start with an external one.
2. **Email form service — build vs buy** — **leaning BUILD (lean), external as an optional runner.**
   The deciding factor is **unification + data ownership**: an external form reintroduces a
   per-provider **schema-mapping seam** (their fields → our Question ids) and **splits PII** into a
   third party (vs our GDPR tombstone) — fighting the "one definition, unified results" goal. And the
   *hard* part (question model, branching, NPS/CSAT scoring) **is already ours** in the shared
   definition, so the email runner is **"render our definition as a form + collect a POST,"** not a
   Typeform-from-scratch. Build wins on native/owned/on-brand results; offer external providers as a
   **secondary** marketplace runner for accounts that prefer their tooling. *Honest caveat:* a public
   form endpoint still needs accessibility, mobile, and **bot protection** — don't under-scope "lean."
3. **Hosted form surface** — the email/web runner needs a **public form-render** endpoint (where does it
   live — `web` + a public API?); PURL ties an anonymous submission back to the contact.
4. **Response identity** — tie to the contact (default, addressed channels) vs **anonymous** surveys
   (no contact link, just aggregates).
5. **Partial responses / abandonment** — store partials? re-prompt? expire?
6. **Completion as conversion** — register survey completion as an analytics conversion/trigger (yes —
   mirrors the commerce-order pattern).

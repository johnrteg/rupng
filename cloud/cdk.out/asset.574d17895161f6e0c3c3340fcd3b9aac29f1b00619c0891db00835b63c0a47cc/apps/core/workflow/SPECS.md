#
# Workflow Service (the account-defined automation engine — deployable)
#

# Objective

The **orchestration brain of automation** — where an account turns *"when X happens, do Y, then
wait, then maybe Z"* into a **durable, branching, per-subject journey** the platform runs reliably
across restarts, long waits, and retries. It is the home for **drip sequences, multi-step journeys,
and integration-triggered automation** — the things [campaign](../campaign/SPECS.md) explicitly defers
here. An event arrives (`contact replied STOP`, `order placed`, `tag added`); workflow finds the flow,
decides the next node, and **enqueues the side effect to the service that performs it** — then parks
until the next event.

This spec is the **deployable service** view. The **engine design** (node catalog, execution model,
context/signals, the `code` sandbox, the swappable `Engine` port) lives alongside it in
[README.md](./README.md) (the engine that this service's `src/` implements). Read that for *how a flow
runs*; read this for *what gets deployed and how it wires into the platform*.

The load-bearing ideas:
* **decider, not doer** — workflow owns the *definition*, the *trigger routing*, the *per-instance run
  state*, the *control flow*, and the *scheduling of waits* — and **delegates every side effect** to the
  owning service (a `send-text` node enqueues to [texting](../texting/SPECS.md)/[dispatch](../../../packages/services/DISPATCH.md),
  never sends). If a send or a segment eval is reimplemented here, it drifts from the real one;
* **event-driven both ways** — an event both **starts** a new instance *and* **resumes** a parked one
  (a `wait-for-response`); workflow decides → enqueues → **waits for the resulting event** → decides
  again. That loop is what survives long waits + restarts;
* **durable interpreter** — instance state (position + context + history + status) is **persisted on
  every transition** (DynamoDB); sleeps/timeouts are **EventBridge Scheduler** wakeups; steps are
  **idempotent + retryable**;
* **the data map lives here** — node→node data flow is the instance **context** + per-node
  `outputMap` / `transform` / `code` seam (producers don't know consumers); definitions are
  **immutable once published**, instances **pin their version**;
* **engine + deployable, one home** — the **engine** (the `Workflow.*` model · node defs · the swappable
  `Engine` port) and the **deployable** (API + trigger/step/scheduler roles) both live in
  **`apps/core/workflow/src/`**. The `Engine` **port** stays an internal boundary (custom interpreter
  today; Step Functions / Temporal possible later) so the substrate can change without touching
  definitions or nodes — and so it could be extracted to a library *if* a second consumer ever appears.

# Architecture — consolidated in this service

| Layer | Where | What |
|---|---|---|
| **Engine** | **`apps/core/workflow/src/`** ([`WorkflowModel.ts`](src/WorkflowModel.ts) + interpreter) | the `Workflow.*` model, node definitions + typed `config/input/output` contracts, validation, and the **swappable `Engine` port** (custom interpreter today; Step Functions / Temporal later). |
| **Deployable roles** | **`apps/core/workflow`** (this spec) | the **`/workflow/*` API**, the **event→trigger router**, the **step executor**, the **scheduler** — hosting the engine above. Owns the AWS footprint (DynamoDB · SQS · EventBridge Scheduler). |

> **Consolidation — DECIDED.** The engine was moved out of a standalone `@repo/workflow` package into
> this service's `src/` (nothing else imported it). One home, simpler deps. The **`Engine` port** is kept
> as an **internal boundary**, so a later extraction to a shared library (if a second runner appears) is
> cheap — but until then there's no separate package to drift.

# The runtime loop (why it must be a service)

```
 1. EVENT IN  ── Kafka (the Events vocabulary) ──► WorkflowTriggerConsumer
                  match account trigger bindings → START a new instance OR SIGNAL a parked one
                  (gated by Events.canConsume(accountRole, action) — can't trigger on unseen data)
 2. LOAD      ── instance (DynamoDB): position + context + history + status
 3. DECIDE    ── the Engine walks edges, evaluates conditions (if/switch) → the NEXT node
 4. MAP       ── resolve node→node data: context + outputMap / transform / code  (the data map)
 5. DISPATCH  ── enqueue the side effect to the OWNING service via SQS, carrying the resume token
                  {instanceId, nodeId, waitKey} (send-text → texting/dispatch, send-email → email, …).
 6. SUSPEND   ── persist the frontier; then either fire-and-forget, or PARK that node on a wait/timeout
                  (EventBridge Scheduler wakeup) until the resuming signal lands → back to step 1.
```

* **Someone decides what's next + emits the SQS** — that's steps 3–5, the engine. ✔
* **Completion resumes the exact node** — the owning service's result is just another step-1 event,
  correlated to the parked **node** two ways: **(a) echoed token** `{instanceId, nodeId, waitKey}` for
  completions of our own delegated calls (we control the round-trip); **(b) subject-keyed**
  `(accountId, subject, waitKey)` for **external inbound** signals that can't carry our id (a contact's
  SMS reply knows only the account + contact) — which resolves to the waiting `(instance, node)`.

# How a workflow operates (trigger → instance → frontier)

* **Triggers (1–N per workflow).** A definition declares **one or more triggers** — an inbound **event**
  (an `Events` action like `contact.contact.created`, an integration event like `shopify.order.placed`),
  a **schedule**, or a **manual/API** start. Triggers are bound per account and `canConsume`-gated.
* **Fan-out (0–N workflows per trigger).** A single inbound event is matched against **every** account
  trigger binding, so it may match **zero, one, or many** workflows — each match spawns its **own
  independent instance**. One `order.placed` can start a thank-you-text flow *and* a CRM-sync flow at once.
* **Instance + active position(s) — a frontier, not a single cursor.** Each match creates a **runtime
  instance** of that definition **version**, with its **context** (variables), **history**, **status**,
  and **one or more active positions**. The engine **evaluates** an active node, **executes** it (or
  delegates the side effect), then **advances by node type** (an `if` takes its `true`/`false` edge, an
  action its default edge, a `wait-*` parks). Because a flow **branches and can run parallel paths**
  (`split`/`merge`, `for-each`), **several nodes can be active or waiting at once** — so position is a
  **set keyed by node**, *not* a single linear cursor.
* **Resume key = `instanceId` + `nodePath` (+ `waitKey`).** When a step **delegates** a side effect (an
  SQS message to texting/email/…), the token that rides along — and is **echoed back** on the completion /
  signal — is the **instance *and* the originating node** (plus a per-wait key). `nodePath` is the node
  id, extended **inside a loop with the iteration index** (nested loops → a path) so a loop body's many
  in-flight sends each resume their own iteration (see *Loops* below). The instance alone isn't
  enough: a flow has **multiple `send-email` / `wait-*` nodes** and isn't linear, so the engine must know
  **which node/branch** a result belongs to, to resume the right one — and to stay **idempotent** against
  a late/duplicate completion that arrives after the frontier moved. (Distinct from the **transaction id**,
  which threads cross-service *tracing*; this triple is *resume-routing*. It also disambiguates siblings
  spawned by the same event fan-out.)
* **Loops carry an iteration index.** `for-each` / `while` create a **loop frame** in the instance — the
  **authoritative, durable** state: the collection, the **current index**, per-iteration status +
  accumulated outputs, the **join counter** (parallel fan-out), and the **max-iteration guard**. The
  resume token's **`nodePath` includes the iteration index** (nested loops → a *path* of indices) so a
  per-item completion routes to the **right iteration slot** — essential for **parallel `for-each`**,
  where many iterations are in flight under one node id. **State lives in the instance** (survives
  restart, dedups a late/duplicate completion); **the message carries only the index — the *address*
  into the frame, never the state** (a message can dup / reorder / drop, so it can't be the truth).
* **Event-driven advance — listen, then eval + exec or fail.** New events are continuously listened for;
  each is either a **trigger** (start a fresh instance) **or** a **signal** to a **waiting node on the
  frontier** (`wait-for-response`, `wait-for-event`, an `approval`, a delegated-action completion, or
  a **timeout** wake). On arrival the engine **evaluates → executes → {advance | fail}**; a failure runs
  retry → the node's **error edge** → DLQ. A **waiting** instance holds **no compute** (it costs nothing
  while it waits days for a reply); it's resumed by signal or an EventBridge Scheduler timeout.
* **Live, inspectable state — the instance carries its full run record.** Open a **running** instance and
  you see, *as it stands now*: the **current frontier** (where it is — which node(s) active/waiting), the
  **context** (all accumulated variables), and **every upstream node's outcome** — a **per-node history**
  of entered-at, the evaluated condition/inputs, the typed output written to context, the outcome
  (advanced / waiting / failed), retries, and timing. So a live run is **self-explanatory**: you can read
  *why it took the branch it did*, *what each node produced*, and *where it's stuck* — not reconstruct it
  from scattered logs. It's **persisted on every transition** (so the snapshot is always current) and
  threaded with the **transaction id** so [monitor](../monitor/SPECS.md) shows the full cross-service path.
* **Durable + versioned.** State is **persisted on every transition** (resume exactly where it left off
  after a restart); steps are **idempotent**; a long-running instance **pins the definition version** it
  started on even after the author edits the workflow.
* **Stoppable — graceful and forceful.** A running instance can be **canceled** (graceful) or
  **force-stopped / terminated** even when **jammed** — a stuck step, a runaway loop, or a flow found to
  be wrong: the in-flight step is abandoned and the instance moves to **terminated**. A definition-level
  **kill switch** stops **all** running instances of a definition at once (the "this flow is broken, halt
  everything" button).
* **Definition lifecycle.** A definition moves **`draft → published → paused → archived`**: **publish** is
  versioned + immutable; **pause** disables its **triggers** (no *new* instances start; in-flight ones
  continue unless also stopped); **resume** re-enables; **test** (simulate or live) is available in any
  state; archive retires it (never deleted).
* **Testing — with or without live execution.**
  - **Simulation (no execution):** run against **mock context/inputs** with side-effecting nodes
    **stubbed** (no real send) and time **fast-forwarded** (sleeps/timeouts don't wait) → the **path +
    per-node output** for the author to verify *before publishing* (`workflow-8.1`).
  - **Live test run (real execution):** run the published flow against a designated **test subject**
    (real sends to a test number/inbox) to validate end-to-end (`workflow-8.3`).

# Node catalog (the building blocks an account composes)

Curated, **typed** nodes — each declares a `config` / `input` / `output` contract validated at publish.
*Control/flow* nodes have **no side effect** (they only choose an edge); *action* nodes **delegate** the
side effect to the owning service. Full per-node detail + the typed contracts live in the
[engine README](./README.md#node-catalog).

| Group | Nodes | Use |
|---|---|---|
| **Entry / terminal** | `start` · `end` / `exit` · `goal` | trigger entry; instance completes; `goal` also records a conversion for metrics |
| **Control & flow** *(no side effect — choose an edge)* | `if` / `else-if` / `else` · `switch` · `filter` · `then` · `split` / `merge` · `ab-split` / `random` · `for-each` · `while` · `goto` · `sub-workflow` | branch, guard, sequence, parallel fan-out/rejoin, %-split (experiment/holdout), definite/indefinite loops (guarded), jump, invoke another flow |
| **Time & pacing** | `sleep` · `wait-until` · `quiet-hours` · `throttle` · `digest` · *(timeout edge on every `wait-*`)* | pause for a duration / calendar moment; hold to a compliant send window; rate-limit; batch-and-release |
| **Inbound / conversation** *(durable waits)* | `wait-for-response` · `wait-for-event` · `classify-reply` · `collect-input` · `ai` / `llm` · `approval` | park for a reply / external event / staff approval; branch on keyword or **AI intent**; multi-turn capture |
| **Action — channels** *(delegated send)* | `send-text` → texting/dispatch · `send-email` → email · `send-push` · `send-rich` (WhatsApp/RCS) · `send-voice` · `launch-campaign` → campaign | the actual outbound; consent/suppression re-checked at send; workflow only enqueues |
| **Action — data & integration** | `http-call` · `transform` / `map` · `code` (sandboxed) · `lookup` / `query` · `enrich` · `set-variable` · `emit-event` · `sync-crm` · `format` · `find-or-create` · `store-get` / `store-set` | fetch/normalize/compute context; the producer→consumer **transform seam**; per-account cross-run KV state |
| **Action — audience & lifecycle** | `update-contact` → contact · `update-consent` → contact/compliance · `score` · `generate-link` → links · `notify-internal` | mutate the subject/segment, consent, score; mint a tracked link; alert staff (not the contact) |
| **Integration (dynamic, from marketplace)** | `integration-action` + integration **trigger** nodes | nodes an **enabled marketplace integration** contributes — contract from the integration definition, creds from the vault, call run by the connector runtime ([marketplace](../marketplace/SPECS.md)) |

> **The `code` node is a distinct security tier** — a **sandboxed, pure `(input)=>output`** transform
> (no I/O, no ambient access, hard CPU/mem/timeout caps, output validated by ajv, recorded for replay).
> Side effects **never** run from inside code — they go through the curated action nodes (which carry
> consent / retry / idempotency). See the engine README.

# Make vs buy — engine + the libraries around it

The **engine** is the one *build* decision (see [README → Engine build vs. buy](./README.md#engine--build-vs-buy-the-core-decision): custom interpreter vs **AWS Step Functions** vs **Temporal**, behind the swappable `Engine` port — open decision #1). **Everything around it should be bought**, not hand-rolled — these are security- or correctness-sensitive surfaces with mature, vetted options:

| Need | Build / buy | Recommendation | Why |
|---|---|---|---|
| **Durable orchestration engine** | **build** *(or managed)* | Custom interpreter on our stack — *or* **AWS Step Functions**; behind the `Engine` port | The core decision (README). Zero-new-infra + full control of live-edited per-account graphs vs no-engine-to-operate. **Temporal** = later power option, not a rewrite (the port). |
| **Condition / gate expressions** | **buy** | **CEL** (`cel-js`) or **JSONLogic** | Gates must be **safe, serializable, statically validatable** — never `eval` author input. A vetted evaluator gives that for free; hand-rolling a parser is risk with no upside. |
| **Mapping / `transform` node** | **buy** | **JSONata** | Declarative reshape/merge across context (the producer→consumer seam) without dropping to `code`. |
| **`code` node sandbox (untrusted JS)** | **buy isolation** | **AWS Lambda** code-runner (zero-permission role — the README's chosen substrate); *in-process alt:* **`isolated-vm`** (V8 isolates) or **QuickJS-WASM** | Hard isolation + CPU/mem/timeout caps + recorded/replayable. **Avoid `vm2`** (deprecated, CVE-prone) — it is *not* a real sandbox. |
| **Visual flow editor (canvas)** | **buy** *(web)* | **React Flow (`@xyflow/react`)** | The node-graph builder is a **web** concern; React Flow is the mature option (Rete.js / GoJS alternates). Workflow owns the schema + a layout hint, not the canvas. |
| **Recurrence / iCal** (`schedule` trigger · `wait-until`) | **buy** | **`rrule.js`** (RFC-5545) | Parse/expand RRULEs; the *wake* itself is **EventBridge Scheduler** (already ours). |
| **AI / LLM node** | **buy / managed** | **`@repo/ai`** → **Bedrock** (or a vendor API) | Model inference is a separate capability (open decision #8) — the `ai`/`llm` node is **provisional** until it lands. |
| **Queue / delays / retries** | **already have** | `@repo/services` **SQS** + **EventBridge Scheduler** | Not a workflow engine — BullMQ / Node-RED / n8n are queues / single-tenant tools, not an embedded multi-tenant durable engine (README "not chosen"). |

**Net:** build the **engine + durable semantics** (idempotency, retries, races, replay) and the **account-defined graph model + simulation**; **buy** the expression evaluator, transform lib, sandbox isolation, editor canvas, and RRULE parser. Keep each behind a thin internal seam so a swap (e.g. CEL→JSONLogic, isolated-vm→Lambda) doesn't touch definitions or nodes.

# Role & boundaries (summary — full table in the engine README)

**Owns:** the **definition** (versioned graph), **trigger bindings** + event→instance routing, the
**instance/run** (context, position, history, status), **control flow** (if/switch/sleep/wait+timeout),
**durability/retries/idempotency**, **test/simulation**, and emitting workflow **lifecycle events**.

**Delegates (calls out, never implements):** send-email → [email](../email/SPECS.md); send-text/MMS →
[texting](../texting/SPECS.md); pacing/fallback/DLQ → [dispatch](../../../packages/services/DISPATCH.md);
launch a campaign → [campaign](../campaign/SPECS.md); segments/consent → [contact](../contact/SPECS.md);
media → [media](../media/SPECS.md); entitlements → [account](../account/specs/SPECS.md); identity/role →
[auth](../auth/specs/SPECS.md); timers → **EventBridge Scheduler**; run trace/metrics →
[monitor](../monitor/SPECS.md); engagement → [analytics](../analytics/SPECS.md). **Integration nodes**
are *supplied* by [marketplace](../marketplace/SPECS.md) (catalog + creds); workflow is **not** "powered
by" it — built-in nodes owe it nothing.

# Events — workflow both consumes and emits

* **Consumes** (the trigger side): any [`Events`](../../../packages/endpoint/src/EventTypes.ts) action,
  matched against account trigger bindings. **`Events.canConsume(accountRole, action)`** gates which
  events an account may bind a trigger to — so a flow can't be triggered by data the account can't see.
* **Emits** (its own lifecycle): **`Events.WorkflowAction`** — `workflow.workflow.created/updated/deleted`
  and `workflow.instance.created` (started) / `instance.updated` (advanced · **completed** · **failed** —
  terminal status in `context` + `outcome`) / `instance.deleted` (cancelled). These flow to audit /
  analytics / realtime like any other service's events.

# Service & Job topology

**Convention (platform-wide).** Framework base → domain base → concrete role. **`WorkflowService extends
Service`** and **`WorkflowJob extends Job`** hold the shared domain code — the **engine** (`src/`:
interpreter + node defs + validation), the **definition/instance model + store**, the **trigger matcher**,
the **`canConsume` gate**, and **audit/emit**. The engine is **request-driven for authoring** (one Service)
but **self-driven for execution** (a Consumer + Jobs).

```
Application
├── Service (Fastify, long-running — ECS)
│     └── WorkflowService          (domain base — engine (src/) · definition/instance model + store · trigger matcher · canConsume · audit; not deployed alone)
│           └── WorkflowMainService  (the /workflow/* API: definition CRUD + versioning/publish · trigger bindings · instance reads · manual start · test/simulate · config/health)
└── Daemon
      ├── Consumer (self-driven — ECS)
      │     └── WorkflowTriggerConsumer  (consumes the Kafka event stream → match trigger bindings → START new / SIGNAL parked instances; canConsume-gated)
      └── Job (Lambda / event-driven)
            └── WorkflowJob          (domain base — engine step · instance store · idempotency)
                  ├── WorkflowStepJob       (SQS — execute one step: pick next node, map data, enqueue the side effect to the owning service; persist transition; emit instance event)
                  └── WorkflowSchedulerJob  (EventBridge Scheduler — sleep / timeout wakeups → resume parked instances)
```

**Services (HTTP, ECS Fargate)**

| Class | Extends | Role |
|---|---|---|
| **`WorkflowService`** | `Service` | **Domain base** — the engine (`src/`) · definition/instance model + store · trigger matcher · `canConsume` · audit; **not deployed alone**. |
| **`WorkflowMainService`** | `WorkflowService` | The **`/workflow/*` API** — definition CRUD + **publish/version**, trigger bindings, instance reads, **manual start**, **test/simulate**, config/health. |

**Consumer (self-driven, ECS Fargate)** — `extends Consumer`:

| Class | Extends | Consumes | Role | Req |
|---|---|---|---|---|
| **`WorkflowTriggerConsumer`** | `Consumer` | Kafka (event stream) | Match each event to account **trigger bindings** → **start** a new instance or **signal** a parked one; **`canConsume`-gated** | workflow-2.0 |

**Jobs (Lambda, event-driven)** — each `extends WorkflowJob`:

| Class | Extends | Trigger | Role | Req |
|---|---|---|---|---|
| **`WorkflowStepJob`** | `WorkflowJob` | SQS | Execute one step — pick next node, **map data**, **enqueue the side effect** to the owning service; persist the transition; emit the instance event; retry → DLQ | workflow-3.0 / 6.0 |
| **`WorkflowSchedulerJob`** | `WorkflowJob` | EventBridge Scheduler | **Sleep / timeout** wakeups → resume parked instances | workflow-4.0 |

> **Notes.** The **trigger router is a `Consumer`** (a live firehose filtered to a subset — start/signal),
> not a per-event `Job`. The **step executor is a `Job`** (one durable unit per step). Side effects are
> **always enqueued to the owning service** — workflow holds no channel credentials and performs no send.
> The **engine is a swappable port** (in `src/`): custom interpreter now, Step Functions / Temporal
> later, without touching definitions or nodes.

# AWS Services and Other Dependencies

**AWS services**
* **DynamoDB** — `Definition` (versioned) + `Instance` (per-run, durable; persisted every transition).
* **SQS** (+ **DLQ**) — step execution queue + the side-effect enqueues to owning services.
* **EventBridge Scheduler** — sleep / timeout / wait wakeups.
* **Kafka (MSK)** — the inbound event stream (triggers + resume signals); the outbound lifecycle events.
* **Lambda** (step + scheduler jobs) · **ECS Fargate** (API + trigger consumer) · **KMS** (encryption at rest).

**Internal (`@repo/*`)**
* The **engine lives in this service's `src/`** ([`WorkflowModel.ts`](src/WorkflowModel.ts) + interpreter) —
  no separate package. `@repo/services` (Dynamo, Sqs, Kafka, the EventBridge Scheduler helper),
  `@repo/endpoint` (`Access`, **`Events`** — consume + emit), `@repo/common` (`Type`).
* Delegates to **texting / email / campaign / contact / media / dispatch / marketplace**; reads
  entitlements from **account**, identity from **auth**.

# Endpoints (first cut)

A first pass in [`@repo/endpoint`](../../../packages/endpoint/SPECS.md) style — service-prefixed
**`/workflow/*`**. **Event ingress is NOT HTTP** — triggers + resume signals arrive on **Kafka**
(consumed by `WorkflowTriggerConsumer`); the HTTP surface is **authoring + instance reads + manual
control + simulate**.

**Access column:** **`minAccess`** — account ladder **`SENDER`<`USER`<`BILLING`<`ACCOUNT`** · staff
**`SUPPORT`<`APPLICATION`<`ROOT`** · **`Internal`** = VPC-only S2S.

### Definitions & versioning (workflow-1)
| Method | URI | Purpose | Access | Req |
|---|---|---|---|---|
| GET, POST | `/workflow/definitions` | List / create a workflow definition (draft) | USER | workflow-1.1 |
| GET, PATCH, DELETE | `/workflow/definitions/{id}` | Get / edit (new draft version) / archive | USER | workflow-1.1 |
| POST | `/workflow/definitions/{id}/publish` | **Publish a version** — validate node contracts; immutable once published | USER | workflow-1.2 |
| GET | `/workflow/definitions/{id}/versions` | Version history | USER | workflow-1.2 |
| POST | `/workflow/definitions/{id}/pause` | **Pause** — disable triggers (no new instances start) | USER | workflow-1.4 |
| POST | `/workflow/definitions/{id}/resume` | **Resume** — re-enable triggers | USER | workflow-1.4 |
| POST | `/workflow/definitions/{id}/instances/stop` | **Kill switch** — force-stop **all running instances** of this definition | ACCOUNT | workflow-3.9 |
| GET, PUT | `/workflow/definitions/{id}/triggers` | Read / set the **trigger bindings** (events that start it; `canConsume`-checked) | USER | workflow-2.1 |

### Instances (runs) (workflow-3)
| Method | URI | Purpose | Access | Req |
|---|---|---|---|---|
| GET | `/workflow/instances` | List runs (by definition / subject / status) | USER | workflow-3.1 |
| GET | `/workflow/instances/{id}` | Run detail — **live state**: frontier (where it is) · context · **per-node history (upstream outcomes)** · status | USER | workflow-3.1 |
| POST | `/workflow/instances` | **Manual / API start** of a definition for a subject | USER | workflow-2.3 |
| POST | `/workflow/instances/{id}/cancel` | **Graceful cancel** of a running instance | USER | workflow-3.4 |
| POST | `/workflow/instances/{id}/stop` | **Force-stop / terminate** — even if jammed (stuck step / runaway loop) | USER | workflow-3.8 |

### Test / simulate (workflow-8)
| Method | URI | Purpose | Access | Req |
|---|---|---|---|---|
| POST | `/workflow/definitions/{id}/simulate` | **Dry-run** with mock inputs — trace nodes/decisions, no side effects | USER | workflow-8.1 |

### Internal / ops
| Method | URI | Purpose | Access | Req |
|---|---|---|---|---|
| POST | `/workflow/internal/erase` | S2S forget hook — purge a subject's instance context (`contact-forget` fan-out) | Internal | workflow-9.3 |
| GET, PUT | `/workflow/config` | Runtime config (step concurrency, default timeouts, sandbox limits) | ROOT | workflow-5.4 |
| GET | `/workflow/health` | Liveness / readiness (consumer + step fleet) | - | workflow-10.1 |

# Requirements (traceable register)

The traceable register for the **workflow service** (IDs **`workflow-N.M`**); the engine README is the
rationale + node/execution detail. **Priority:** **A** = MVP, **B** = core / hardening, **C** = later.
**Boundary:** workflow owns **definitions + triggers + instances + control flow + durability**; **side
effects** are the owning service; the **engine logic** is in this service's `src/`; identity/RBAC = auth.

## workflow-1.0 Definitions & versioning — A
- **workflow-1.1** **Account-scoped definition** — a node/edge graph authored per account — A
- **workflow-1.2** **Versioned + immutable on publish** — edits create a new version; **validate node `config/input/output` contracts at publish**; instances pin their version — A
- **workflow-1.3** **Archive-never-delete** — definitions are retired, not destroyed — B
- **workflow-1.4** **Definition lifecycle** — `draft → published → paused → archived`: **publish** (versioned), **pause** (disable triggers — no new instances; in-flight continue), **resume**, **test** (any state), archive — A

## workflow-2.0 Triggers & event matching — A
- **workflow-2.1** **Trigger bindings** — bind a definition to inbound **`Events` actions** (start), schedules, or manual/API — A
- **workflow-2.2** **`canConsume` gate** — an account may bind a trigger only to events its role may consume (`Events.canConsume`) — A
- **workflow-2.3** **Start / signal routing** — one event **starts** a new instance or **resumes** a parked **node**: by echoed `{instanceId, nodeId, waitKey}` (our delegated completions) or `(accountId, subject, waitKey)` for external inbound (a reply) → resolves to the waiting `(instance, node)` — A
- **workflow-2.4** Trigger router is a **`Consumer`** (Kafka firehose → subset), not a per-event Job — B
- **workflow-2.5** **Fan-out** — a definition has **1–N triggers**; one event matches **0–N workflows**, each spawning an **independent instance** — A

## workflow-3.0 Instances & durable execution — A
- **workflow-3.1** **Instance = one durable run** of a version for one subject — carries its **live, inspectable state**: **frontier** (active/waiting nodes) · **context** (all variables) · **per-node history** (every upstream node's outcome+output) · status. Opening a running instance shows **where it is + all upstream outcomes** — A
- **workflow-3.2** **Persist every transition** (DynamoDB); resume after restart — A
- **workflow-3.3** **Idempotent, retryable** step execution → retry → **DLQ** — A
- **workflow-3.4** **Cancel / pause / resume** an instance — B
- **workflow-3.5** **Per-node activity log** — each instance records, per node, entered-at · evaluated inputs/condition · typed output · outcome (advanced/waiting/failed) · retries · timing — the troubleshooting trace (transaction-id threaded to monitor) — A
- **workflow-3.6** **Execution frontier (not a single cursor)** — an instance has **one or more active positions**; branching + parallel (`split`/`merge`, `for-each`) mean **multiple nodes** can be active/waiting at once; each advances **by node type** — A
- **workflow-3.7** **Resume correlation = `instanceId` + `nodePath` (+ `waitKey`)** — the delegated side-effect call carries the instance **and the originating node**, echoed back on the completion/signal, so the engine resumes the **exact node/branch** (a flow has many sends/waits + parallel paths — the instance alone, or a single cursor, can't locate it). `nodePath` = node id **+ loop iteration index** (nested → a path). **Idempotent** against late/duplicate completions; distinct from the trace transaction id — A
- **workflow-3.8** **Force-stop / terminate** — stop a running instance even when **jammed** (stuck step / runaway loop / wrong flow): abandon the in-flight step → **terminated**; beyond graceful cancel — A
- **workflow-3.9** **Definition kill switch** — force-stop **all running instances** of a definition at once (a published flow found to be wrong) — B

## workflow-4.0 Control flow — A
- **workflow-4.1** **if / else-if / else / switch** branching (labeled edges) — A
- **workflow-4.2** **sleep(time)** + **wait-for-response + timeout** — **EventBridge Scheduler** wakeups — A
- **workflow-4.3** **Signals** resume parked instances (awaited reply / timeout) — A
- **workflow-4.4** **Loops carry a durable frame** — `for-each` / `while` keep the **collection · current index · per-iteration status+output · join counter · max-iteration guard** in the instance; the `nodePath` iteration index routes per-item completions (parallel fan-out / nesting); **state in the instance, index in the message** — A

## workflow-5.0 Data mapping & nodes — A
- **workflow-5.1** **Context / variables** — typed instance state read by conditions + merge fields — A
- **workflow-5.2** **Producer→consumer seam** — `outputMap` (inline) + a `transform` node (multi-source); type-checked at publish — A
- **workflow-5.3** **`code` node** — sandboxed **pure `(input)=>output`**, no I/O / ambient access, hard CPU/mem/timeout caps, **output validated (ajv)**, recorded for replay — B
- **workflow-5.4** Sandbox + step limits are **runtime-config** (concurrency, timeouts, caps) — B

## workflow-6.0 Delegation (side effects) — A
- **workflow-6.1** **Every side effect is enqueued (SQS) to the owning service** — send-text → texting/dispatch · send-email → email · launch → campaign · segment → contact · media → media; **workflow performs none** — A
- **workflow-6.2** **Integration nodes** supplied by marketplace (catalog + creds); built-in nodes independent — B

## workflow-7.0 Events (consume + emit) — A
- **workflow-7.1** **Consume** any `Events` action as a trigger (gated by `canConsume`) — A
- **workflow-7.2** **Emit `WorkflowAction`** — `workflow.workflow.*` + `workflow.instance.*` (started / updated=completed·failed / deleted) to audit / analytics / realtime — B

## workflow-8.0 Test & observability — B
- **workflow-8.1** **Simulation (no execution)** — dry-run with mock inputs, side-effecting nodes **stubbed**, time **fast-forwarded** → path + per-node output, **before publishing** — B
- **workflow-8.2** **Trace** (transaction id) + run metrics → [monitor](../monitor/SPECS.md); visualization hooks — B
- **workflow-8.3** **Live test run** — execute a published flow against a designated **test subject** (real sends to a test number/inbox) — B
- **workflow-8.4** **Node catalog** — typed `config/input/output` nodes across entry/terminal · control & flow · time & pacing · inbound/conversation · action (channels · data/integration · audience/lifecycle) · dynamic integration nodes — B

## workflow-9.0 Privacy & compliance — A
- **workflow-9.1** **Tenant isolation** — every definition + instance account-scoped — A
- **workflow-9.2** **Encryption** at rest (SSE-KMS) + in transit — A
- **workflow-9.3** **GDPR forget** — purge a subject's instance **context** on `contact-forget` fan-out — A

## workflow-10.0 Infra footprint — A
- **workflow-10.1** **DynamoDB** (definition + instance) · **SQS (+DLQ)** · **EventBridge Scheduler** · **Kafka** (in/out) · **Lambda** (step/scheduler) · **ECS** (API + consumer) · **KMS** — A
- **workflow-10.2** Hosts the **engine in `src/`** (swappable `Engine` port; no separate package) — A

## workflow-11.0 Service & Job topology — B
- **workflow-11.1** **Domain bases** — `WorkflowService extends Service` + `WorkflowJob extends Job` hold the engine + model + store + `canConsume`; concrete roles extend them — B
- **workflow-11.2** **`WorkflowMainService`** — the `/workflow/*` authoring + instance API — A
- **workflow-11.3** **`WorkflowTriggerConsumer extends Consumer`** — Kafka → match → start/signal — A
- **workflow-11.4** **`WorkflowStepJob` / `WorkflowSchedulerJob` extend `WorkflowJob`** — step exec (→ SQS to owning service) + sleep/timeout wakeups — A

# eof

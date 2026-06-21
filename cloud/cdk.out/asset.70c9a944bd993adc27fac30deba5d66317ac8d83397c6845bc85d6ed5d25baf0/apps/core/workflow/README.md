#
# Workflow Service
#

# Objective

An **account-defined automation engine**: a visual graph of linked nodes that an account builds
once and the platform **runs durably, per initiation**, in response to events. It is the home for
**multi-step journeys, drip sequences, and integration-triggered automation** — the things the
campaign service explicitly defers here. A workflow reacts to an event ("contact replied STOP",
"order placed", "tag added"), walks a graph of conditions and actions (send a text, wait for a
reply, branch, sleep three days, send an email), and survives restarts, long waits, and retries.

# Role & boundaries (read this first)

Workflow is an **orchestrator + durable interpreter**, not a send engine and not a UI toolkit. It
owns the *definition*, the *per-initiation run state*, the *control flow*, and the *scheduling of
waits/timeouts* — and it **delegates every side effect** to the service that owns that capability.
If "send a text" or "evaluate a segment" is reimplemented inside workflow, it will drift from the
real one.

What Workflow **owns**:
* The **workflow definition** — the node/edge graph, authored per account, **versioned**.
* The **trigger** bindings (what event starts an instance) and trigger→instance routing.
* The **instance (run)** — one durable execution of a definition for one subject (e.g. a contact),
  with its variable context, current position, history, and status.
* **Control flow**: if / else-if / else / then, switch, sleep(time), wait-for-response + timeout.
* **Durability, retries, and idempotency** of step execution; resume after restart.
* **Test/simulation** runs with mock inputs; **trace**, **metrics**, and **visualization** hooks.

What Workflow **delegates** (calls out to, does not implement):

| Node action / concern | Owning service |
|---|---|
| send-email (templates, deliverability) | **email** |
| send-text / MMS, managed replies, conversations | **texting** |
| throughput, pacing, carrier fallback, retries, DLQ | **dispatch** |
| launch a campaign / use a campaign template | **campaign** |
| segment membership, contact attributes, **consent/suppression** | **contact** |
| media upload/library/transcode | **media** |
| plan limits / feature gating (`ResolvedEntitlements`) | **account** |
| author identity & role checks (`Access` ladder) | **auth** |
| sleeps, timers, timeout wakeups | **EventBridge Scheduler** (via `@repo/services`) |
| run trace (transaction id), run metrics, job-run history | **monitor** |
| engagement metrics (delivered/clicked/opt-out) | **analytics** |

**Workflow vs Campaign:** a campaign is a *one-shot/scheduled blast* to an audience; a workflow is
a *long-running, per-subject, branching journey*. A workflow node may **launch a campaign** (or a
campaign template); a campaign never drives a workflow. (This is the boundary the campaign spec
draws when it defers drip/journeys and integration triggers here.)

**Workflow vs Marketplace (workflow is NOT "powered by" the marketplace):** workflow's backbone is its
**own engine** — the durable interpreter (DynamoDB + SQS + EventBridge Scheduler), the node graph, the
context/signals — which runs independently. The **marketplace** is just one *supplier* of nodes: it
contributes the **integration** trigger/action nodes and owns their catalog + credentials + connector
execution. Built-in nodes (`send-text`, `if`, `sleep`, `code`, …) owe nothing to it. The dependency is
one-way and narrow — workflow *consumes* enabled integrations as nodes; marketplace orchestrates
nothing. If marketplace were unavailable, built-in workflows still run; only integration nodes go dark.
(Think app-store-plugins, not kernel.)

# Out of scope (deferred)

* **A full node-authoring SDK / arbitrary packages** — accounts get the **sandboxed `code` node**
  (a bounded, pure-transform JS step — see Custom code nodes), **not** an SDK to publish new node
  *types*, import arbitrary npm modules, or make ambient network/DB calls from code. Side effects
  stay in the curated action nodes.
* **Cross-account / platform-global workflows** — every workflow is account-scoped.
* **Visual editor implementation** — the editor is a **web** concern; workflow owns the definition
  *schema*, validation, and a layout hint, not the React canvas.
* **The integration catalog + credentials** — *which* 3rd-party integrations exist, and each account's
  connection/credentials, are owned by the **marketplace** service (its own service). Workflow
  *consumes* an enabled integration's triggers/actions as nodes (see "Integration nodes"); it doesn't
  own the catalog, OAuth, or the credential vault.

# Core concepts

* **Definition** — the authored graph: nodes + edges + trigger binding, owned by an account and
  **versioned**. Immutable once a version is published; edits create a new version.
* **Node** — one unit of work or decision (see catalog below). Has a type, config, and outgoing
  edge(s). Nodes are the "objects that link together."
* **Edge** — a directed connection between nodes; control-flow nodes have **labeled** edges
  (`true`/`false`, switch cases, `timeout`).
* **Trigger** — what starts an instance: an inbound **event** (an SQS/Kafka event such as
  `contact.replied`, `tag.added`, `order.placed`), a schedule, or a manual/API start.
* **Instance (Run)** — one durable execution of a definition **version** for one subject (usually a
  contact). Carries a **context** (variables), the **current node**, a **history** of visited
  nodes/decisions, and a **status**. Persisted on every transition.
* **Context / variables** — typed key/value state for an instance (trigger payload, node outputs,
  account/contact attributes) read by conditions and merge fields.
* **Signal** — an external event that resumes a *parked* instance (e.g. the awaited reply arrives,
  or a timeout fires). Correlated to the waiting instance by `(accountId, subject, waitKey)`.
* **Engine** — the durable interpreter that advances instances. Behind an interface (see "Engine"
  below) so the substrate can change without touching definitions or nodes.

# Node catalog

Curated, typed nodes — the account composes these; each declares a typed **`config` / `input` /
`output`** contract (see **Execution model**): JSON-schema'd config validated at publish, the
context paths it reads, and the typed output it writes back to the instance context.

### Decoupling producers from consumers — the transform seam
A node like `http-call` (fetch the weather) returns a **provider-shaped** payload that downstream
nodes shouldn't have to know. **Producers don't know their consumers**, so normalization is explicit,
two ways:
* **Inline output mapping** (the common case) — any action node may declare an **`outputMap`**
  expression (ResultSelector-style) that ETLs its raw result into the node's **declared `output`
  contract** before it lands in context. The raw response is reshaped *at the source* to a stable
  typed shape, so the http node's quirks never leak downstream.
* **A dedicated `transform` node** (heavier cases) — when you must **merge multiple sources**,
  reshape across several upstream outputs, or compute derived fields, a `transform`/`map` node reads
  declared inputs and emits a **named, typed variable** (`vars.weather = { tempF, condition }`) that
  becomes the contract downstream nodes consume.
* **A `code` node** (the long tail — *Zapier "Code" step*) — for mapping that expressions can't
  express (loops, string parsing, conditional assembly across sources), run **account-authored
  sandboxed JS** as a **pure `(input) => output` transform**. See **Custom code nodes** below — this
  is a distinct **security tier** (untrusted code), not just another expression.

Either way the seam is the same: raw provider data in → **a stable named/typed shape** out → consumers
bind only to that shape. This is what lets you swap the weather provider without touching the rest of
the graph, and it's still **type-checked at publish** (the mapped output is the contract that's verified).

### Custom code nodes (Zapier-style) — a separate security tier
Expressions (`transform`/`outputMap`) are **safe by construction** (no I/O, statically validatable) and
should be the default. The `code` node trades that for power, so it is **sandboxed and bounded**:

* **Pure transform only** — the contract is `(input) => output`: it receives a **declared subset of
  context** and **returns** a value. **No side effects** — sends, HTTP, events, and DB writes go
  through the dedicated action nodes (which carry consent/retry/idempotency), never from inside code.
* **No ambient access** — no filesystem, no network, no `process`/env, no `require` of arbitrary
  modules, no clock/random unless injected (so runs stay replayable). The sandbox grants *nothing* by
  default.
* **Hard limits** — CPU time, wall-clock timeout, memory, and output size are capped per execution; a
  breach fails the step onto the normal retry → `error` edge → DLQ path.
* **Contract enforced at runtime** — the static publish-time type-check **can't see inside** opaque
  code, so the node declares an **`output` JSON schema** and the runtime **validates the returned
  value against it** (ajv) before it enters context. Downstream type-safety holds regardless of what
  the code does; a non-conforming return is a step failure.
* **Deterministic + recorded** — being a pure transform, the result is written to instance history, so
  **replay/resume uses the recorded output** rather than re-executing.

**Publish-time review (defense in depth, not the primary control).** Before a `code` node can run it
passes a gate at publish:
* **Deterministic static checks first** — parse the AST and **reject disallowed constructs** (`eval`,
  `Function`, dynamic `import`/`require`, network/`process` globals, obvious unbounded loops). These
  are cheap, exact, and non-bypassable.
* **AI/LLM review as an advisory signal** — additionally scan the code for vulnerabilities / data
  exfiltration / obfuscation and **block or flag-for-human-review** on a finding. Treat it as
  **belt-and-suspenders**: it is probabilistic and can be fooled (incl. prompt injection in the code),
  so it **never replaces the sandbox** — the runtime isolation is what actually contains a malicious
  node. (It also reuses the AI capability of open decision #8.)

**At rest.** The node's source is account content, so it is **encrypted at rest** — DynamoDB is
encrypted by default; store definitions under a **customer-managed KMS key** (the `Kms` facade / a
cloud-manifest `keys` entry) and consider **field-level envelope encryption** of the code body specifically.
Crucially, **secrets do not belong in code** — the sandbox blocks ambient access anyway, so API keys,
etc. come from **Secrets Manager**, injected into the declared `input`, never hard-coded.

### Code execution on AWS — the `code-runner` Lambda  *(chosen substrate)*
Account JS runs in a **dedicated `code-runner` Lambda**, invoked per execution by the worker. The
Lambda execution environment **is a Firecracker microVM** (hardware-virtualized, own kernel), so we get
VM-level isolation with no microVM fleet to operate — we just lock the function down.

```
 workflow worker (Fargate)                  code-runner Lambda
 ──────────────────────────                 ────────────────────────────────────────────
  reach a `code` node                        Firecracker microVM  (per concurrent exec)
  Lambda.invoke(runner, {                       ├─ NO VPC / no egress route  → no network
     code,                 ── RequestResponse ─►│─ execution role = ZERO permissions
     input (declared       ◄── { output } ──────┤   (no DynamoDB, no Secrets, no KMS, no APIs)
             context subset)  or { error }      ├─ run code in a FRESH isolated-vm V8 isolate
  })                                            │   per call (mem + wall-clock caps)
  validate output vs schema (ajv)               └─ return the value only; nothing persists
  record result → context → advance
```

Defense layers, outermost to innermost:
1. **Firecracker microVM** (the Lambda boundary) — an escape must break KVM, not just a Node process.
2. **Zero-permission execution role + no VPC egress** — *the control that matters most*: the function
   the code runs in can reach **nothing** (no AWS APIs, no internet, no DB, no secrets), so "what can
   malicious code do?" reduces to "compute and return a value."
3. **A fresh `isolated-vm` isolate per invocation** *inside* the Lambda — belt-and-suspenders, and it
   closes the **warm-reuse tenant-bleed** gap (Lambda reuses warm environments for sequential calls, so
   without a fresh isolate account B could see account A's leftover in-memory state).
4. **Caps** — Lambda `timeout` + `memorySize` bound the environment; the isolate adds its own
   wall-clock + heap cap so a busy-loop dies fast and trips the retry → `error` edge → DLQ path.

The runner is a single function executing many tenants' code; per-account **metering** is one
invocation = one unit, and per-account **abuse controls** (kill/cool-down on repeated timeouts/errors)
live in the worker that invokes it. Contract is the pure transform `{ code, input } → { output | error }`
— and the returned value is still **ajv-validated against the node's `output` schema** before it enters
context. Latency cost is the invoke hop + possible cold start; mitigate with **provisioned concurrency**
if code-node latency ever shapes journey design. *(Reuses the existing `Job`/Lambda primitive + the
`Lambda` facade — `never vm2`.)*

### Action — channels (a delegated send)
| Node | Delegates to | Notes |
|---|---|---|
| `send-text` | texting / dispatch | SMS/MMS; consent/suppression re-checked at send |
| `send-email` | email | template + merge fields |
| `send-push` | (push svc) | mobile/web push notification |
| `send-rich` | texting | WhatsApp / RCS rich messages (extensible channel) |
| `send-voice` | (voice svc) | outbound voice / IVR / ringless voicemail |
| `launch-campaign` | campaign | start a campaign / template for the subject |

### Action — data & integration
| Node | Delegates to | Notes |
|---|---|---|
| `http-call` | (self) | call a remote/internal HTTP endpoint; raw response → `outputMap` → context |
| `transform` / `map` | (self) | ETL/normalize/merge upstream outputs into a typed variable (the seam above) |
| `code` | (sandbox) | account-authored **sandboxed JS** pure transform — the long tail of mapping (see Custom code nodes) |
| `lookup` / `query` | contact / search / svc | fetch a contact attribute, segment membership, or another service's record |
| `enrich` | integration | append 3rd-party/CRM data to the context |
| `set-variable` | (self) | compute/assign a context variable from an expression |
| `emit-event` | Kafka / EventBridge | publish an event for other services / workflows |
| `sync-crm` | integration | create/update an external CRM record |
| `integration-action` | marketplace integration | a **dynamic** action contributed by an enabled integration — e.g. *create QuickBooks invoice*, *push contact to HubSpot* (see below) |
| `format` | (self) | **no-code** text/number/date/currency utilities (à la Zapier *Formatter*) — the safe, common transforms without reaching for `code` |
| `find-or-create` | contact / integration | **search** for a record (Zapier *Find*); optionally create it if absent — branch on found/created |
| `store-get` / `store-set` | (self) | small **per-account key/value** state that persists *across runs* (counters, last-seen, dedup keys) — see open decision |

### Integration nodes (from the marketplace)
Beyond the fixed catalog above, an account's **enabled marketplace integrations dynamically
contribute typed nodes** — both **trigger (input) nodes** and **action nodes** — scoped to what that
account has connected and authorized:

* **Integration triggers** — an integration's events start workflows: `quickbooks.invoice.created`,
  `shopify.order.placed`, `actblue.donation.received`. (These are the {@link EventTrigger}s the
  router matches; the marketplace + connector runtime normalize the vendor payload first.)
* **Integration actions** — call out to the integration using the **account's vaulted credentials**:
  *create QuickBooks invoice*, *add to a Mailchimp audience*, *create a Salesforce lead*.

The **node's contract (its `config`/`input`/`output` schema) comes from the integration definition**
in the marketplace; the **credentials come from the marketplace vault** (workflow never holds them);
the **call is executed by the connector runtime** (workflow just declares the step). So a journey like
*invoice created → send to accounting software X* is an integration **trigger node** feeding an
integration **action node**, with optional `transform`/`code` in between to map fields.

### Action — audience & lifecycle
| Node | Delegates to | Notes |
|---|---|---|
| `update-contact` | contact | set attribute / add-remove tag / change segment membership |
| `update-consent` | contact / compliance | opt-in / opt-out / suppress |
| `score` | (self/analytics) | adjust a lead/engagement score |
| `generate-link` | links/tracking | create a tracked/branded short link for use in a message |
| `notify-internal` | (self) | alert a staff user / Slack / internal queue (not the contact) |

### Inbound / conversation (durable waits)
| Node | Behavior |
|---|---|
| `wait-for-response` | park until the contact **replies** (texting inbound) **or** the timeout edge fires |
| `wait-for-event` | park until a named external **event/webhook** arrives (or timeout) |
| `classify-reply` | branch on the inbound reply — keyword (`YES`/`NO`/`STOP`/`HELP`) or **AI intent** |
| `collect-input` | multi-turn capture over a channel ("reply with your ZIP"), validate, store to a variable |
| `ai` / `llm` | classify / generate / summarize / sentiment — output feeds gates or a send body |
| `approval` | **human-in-the-loop**: park until a staff user approves/rejects (RBAC-gated), then branch |

### Control & flow (no side effect, choose an edge)
| Node | Behavior |
|---|---|
| `if` / `else-if` / `else` | boolean condition over context → `true`/`false` edges; chainable |
| `switch` | evaluate an expression → one of N labeled case edges (+ `default`) |
| `filter` | drop the instance (exit) unless a condition holds — a guard |
| `then` | unconditional sequence to the next node (the default edge) |
| `split` / `merge` | parallel branches that fan out and rejoin (optional, later) |
| `ab-split` / `random` | percentage-weighted branches (experiment / holdout) |
| `for-each` | **definite** loop — iterate an **array**, run the body once per item (bound to `itemVar`); bounded by the collection; collects per-item output (Zapier *Looping*) |
| `while` | **indefinite** loop — repeat the body **while a condition holds** (loop-until); **requires a max-iteration guard** since nothing else bounds it |
| `goto` | jump to a labeled node (controlled loops — with a max-iteration guard) |
| `sub-workflow` | invoke another workflow definition and continue on its result |

### Time & pacing
| Node | Behavior |
|---|---|
| `sleep` | pause for a duration / until a timestamp / until contact-local time, then continue |
| `wait-until` | pause until a specific calendar moment (e.g. "next Monday 9am local") |
| `quiet-hours` | gate/hold a send until inside the allowed window (TZ + regulatory rules) |
| `throttle` | rate-limit instances through a point (protect a downstream system) |
| `digest` | **accumulate** items and release on a schedule or threshold (Zapier *Digest*) — e.g. batch a day's events into one summary message |
| (timeout) | every `wait-*` node carries a **timeout edge** taken when no signal arrives in time |

### Terminal
`start` (the trigger entry), `end` / `exit` (instance completes), and `goal` (a conversion/exit that
also records success for metrics). An uncaught node failure ends at the **error/DLQ** path (above).

# Control flow & expressions

* `if` / `else-if` / `else`, `switch`, `then` operate on the instance **context** via a small,
  **sandboxed expression language** (no arbitrary code) — comparisons, boolean logic, membership,
  and references to `context.*` / contact attributes. Expressions are validated at publish so a
  bad reference can't reach runtime.
* `sleep` supports **duration** (`PT30M`, `P3D`), **absolute** (ISO timestamp), and
  **contact-local** ("9am in the contact's timezone") — the last respecting quiet-hours rules.
* Every `wait-for-response` (and any awaiting node) **must** declare a **timeout edge**; an instance
  can never wait forever silently.

# Execution model — data flow, edges, and errors

This is the heart of how a node finishes and how the next node is chosen. **Advancement is not "the
previous step returned 200."** Two **independent axes** govern every node:

1. **Execution status** — did the step *run* successfully? (succeeded / transient-failure /
   permanent-failure / still-waiting). This axis drives **retries, the error edge, and the DLQ**.
2. **Output data** — *what did the step produce?* A node writes a **typed output** into the instance
   **context**; this axis drives **logic gates and merge fields**.

So "proceed to next node" is the combination: a node must **succeed** to advance at all, and *which*
outgoing edge is taken is decided by **evaluating the edge conditions against the context** — which
includes that node's (and earlier nodes') output. A bare action node with one `next` edge advances
on success; an `if`/`switch` has no side effect and picks an edge purely from data; an action node
that branches on its result (e.g. `http-call`) both *succeeds* (got a response) **and** feeds its
output into the branch condition.

## Node I/O contract (the typed JSON interfaces you intuited)

Yes — each node type declares a **contract**, and they are shared, centralized definitions (same
principle as the Kafka event interfaces): 

* **`config`** — authoring-time settings (validated by JSON schema at publish).
* **`input`** — the shape it *reads*. The node declares which **context paths** it consumes (e.g.
  `contact.phone`, `nodes.lookup.output.tier`), not a free-for-all over all state.
* **`output`** — the typed shape it *writes* back to the context.
* **`outputMap`** (optional) — an expression that **ETLs the raw result into `output`** before it
  lands in context (ResultSelector-style), so a provider-shaped response is normalized **at the
  source** and never leaks its quirks downstream. Heavier reshaping/merging uses a `transform` node.

At **publish** the whole graph is **type-checked**: every input path a node references must be
**produced upstream** on every path that can reach it, and every gate/merge-field expression must
reference a **real, correctly-typed** field. A mis-wired graph fails to publish rather than blowing
up mid-run. This is the static guarantee that makes logic gates safe.

## Data flow: a shared, accumulating context (blackboard), not point-to-point piping

Each node's output is written to the context under a **namespaced key** (`nodes.<nodeId>.output`,
plus optional author-named variables), and downstream nodes/gates read from the **whole context** —
not just "the previous node." This is deliberate: in a **branching/merging** graph "the previous
node" is ambiguous, and a gate often needs data produced **several steps back**. A shared addressable
context handles branches, merges, and look-back cleanly; pure pipe-the-output-to-the-next-input only
works for linear chains.

```
 trigger payload ─┐
                  ▼
   context = { trigger, contact, nodes: { lookup:{output}, sendText:{output}, … }, vars: {…} }
                  ▲                                   │
   node reads declared input paths ──────────────────┘ writes typed output back
   gate evaluates expression over context ──► chooses labeled edge
```

> On **Step Functions** this maps onto `InputPath` / `ResultPath` / `OutputPath` + Choice rules; on
> the **custom engine** it's a context object persisted on the instance item. Same model either way —
> which is why it lives above the engine choice.

## Errors, retries, and the DLQ  *(per node, then per instance)*

* A node action is classified: **transient** (5xx, throttling, timeout, network) → **retry** with
  backoff per the node's policy; **permanent** (4xx/validation/business rejection) → **no retry**.
* On retry **exhaustion** (or a permanent failure): take the node's **`error` edge** if one is
  defined (let the author handle it — fallback channel, notify, alternate path); **otherwise** the
  **instance** moves to `failed` and is **dead-lettered** with full context (current node, attempts,
  last error) for inspection and **manual replay**.
* **Idempotency:** every step records its attempt + outcome before acting, so a redelivered queue
  message or a duplicate signal **never double-sends** (a half-completed step resumes, not repeats).
* DLQ is therefore at the **step/instance** level (a stuck *run*), distinct from the channel DLQs
  **dispatch** owns for individual message sends.

# Instance lifecycle (durable state machine)

```
 (trigger event) ──► running ──node──► running ──wait/sleep──► waiting ──signal/timeout──► running
                       │                                          │
                       │                                          └── timeout edge / resume edge
                       ├── error (node failed, retries exhausted) ──► failed
                       ├── reach end/exit ──────────────────────────► completed
   running/waiting ──cancel (account or definition unpublished)────► canceled
   completed / failed / canceled ──(retained for audit, TTL'd)────► archived
```

* **Persisted on every transition** — current node, context, and history are written to the
  instance store before the next step, so a restart resumes exactly where it left off.
* **Waiting is durable + async** — a `waiting` instance holds **no compute**; it is resumed by a
  **signal** (inbound event) or a **timeout wake** scheduled in EventBridge Scheduler. This is how a
  "wait 3 days for a reply" journey costs nothing while it waits.
* **Idempotent steps** — advancing a node is safe to retry; a step records its outcome so a
  redelivered message or duplicate signal does not double-send.
* **Instances pin a definition version** — a long-running instance keeps executing the version it
  started on, even after the account edits the workflow (same rule report uses for scheduled specs).

# Engine — build vs. buy (the core decision)

> *(Aside: **AWS Glue** is serverless **ETL** — Spark/Python data transformation, not application
> orchestration — so it's not a candidate. The native AWS orchestrator is **Step Functions**, below.)*

Three real options, judged against *account-defined dynamic graphs* + *long durable waits* +
*mock testing*. The two finalists are **Step Functions** (managed/native) and a **custom interpreter**
(leanest on our stack); **Temporal** is the power option if we outgrow either.

| Option | Verdict | Why |
|---|---|---|
| **AWS Step Functions** | **finalist — managed/native** | A state machine is a deployed **ASL artifact**, so the fit comes from **generating ASL at publish** from each account definition **version** (one state machine + version/alias per published definition). Then it's fully managed and durable with **no engine to operate**: Choice = `if`/`switch`, Wait = `sleep`, `waitForTaskToken` (+ heartbeat/timeout) = `wait-for-response`, Map/Parallel = fan-out, Standard workflows run up to **1 year**. Costs to weigh: **state-machine sprawl** across accounts×workflows×versions (raise the quota), **per-state-transition pricing** on high-fan-out journeys, and mock-testing leans on **SFN Local**. |
| **Custom interpreter on our stack** | **finalist — leanest fit** | Instance = a **DynamoDB** item; an **SQS**-driven worker advances it; **sleeps/timeouts via the EventBridge Scheduler we already built**; node actions are calls to **existing service facades**; `wait-for-response` parks and resumes on an inbound event. Adds **zero new infra** and gives full control of the account-defined graph model + simulation. Cost: **we own** durable-semantics correctness (idempotency, retries, races, replay). |
| **Temporal** (3rd-party durable execution) | power option, heaviest ops | One generic **interpreter workflow** runs an account's graph as *data*: signals = `wait-for-response`, timers = `sleep`/timeout, activities = our sends, with built-in retries, **versioning**, history/replay, and a **time-skipping test harness**. Cost: operate a Temporal cluster (persistence + visibility store) or buy Temporal Cloud — a new stateful system to run. |

**Recommendation:** keep the definition schema, node catalog, and execution **behind an `Engine`
interface** so the substrate is swappable, and choose between the two finalists on the deciding
factors below. **Step Functions** wins if "no engine to operate / fully managed durability" outweighs
ASL-generation + state-machine sprawl + per-transition cost. The **custom interpreter** wins if
zero-new-infra and full control over live-edited per-account graphs + simulation matter more, since
every node action is already a call to a service we own and waits map cleanly onto Scheduler. Either
way the abstraction keeps **Temporal** a later refactor, not a rewrite. *(This is open decision #1.)*

Deciding factors: (a) ops appetite (managed SFN vs owning durable correctness vs running Temporal);
(b) graph **volume/edit-frequency** (sprawl + transition cost on SFN); (c) **testing fidelity** needed
(SFN Local vs a custom simulator vs Temporal time-skipping); (d) max **wait duration**.

> *Not chosen:* **n8n / Node-RED** — great inspiration for the node-graph UX, but heavy single-tenant
> automation tools, not an embedded multi-tenant durable engine. **XState** — an excellent in-process
> interpreter model we may use *inside* a custom engine, but not durable on its own. **BullMQ** — a
> Redis job queue with delays/retries, not a workflow engine.

# Architecture (custom-engine path)

```
 trigger event (SQS/Kafka: contact.replied, tag.added, order.placed, schedule, manual)
        │
        ▼
  ┌─────────────────────────────── workflow service ───────────────────────────────┐
  │  trigger router ──► start instance (DynamoDB) ──► advance queue (SQS) ──► WORKER │
  │                                                                          │       │
  │   WORKER per step:  load instance ─► eval node ─► (action: call service) ─┤       │
  │                         │                                                 │       │
  │            control ◄────┘            time ─► EventBridge Scheduler (wake) ─┘      │
  │                         │                                                         │
  │            persist next node + context (DynamoDB)  ─► re-enqueue or PARK          │
  │                                                                                   │
  │   PARKED (waiting): inbound signal (reply/webhook/timeout) ─► resume ─► advance   │
  └───────────────────────────────────────────────────────────────────────────────-─┘
        │ trace = transaction id (monitor)   │ metrics + run history (monitor)
        ▼                                     ▼
   action services (email, texting, dispatch, campaign, contact, media)
```

* **Trigger router** subscribes to the bound events, matches them to active definitions, and starts
  an instance (de-duped per subject where the definition says "one active instance per contact").
* **Worker** processes one **advance** message: load → evaluate node → perform/delegate → compute
  next → persist → re-enqueue (or park). Idempotent and retried (SQS + DLQ).
* **Scheduler** (the facade we built) backs `sleep` and every wait **timeout** — the wake is a
  scheduled message that re-enqueues the instance on the `timeout` edge.
* **Signals** (inbound reply, webhook, emitted event) are correlated to the waiting instance and
  resume it on the `resume` edge.

# Worked example — Shopify order → thank-you text

The canonical **integration-triggered** journey: *order comes in → fetch order + contact → wait 1
hour → send a thank-you text.* It shows the **boundary** — workflow orchestrates, but the **Shopify
connector lives in the integration service**, not in workflow.

```
 Shopify ─webhook─► incoming-webhook intake ─► SQS ─► integration svc      workflow service
                    (general: validate at edge,       (owns the connector)  (owns the journey)
                     queue for any consumer)          • normalize to    ┌─────────────────────────────────────────┐
                                                        canonical  ──►  │ trigger: order.placed                     │
                                                        `order.placed`  │   └─►(start instance, subject=contact)    │
                                                      • publish event   │ enrich  : http-call → Shopify (via integ) │
                                                        │           get order + customer            │
                                                        │           outputMap → { order, contact }  │
                                                        │ lookup  : upsert contact (contact svc)    │
                                                        │ sleep   : PT1H  (EventBridge Scheduler)   │
                                                        │ quiet-hours gate (consent re-checked)     │
                                                        │ send-text: "Thanks {{contact.first}}…"    │
                                                        │   └─► texting / dispatch                  │
                                                        │ goal: thank-you-sent                      │
                                                        └─────────────────────────────────────────┘
```

Step by step, mapped to the model above:

1. **Connector (integration service, not workflow):** receives the Shopify webhook, **verifies the
   HMAC**, and **normalizes** the vendor payload into a canonical `order.placed` event (`accountId`,
   `orderId`, `customer{}`, minimal fields), then publishes it. *Why here:* webhook auth, API
   credentials, rate limits, and Shopify's payload shape are connector concerns — keeping them out of
   workflow is the same "owns the provider format" rule analytics uses for channel webhooks.
2. **Trigger → start (`order.placed`):** the trigger router matches the event to the account's active
   definition and **starts an instance**, subject = the contact, seeding `context.trigger` with the
   normalized order.
3. **Enrich (`http-call` + `outputMap`):** the event is intentionally thin, so an `http-call` (through
   the integration service's Shopify API) **fetches the full order + customer**, and `outputMap` ETLs
   the provider response into a stable `{ order, contact }` shape (the transform seam) — downstream
   nodes bind to that, not to Shopify's JSON.
4. **Resolve contact (`lookup`/`update-contact`):** upsert/lookup the contact in **contact** so the
   send has a valid, consented phone (creating the contact record if this is a new customer).
5. **Wait (`sleep` PT1H):** the instance **parks for one hour** with no compute — backed by an
   **EventBridge Scheduler** wake that re-enqueues it. (Durable: a restart in that hour resumes fine.)
6. **Send (`send-text`):** a `quiet-hours` gate holds if needed; **consent/suppression are re-checked
   at send time** (a customer who opted out in that hour is suppressed); then the thank-you goes via
   **texting/dispatch** with merge fields from the normalized `contact`/`order`.
7. **`goal: thank-you-sent`** records the conversion for metrics; errors at any step follow the
   retry → `error` edge → run-DLQ path.

> **Boundary takeaway:** "workflow interfaces with Shopify" = workflow **consumes a normalized
> trigger** and **calls back through the integration service** via `http-call`/`enrich`; it never
> holds Shopify credentials or parses raw Shopify webhooks. The webhook itself is received by the
> platform's **general incoming-webhook intake** (validate at the edge → **queue to SQS** for general
> consumption by any service), so workflow just consumes the resulting event off the queue — the same
> intake every service shares. *(See the incoming-webhook design; the connector/normalization owner
> is open decision #9.)*

# Requirements

## Definition & authoring
* Account-scoped, **versioned** definitions; publishing validates the whole graph (reachability,
  every wait has a timeout edge, expressions reference real context/attributes, no orphan nodes).
* A definition declares its **trigger**, its nodes/edges, and a **layout hint** for the visual editor.
* **Entry constraints** — e.g. "one active instance per contact", re-entry policy, max active.

## Templates *(Zapier-style gallery + reuse)*
The fastest path to value isn't a blank canvas — it's a **pre-built journey** an account clones and
fills in. Templates are the onboarding and vertical-expansion lever.

* **Template** = a parameterized, **unbound** workflow definition (graph + nodes) with **placeholders**
  for what an account must supply: which segment, which message copy, which integration connection,
  timing. Instantiating a template clones it into a **draft** the account then connects + publishes.
* **Gallery**, browsable by **use-case** and **vertical** (political / nonprofit / e-commerce /
  marketing) — e.g. *"Abandoned cart → 1h wait → SMS"* (e-commerce), *"New donation → thank-you text +
  receipt email"* (nonprofit), *"Event RSVP → reminders"* (political). Vertical packs pair with the
  marketplace's vertical catalog.
* **Required integrations surfaced up front** — a template declares the integrations its nodes need;
  the account is prompted to enable/connect them (via marketplace) during instantiation.
* **Save-as-template** from an existing definition (strip account-specifics → placeholders); **clone**
  any definition; **platform** templates (curated) vs **account** templates (an account's own library).
* Templates are themselves **versioned**; instantiating records which template+version seeded a
  definition (provenance), but the resulting definition then evolves independently.

## Versioning & archive
Definitions are **immutable once published** and versioned; instances pin the version they started
on; nothing is hard-deleted.

```
 definition:  draft ──publish──► published(V1) ──edit──► draft(V2) ──publish──► published(V2)
                 ▲                    │                                              │
                 └──── edit draft ────┘        unpublish / supersede ──► archived(Vn, read-only)

 instance:    pinned to the definition VERSION it started on; runs that version to completion
              even after newer versions publish (same rule report uses for scheduled specs).
```

* **Publishing snapshots a new version** (`V1`, `V2`, …); the published graph is then **read-only**.
  Editing forks a new **draft** from a version; publishing it supersedes the prior active version.
* **One active (published) version** per definition triggers new instances; **in-flight instances
  keep running their pinned version** — an account editing a journey never mutates running journeys.
* **Archive, never delete** (consistent with campaign/contact/segment):
  * **Definition** → `archived` is terminal + **read-only**: stops new triggers, but the graph and
    its version history are retained for audit and so archived instances remain interpretable.
  * **Instance** → terminal states (`completed`/`failed`/`canceled`) are retained, then `archived`
    and **TTL'd** after a retention window; history (visited nodes, decisions, outputs) is preserved
    for audit/replay until TTL.
* Archiving a definition does **not** kill its in-flight instances by default — they drain on their
  pinned version (cancelling them is an explicit action). *(See open decision on drain-vs-cancel.)*

## Triggers
* **Event-initiated** (primary): an SQS/Kafka event starts an instance, carrying the subject +
  payload into the initial context. (e.g. `contact.replied`, `tag.added`, future `order.placed`.)
* **Scheduled** (via Scheduler) and **manual/API** start.
* **Polling** *(for integrations without webhooks)*: the connector polls a 3rd-party API on a
  cadence, **dedupes** against already-seen ids, and emits the new items as events (Zapier's
  polling-trigger model). The polling + dedup is the connector's job (marketplace); workflow just
  sees the resulting events. Prefer webhook/event triggers when the integration supports them.

## Persistence & durability
* Every instance is persisted per initiation; **every transition is written before the next step**.
* A worker/process restart **resumes** in-flight instances with no lost or double work.

## Timeouts & waits  *(async, durable)*
* Any awaiting node **must** declare a timeout; **no silent infinite waits**.
* Waits hold no compute; a timeout is a **scheduled wake** that resumes the instance on its
  `timeout` edge.

## Data flow & node contracts
* See **Execution model** above. Each node has a typed **`config` / `input` / `output`** contract;
  outputs accumulate in a shared, namespaced **context**; gates read the whole context.
* The graph is **type-checked at publish**: referenced input paths must be produced upstream on every
  reaching path, and gate expressions must reference real, correctly-typed fields.

## Retries & error handling
* Classify failures **transient** (retry w/ backoff per the node's policy) vs **permanent** (no retry).
* On exhaustion / permanent failure: take the node's **`error` edge** if defined, else move the
  **instance** to `failed` and **dead-letter** it (current node + attempts + last error) for
  inspect/replay. **Idempotent** steps — a redelivery resumes, never double-sends.
* This run-level DLQ is distinct from the per-message channel DLQs **dispatch** owns.
* **Replay** — a dead-lettered instance can be **re-run from its failed node** (with its persisted
  context) once the cause is fixed; bulk-replay a definition's failures. Failure counts/alerts surface
  via monitor (Zapier's "autoreplay" + error-notification equivalent).

## Testing with mock data
* **Simulation mode**: run a definition against **mock context/inputs** with side-effecting nodes
  **stubbed** (no real send) and time **fast-forwarded** (sleeps/timeouts don't actually wait),
  producing the path + per-node output for the author to verify before publishing.

## Tracing
* Each instance carries a **transaction id** threaded through every delegated call (the base
  `Application` correlation work) so monitor can show the full cross-service path of a run.

## Metrics & visualization
* Per-definition + per-instance metrics (started, completed, failed, currently-waiting, conversion
  at each node) aggregated by **monitor**/analytics.
* **Live visualization**: render the graph and **highlight where instances currently sit** + counts
  per node/edge; replay an instance's history. (Editor canvas is **web**; workflow serves the data.)

## Multi-tenancy, limits & audit
* All definitions/instances are account-scoped and **`Access`-gated** for authoring vs viewing.
* **Entitlements** (`ResolvedEntitlements`): max active workflows, allowed node types, max instances
  — gated like other plan features.
* **Audit** every publish/unpublish and lifecycle action (who/when/what), per the platform
  `AuditEvent` shape.

# Data model (sketch)

```
WorkflowDefinition   pk=ACCOUNT#<id>  sk=DEF#<defId>#V<version>
  { name, status: draft|published|archived, trigger, nodes[], edges[], layout, version, createdBy, … }

WorkflowInstance     pk=ACCOUNT#<id>  sk=RUN#<defId>#<instanceId>
  { defVersion, subject (e.g. contactId), status, currentNodeId, context{}, history[],
    waitKey?, timeoutAt?, startedAt, updatedAt, ttl }

  GSI: by status + timeoutAt   (sweep due timeouts)
  GSI: by waitKey              (route an inbound signal to the parked instance)
```

* Instances are **archived, never hard-deleted** (audit), then TTL'd after a retention window —
  consistent with campaign/contact/segment archival rules.

# Services & primitives to utilize

* **DynamoDB** — definition store + instance store (+ TTL, GSIs for timeout sweep and signal routing).
* **SQS** (+ DLQ) — the advance queue + trigger intake; the retry/idempotency substrate.
* **EventBridge Scheduler** (`@repo/services` facade) — `sleep` and all wait **timeouts**.
* **Kafka / EventBridge** — trigger events in, `emit-event` out.
* **monitor** — transaction-id trace, run metrics, job-run/instance history.
* **email / texting / dispatch / campaign / contact / media** — the delegated node actions.
* **(swap-in) Temporal** — if the homegrown durable semantics outgrow themselves; the `Engine`
  interface keeps definitions and nodes unchanged.

# Structure note

The **engine-agnostic core** (definition schema, node catalog + node interface, the expression
evaluator, validation, and the `Engine` interface) and the **deployable roles** (trigger router, step
worker, API, scheduler, visualization data) both live in **`apps/core/workflow`** — the engine in
`src/`, the service surface in [SPECS.md](./SPECS.md). It was **consolidated** out of a standalone
`@repo/workflow` package (nothing else imported it). The **`Engine` port** stays an internal boundary,
so the core can be extracted to a shared package later **if** a second consumer appears.

# Open decisions

1. **Engine substrate** — adopt the recommended **custom interpreter** now; define the threshold
   (scale? compensation complexity? team appetite for owning durable correctness?) that would
   trigger a move to **Temporal**.
2. **Expression language** — pick the sandboxed evaluator (a tiny purpose-built one vs a vetted
   library like JSONLogic / CEL); it must be safe, serializable, and statically validatable.
3. **Re-entry policy default** — one active instance per subject by default, or allow concurrent?
4. **Parallel branches** (`split`/`merge`) — in v1 or deferred until a journey needs true fan-out?
5. **Package vs app split** — ✅ **DECIDED: consolidated into `apps/core/workflow`** (engine in `src/`,
   service surface in SPECS.md); the `Engine` port stays internal so the core can be extracted to a
   shared package later if a second consumer appears.
6. **Signal correlation key** — exact shape of `waitKey` (per contact? per conversation? per custom
   business key) so inbound events route to the right parked instance without ambiguity.
7. **Archive drain vs cancel** — when a definition is archived/superseded, do in-flight instances
   **drain** on their pinned version (default proposed) or **cancel**? Likely a per-archive choice.
8. **AI/LLM node dependency** — the `ai`/`llm` node breaks the "every action calls a service we
   already own" assumption: it needs a **model-inference capability** we haven't specced (e.g. AWS
   Bedrock, or an internal LLM-gateway service handling prompts, model choice, cost/rate limits,
   PII redaction, and guardrails). Treat the catalog entry as **provisional** until that capability
   exists; decide build-vs-Bedrock and where it lives before shipping AI-in-journeys.
9. **Integration catalog + connectors** — the catalog, OAuth, and per-account credentials are owned by
   the **marketplace** service (DECIDED: standalone). Webhook *receipt* (edge validation + queue to
   SQS) is the platform's **general incoming-webhook intake**. Still open: where the **connector
   runtime** (data plane — using a marketplace vault reference to call the 3rd party + normalize its
   payload into canonical events like `invoice.created`) lives — inside marketplace, as its own
   service, or here. Also define the canonical event taxonomy workflows trigger on. Workflow's part is
   settled: it consumes enabled integrations' triggers/actions as **nodes** ("Integration nodes").
10. **`code` node sandbox substrate** — **DECIDED: a dedicated `code-runner` Lambda** (Firecracker
    microVM) with a **zero-permission role + no VPC egress**, running each call in a **fresh
    `isolated-vm` isolate**; **not `vm2`**. See **Code execution on AWS** for the architecture + layers.
    Remaining to set: per-execution **caps** (Lambda timeout/memory + isolate wall-clock/heap + output
    size), whether to use **provisioned concurrency**, and the per-account **abuse thresholds**
    (kill/cool-down on repeated timeouts/errors). Pairs with the expression-language choice (#2) —
    expressions stay the safe default; `code` is only the long tail.
11. **Cross-run KV store** (`store-get`/`store-set`) — useful for counters/dedup/last-seen across
    instances, but it's a new stateful primitive (a per-account DynamoDB namespace). Confirm scope
    (per-definition vs per-account), size caps, and TTL — or defer until a journey needs it.
12. **Transfer / bulk backfill** — on connecting an integration, optionally **import existing**
    records (not just new events) to seed segments/contacts (Zapier *Transfer*). A connector-side
    bulk job (marketplace) feeding the same normalized events; confirm whether v1 or later.
13. **AI Copilot — build a workflow from a prompt** — generate a draft definition from a natural-language
    description (via `@repo/ai` + the visual editor). High-value onboarding, but depends on the editor
    (web) and the AI capability (#8); deferred but worth designing the definition schema to be
    LLM-emittable (it already is — typed JSON).

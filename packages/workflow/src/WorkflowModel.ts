//
// Workflow domain model — account-defined automation: a versioned graph of linked nodes
// that the engine runs durably, per initiation, in response to events.
//
// Everything is scoped under the `Workflow` namespace, so call sites read clearly:
//   Workflow.Definition, Workflow.Instance, Workflow.Node, Workflow.Engine, ...
//
// Sourced from elsewhere (single source of truth):
//   * scalar primitives (ID, ISODateTime, EpochSeconds, ...) -> `Type` in @repo/common
//
// Organized by WHERE each model lives / what it is (see README.md):
//   1. ALIASES & ENUMS — vocabulary shared across the model
//   2. GRAPH          — the authored definition: triggers, nodes, edges, per-node config
//   3. PERSISTED      — DynamoDB: Definition (versioned) + Instance (per-run, durable)
//   4. RUNTIME        — engine execution: context, signals, step outcomes, the Engine port
//   5. CODE & SANDBOX — the `code` node + the code-runner Lambda contract
//   6. TESTING        — simulation with mock inputs
//   7. METRICS & AUDIT
//
// Design anchors from the spec: nodes carry typed config/input/output contracts and are
// validated at publish; outputs accumulate in a shared CONTEXT (not point-to-point piping);
// advancement is two axes (execution status + output data); definitions are immutable once
// published and instances PIN their version; archive-never-delete; the Engine is a swappable
// port (custom interpreter today, Step Functions / Temporal possible later).
//

import type { Type } from "@repo/common";

export namespace Workflow
{
    // ══════════════════════════════════════════════════════════════════════════
    // 1. ALIASES & ENUMS
    // ══════════════════════════════════════════════════════════════════════════

    /** A node's id, unique within a definition. */
    export type NodeId = Type.ID;

    /** An edge's id, unique within a definition. */
    export type EdgeId = Type.ID;

    /**
     * ISO-8601 **duration** (not a timestamp), e.g. `"PT30M"`, `"PT1H"`, `"P3D"`. Used by
     * `sleep`/timeout cadences.
     */
    export type Duration = string;

    /**
     * A **sandboxed expression** over the instance context (decision #2: a tiny evaluator or a
     * vetted lib like JSONLogic/CEL). No arbitrary code — comparisons, boolean logic, membership,
     * and `context.*` references. Statically validated at publish.
     */
    export type Expression = string;

    /** Account-authored JavaScript for a `code` node (see CODE & SANDBOX). */
    export type CodeBody = string;

    /** A JSON Schema document (the same `ajv` schemas endpoints use) — for runtime output validation. */
    export type JsonSchema = Record<string, unknown>;

    /** Definition lifecycle — immutable once published; editing forks a new draft version. */
    export enum DefinitionStatus
    {
        DRAFT     = "draft",
        PUBLISHED = "published",
        ARCHIVED  = "archived",     // terminal, read-only: stops new triggers, retained for audit
    }

    /** Instance (run) lifecycle. See the state machine in README.md. */
    export enum InstanceStatus
    {
        RUNNING   = "running",
        WAITING   = "waiting",      // parked on a signal/timeout; holds no compute
        COMPLETED = "completed",
        FAILED    = "failed",       // a step exhausted retries with no error edge
        CANCELED  = "canceled",
        ARCHIVED  = "archived",     // terminal state retained, then TTL'd
    }

    /** How an instance is started. */
    export enum TriggerKind
    {
        EVENT    = "event",         // an inbound normalized event (SQS/Kafka), e.g. "order.placed"
        SCHEDULE = "schedule",      // a cron/rate schedule (EventBridge Scheduler)
        POLL     = "poll",          // connector polls a webhook-less API on a cadence, dedupes, emits
        MANUAL   = "manual",        // explicit API / UI start
    }

    /** The kinds of node the catalog understands (see README.md "Node catalog"). */
    export enum NodeKind
    {
        // entry / exit
        START          = "start",
        END            = "end",
        GOAL           = "goal",            // an exit that also records a conversion

        // channels (a delegated send)
        SEND_TEXT      = "send-text",
        SEND_EMAIL     = "send-email",
        SEND_PUSH      = "send-push",
        SEND_RICH      = "send-rich",       // WhatsApp / RCS
        SEND_VOICE     = "send-voice",      // IVR / ringless voicemail
        LAUNCH_CAMPAIGN = "launch-campaign",

        // data & integration
        HTTP_CALL      = "http-call",
        TRANSFORM      = "transform",       // expression-based ETL/normalize/merge
        CODE           = "code",            // sandboxed JS pure transform
        FORMAT         = "format",          // no-code text/number/date/currency utilities
        LOOKUP         = "lookup",
        FIND_OR_CREATE = "find-or-create",  // search a record; optionally create if absent
        ENRICH         = "enrich",
        SET_VARIABLE   = "set-variable",
        STORE_GET      = "store-get",       // read per-account KV state (across runs)
        STORE_SET      = "store-set",       // write per-account KV state (across runs)
        EMIT_EVENT     = "emit-event",
        SYNC_CRM       = "sync-crm",
        INTEGRATION_ACTION = "integration-action",  // dynamic action from an enabled marketplace integration

        // audience & lifecycle
        UPDATE_CONTACT = "update-contact",
        UPDATE_CONSENT = "update-consent",
        SCORE          = "score",
        GENERATE_LINK  = "generate-link",
        NOTIFY_INTERNAL = "notify-internal",

        // inbound / conversation (durable waits)
        WAIT_FOR_RESPONSE = "wait-for-response",
        WAIT_FOR_EVENT = "wait-for-event",
        CLASSIFY_REPLY = "classify-reply",
        COLLECT_INPUT  = "collect-input",
        AI             = "ai",              // provisional — see open decision #8
        APPROVAL       = "approval",        // human-in-the-loop

        // control & flow (no side effect — choose an edge)
        IF             = "if",
        SWITCH         = "switch",
        FILTER         = "filter",
        THEN           = "then",
        SPLIT          = "split",
        MERGE          = "merge",
        AB_SPLIT       = "ab-split",
        RANDOM         = "random",
        FOR_EACH       = "for-each",        // definite: iterate an array, body once per item
        WHILE          = "while",           // indefinite: repeat body while a condition holds (loop-until)
        GOTO           = "goto",
        SUB_WORKFLOW   = "sub-workflow",

        // time & pacing
        SLEEP          = "sleep",
        WAIT_UNTIL     = "wait-until",
        QUIET_HOURS    = "quiet-hours",
        THROTTLE       = "throttle",
        DIGEST         = "digest",          // accumulate items, release on schedule/threshold
    }

    /**
     * Reserved edge labels. Edges are otherwise labeled freely (e.g. a `switch` case name); these
     * have engine meaning. An action node typically has `NEXT` (+ optional `ERROR`); `if`/`filter`
     * use `TRUE`/`FALSE`; wait nodes use `RESUME`/`TIMEOUT`.
     */
    export enum EdgeLabel
    {
        NEXT    = "next",       // the default/unconditional outgoing edge (`then`, action success)
        TRUE    = "true",
        FALSE   = "false",
        DEFAULT = "default",    // `switch` fallthrough
        RESUME  = "resume",     // a wait node's signal-arrived edge
        TIMEOUT = "timeout",    // a wait node's no-signal-in-time edge
        ERROR   = "error",      // taken when a node fails (else the instance dead-letters)
    }

    /** Classifies a failure to decide retry-ability. */
    export enum FailureClass
    {
        TRANSIENT = "transient",    // 5xx / throttle / timeout / network — safe to retry
        PERMANENT = "permanent",    // 4xx / validation / business rejection — do not retry
    }

    /** Per-node execution status (the first of the two advancement axes). */
    export enum StepStatus
    {
        SUCCEEDED = "succeeded",
        FAILED    = "failed",
        WAITING   = "waiting",
    }

    /** Re-entry policy: may a subject have more than one live instance of a definition at once? */
    export enum ReEntry
    {
        ONE_ACTIVE_PER_SUBJECT = "one-active-per-subject",
        ALLOW_CONCURRENT       = "allow-concurrent",
    }

    /** Retry backoff shape. */
    export enum Backoff { FIXED = "fixed", EXPONENTIAL = "exponential" }

    // ══════════════════════════════════════════════════════════════════════════
    // 2. GRAPH — the authored definition (triggers, nodes, edges, per-node config)
    // ══════════════════════════════════════════════════════════════════════════

    /** Editor canvas coordinate for a node (layout hint only; not used at runtime). */
    export interface Position { x : number; y : number; }

    /**
     * A node's typed I/O contract (see README.md "Node I/O contract"). Declares the context paths
     * it READS and the typed shape it WRITES; the graph is type-checked at publish against these.
     */
    export interface IoContract
    {
        /** Context paths the node consumes, e.g. `["contact.phone", "nodes.lookup.output.tier"]`. */
        input?      : Array<string>;
        /** JSON Schema of the value this node writes to `context.nodes[nodeId].output`. */
        output?     : JsonSchema;
        /**
         * Optional **ResultSelector-style** expression that ETLs the node's raw result into `output`
         * before it enters context — normalizes a provider-shaped response at the source.
         */
        outputMap?  : Expression;
    }

    /** Retry policy for an action node (control/time nodes don't retry). */
    export interface RetryPolicy
    {
        maxAttempts : number;
        backoff     : Backoff;
        baseMs      : number;
        maxMs?      : number;
        /** Which failure classes to retry (default: `[TRANSIENT]`). */
        retryOn?    : Array<FailureClass>;
    }

    /** Fields common to every node, regardless of kind. `kind`/`config` are added per-kind below. */
    export interface NodeBase
    {
        id           : NodeId;
        name?        : string;          // author label shown in the editor
        description? : string;
        io?          : IoContract;      // input/output contract (+ outputMap)
        retry?       : RetryPolicy;     // action nodes only
        position?    : Position;        // editor layout hint
    }

    // ── per-node config (one interface per kind; shared shapes are reused) ──────

    /** No configurable options (e.g. `then`, `start`, `end`). */
    export type EmptyConfig = Record<string, never>;

    /** A single boolean predicate over context — used by `if` and `filter`. */
    export interface ConditionConfig { condition : Expression; }

    // channels
    export interface SendTextConfig   { body : string; mediaKeys? : Array<string>; fromKey? : string; }
    export interface SendEmailConfig  { templateKey? : string; subject? : string; body? : string; fromKey? : string; }
    export interface SendPushConfig   { title : string; body : string; deepLink? : string; }
    export interface SendRichConfig   { channel : "whatsapp" | "rcs"; templateKey? : string; body? : string; mediaKeys? : Array<string>; }
    export interface SendVoiceConfig  { mode : "ivr" | "voicemail"; audioKey? : string; ttsText? : string; }
    export interface LaunchCampaignConfig { campaignId? : Type.ID; templateId? : Type.ID; }

    // data & integration
    export interface HttpCallConfig   { method : "GET" | "POST" | "PUT" | "PATCH" | "DELETE"; url : string; headers? : Record<string, string>; bodyExpr? : Expression; }
    export interface TransformConfig  { expression : Expression; }    // result becomes the node output
    /** No-code formatter utilities (text/number/date/currency) — the common transforms without `code`. */
    export interface FormatConfig     { operation : string; inputExpr : Expression; options? : Record<string, unknown>; }
    export interface LookupConfig     { source : "contact" | "segment" | "service"; query : Expression; }
    /** Search a record; optionally create it if absent. Branches on `found` / `created` edges. */
    export interface FindOrCreateConfig { source : "contact" | "integration" | "service"; query : Expression; createIfMissing? : boolean; createWith? : Record<string, Expression>; }
    export interface EnrichConfig     { provider : string; fields? : Array<string>; }
    export interface SetVariableConfig { name : string; valueExpr : Expression; }
    /** Read per-account KV state (persists across runs) into a variable. */
    export interface StoreGetConfig   { key : Expression; varName : string; }
    /** Write per-account KV state (persists across runs), optionally with a TTL. */
    export interface StoreSetConfig   { key : Expression; valueExpr : Expression; ttlSeconds? : number; }
    export interface EmitEventConfig  { eventType : string; channel : "kafka" | "eventbridge"; payloadExpr? : Expression; }
    export interface SyncCrmConfig    { provider : string; operation : "create" | "update" | "upsert"; mapping : Record<string, Expression>; }
    /** A dynamic action contributed by an enabled marketplace integration (creds come from its vault). */
    export interface IntegrationActionConfig { integrationId : Type.ID; action : string; input? : Record<string, Expression>; }

    // audience & lifecycle
    export interface UpdateContactConfig { set? : Record<string, Expression>; addTags? : Array<string>; removeTags? : Array<string>; segment? : { add? : Type.ID; remove? : Type.ID }; }
    export interface UpdateConsentConfig { channel : "sms" | "email" | "voice" | "push"; action : "opt-in" | "opt-out" | "suppress"; }
    export interface ScoreConfig      { delta? : number; setExpr? : Expression; }
    export interface GenerateLinkConfig { targetUrlExpr : Expression; domainKey? : string; varName : string; }
    export interface NotifyInternalConfig { channel : "slack" | "email" | "queue"; target : string; messageExpr : Expression; }

    // inbound / conversation
    export interface WaitForResponseConfig { channel : "sms" | "email"; timeout : Duration; }
    export interface WaitForEventConfig { eventType : string; matchExpr? : Expression; timeout : Duration; }
    export interface ClassifyReplyConfig { mode : "keyword" | "ai"; keywords? : Record<string, Array<string>>; intents? : Array<string>; }
    export interface CollectInputConfig { prompt : string; varName : string; validateExpr? : Expression; timeout : Duration; maxAttempts? : number; }
    export interface AiConfig         { task : "classify" | "generate" | "summarize" | "sentiment"; promptExpr : Expression; model? : string; }  // provisional (#8)
    export interface ApprovalConfig   { approverRole : string; timeout : Duration; }

    // control & flow
    export interface SwitchCase       { label : string; whenExpr : Expression; }
    export interface SwitchConfig     { expression : Expression; cases : Array<SwitchCase>; }
    export interface SplitConfig      { branches : number; }
    export interface MergeConfig      { mode : "all" | "any"; }
    export interface WeightedBranch   { label : string; weight : number; }          // A/B + random
    export interface WeightedSplitConfig { variants : Array<WeightedBranch>; }
    export interface GotoConfig       { targetNodeId : NodeId; maxIterations? : number; }
    export interface SubWorkflowConfig { definitionId : Type.ID; inputMapping? : Record<string, Expression>; }
    /** For-each (definite): iterate `itemsExpr` (an array), running the body (from `bodyStartNodeId`) once per item, bound to `itemVar`. Bounded by the array; `maxIterations` is an optional extra cap. */
    export interface ForEachConfig    { itemsExpr : Expression; itemVar : string; bodyStartNodeId : NodeId; maxIterations? : number; }
    /** While / loop-until (indefinite): repeat the body while `condition` holds. `maxIterations` is REQUIRED — the anti-runaway guard, since nothing else bounds it. */
    export interface WhileConfig      { condition : Expression; bodyStartNodeId : NodeId; maxIterations : number; }

    // time & pacing
    export interface SleepConfig      { kind : "duration" | "absolute" | "contact-local"; duration? : Duration; until? : Type.ISODateTime; localTime? : string; }
    export interface WaitUntilConfig  { cron? : string; at? : Type.ISODateTime; timezone? : string; }
    export interface QuietHoursConfig { windowOverride? : { start : string; end : string }; }   // default: account/regulatory rules
    export interface ThrottleConfig   { ratePerSec? : number; key? : Expression; }
    /** Accumulate items keyed by `keyExpr`, release on a schedule or when a size threshold is hit. */
    export interface DigestConfig     { release : "schedule" | "threshold"; cron? : string; threshold? : number; keyExpr? : Expression; collectExpr? : Expression; }

    /**
     * Maps each {@link NodeKind} to its config shape. The discriminated {@link Node} union is derived
     * from this, so a node's `config` is correctly typed by its `kind`.
     */
    export interface NodeConfigMap
    {
        [NodeKind.START]:           EmptyConfig;
        [NodeKind.END]:             EmptyConfig;
        [NodeKind.GOAL]:            { name : string };
        [NodeKind.SEND_TEXT]:       SendTextConfig;
        [NodeKind.SEND_EMAIL]:      SendEmailConfig;
        [NodeKind.SEND_PUSH]:       SendPushConfig;
        [NodeKind.SEND_RICH]:       SendRichConfig;
        [NodeKind.SEND_VOICE]:      SendVoiceConfig;
        [NodeKind.LAUNCH_CAMPAIGN]: LaunchCampaignConfig;
        [NodeKind.HTTP_CALL]:       HttpCallConfig;
        [NodeKind.TRANSFORM]:       TransformConfig;
        [NodeKind.CODE]:            CodeConfig;
        [NodeKind.FORMAT]:          FormatConfig;
        [NodeKind.LOOKUP]:          LookupConfig;
        [NodeKind.FIND_OR_CREATE]:  FindOrCreateConfig;
        [NodeKind.ENRICH]:          EnrichConfig;
        [NodeKind.SET_VARIABLE]:    SetVariableConfig;
        [NodeKind.STORE_GET]:       StoreGetConfig;
        [NodeKind.STORE_SET]:       StoreSetConfig;
        [NodeKind.EMIT_EVENT]:      EmitEventConfig;
        [NodeKind.SYNC_CRM]:        SyncCrmConfig;
        [NodeKind.INTEGRATION_ACTION]: IntegrationActionConfig;
        [NodeKind.UPDATE_CONTACT]:  UpdateContactConfig;
        [NodeKind.UPDATE_CONSENT]:  UpdateConsentConfig;
        [NodeKind.SCORE]:           ScoreConfig;
        [NodeKind.GENERATE_LINK]:   GenerateLinkConfig;
        [NodeKind.NOTIFY_INTERNAL]: NotifyInternalConfig;
        [NodeKind.WAIT_FOR_RESPONSE]: WaitForResponseConfig;
        [NodeKind.WAIT_FOR_EVENT]:  WaitForEventConfig;
        [NodeKind.CLASSIFY_REPLY]:  ClassifyReplyConfig;
        [NodeKind.COLLECT_INPUT]:   CollectInputConfig;
        [NodeKind.AI]:              AiConfig;
        [NodeKind.APPROVAL]:        ApprovalConfig;
        [NodeKind.IF]:              ConditionConfig;
        [NodeKind.SWITCH]:          SwitchConfig;
        [NodeKind.FILTER]:          ConditionConfig;
        [NodeKind.THEN]:            EmptyConfig;
        [NodeKind.SPLIT]:           SplitConfig;
        [NodeKind.MERGE]:           MergeConfig;
        [NodeKind.AB_SPLIT]:        WeightedSplitConfig;
        [NodeKind.RANDOM]:          WeightedSplitConfig;
        [NodeKind.FOR_EACH]:        ForEachConfig;
        [NodeKind.WHILE]:           WhileConfig;
        [NodeKind.GOTO]:            GotoConfig;
        [NodeKind.SUB_WORKFLOW]:    SubWorkflowConfig;
        [NodeKind.SLEEP]:           SleepConfig;
        [NodeKind.WAIT_UNTIL]:      WaitUntilConfig;
        [NodeKind.QUIET_HOURS]:     QuietHoursConfig;
        [NodeKind.THROTTLE]:        ThrottleConfig;
        [NodeKind.DIGEST]:          DigestConfig;
    }

    /**
     * A node in the graph — `NodeBase` + a `kind` discriminant + the `config` typed for that kind.
     * Narrowing on `node.kind` narrows `node.config` automatically.
     */
    export type Node = { [K in NodeKind]: NodeBase & { kind : K; config : NodeConfigMap[K] } }[NodeKind];

    /** A directed, labeled connection between two nodes. */
    export interface Edge
    {
        id    : EdgeId;
        from  : NodeId;
        to    : NodeId;
        /** {@link EdgeLabel} for control meaning, or a free label (e.g. a `switch` case name). */
        label : EdgeLabel | string;
    }

    // ── triggers ────────────────────────────────────────────────────────────

    /** Starts an instance from an inbound normalized event (the primary path). */
    export interface EventTrigger
    {
        kind        : TriggerKind.EVENT;
        eventType   : string;           // canonical event, e.g. "order.placed"
        /** Path within the event payload that identifies the subject (e.g. `"customer.id"`). */
        subjectPath : string;
        filterExpr? : Expression;       // only start when this holds
    }

    /** Starts instances on a cron/rate schedule (EventBridge Scheduler). */
    export interface ScheduleTrigger
    {
        kind      : TriggerKind.SCHEDULE;
        cron?     : string;
        rate?     : Duration;
        timezone? : string;
    }

    /**
     * Starts instances from a **polled** 3rd-party API (for integrations without webhooks). The
     * connector (marketplace) polls on `intervalSeconds`, dedupes against `dedupeKey`, and emits each
     * new item; workflow sees the resulting events like any other.
     */
    export interface PollTrigger
    {
        kind            : TriggerKind.POLL;
        integrationId?  : Type.ID;      // the marketplace integration that polls
        resource        : string;       // what to poll (e.g. "orders", "invoices")
        intervalSeconds : number;        // poll cadence
        subjectPath     : string;        // path to the subject id in each item
        dedupeKey       : string;        // field used to skip already-seen items
    }

    /** Started explicitly via API / UI. */
    export interface ManualTrigger { kind : TriggerKind.MANUAL; }

    export type Trigger = EventTrigger | ScheduleTrigger | PollTrigger | ManualTrigger;

    /** Controls how many live instances a subject may have. */
    export interface EntryPolicy
    {
        reEntry    : ReEntry;
        maxActive? : number;            // platform/plan-bounded cap on concurrently-active instances
    }

    // ══════════════════════════════════════════════════════════════════════════
    // 3. PERSISTED — DynamoDB
    // ══════════════════════════════════════════════════════════════════════════

    // ────────────────────────────────────────────────────────────────────────
    // Definition — the authored, versioned graph (immutable once published)
    //   DynamoDB: definitions   PK: ACCOUNT#<accountId>   SK: DEF#<definitionId>#V<version>
    //   GSI: by status (list active/published definitions per account)
    // ────────────────────────────────────────────────────────────────────────

    export interface Definition
    {
        accountId    : Type.ID;         // PK part
        definitionId : Type.ID;
        version      : number;          // monotonically increasing; published versions are immutable
        name         : string;
        description? : string;

        status       : DefinitionStatus;
        trigger      : Trigger;
        entry        : EntryPolicy;

        nodes        : Array<Node>;
        edges        : Array<Edge>;
        startNodeId  : NodeId;          // the `start` node the trigger enters

        createdBy    : Type.ID;
        createdAt    : Type.ISODateTime;
        updatedAt    : Type.ISODateTime;
        publishedAt? : Type.ISODateTime;
        archivedAt?  : Type.ISODateTime;
    }

    // ────────────────────────────────────────────────────────────────────────
    // Instance — one durable RUN of a definition version for one subject
    //   DynamoDB: instances   PK: ACCOUNT#<accountId>   SK: RUN#<definitionId>#<instanceId>
    //   GSI: (status, timeoutAt)  — sweep due timeouts
    //   GSI: waitKey              — route an inbound signal to the parked instance
    //   TTL: ttl (set once terminal+archived)
    // ────────────────────────────────────────────────────────────────────────

    /** The subject a run is about (usually a contact). */
    export interface Subject { type : "contact" | "account" | "custom"; id : Type.ID; }

    /** One node's recorded output in the context. */
    export interface NodeOutput { output : unknown; at : Type.ISODateTime; }

    /**
     * The accumulating, shared **context** (the blackboard). Nodes read declared paths and write
     * their output under `nodes[nodeId]`; gates evaluate expressions over the whole object.
     */
    export interface Context
    {
        trigger : Record<string, unknown>;          // the normalized trigger payload
        contact? : Record<string, unknown>;         // resolved contact attributes
        nodes   : Record<NodeId, NodeOutput>;        // each executed node's output
        vars    : Record<string, unknown>;           // author-named variables (set-variable, code, …)
    }

    /** A run-level error (a stuck step → the run DLQ). Distinct from per-message channel DLQs. */
    export interface RunError
    {
        class    : FailureClass;
        message  : string;
        nodeId?  : NodeId;
        attempts : number;
        at       : Type.ISODateTime;
        detail?  : unknown;
    }

    /** One visited node in an instance's history (audit + replay + visualization). */
    export interface HistoryEntry
    {
        nodeId      : NodeId;
        kind        : NodeKind;
        enteredAt   : Type.ISODateTime;
        status      : StepStatus;
        attempt     : number;
        chosenEdge? : EdgeLabel | string;   // which outgoing edge was taken
        output?     : unknown;
        error?      : RunError;
    }

    /** Present while an instance is `WAITING` — how it parks and how it resumes. */
    export interface WaitState
    {
        /** Correlation key an inbound {@link Signal} matches to resume THIS instance. */
        waitKey       : string;
        resumeEdge    : EdgeLabel | string; // edge taken when the signal arrives
        timeoutEdge   : EdgeLabel | string; // edge taken when the timeout fires
        timeoutAt     : Type.EpochSeconds;  // scheduled wake (also the timeout-sweep GSI key)
        scheduleName? : string;             // the EventBridge Scheduler entry backing the timeout
    }

    export interface Instance
    {
        accountId     : Type.ID;        // PK part
        instanceId    : Type.ID;
        definitionId  : Type.ID;
        defVersion    : number;         // PINNED — this run executes this version to completion
        subject       : Subject;

        status        : InstanceStatus;
        currentNodeId? : NodeId;        // where the run sits (undefined once terminal)
        context       : Context;
        history       : Array<HistoryEntry>;
        wait?         : WaitState;      // set iff status === WAITING

        startedAt     : Type.ISODateTime;
        updatedAt     : Type.ISODateTime;
        endedAt?      : Type.ISODateTime;
        lastError?    : RunError;
        ttl?          : Type.EpochSeconds;  // DynamoDB TTL — set when archived
    }

    // ══════════════════════════════════════════════════════════════════════════
    // 4. RUNTIME — engine execution (the Engine PORT keeps the substrate swappable)
    // ══════════════════════════════════════════════════════════════════════════

    /** Why a parked instance is being resumed. */
    export enum SignalKind { RESUME = "resume", TIMEOUT = "timeout" }

    /**
     * An external event that resumes a waiting instance — an inbound reply/webhook (`RESUME`) or a
     * scheduled timeout wake (`TIMEOUT`). Routed to the instance by `waitKey`.
     */
    export interface Signal
    {
        accountId   : Type.ID;
        waitKey     : string;
        kind        : SignalKind;
        instanceId? : Type.ID;          // set when known directly (else resolved via the waitKey GSI)
        payload?    : Record<string, unknown>;  // e.g. the reply body, merged into context on resume
        at          : Type.ISODateTime;
    }

    /**
     * The result of advancing one node — the durable step outcome the worker persists.
     * `advanced`/`completed` move forward; `parked` waits; `failed` dead-letters (after retries).
     */
    export type StepOutcome =
        | { type : "advanced";  nextNodeId : NodeId; output? : unknown }
        | { type : "parked";    wait : WaitState }
        | { type : "completed"; goal? : string }
        | { type : "failed";    error : RunError }
        | { type : "canceled";  reason? : string };

    /** Query shape for listing instances (visibility / dashboards). */
    export interface InstanceQuery
    {
        accountId     : Type.ID;
        definitionId? : Type.ID;
        status?       : InstanceStatus;
        subjectId?    : Type.ID;
        limit?        : number;
        cursor?       : string;
    }

    /**
     * The engine **port** — the durable interpreter behind an interface so the substrate can change
     * (custom DynamoDB+SQS+Scheduler interpreter now; Step Functions / Temporal later) without
     * touching definitions or nodes.
     */
    export interface Engine
    {
        /** Start a new instance of a (published) definition for a subject, seeding the trigger context. */
        start( definition : Definition, subject : Subject, trigger : Record<string, unknown> ) : Promise<Instance>;
        /** Advance the instance by one node; returns the durable {@link StepOutcome}. */
        advance( accountId : Type.ID, instanceId : Type.ID ) : Promise<StepOutcome>;
        /** Deliver a {@link Signal} to a parked instance (resume or timeout). */
        signal( signal : Signal ) : Promise<void>;
        /** Cancel a running/waiting instance. */
        cancel( accountId : Type.ID, instanceId : Type.ID, reason? : string ) : Promise<void>;
        /** Fetch one instance. */
        get( accountId : Type.ID, instanceId : Type.ID ) : Promise<Instance | undefined>;
        /** List instances (visibility). */
        list( query : InstanceQuery ) : Promise<Array<Instance>>;
        /** Dry-run a definition against mock inputs (no side effects, time fast-forwarded). */
        simulate( request : SimulationRequest ) : Promise<SimulationResult>;
    }

    // ══════════════════════════════════════════════════════════════════════════
    // 5. CODE & SANDBOX — the `code` node + the code-runner Lambda contract
    // ══════════════════════════════════════════════════════════════════════════

    /** Per-execution resource caps enforced by the runner. */
    export interface CodeLimits
    {
        timeoutMs     : number;
        memoryMb      : number;
        maxOutputBytes : number;
    }

    /** Publish-time review verdict for a code node (defense in depth — not the primary control). */
    export enum CodeReviewStatus
    {
        PENDING     = "pending",
        PASSED      = "passed",
        BLOCKED     = "blocked",
        NEEDS_HUMAN = "needs-human",
    }

    /** One review check's result (deterministic AST scan, or advisory AI review). */
    export interface ReviewCheck { passed : boolean; findings? : Array<string>; }

    export interface CodeReview
    {
        status      : CodeReviewStatus;
        ast?        : ReviewCheck;      // deterministic static checks (reject eval/import/network/…)
        ai?         : ReviewCheck;      // advisory LLM scan (reuses the AI capability of #8)
        reviewedAt? : Type.ISODateTime;
    }

    /**
     * `code` node config — account-authored **sandboxed JS** run as a pure `(input) => output`
     * transform in the code-runner Lambda. `outputSchema` is validated at RUNTIME (ajv) because the
     * static publish-time check can't see inside opaque code. Source is encrypted at rest (KMS CMK).
     */
    export interface CodeConfig
    {
        language     : "js";
        source       : CodeBody;
        outputSchema : JsonSchema;      // runtime-validated before the value enters context
        limits?      : CodeLimits;
        review?      : CodeReview;
    }

    /** Request to the code-runner Lambda: pure transform, nothing else crosses the boundary. */
    export interface SandboxRequest { code : CodeBody; input : unknown; limits : CodeLimits; }

    /** Response from the code-runner Lambda. */
    export type SandboxResponse =
        | { ok : true;  output : unknown }
        | { ok : false; error : { kind : "timeout" | "memory" | "throw" | "output-too-large" | "schema"; message : string } };

    // ══════════════════════════════════════════════════════════════════════════
    // 6. TESTING — simulation with mock inputs
    // ══════════════════════════════════════════════════════════════════════════

    /**
     * A simulation run: execute a definition against mock context with side-effecting nodes stubbed
     * and time fast-forwarded — so an author can verify the path/outputs before publishing.
     */
    export interface SimulationRequest
    {
        accountId     : Type.ID;
        definitionId? : Type.ID;        // an existing (draft) definition…
        version?      : number;
        definition?   : Definition;     // …or an inline, unsaved one
        mockContext   : Partial<Context>;
        stubActions   : boolean;        // true: no real sends/HTTP/events
        fastForward   : boolean;        // true: sleeps/timeouts don't actually wait
    }

    export interface SimulationResult
    {
        path         : Array<NodeId>;               // the nodes visited, in order
        outputs      : Record<NodeId, unknown>;     // each node's (stubbed) output
        finalStatus  : InstanceStatus;
        reachedGoal? : string;
        errors?      : Array<RunError>;
    }

    // ══════════════════════════════════════════════════════════════════════════
    // 7. METRICS & AUDIT
    // ══════════════════════════════════════════════════════════════════════════

    /** Per-node counters for the live visualization (where instances currently sit). */
    export interface NodeMetrics
    {
        nodeId    : NodeId;
        entered   : number;
        completed : number;
        failed    : number;
        waiting   : number;
    }

    /** Aggregated metrics for a definition version over a window (surfaced via monitor/analytics). */
    export interface DefinitionMetrics
    {
        definitionId : Type.ID;
        version      : number;
        started      : number;
        completed    : number;
        failed       : number;
        active       : number;
        perNode      : Array<NodeMetrics>;
        windowStart  : Type.ISODateTime;
        windowEnd    : Type.ISODateTime;
    }

    /** Immutable audit entry (mirrors the platform `AuditEvent` shape). */
    export interface AuditEvent
    {
        id        : Type.ID;
        at        : Type.ISODateTime;
        accountId : Type.ID;
        actor     : { type : "user" | "staff" | "system"; id? : Type.ID };
        action    : string;             // "definition.publish", "definition.archive", "instance.cancel", …
        target    : { entity : "definition" | "instance"; id : Type.ID };
        before?   : unknown;
        after?    : unknown;
        traceId?  : string;             // transaction-id correlation (monitor)
    }
}

export default Workflow;

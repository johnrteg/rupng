//
import { Type } from "@repo/common";
import { Validation } from "../../model/Validation";

//
// Workflow — the shared **wire contract** for the workflow domain: an account-authored, versioned
// node/edge graph the engine runs durably per subject (see apps/core/workflow/README.md for the full
// engine design, SPECS.md for the deployable-service view). Defined ONCE here so every endpoint + the
// service + web import the same shapes.
//
// SCOPE (this pass) — a small, curated node catalog proving real node/path authoring + a minimal
// run loop: `start` / `end` (entry/terminal), `if` (labeled true/false edges), `send_text` (a delegated
// action, stubbed — see the engine README's delegation table), `sleep` (a timed park), and
// `wait_for_response` (a signal-or-timeout park). The other ~25 node types in SPECS.md's full catalog
// (transform/code sandbox, http-call, integration nodes, loops, split/merge, …) are DEFERRED, not faked.
//
export namespace Workflow
{
    // ──────────────────────────────────────────────────────────────────────────
    // Node catalog (v1 — curated subset; see README.md#node-catalog for the full target set)
    // ──────────────────────────────────────────────────────────────────────────

    /** The node types this pass supports. Each has a fixed set of labeled outgoing-edge handles. */
    export enum NodeType
    {
        START             = "start",              // entry — one unlabeled outgoing edge
        END               = "end",                // terminal — no outgoing edges
        IF                = "if",                 // control — "true" / "false" outgoing edges
        SEND_TEXT         = "send_text",           // action (delegated, stubbed) — one unlabeled outgoing edge
        SLEEP             = "sleep",               // time (timed park) — one unlabeled outgoing edge
        WAIT_FOR_RESPONSE = "wait_for_response",   // inbound (signal-or-timeout park) — "resume" / "timeout" edges
    }

    /** The outgoing-edge handle labels a node type exposes (empty array = a single unlabeled "next" handle). */
    export const NODE_HANDLES : Record<NodeType, Array<string>> =
    {
        [ NodeType.START ]:             [],
        [ NodeType.END ]:               [],
        [ NodeType.IF ]:                [ "true", "false" ],
        [ NodeType.SEND_TEXT ]:         [],
        [ NodeType.SLEEP ]:             [],
        [ NodeType.WAIT_FOR_RESPONSE ]: [ "resume", "timeout" ],
    };

    /** Node types with no outgoing edge at all (graph terminals). */
    export const TERMINAL_NODE_TYPES : Array<NodeType> = [ NodeType.END ];

    /** The unlabeled single-handle marker used on an `Edge.sourceHandle` for a plain "next" edge. */
    export const DEFAULT_HANDLE : string = "next";

    // ──────────────────────────────────────────────────────────────────────────
    // Node / Edge / Trigger — the graph
    // ──────────────────────────────────────────────────────────────────────────

    /** One unit of work or decision. `config` is per-`type` (validated loosely here; typed narrowing
     *  happens in the editor's inspector + the engine's node handlers). `position` is the editor's
     *  layout hint — workflow owns the schema, not the canvas (see README.md "Out of scope"). */
    export interface Node
    {
        id:       Type.ID;
        type:     NodeType;
        position: { x : number; y : number };
        config:   Record<string, unknown>;
    }

    /** A directed connection between two nodes. `sourceHandle` names WHICH outgoing handle of `source`
     *  this edge leaves from — required for a node with labeled handles (`if`'s "true"/"false"), the
     *  default `DEFAULT_HANDLE` ("next") for a single-handle node. */
    export interface Edge
    {
        id:           Type.ID;
        source:       Type.ID;
        sourceHandle: string;
        target:       Type.ID;
    }

    /** What starts an instance — an inbound `Events` action (see `packages/system/src/Events.ts`).
     *  Scheduled / manual-only triggers are deferred; every definition may declare 0-N of these. */
    export interface Trigger
    {
        id:         Type.ID;
        eventAction: string;
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Definition (the resource) — versioned, immutable once published
    //   DynamoDB: workflows          PK: accountId  SK: defId            (the mutable HEAD row)
    //             workflow_versions  PK: accountId  SK: "<defId>#V<n>"   (immutable published snapshots)
    // ──────────────────────────────────────────────────────────────────────────

    /** `draft → published → paused → archived` (README.md "Definition lifecycle"). Editing a
     *  `published`/`paused` definition forks it back to `draft` (see `PatchWorkflowImpl`) — the HEAD row
     *  models "the definition as currently authored", not one row per historical draft revision. */
    export enum Status
    {
        DRAFT     = "draft",
        PUBLISHED = "published",
        PAUSED    = "paused",
        ARCHIVED  = "archived",
    }

    export interface Entity
    {
        id:          Type.UUID;
        accountId:   Type.UUID;
        name:        string;
        status:      Status;
        version:     number;             // 0 until first publish; bumped + snapshotted on each publish
        triggers:    Array<Trigger>;
        nodes:       Array<Node>;
        edges:       Array<Edge>;
        ownerId:     Type.UUID;
        createdAt:   Type.ISODateTime;
        updatedAt:   Type.ISODateTime;
        publishedAt?: Type.ISODateTime;
    }

    /** Create payload — server assigns id / accountId / status / version / ownerId / timestamps. A new
     *  definition starts with the two mandatory graph endpoints already wired (start → end). */
    export type CreateWorkflow = Pick<Entity, "name"> & Partial<Pick<Entity, "triggers" | "nodes" | "edges">>;

    /** Update payload — any subset of the editable graph fields. */
    export type UpdateWorkflow = Partial<Pick<Entity, "name" | "triggers" | "nodes" | "edges">>;

    /** Read-time DEFAULTs — see CLAUDE.md "Models & closed sets". Identity/lifecycle fields are omitted. */
    export const DEFAULT : Partial<Entity> =
    {
        status:   Status.DRAFT,
        version:  0,
        triggers: [],
        nodes:    [],
        edges:    [],
    };

    /** A fresh definition's starter graph — a `start` node wired straight to an `end` node, so every
     *  new workflow opens on a valid (if trivial), publishable shape. */
    export function starterGraph( startId : Type.ID, endId : Type.ID, edgeId : Type.ID ) : Pick<Entity, "nodes" | "edges">
    {
        return {
            nodes: [
                { id: startId, type: NodeType.START, position: { x: 80,  y: 160 }, config: {} },
                { id: endId,   type: NodeType.END,   position: { x: 420, y: 160 }, config: {} },
            ],
            edges: [
                { id: edgeId, source: startId, sourceHandle: DEFAULT_HANDLE, target: endId },
            ],
        };
    }

    // ── Schema + validator for the wire shape (ajv) ─────────────────────────────────────────────
    const NODE_SCHEMA : Validation.Schema =
    {
        type: "object", additionalProperties: false, required: [ "id", "type", "position", "config" ],
        properties:
        {
            id:       { type: "string" },
            type:     { type: "string", enum: Object.values( NodeType ) },
            position: { type: "object", additionalProperties: false, required: [ "x", "y" ],
                        properties: { x: { type: "number" }, y: { type: "number" } } },
            config:   { type: "object" },
        },
    };

    const EDGE_SCHEMA : Validation.Schema =
    {
        type: "object", additionalProperties: false, required: [ "id", "source", "sourceHandle", "target" ],
        properties:
        {
            id:           { type: "string" },
            source:       { type: "string" },
            sourceHandle: { type: "string" },
            target:       { type: "string" },
        },
    };

    const TRIGGER_SCHEMA : Validation.Schema =
    {
        type: "object", additionalProperties: false, required: [ "id", "eventAction" ],
        properties: { id: { type: "string" }, eventAction: { type: "string" } },
    };

    export const SCHEMA : Validation.Schema =
    {
        $schema: "http://json-schema.org/draft-07/schema#",
        type: "object", additionalProperties: false,
        required: [ "id", "accountId", "name", "status", "version", "triggers", "nodes", "edges", "ownerId", "createdAt", "updatedAt" ],
        properties:
        {
            id:          { type: "string", format: "uuid" },
            accountId:   { type: "string", format: "uuid" },
            name:        { type: "string" },
            status:      { type: "string", enum: Object.values( Status ) },
            version:     { type: "number" },
            triggers:    { type: "array", items: TRIGGER_SCHEMA },
            nodes:       { type: "array", items: NODE_SCHEMA },
            edges:       { type: "array", items: EDGE_SCHEMA },
            ownerId:     { type: "string", format: "uuid" },
            createdAt:   { type: "string", format: "date-time" },
            updatedAt:   { type: "string", format: "date-time" },
            publishedAt: { type: "string", format: "date-time" },
        },
    };

    /** Validate a `Workflow.Entity`'s WIRE SHAPE (a request/response/event body) — ajv, wire-only.
     *  Graph-semantic checks (reachability, labeled-edge completeness) are {@link validateGraph}. */
    export const validate : Validation.Validator<Entity> = Validation.compile<Entity>( SCHEMA );

    // ──────────────────────────────────────────────────────────────────────────
    // Graph-semantic validation — reused by the publish endpoint AND the editor's pre-publish check
    // (README.md "at publish the whole graph is type-checked"; this pass checks structure, not the
    // full input/output type-check the eventual broader node catalog will need).
    // ──────────────────────────────────────────────────────────────────────────

    /** One graph-validation failure — human-readable, optionally pointing at a node/edge id. */
    export interface GraphIssue
    {
        message: string;
        nodeId?: Type.ID;
        edgeId?: Type.ID;
    }

    /**
     * Structural checks a definition must pass before it can publish:
     *  - exactly one `start` node, with exactly one outgoing edge;
     *  - every edge's `source`/`target` reference a real node in this definition;
     *  - every `if` node has EXACTLY the `true` + `false` outgoing edges (no more, no fewer);
     *  - every `wait_for_response` node has EXACTLY the `resume` + `timeout` outgoing edges;
     *  - every non-terminal node has at least one outgoing edge (no dead ends other than `end`);
     *  - every node is reachable from `start` (no orphans).
     */
    export function validateGraph( entity : Pick<Entity, "nodes" | "edges"> ) : Array<GraphIssue>
    {
        const issues : Array<GraphIssue> = [];
        const nodesById : Map<Type.ID, Node> = new Map( entity.nodes.map( ( node : Node ) : [ Type.ID, Node ] => [ node.id, node ] ) );

        // 1. exactly one start node
        const starts : Array<Node> = entity.nodes.filter( ( node : Node ) : boolean => node.type === NodeType.START );
        if( starts.length !== 1 ) issues.push( { message: `expected exactly one "start" node, found ${starts.length}` } );

        // 2. every edge references real nodes in this definition
        for( const edge of entity.edges )
        {
            if( !nodesById.has( edge.source ) ) issues.push( { message: `edge source "${edge.source}" is not a node in this definition`, edgeId: edge.id } );
            if( !nodesById.has( edge.target ) ) issues.push( { message: `edge target "${edge.target}" is not a node in this definition`, edgeId: edge.id } );
        }

        // 3. per-node outgoing-handle completeness (start's single edge, if's true/false, wait's resume/timeout)
        //    and no-dead-end (every non-terminal node has >=1 outgoing edge)
        for( const node of entity.nodes )
        {
            const outgoing : Array<Edge> = entity.edges.filter( ( edge : Edge ) : boolean => edge.source === node.id );
            const handles  : Array<string> = NODE_HANDLES[ node.type ];

            if( TERMINAL_NODE_TYPES.includes( node.type ) )
            {
                if( outgoing.length > 0 ) issues.push( { message: `"${node.type}" node has an outgoing edge but is a terminal node`, nodeId: node.id } );
                continue;
            }

            if( handles.length === 0 )
            {
                if( outgoing.length !== 1 ) issues.push( { message: `"${node.type}" node must have exactly one outgoing edge, found ${outgoing.length}`, nodeId: node.id } );
                continue;
            }

            const outgoingHandles : Array<string> = outgoing.map( ( edge : Edge ) : string => edge.sourceHandle );
            for( const handle of handles )
                if( !outgoingHandles.includes( handle ) )
                    issues.push( { message: `"${node.type}" node is missing its required "${handle}" outgoing edge`, nodeId: node.id } );
        }

        // 4. reachability from start (skip if the start-count check above already failed)
        if( starts.length === 1 )
        {
            const reachable : Set<Type.ID> = new Set( [ starts[ 0 ].id ] );
            const queue : Array<Type.ID> = [ starts[ 0 ].id ];
            while( queue.length > 0 )
            {
                const current : Type.ID = queue.shift() as Type.ID;
                for( const edge of entity.edges.filter( ( edge : Edge ) : boolean => edge.source === current ) )
                    if( !reachable.has( edge.target ) ) { reachable.add( edge.target ); queue.push( edge.target ); }
            }
            for( const node of entity.nodes )
                if( !reachable.has( node.id ) ) issues.push( { message: `node is unreachable from "start"`, nodeId: node.id } );
        }

        return issues;
    }
}

export default Workflow;
// eof

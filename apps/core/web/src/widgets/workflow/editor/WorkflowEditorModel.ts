//
import { Workflow } from "@repo/api";

//
// WorkflowEditorModel — the shared, component-free constants + pure helpers for the workflow node-graph
// editor family (widgets/workflow/editor). The node-kind catalog, id factory, default-position helper,
// AND the editor's ephemeral state shape + reducer-action union — mirrors widgets/svg/editor's
// SvgEditorModel.ts split (no React here; safe to import anywhere).
//

// ── Node catalog (the palette) ──────────────────────────────────────────────

/** One node kind's palette entry — label/color/default config/handle labels for the editor UI. The
 *  handle set + config shape are the SAME source `Workflow.NODE_HANDLES` the server validates against
 *  (never re-declared in parallel — see CLAUDE.md "Models & closed sets"). */
export interface NodeKindDef
{
    readonly type:        Workflow.NodeType;
    readonly label:       string;
    readonly description: string;
    readonly handles:     Array<string>;    // Workflow.NODE_HANDLES[ type ] — [] means one unlabeled "next" handle
    readonly hasInput:    boolean;          // false only for "start" (the graph's sole entry point)
    readonly accent:      string;           // a theme palette token (e.g. "primary.main") — never a hex literal
    readonly defaultConfig: Record<string, unknown>;
}

export const NODE_KINDS : Array<NodeKindDef> =
[
    { type: Workflow.NodeType.START,             label: "Start",             description: "The graph's entry point.",                    handles: Workflow.NODE_HANDLES[ Workflow.NodeType.START ],             hasInput: false, accent: "success.main", defaultConfig: {} },
    { type: Workflow.NodeType.IF,                 label: "If / Else",        description: "Branch on a condition.",                       handles: Workflow.NODE_HANDLES[ Workflow.NodeType.IF ],                 hasInput: true,  accent: "warning.main", defaultConfig: { condition: true } },
    { type: Workflow.NodeType.SEND_TEXT,          label: "Send text",        description: "Send a text message (delegated to texting).", handles: Workflow.NODE_HANDLES[ Workflow.NodeType.SEND_TEXT ],          hasInput: true,  accent: "primary.main", defaultConfig: { body: "" } },
    { type: Workflow.NodeType.SLEEP,              label: "Sleep",            description: "Pause for a duration, then continue.",         handles: Workflow.NODE_HANDLES[ Workflow.NodeType.SLEEP ],              hasInput: true,  accent: "info.main",    defaultConfig: { durationSeconds: 3600 } },
    { type: Workflow.NodeType.WAIT_FOR_RESPONSE,  label: "Wait for reply",   description: "Park until a reply arrives, or time out.",     handles: Workflow.NODE_HANDLES[ Workflow.NodeType.WAIT_FOR_RESPONSE ],  hasInput: true,  accent: "info.main",    defaultConfig: { durationSeconds: 86400 } },
    { type: Workflow.NodeType.END,                label: "End",              description: "The instance completes.",                     handles: Workflow.NODE_HANDLES[ Workflow.NodeType.END ],                hasInput: true,  accent: "text.secondary", defaultConfig: {} },
];

export function nodeKindOf( type : Workflow.NodeType ) : NodeKindDef
{
    return NODE_KINDS.find( ( kind : NodeKindDef ) : boolean => kind.type === type ) ?? NODE_KINDS[ 0 ];
}

// ── Id + placement helpers ──────────────────────────────────────────────────

let idCounter : number = 0;

/** A short, unique-enough id for a node/edge created in the editor (server re-validates, doesn't trust this). */
export function makeId( prefix : string ) : string
{
    idCounter += 1;
    return `${prefix}-${Date.now().toString( 36 )}-${idCounter}`;
}

// ── Editor state + actions ──────────────────────────────────────────────────

/** A bounded undo/redo ring of full-definition snapshots (mirrors SvgEditorModel's HistoryStack). */
export interface HistoryStack
{
    readonly past:    Array<Workflow.Entity>;
    readonly future:  Array<Workflow.Entity>;
    readonly maxSize: number;
}

export const HISTORY_MAX_SIZE : number = 50;

export interface WorkflowEditorState
{
    readonly definition:    Workflow.Entity | null;
    readonly selectedNodeId: string | null;
    readonly selectedEdgeId: string | null;
    readonly history:       HistoryStack;
    readonly dirtyFlag:     boolean;
}

export function makeInitialState() : WorkflowEditorState
{
    return {
        definition:     null,
        selectedNodeId: null,
        selectedEdgeId: null,
        history:        { past: [], future: [], maxSize: HISTORY_MAX_SIZE },
        dirtyFlag:       false,
    };
}

export enum WorkflowEditorActionType
{
    SET_DEFINITION     = "set_definition",
    ADD_NODE           = "add_node",
    MOVE_NODE          = "move_node",
    COMMIT_NODE_MOVE   = "commit_node_move",
    UPDATE_NODE_CONFIG = "update_node_config",
    DELETE_NODE        = "delete_node",
    ADD_EDGE           = "add_edge",
    DELETE_EDGE        = "delete_edge",
    SELECT_NODE        = "select_node",
    SELECT_EDGE        = "select_edge",
    MARK_SAVED         = "mark_saved",
    UNDO               = "undo",
    REDO               = "redo",
}

export type WorkflowEditorAction =
    | { type : WorkflowEditorActionType.SET_DEFINITION;     definition : Workflow.Entity }
    | { type : WorkflowEditorActionType.ADD_NODE;            nodeType : Workflow.NodeType; position : { x : number; y : number } }
    | { type : WorkflowEditorActionType.MOVE_NODE;           nodeId : string; position : { x : number; y : number } }
    | { type : WorkflowEditorActionType.COMMIT_NODE_MOVE }
    | { type : WorkflowEditorActionType.UPDATE_NODE_CONFIG;  nodeId : string; config : Record<string, unknown> }
    | { type : WorkflowEditorActionType.DELETE_NODE;         nodeId : string }
    | { type : WorkflowEditorActionType.ADD_EDGE;            source : string; sourceHandle : string; target : string }
    | { type : WorkflowEditorActionType.DELETE_EDGE;         edgeId : string }
    | { type : WorkflowEditorActionType.SELECT_NODE;         nodeId : string | null }
    | { type : WorkflowEditorActionType.SELECT_EDGE;         edgeId : string | null }
    | { type : WorkflowEditorActionType.MARK_SAVED }
    | { type : WorkflowEditorActionType.UNDO }
    | { type : WorkflowEditorActionType.REDO };

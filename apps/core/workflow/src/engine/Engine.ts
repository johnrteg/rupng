//
import jsonLogic from "json-logic-js";
import { Workflow } from "@repo/api";

//
// Engine — the pure decide-next-node core (no I/O, no persistence — WorkflowStepJob does the
// load/persist/dispatch around this). Mirrors README.md's "execution model": a node either
// ADVANCES (taking exactly one outgoing edge), WAITS (parks — `sleep`/`wait_for_response` with no
// signal yet), or FAILS. `if`'s branch is decided by evaluating `node.config.condition` — a
// JsonLogic rule (README.md "buy JSONLogic") — against the instance context; never `eval`.
//
// SCOPE — the 6-node catalog this pass supports (see Workflow.ts's header note). `send_text`'s
// delegation is a STUB here too: this module only decides which edge to take next; WorkflowStepJob
// is what actually (doesn't, yet) call texting/dispatch — see its file header.
//
export namespace Engine
{
    export enum Outcome { ADVANCED = "advanced", WAITING = "waiting", FAILED = "failed" }

    export interface Decision
    {
        outcome: Outcome;
        edge?:   Workflow.Edge;   // set when outcome === ADVANCED
        error?:  string;          // set when outcome === FAILED
    }

    /**
     * Decide what a node does next.
     * @param node    the node currently at the frontier.
     * @param edges   the definition's full edge list (filtered here to this node's outgoing set).
     * @param context the instance's accumulated context (read-only; `if`'s condition evaluates against it).
     * @param signal  `"resume"` / `"timeout"` when this call is WAKING a previously-parked node
     *                (`sleep`/`wait_for_response`); `undefined` for a normal, first-visit advance.
     */
    export function decide( node : Workflow.Node, edges : Array<Workflow.Edge>, context : Record<string, unknown>, signal? : string ) : Decision
    {
        const outgoing : Array<Workflow.Edge> = edges.filter( ( edge : Workflow.Edge ) : boolean => edge.source === node.id );

        switch( node.type )
        {
            case Workflow.NodeType.START:
            case Workflow.NodeType.SEND_TEXT:
                return takeDefaultEdge( outgoing );

            case Workflow.NodeType.IF:
                return takeConditionalEdge( node, outgoing, context );

            case Workflow.NodeType.SLEEP:
                // no signal yet -> this is the first visit, park for the configured duration; a
                // "timeout" wake (from WorkflowSchedulerJob) is what lets it advance.
                if( signal === undefined ) return { outcome: Outcome.WAITING };
                return takeDefaultEdge( outgoing );

            case Workflow.NodeType.WAIT_FOR_RESPONSE:
                if( signal === undefined ) return { outcome: Outcome.WAITING };
                return takeHandleEdge( outgoing, signal );

            case Workflow.NodeType.END:
                // terminal — WorkflowStepJob checks for END before calling decide() on it; reaching
                // here means a malformed graph slipped past publish validation.
                return { outcome: Outcome.FAILED, error: "\"end\" is terminal and has no next step" };

            default:
                return { outcome: Outcome.FAILED, error: `unhandled node type "${node.type}"` };
        }
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    function takeDefaultEdge( outgoing : Array<Workflow.Edge> ) : Decision
    {
        const edge : Workflow.Edge | undefined = outgoing.find( ( edge : Workflow.Edge ) : boolean => edge.sourceHandle === Workflow.DEFAULT_HANDLE ) ?? outgoing[ 0 ];
        if( !edge ) return { outcome: Outcome.FAILED, error: "no outgoing edge" };
        return { outcome: Outcome.ADVANCED, edge };
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    function takeHandleEdge( outgoing : Array<Workflow.Edge>, handle : string ) : Decision
    {
        const edge : Workflow.Edge | undefined = outgoing.find( ( edge : Workflow.Edge ) : boolean => edge.sourceHandle === handle );
        if( !edge ) return { outcome: Outcome.FAILED, error: `missing "${handle}" outgoing edge` };
        return { outcome: Outcome.ADVANCED, edge };
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    function takeConditionalEdge( node : Workflow.Node, outgoing : Array<Workflow.Edge>, context : Record<string, unknown> ) : Decision
    {
        const rule : unknown = node.config.condition ?? true;
        let result : boolean;
        try
        {
            result = Boolean( jsonLogic.apply( rule as object, context ) );
        }
        catch( err : unknown )
        {
            return { outcome: Outcome.FAILED, error: `condition evaluation failed: ${( err as Error ).message ?? String( err )}` };
        }
        return takeHandleEdge( outgoing, result ? "true" : "false" );
    }
}

export default Engine;
// eof

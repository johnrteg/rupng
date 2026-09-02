//
import { Context } from "aws-lambda";

import { Workflow, WorkflowInstance } from "@repo/api";
import { type Type } from "@repo/common";
import { Events, Payloads } from "@repo/system";

import WorkflowJob from "../services/WorkflowJob";
import { WorkflowStore } from "../store/WorkflowStore";
import { Engine } from "../engine/Engine";
import { AdvanceMessage } from "../engine/AdvanceMessage";
import { toSchedulerTimestamp } from "../engine/SchedulerTime";
import { emitWorkflowEvent } from "../engine/emitWorkflowEvent";

// v1 simplification (see Workflow.ts's header note) — `sleep`/`wait_for_response` durations are a
// plain second count in `node.config.durationSeconds`, not the README's full ISO-8601/calendar syntax.
const DEFAULT_DURATION_SECONDS : number = 60;

//
// WorkflowStepJob — the step-execution loop's worker (SPECS.md `workflow-3.0`/`workflow-6.0`): load →
// evaluate the current node via `Engine.decide` → either ADVANCE (persist + re-enqueue the next tick),
// WAIT (persist `WAITING` + schedule a timeout wake), or FAIL (persist `FAILED`) → emit the instance
// lifecycle event. Idempotent against a stale/duplicate message (see `nodeId` guard below).
//
// STUBBED delegation: `send_text` does NOT call texting/dispatch — see README.md's delegation table
// for the real destination. This job only proves the decide→persist→re-enqueue loop; wiring the actual
// cross-service SQS contract for each action node is deferred (see the workflow build plan).
//
export class WorkflowStepJob extends WorkflowJob<unknown, void>
{
    /////////////////////////////////////////////////////////////////////
    constructor() { super( "workflowStepJob" ); }

    /////////////////////////////////////////////////////////////////////
    public async handler( event : unknown, _context : Context ) : Promise<void>
    {
        for( const message of this.messages( event ) ) await this.step( message );
    }

    /////////////////////////////////////////////////////////////////////
    private async step( message : AdvanceMessage ) : Promise<void>
    {
        const got : Type.Result<WorkflowInstance.Entity | undefined> = await WorkflowStore.getInstance( this.dynamo, message.accountId, message.instanceId );
        if( !got.ok || !got.data )
        {
            this.log.warn( "step: instance not found", { instanceId: message.instanceId } );
            return;
        }
        const instance : WorkflowInstance.Entity = got.data;

        // idempotency / staleness guard — the frontier has already moved past this node (a redelivered
        // or duplicate message), or the instance already finished. Either way, a no-op, not an error.
        if( instance.currentNodeId !== message.nodeId || instance.status === WorkflowInstance.Status.COMPLETED || instance.status === WorkflowInstance.Status.FAILED )
        {
            this.log.info( "step: stale/duplicate message, skipping", { instanceId: instance.instanceId, currentNodeId: instance.currentNodeId, messageNodeId: message.nodeId } );
            return;
        }

        const version : Type.Result<Workflow.Entity | undefined> = await WorkflowStore.getVersion( this.dynamo, message.accountId, instance.definitionId, instance.defVersion );
        if( !version.ok || !version.data )
        {
            this.log.warn( "step: pinned definition version not found", { instanceId: instance.instanceId, definitionId: instance.definitionId, defVersion: instance.defVersion } );
            return;
        }
        const definition : Workflow.Entity = version.data;

        const node : Workflow.Node | undefined = definition.nodes.find( ( node : Workflow.Node ) : boolean => node.id === message.nodeId );
        if( !node )
        {
            await this.fail( instance, message.nodeId, "current node not found in its pinned definition version" );
            return;
        }

        const decision : Engine.Decision = Engine.decide( node, definition.edges, instance.context, message.signal );

        if( decision.outcome === Engine.Outcome.WAITING )   { await this.park( instance, node );               return; }
        if( decision.outcome === Engine.Outcome.FAILED )    { await this.fail( instance, node.id, decision.error ?? "unknown error" ); return; }
        await this.advance( instance, node, decision.edge as Workflow.Edge, definition );
    }

    /////////////////////////////////////////////////////////////////////
    /** Node ADVANCED — record its outcome, move the frontier to the edge's target, and either complete
     *  the instance (target is `end`) or re-enqueue immediately for the next node. */
    private async advance( instance : WorkflowInstance.Entity, node : Workflow.Node, edge : Workflow.Edge, definition : Workflow.Entity ) : Promise<void>
    {
        const now : Type.ISODateTime = new Date().toISOString();
        const output : Record<string, unknown> | undefined = node.type === Workflow.NodeType.SEND_TEXT
            ? { stubbed: true, note: "send_text delegation to texting/dispatch is not wired yet" }
            : undefined;

        const history : WorkflowInstance.HistoryEntry = { nodeId: node.id, enteredAt: now, outcome: WorkflowInstance.Outcome.ADVANCED, output };
        const target : Workflow.Node | undefined = definition.nodes.find( ( candidate : Workflow.Node ) : boolean => candidate.id === edge.target );
        const completed : boolean = target?.type === Workflow.NodeType.END;

        const updated : WorkflowInstance.Entity =
        {
            ...instance,
            status:        completed ? WorkflowInstance.Status.COMPLETED : WorkflowInstance.Status.RUNNING,
            currentNodeId: edge.target,
            waitKey:       undefined,
            history:       [ ...instance.history, history ],
            updatedAt:     now,
        };

        const wrote : Type.Result<void> = await WorkflowStore.putInstance( this.dynamo, updated );
        if( !wrote.ok ) { this.log.warn( "step: instance persist failed", { instanceId: instance.instanceId, error: wrote.error } ); return; }

        if( !completed )
        {
            const next : AdvanceMessage = { accountId: instance.accountId, instanceId: instance.instanceId, nodeId: edge.target };
            const enqueued : Type.Result<void> = await this.sqs.send( "workflow-advance", next );
            if( !enqueued.ok ) this.log.warn( "step: re-enqueue failed", { instanceId: instance.instanceId, error: enqueued.error } );
        }

        const payload : Payloads.WorkflowInstance = { instanceId: updated.instanceId, accountId: updated.accountId, definitionId: updated.definitionId, status: updated.status };
        await emitWorkflowEvent( this.kafka, this.log, Events.Object.WORKFLOW_INSTANCE, Events.Verb.UPDATED, updated.instanceId, updated.accountId, payload );
    }

    /////////////////////////////////////////////////////////////////////
    /** `sleep` / `wait_for_response` parking — persist `WAITING` (+ a `waitKey` for external inbound
     *  resume on `wait_for_response`) and schedule the timeout wake via the dynamic `Scheduler` facade. */
    private async park( instance : WorkflowInstance.Entity, node : Workflow.Node ) : Promise<void>
    {
        const now : Type.ISODateTime = new Date().toISOString();
        const durationSeconds : number = Number( node.config.durationSeconds ?? DEFAULT_DURATION_SECONDS );
        const waitKey : string | undefined = node.type === Workflow.NodeType.WAIT_FOR_RESPONSE
            ? `${instance.accountId}:${instance.subject}:${node.id}`
            : undefined;

        const updated : WorkflowInstance.Entity =
        {
            ...instance,
            status:    WorkflowInstance.Status.WAITING,
            waitKey,
            history:   [ ...instance.history, { nodeId: node.id, enteredAt: now, outcome: WorkflowInstance.Outcome.WAITING } ],
            updatedAt: now,
        };

        const wrote : Type.Result<void> = await WorkflowStore.putInstance( this.dynamo, updated );
        if( !wrote.ok ) { this.log.warn( "step: instance persist failed", { instanceId: instance.instanceId, error: wrote.error } ); return; }

        const wake : AdvanceMessage = { accountId: instance.accountId, instanceId: instance.instanceId, nodeId: node.id, signal: "timeout" };
        const scheduledAt : Date = new Date( Date.now() + durationSeconds * 1000 );
        const scheduled : Type.Result<void> = await this.scheduler.upsert( `wake-${instance.instanceId}-${node.id}`, {
            at:     toSchedulerTimestamp( scheduledAt ),
            target: { queueKey: "workflow-scheduler-wake" },
            input:  wake,
        } );
        if( !scheduled.ok ) this.log.warn( "step: scheduler upsert failed", { instanceId: instance.instanceId, error: scheduled.error } );
    }

    /////////////////////////////////////////////////////////////////////
    private async fail( instance : WorkflowInstance.Entity, nodeId : string, error : string ) : Promise<void>
    {
        const now : Type.ISODateTime = new Date().toISOString();
        const updated : WorkflowInstance.Entity =
        {
            ...instance,
            status:    WorkflowInstance.Status.FAILED,
            history:   [ ...instance.history, { nodeId, enteredAt: now, outcome: WorkflowInstance.Outcome.FAILED, error } ],
            updatedAt: now,
        };

        const wrote : Type.Result<void> = await WorkflowStore.putInstance( this.dynamo, updated );
        if( !wrote.ok ) { this.log.warn( "step: instance persist failed", { instanceId: instance.instanceId, error: wrote.error } ); return; }

        const payload : Payloads.WorkflowInstance = { instanceId: updated.instanceId, accountId: updated.accountId, definitionId: updated.definitionId, status: updated.status };
        await emitWorkflowEvent( this.kafka, this.log, Events.Object.WORKFLOW_INSTANCE, Events.Verb.UPDATED, updated.instanceId, updated.accountId, payload );
    }

    /////////////////////////////////////////////////////////////////////
    /** Parse `AdvanceMessage`s out of an SQS Lambda event's records. */
    private messages( event : unknown ) : Array<AdvanceMessage>
    {
        const records : Array<{ body? : string }> = ( event as { Records? : Array<{ body? : string }> } )?.Records ?? [];
        const messages : Array<AdvanceMessage> = [];
        for( const record of records )
        {
            try
            {
                const parsed : Partial<AdvanceMessage> = JSON.parse( record.body ?? "{}" );
                if( parsed.accountId && parsed.instanceId && parsed.nodeId )
                    messages.push( { accountId: parsed.accountId, instanceId: parsed.instanceId, nodeId: parsed.nodeId, signal: parsed.signal } );
            }
            catch { /* skip a malformed record */ }
        }
        return messages;
    }
}

//
// Lambda entrypoint — manifest `jobs.workflowStepJob`, handler "jobs/WorkflowStepJob.handler".
//
const job : WorkflowStepJob = new WorkflowStepJob();
export const handler = ( event : unknown, context : Context ) : Promise<void> => job.invoke( event, context );

export default WorkflowStepJob;
// eof

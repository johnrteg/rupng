//
import { randomUUID } from "node:crypto";

import { Events } from "@repo/system";
import { Workflow, WorkflowInstance } from "@repo/api";
import type { Type } from "@repo/common";

import WorkflowConsumer from "./WorkflowConsumer";
import { WorkflowStore } from "../store/WorkflowStore";
import { AdvanceMessage } from "../engine/AdvanceMessage";
import { emitWorkflowEvent } from "../engine/emitWorkflowEvent";

//
// WorkflowTriggerConsumer — the trigger role (SPECS.md `workflow-2.0`/`workflow-11.3`): matches every
// inbound event against every account's PUBLISHED, non-paused definitions' trigger bindings and either
// STARTS a new instance (event-initiated trigger match) or SIGNALS a parked `wait_for_response` node
// (subject-keyed resume — README.md "(b) subject-keyed" routing). A genuine `Consumer` (ECS,
// long-running), not a Lambda `Job` — see `WorkflowConsumer.ts`'s header comment for why.
//
// SCOPE — subscribes to the CloudManifest's starter topic set (`Events.Object.CONTACT_CONTACT` today;
// see CloudManifest.ts's `subscribes` comment). `workflow-7.1`'s full "any Events action" surface is
// deferred — this proves the fan-out/match/signal loop end-to-end on one representative source.
//
export class WorkflowTriggerConsumer extends WorkflowConsumer
{
    ////////////////////////////////////////////////////////////////////////////////////////////
    constructor() { super( "trigger" ); }

    ////////////////////////////////////////////////////////////////////////////////////////////
    protected async consume() : Promise<void>
    {
        await this.kafka.subscribeEvents( "workflow-trigger", Events.Object.CONTACT_CONTACT,
            ( event : Events.Of<Events.Object.CONTACT_CONTACT> ) : Promise<void> => this.onEvent( event ) );

        // the subscription runs its own consume loop in the background (kafkajs); block here until a
        // shutdown signal arrives, then let aboutToQuit() disconnect.
        while( !this.isShuttingDown() ) await WorkflowTriggerConsumer.sleep( 1_000 );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    private async onEvent( event : Events.Envelope ) : Promise<void>
    {
        // README.md describes an inbound event as EITHER a trigger (start) or a signal (resume a parked
        // wait_for_response, subject-keyed via `WorkflowStore.findInstanceByWaitKey`). This pass wires
        // the START half only — the SIGNAL half needs the waiting node's id (per-definition, not knowable
        // from the event alone) to build the exact `accountId:subject:nodeId` waitKey, which needs a
        // real resume-source contract (e.g. `contact.contact.replied` carrying the conversation context)
        // this pass doesn't have yet. Documented gap, not a silent stub — see the build plan.
        await this.tryStart( event );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Match `event.action` against every account's PUBLISHED, non-paused definitions' trigger
     *  bindings and start an independent instance per match (README.md "fan-out — 0-N workflows"). */
    private async tryStart( event : Events.Envelope ) : Promise<void>
    {
        const heads : Type.Result<Array<Workflow.Entity>> = await WorkflowStore.listHeads( this.dynamo, event.accountId );
        if( !heads.ok ) { this.log.warn( "trigger: definitions read failed", { accountId: event.accountId, error: heads.error } ); return; }

        const matches : Array<Workflow.Entity> = heads.data.filter( ( definition : Workflow.Entity ) : boolean =>
            definition.status === Workflow.Status.PUBLISHED &&
            definition.triggers.some( ( trigger : Workflow.Trigger ) : boolean => trigger.eventAction === event.action ) );

        for( const definition of matches ) await this.startInstance( definition, event );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    private async startInstance( definition : Workflow.Entity, event : Events.Envelope ) : Promise<void>
    {
        const startNode : Workflow.Node | undefined = definition.nodes.find( ( node : Workflow.Node ) : boolean => node.type === Workflow.NodeType.START );
        if( !startNode ) { this.log.warn( "trigger: published definition has no start node", { definitionId: definition.id } ); return; }

        const now : Type.ISODateTime = new Date().toISOString();
        const instance : WorkflowInstance.Entity =
        {
            instanceId:    randomUUID(),
            accountId:     definition.accountId,
            definitionId:  definition.id,
            defVersion:    definition.version,
            subject:       event.target?.id ?? "unknown",
            status:        WorkflowInstance.Status.RUNNING,
            context:       { trigger: event.data ?? {} },
            currentNodeId: startNode.id,
            history:       [],
            startedAt:     now,
            updatedAt:     now,
        };

        const wrote : Type.Result<void> = await WorkflowStore.putInstance( this.dynamo, instance );
        if( !wrote.ok ) { this.log.warn( "trigger: instance write failed", { definitionId: definition.id, error: wrote.error } ); return; }

        const message : AdvanceMessage = { accountId: instance.accountId, instanceId: instance.instanceId, nodeId: startNode.id };
        const enqueued : Type.Result<void> = await this.sqs.send( "workflow-advance", message );
        if( !enqueued.ok ) this.log.warn( "trigger: advance enqueue failed", { instanceId: instance.instanceId, error: enqueued.error } );

        await emitWorkflowEvent( this.kafka, this.log, Events.Object.WORKFLOW_INSTANCE, Events.Verb.CREATED, instance.instanceId, instance.accountId,
            { instanceId: instance.instanceId, accountId: instance.accountId, definitionId: instance.definitionId, status: instance.status } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    private static sleep( ms : number ) : Promise<void> { return new Promise( ( resolve ) => setTimeout( resolve, ms ) ); }
}

export default WorkflowTriggerConsumer;
// eof

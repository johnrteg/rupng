//
import type { Kafka } from "@repo/services";
import type { Type } from "@repo/common";
import { Events } from "@repo/system";
import type { Trace } from "@repo/services";

//
// emitWorkflowEvent — publish a `workflow.workflow.*` / `workflow.instance.*` lifecycle event.
// Best-effort (logged, never throws) — plain function (not a method) so it's shared across
// WorkflowService / WorkflowJob / WorkflowTriggerConsumer, three DIFFERENT platform base classes.
//
export async function emitWorkflowEvent(
    kafka       : Kafka,
    log         : Trace,
    object      : Events.Object.WORKFLOW_WORKFLOW | Events.Object.WORKFLOW_INSTANCE,
    verb        : Events.Verb,
    targetId    : string,
    accountId   : string,
    data        : unknown,
    actorUserId? : string,
) : Promise<void>
{
    const noun : string = object === Events.Object.WORKFLOW_WORKFLOW ? "workflow" : "instance";
    const env : Events.Envelope = Events.envelope( { object, verb, accountId, target: { type: noun, id: targetId }, data, actorUserId } );
    const published : Type.Result<void> = await kafka.publishEvent( env );
    if( !published.ok ) log.warn( "workflow event publish failed", { action: env.action, targetId, error: published.error } );
}

export default emitWorkflowEvent;
// eof

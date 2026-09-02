//
import { Context } from "aws-lambda";

import { WorkflowInstance } from "@repo/api";
import { type Type } from "@repo/common";

import WorkflowJob from "../services/WorkflowJob";
import { WorkflowStore } from "../store/WorkflowStore";
import { AdvanceMessage } from "../engine/AdvanceMessage";

//
// WorkflowSchedulerJob — the delivery target for EventBridge Scheduler `sleep`/timeout wakeups
// (SPECS.md `workflow-4.2`). Its only job is IDEMPOTENCY: the wake fires unconditionally at the
// scheduled instant, even if the instance already resumed some other way in the meantime (an external
// signal landing on `wait_for_response` before the timeout). If the instance is still `WAITING` on the
// exact node the wake was for, forward it to `workflow-advance` (with `signal: "timeout"`, already on
// the message) for WorkflowStepJob to actually decide/dispatch — this job doesn't run `Engine` itself.
//
export class WorkflowSchedulerJob extends WorkflowJob<unknown, void>
{
    /////////////////////////////////////////////////////////////////////
    constructor() { super( "workflowSchedulerJob" ); }

    /////////////////////////////////////////////////////////////////////
    public async handler( event : unknown, _context : Context ) : Promise<void>
    {
        for( const wake of this.wakes( event ) ) await this.onWake( wake );
    }

    /////////////////////////////////////////////////////////////////////
    private async onWake( wake : AdvanceMessage ) : Promise<void>
    {
        const got : Type.Result<WorkflowInstance.Entity | undefined> = await WorkflowStore.getInstance( this.dynamo, wake.accountId, wake.instanceId );
        if( !got.ok || !got.data )
        {
            this.log.warn( "scheduler wake: instance not found", { instanceId: wake.instanceId } );
            return;
        }
        const instance : WorkflowInstance.Entity = got.data;

        // stale wake — the instance already moved on (resumed via an external signal, or the definition
        // was force-stopped) before the timeout fired. A no-op, not an error (see WorkflowStepJob's own
        // staleness guard for the mirror-image case).
        if( instance.status !== WorkflowInstance.Status.WAITING || instance.currentNodeId !== wake.nodeId )
        {
            this.log.info( "scheduler wake: instance no longer waiting on this node, skipping", { instanceId: instance.instanceId } );
            return;
        }

        const enqueued : Type.Result<void> = await this.sqs.send( "workflow-advance", wake );
        if( !enqueued.ok ) this.log.warn( "scheduler wake: advance enqueue failed", { instanceId: instance.instanceId, error: enqueued.error } );
    }

    /////////////////////////////////////////////////////////////////////
    /** Parse `AdvanceMessage` wakes out of an SQS Lambda event's records (the `input` the `Scheduler`
     *  facade posted, unchanged). */
    private wakes( event : unknown ) : Array<AdvanceMessage>
    {
        const records : Array<{ body? : string }> = ( event as { Records? : Array<{ body? : string }> } )?.Records ?? [];
        const wakes : Array<AdvanceMessage> = [];
        for( const record of records )
        {
            try
            {
                const parsed : Partial<AdvanceMessage> = JSON.parse( record.body ?? "{}" );
                if( parsed.accountId && parsed.instanceId && parsed.nodeId )
                    wakes.push( { accountId: parsed.accountId, instanceId: parsed.instanceId, nodeId: parsed.nodeId, signal: parsed.signal ?? "timeout" } );
            }
            catch { /* skip a malformed record */ }
        }
        return wakes;
    }
}

//
// Lambda entrypoint — manifest `jobs.workflowSchedulerJob`, handler "jobs/WorkflowSchedulerJob.handler".
//
const job : WorkflowSchedulerJob = new WorkflowSchedulerJob();
export const handler = ( event : unknown, context : Context ) : Promise<void> => job.invoke( event, context );

export default WorkflowSchedulerJob;
// eof

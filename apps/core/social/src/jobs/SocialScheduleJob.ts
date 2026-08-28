//
import { Context } from "aws-lambda";
import { SocialPost } from "@repo/api";
import type { Type } from "@repo/common";

import SocialJob from "./SocialJob";

//
// SocialScheduleJob — fires scheduled posts. Runs every minute (EventBridge `rate(1 minute)`),
// sweeps the posts table's cross-account "schedule" GSI for SCHEDULED posts whose `scheduleAt` has
// passed, and enqueues each to `social-publish` (SocialPublishWorker / MAIN's local drain do the
// actual per-target publish — see SocialPipeline).
//
// Known follow-up: this doesn't yet guard against enqueueing the same due post twice if a sweep runs
// again before the worker has flipped its status off SCHEDULED — acceptable for this initial cut since
// the worker's per-target publish isn't strictly idempotent either; both need a dedupe pass together.
//
export class SocialScheduleJob extends SocialJob<unknown, void>
{
    /////////////////////////////////////////////////////////////////////
    constructor() { super( "socialScheduleJob" ); }

    /////////////////////////////////////////////////////////////////////
    public async handler( _event : unknown, _context : Context ) : Promise<void>
    {
        const now : Type.ISODateTime = new Date().toISOString();

        const due : Type.Result<Array<SocialPost.Entity>> = await this.dynamo.query<SocialPost.Entity>( "posts", {
            IndexName:                 "schedule",
            KeyConditionExpression:    "#status = :s AND scheduleAt <= :now",
            ExpressionAttributeNames:  { "#status": "status" },
            ExpressionAttributeValues: { ":s": SocialPost.Status.SCHEDULED, ":now": now },
        } );
        if( !due.ok ) { this.log.warn( "schedule sweep read failed", { error: due.error } ); return; }

        for( const post of due.data )
        {
            const enqueued : Type.Result<void> = await this.sqs.send( "social-publish", { accountId: post.accountId, postId: post.id } );
            if( !enqueued.ok ) this.log.warn( "schedule sweep enqueue failed", { postId: post.id, error: enqueued.error } );
        }
    }
}

//
// Lambda entrypoint — manifest `jobs.socialScheduleJob`, handler "jobs/SocialScheduleJob.handler".
//
const job : SocialScheduleJob = new SocialScheduleJob();
export const handler = ( event : unknown, context : Context ) : Promise<void> => job.invoke( event, context );

export default SocialScheduleJob;
// eof

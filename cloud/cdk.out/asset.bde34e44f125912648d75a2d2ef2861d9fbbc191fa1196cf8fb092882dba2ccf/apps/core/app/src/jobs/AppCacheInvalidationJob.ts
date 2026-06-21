//
import type { Context } from "aws-lambda";

import AppJob from "./AppJob";

//
// AppCacheInvalidationJob — on asset / help-article change events (Kafka / EventBridge — the
// `platform.changes` subscription), invalidate the CloudFront cache for the affected static assets /
// help articles. The bootstrap is no-TTL / revalidated, so it needs no busting. (SPECS app-9.2)
//
// The event is the normalized change record (Kafka/EventBridge payload) — typed loosely until the
// change-event contract is finalized.
//
export class AppCacheInvalidationJob extends AppJob<unknown, void>
{
    /////////////////////////////////////////////////////////////////////
    constructor()
    {
        super( "cache-invalidation" );
    }

    /////////////////////////////////////////////////////////////////////
    public async handler( event : unknown, _context : Context ) : Promise<void>
    {
        // TODO(app-9.2): map change event → affected asset/help paths → CloudFront createInvalidation.
        this.log.info( "AppCacheInvalidationJob", { received: event !== undefined } );
    }
}

//
// Lambda entrypoint — manifest `jobs.cacheInvalidation`, handler "jobs/AppCacheInvalidationJob.handler".
//
const job : AppCacheInvalidationJob = new AppCacheInvalidationJob();
export const handler = ( event : unknown, context : Context ) : Promise<void> => job.invoke( event, context );

export default AppCacheInvalidationJob;

//
import { Context } from "aws-lambda";

import SocialJob from "./SocialJob";
import { SocialPipeline } from "../pipeline/SocialPipeline";

//
// SocialPublishWorker — the Lambda counterpart to SocialMainService's in-process social-publish
// consumer. Decouples publish throughput (rate-limited by each platform's API) from the API traffic
// SocialMainService also serves, and scales with queue depth. Runs the exact same
// SocialPipeline.publishPost the MAIN consumer does — only the trigger differs.
//
export class SocialPublishWorker extends SocialJob<unknown, void>
{
    /////////////////////////////////////////////////////////////////////
    constructor() { super( "socialPublishWorker" ); }

    /////////////////////////////////////////////////////////////////////
    public async handler( event : unknown, _context : Context ) : Promise<void>
    {
        const deps : SocialPipeline.Deps = this.pipelineDeps();
        for( const ref of this.postRefs( event ) )
            await SocialPipeline.publishPost( deps, ref.accountId, ref.postId );
    }
}

//
// Lambda entrypoint — manifest `jobs.socialPublishWorker`, handler "jobs/SocialPublishWorker.handler".
//
const job : SocialPublishWorker = new SocialPublishWorker();
export const handler = ( event : unknown, context : Context ) : Promise<void> => job.invoke( event, context );

export default SocialPublishWorker;
// eof

//
import { Context } from "aws-lambda";

import SocialJob from "./SocialJob";
import { InboundPipeline } from "../pipeline/InboundPipeline";

//
// SocialInboundJob — normalizes inbound items fed by BOTH sources (SocialMainService's webhook intake
// for Meta push, SocialPollJob for X/TikTok/LinkedIn pull) via the `social-inbound` queue: keyword-tag
// + sentiment-score + store, via the shared InboundPipeline (SPECS.md §9.6 — "inbound is asymmetric").
//
export class SocialInboundJob extends SocialJob<unknown, void>
{
    /////////////////////////////////////////////////////////////////////
    constructor() { super( "socialInboundJob" ); }

    /////////////////////////////////////////////////////////////////////
    public async handler( event : unknown, _context : Context ) : Promise<void>
    {
        const deps : InboundPipeline.Deps = this.inboundPipelineDeps();
        for( const ref of this.inboundRefs( event ) )
            await InboundPipeline.ingest( deps, ref.accountId, ref.connectionId, ref.platform, ref.item );
    }
}

//
// Lambda entrypoint — manifest `jobs.socialInboundJob`, handler "jobs/SocialInboundJob.handler".
//
const job : SocialInboundJob = new SocialInboundJob();
export const handler = ( event : unknown, context : Context ) : Promise<void> => job.invoke( event, context );

export default SocialInboundJob;
// eof

//
import { Context } from "aws-lambda";

import MediaJob from "./MediaJob";
import { MediaPipeline } from "../pipeline/MediaPipeline";

//
// MediaScanJob — the security gate (media-5). Triggered by the media-scan SQS queue (S3-created → dispatch).
// Runs the scan stage per record; on clean it advances the asset to processing (MediaPipeline handles the
// stub-vs-real engine). The Lambda entry wires: `const job = new MediaScanJob(); export const handler = job.invoke`.
//
export class MediaScanJob extends MediaJob<unknown, void>
{
    constructor() { super( "scan" ); }

    ///////////////////////////////////////////////////////////////////////////////////////
    public async handler( event : unknown, _context : Context ) : Promise<void>
    {
        for( const ref of this.mediaRefs( event ) )
            await MediaPipeline.scan( await this.pipelineDeps(), ref.accountId, ref.guid );
    }
}

export default MediaScanJob;

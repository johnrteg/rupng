//
import { Context } from "aws-lambda";

import MediaJob from "./MediaJob";
import { MediaPipeline } from "../pipeline/MediaPipeline";

//
// MediaProcessJob — image processing (media-4). Triggered by the media-process SQS queue (enqueued by the
// scan gate once clean). Derives the standard renditions per record via the shared MediaPipeline.
//
export class MediaProcessJob extends MediaJob<unknown, void>
{
    constructor() { super( "process" ); }

    ///////////////////////////////////////////////////////////////////////////////////////
    public async handler( event : unknown, _context : Context ) : Promise<void>
    {
        for( const ref of this.mediaRefs( event ) )
        {
            if( ref.posterAt !== undefined ) await MediaPipeline.regeneratePoster( await this.pipelineDeps(), ref.accountId, ref.guid, ref.posterAt );
            else if( ref.rescan ) await MediaPipeline.analyze( await this.pipelineDeps(), ref.accountId, ref.guid );
            else await MediaPipeline.process( await this.pipelineDeps(), ref.accountId, ref.guid, ref.profile );
        }
    }
}

export default MediaProcessJob;

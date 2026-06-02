//

import { Application } from './Application';
/*
Jobs are short run functions that might be called from:
1) SQS pipe
2) S3 event change
3) Scheduled cron activity
*/

export class Job extends Application
{

    ////////////////////////////////////////////////////////////////////////
    constructor( name : string )
    {
        super( name );
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////
    protected async config() : Promise<void>
    {
        await super.config();
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////
    protected async init() : Promise<void>
    {
        await super.init();
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////////////////
    protected async start() : Promise<void>
    {
        await super.start();
    }

    ////////////////////////////////////////////////////////////////////////
    // Main Lambda handler (must be implemented by subclass)
    protected async handler( event: any, context: any ): Promise<any>
    {
    }

    ////////////////////////////////////////////////////////////////////////
    protected async aboutToQuit() : Promise<void>
    {
        await super.aboutToQuit();
    }

}

export default Job;
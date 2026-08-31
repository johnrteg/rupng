//
import type { Type } from "@repo/common";

import { EmailClient } from "../clients/EmailClient";
import { Destination } from "./Destination";

//
// EmailDestination — sends a completion notice email carrying the presigned download link. `config.to` is
// the caller-supplied recipient (recorded on `Submission.destination.config` at submit time); a missing
// `to` is a caller error surfaced back up as a failed Result, not silently dropped.
//
export class EmailDestination implements Destination
{
    ////////////////////////////////////////////////////////////////////////////////////////////
    public async deliver( ctx : Destination.DeliverContext ) : Promise<Type.Result<void>>
    {
        const config : { to? : string } = ( ctx.submission.destination.config as { to? : string } ) ?? {};
        if( !config.to ) return { ok: false, error: "email destination missing config.to" };

        const client : EmailClient = new EmailClient();
        const subject : string = `Your report is ready — ${ ctx.submission.reportId }`;
        const body : string = `Your report (${ ctx.submission.reportId }, submission ${ ctx.submission.submissionId }) has finished generating.\n\nDownload it here: ${ ctx.downloadUrl }`;
        return client.send( ctx.accountId, config.to, subject, body );
    }
}

export default EmailDestination;
// eof

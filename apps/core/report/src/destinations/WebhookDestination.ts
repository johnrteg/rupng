//
import { createHmac } from "node:crypto";

import type { Type } from "@repo/common";
import { ResultUtils } from "@repo/common";

import { Destination } from "./Destination";

//
// WebhookDestination — POSTs a completion notification to the caller-supplied URL (recorded on
// `Submission.destination.config` at submit time: `{ url, secret? }`), signed with an HMAC-SHA256 over the
// JSON body (`X-Report-Signature: sha256=<hex>`) when a `secret` was given — the same "sign if configured"
// convention as the platform's other outbound webhooks. Uses Node's global `fetch` (no HTTP client dep).
//
export class WebhookDestination implements Destination
{
    ////////////////////////////////////////////////////////////////////////////////////////////
    public async deliver( ctx : Destination.DeliverContext ) : Promise<Type.Result<void>>
    {
        const config : { url? : string; secret? : string } = ( ctx.destination.config as { url? : string; secret? : string } ) ?? {};
        if( !config.url ) return ResultUtils.err( "webhook destination missing config.url" );

        const payload : Record<string, unknown> =
        {
            accountId: ctx.accountId, reportId: ctx.submission.reportId, submissionId: ctx.submission.submissionId,
            downloadUrl: ctx.downloadUrl, format: ctx.submission.format, size: ctx.submission.size ?? 0,
            recordCount: ctx.submission.recordCount ?? 0,
        };
        const body : string = JSON.stringify( payload );

        const headers : Record<string, string> = { "Content-Type": "application/json" };
        if( config.secret )
        {
            const signature : string = createHmac( "sha256", config.secret ).update( body ).digest( "hex" );
            headers[ "X-Report-Signature" ] = `sha256=${ signature }`;
        }

        return ResultUtils.from( async () : Promise<void> =>
        {
            const response : Response = await fetch( config.url as string, { method: "POST", headers, body } );
            if( !response.ok ) throw new Error( `webhook destination responded ${ response.status }` );
        } );
    }
}

export default WebhookDestination;
// eof

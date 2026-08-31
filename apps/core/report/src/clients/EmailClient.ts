//
import { NetworkUtils, ResultUtils, type Type } from "@repo/common";
import { RestfulService } from "@repo/endpoint";
import { Ports } from "@repo/services";
import { PostInternalSend } from "@repo/api";

//
// EmailClient — the S2S client to email's internal send API (used by `EmailDestination` to notify a
// completed report's recipient). Base URL is `EMAIL_INTERNAL_URL`, falling back to email's local-dev port —
// same pattern as `MediaClient`.
//
export class EmailClient
{
    private readonly client : RestfulService;

    ////////////////////////////////////////////////////////////////////////////////////////////
    constructor()
    {
        this.client = new RestfulService(
            process.env.EMAIL_INTERNAL_URL ?? NetworkUtils.url( NetworkUtils.Protocol.HTTP, "localhost", Ports.EMAIL.MAIN, null, null ) );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Enqueue a plain-body notification email (S2S) — fire-and-forget from report's point of view. */
    public async send( accountId : Type.ID, to : string, subject : string, body : string ) : Promise<Type.Result<void>>
    {
        const reply : RestfulService.Reply<PostInternalSend.Response> = await this.client.fetch(
            new PostInternalSend( { accountId, to, subject, body } ) );
        if( !reply.ok ) return ResultUtils.err( `email internal send failed (${ reply.status })` );
        return ResultUtils.ok( undefined );
    }
}

export default EmailClient;
// eof

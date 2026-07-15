//
import { Email } from "@repo/api";
import { NetworkUtils } from "@repo/common";

import { EmailProvider, EmailContext } from "../EmailProvider";

//
// SparkPostProvider — the SparkPost transmissions adapter (email-3.1). Auth is the raw API key in the
// `Authorization` header (no `Bearer`). Maps the Outbound onto SparkPost's content/recipients shape and
// normalizes the reply (`{ results: { id } }`); 429/5xx are retryable.
//
export class SparkPostProvider implements EmailProvider
{
    public readonly provider : Email.Provider = Email.Provider.SPARKPOST;

    private static readonly SEND_URL : string = "https://api.sparkpost.com/api/v1/transmissions";

    ////////////////////////////////////////////////////////////////////////////////////////////
    public async send( outbound : Email.Outbound, ctx : EmailContext ) : Promise<Email.SendResult>
    {
        if( !ctx.apiKey ) return { ok: false, error: "SparkPost API key not configured", retryable: false };

        try
        {
            // recipients are objects; content is a single from/subject/html/text block
            const recipients : Array<{ address : { email : string } }> = outbound.to.map( ( email : string ) : { address : { email : string } } => ( { address: { email } } ) );
            const payload : Record<string, unknown> =
            {
                content:    { from: outbound.from, subject: outbound.subject, html: outbound.html, text: outbound.text },
                recipients,
            };

            const response : Response = await fetch( SparkPostProvider.SEND_URL, {
                method:  "POST",
                headers: { "Content-Type": "application/json", Authorization: ctx.apiKey },
                body:    JSON.stringify( payload ),
            } );

            if( response.ok )
            {
                const body : { results? : { id? : string } } = await response.json() as { results? : { id? : string } };
                return { ok: true, providerMessageId: body.results?.id };
            }
            const retryable : boolean = response.status === NetworkUtils.Status.TOO_MANY_REQUESTS || response.status >= NetworkUtils.Status.INTERNAL_SERVER_ERROR;
            return { ok: false, error: `SparkPost send failed (${ response.status })`, retryable };
        }
        catch( error ) { return { ok: false, error: String( error ), retryable: true }; }
    }
}

export default SparkPostProvider;
// eof

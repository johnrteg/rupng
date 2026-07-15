//
import { Email } from "@repo/api";
import { NetworkUtils } from "@repo/common";

import { EmailProvider, EmailContext } from "../EmailProvider";

//
// ResendProvider — the Resend emails adapter (email-3.1). Bearer API key. Resend accepts the RFC `from` string
// (`"Name" <email>`) as-is and a `to` array. Normalizes the reply (`{ id }`); 429/5xx are retryable.
//
export class ResendProvider implements EmailProvider
{
    public readonly provider : Email.Provider = Email.Provider.RESEND;

    private static readonly SEND_URL : string = "https://api.resend.com/emails";

    ////////////////////////////////////////////////////////////////////////////////////////////
    public async send( outbound : Email.Outbound, ctx : EmailContext ) : Promise<Email.SendResult>
    {
        if( !ctx.apiKey ) return { ok: false, error: "Resend API key not configured", retryable: false };

        try
        {
            const payload : Record<string, unknown> =
            {
                from:    outbound.from,
                to:      outbound.to,
                cc:      outbound.cc,
                bcc:     outbound.bcc,
                subject: outbound.subject,
                html:    outbound.html,
                text:    outbound.text,
            };

            const response : Response = await fetch( ResendProvider.SEND_URL, {
                method:  "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${ ctx.apiKey }` },
                body:    JSON.stringify( payload ),
            } );

            if( response.ok )
            {
                const body : { id? : string } = await response.json() as { id? : string };
                return { ok: true, providerMessageId: body.id };
            }
            const retryable : boolean = response.status === NetworkUtils.Status.TOO_MANY_REQUESTS || response.status >= NetworkUtils.Status.INTERNAL_SERVER_ERROR;
            return { ok: false, error: `Resend send failed (${ response.status })`, retryable };
        }
        catch( error ) { return { ok: false, error: String( error ), retryable: true }; }
    }
}

export default ResendProvider;
// eof

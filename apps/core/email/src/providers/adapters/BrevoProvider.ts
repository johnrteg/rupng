//
import { Email } from "@repo/api";
import { NetworkUtils } from "@repo/common";

import { EmailProvider, EmailContext, ParsedAddress, parseAddress } from "../EmailProvider";

//
// BrevoProvider — the Brevo (formerly Sendinblue) transactional adapter (email-3.1). Auth is the `api-key`
// header. Maps the Outbound onto Brevo's sender/to/htmlContent shape and normalizes the reply (`{ messageId }`);
// 429/5xx are retryable.
//
export class BrevoProvider implements EmailProvider
{
    public readonly provider : Email.Provider = Email.Provider.BREVO;

    private static readonly SEND_URL : string = "https://api.brevo.com/v3/smtp/email";

    ////////////////////////////////////////////////////////////////////////////////////////////
    public async send( outbound : Email.Outbound, ctx : EmailContext ) : Promise<Email.SendResult>
    {
        if( !ctx.apiKey ) return { ok: false, error: "Brevo API key not configured", retryable: false };

        try
        {
            const from : ParsedAddress = parseAddress( outbound.from );
            const payload : Record<string, unknown> =
            {
                sender:      { email: from.email, name: from.name },
                to:          outbound.to.map( ( email : string ) : { email : string } => ( { email } ) ),
                subject:     outbound.subject,
                htmlContent: outbound.html,
                textContent: outbound.text,
            };

            // reply-to override, when present — Brevo wants it as a structured field
            if( outbound.replyTo !== undefined )
            {
                const replyTo : ParsedAddress = parseAddress( outbound.replyTo );
                payload.replyTo = { email: replyTo.email, name: replyTo.name };
            }

            const response : Response = await fetch( BrevoProvider.SEND_URL, {
                method:  "POST",
                headers: { "Content-Type": "application/json", Accept: "application/json", "api-key": ctx.apiKey },
                body:    JSON.stringify( payload ),
            } );

            if( response.ok )
            {
                const body : { messageId? : string } = await response.json() as { messageId? : string };
                return { ok: true, providerMessageId: body.messageId };
            }
            const retryable : boolean = response.status === NetworkUtils.Status.TOO_MANY_REQUESTS || response.status >= NetworkUtils.Status.INTERNAL_SERVER_ERROR;
            return { ok: false, error: `Brevo send failed (${ response.status })`, retryable };
        }
        catch( error ) { return { ok: false, error: String( error ), retryable: true }; }
    }
}

export default BrevoProvider;
// eof

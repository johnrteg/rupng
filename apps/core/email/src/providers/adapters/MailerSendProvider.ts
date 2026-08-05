//
import { Email } from "@repo/api";
import { NetworkUtils } from "@repo/common";

import { EmailProvider, EmailContext, ParsedAddress, parseAddress } from "../EmailProvider";

//
// MailerSendProvider — the MailerSend email adapter (email-3.1). Bearer API key. Maps the Outbound onto
// MailerSend's from/to/html/text shape and normalizes the reply; MailerSend returns 202 with the message id in
// the `X-Message-Id` header. 429/5xx are retryable.
//
export class MailerSendProvider implements EmailProvider
{
    public readonly provider : Email.Provider = Email.Provider.MAILERSEND;

    private static readonly SEND_URL : string = "https://api.mailersend.com/v1/email";

    ////////////////////////////////////////////////////////////////////////////////////////////
    public async send( outbound : Email.Outbound, ctx : EmailContext ) : Promise<Email.SendResult>
    {
        if( !ctx.apiKey ) return { ok: false, error: "MailerSend API key not configured", retryable: false };

        try
        {
            const from : ParsedAddress = parseAddress( outbound.from );
            const payload : Record<string, unknown> =
            {
                from:    { email: from.email, name: from.name },
                to:      outbound.to.map( ( email : string ) : { email : string } => ( { email } ) ),
                subject: outbound.subject,
                html:    outbound.html,
                text:    outbound.text,
            };

            // reply-to override, when present — MailerSend wants it as a structured field
            if( outbound.replyTo !== undefined )
            {
                const replyTo : ParsedAddress = parseAddress( outbound.replyTo );
                payload.reply_to = { email: replyTo.email, name: replyTo.name };
            }

            const response : Response = await fetch( MailerSendProvider.SEND_URL, {
                method:  "POST",
                headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: `Bearer ${ ctx.apiKey }` },
                body:    JSON.stringify( payload ),
            } );

            if( response.ok ) return { ok: true, providerMessageId: response.headers.get( "x-message-id" ) ?? undefined };
            const retryable : boolean = response.status === NetworkUtils.Status.TOO_MANY_REQUESTS || response.status >= NetworkUtils.Status.INTERNAL_SERVER_ERROR;
            return { ok: false, error: `MailerSend send failed (${ response.status })`, retryable };
        }
        catch( error ) { return { ok: false, error: String( error ), retryable: true }; }
    }
}

export default MailerSendProvider;
// eof

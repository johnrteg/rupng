//
import { Email } from "@repo/api";
import { NetworkUtils } from "@repo/common";

import { EmailProvider, EmailContext, ParsedAddress, parseAddress } from "../EmailProvider";

//
// SendGridProvider — the SendGrid (Twilio) v3 mail-send adapter (email-3.1). Bearer API key. Maps the rendered
// Outbound onto the personalizations/content shape and normalizes the reply; SendGrid returns 202 with the
// message id in the `X-Message-Id` header (no JSON body). 429/5xx are retryable.
//
export class SendGridProvider implements EmailProvider
{
    public readonly provider : Email.Provider = Email.Provider.SENDGRID;

    private static readonly SEND_URL : string = "https://api.sendgrid.com/v3/mail/send";

    ////////////////////////////////////////////////////////////////////////////////////////////
    public async send( outbound : Email.Outbound, ctx : EmailContext ) : Promise<Email.SendResult>
    {
        if( !ctx.apiKey ) return { ok: false, error: "SendGrid API key not configured", retryable: false };

        try
        {
            // build the content parts (text first, then html — SendGrid orders least→most specific)
            const from : ParsedAddress = parseAddress( outbound.from );
            const content : Array<{ type : string; value : string }> = [];
            if( outbound.text !== undefined ) content.push( { type: "text/plain", value: outbound.text } );
            if( outbound.html !== undefined ) content.push( { type: "text/html", value: outbound.html } );

            // assemble the payload
            const payload : Record<string, unknown> =
            {
                personalizations: [ { to: outbound.to.map( ( email : string ) : { email : string } => ( { email } ) ) } ],
                from:             { email: from.email, name: from.name },
                subject:          outbound.subject,
                content,
            };

            // reply-to override, when present — SendGrid wants it as a structured top-level field
            if( outbound.replyTo !== undefined )
            {
                const replyTo : ParsedAddress = parseAddress( outbound.replyTo );
                payload.reply_to = { email: replyTo.email, name: replyTo.name };
            }

            // send it
            const response : Response = await fetch( SendGridProvider.SEND_URL, {
                method:  "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${ ctx.apiKey }` },
                body:    JSON.stringify( payload ),
            } );

            // 2xx = accepted (message id in a header); else map by status class
            if( response.ok ) return { ok: true, providerMessageId: response.headers.get( "x-message-id" ) ?? undefined };
            const retryable : boolean = response.status === NetworkUtils.Status.TOO_MANY_REQUESTS || response.status >= NetworkUtils.Status.INTERNAL_SERVER_ERROR;
            return { ok: false, error: `SendGrid send failed (${ response.status })`, retryable };
        }
        catch( error ) { return { ok: false, error: String( error ), retryable: true }; }
    }
}

export default SendGridProvider;
// eof

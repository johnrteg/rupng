//
import { Email } from "@repo/api";
import { NetworkUtils } from "@repo/common";

import { EmailProvider, EmailContext, ParsedAddress, parseAddress } from "../EmailProvider";

//
// MailchimpProvider — the Mailchimp Transactional (Mandrill) messages/send adapter (email-3.1). Auth is the API
// key IN THE BODY (`key`), not a header. Maps the Outbound onto Mandrill's message shape and normalizes the
// reply (an array of `{ _id, status, reject_reason }` — status `rejected`/`invalid` is a permanent failure).
// 5xx are retryable.
//
export class MailchimpProvider implements EmailProvider
{
    public readonly provider : Email.Provider = Email.Provider.MAILCHIMP;

    private static readonly SEND_URL : string = "https://mandrillapp.com/api/1.0/messages/send.json";

    ////////////////////////////////////////////////////////////////////////////////////////////
    public async send( outbound : Email.Outbound, ctx : EmailContext ) : Promise<Email.SendResult>
    {
        if( !ctx.apiKey ) return { ok: false, error: "Mailchimp (Mandrill) API key not configured", retryable: false };

        try
        {
            const from : ParsedAddress = parseAddress( outbound.from );
            const message : Record<string, unknown> =
            {
                from_email: from.email,
                from_name:  from.name,
                to:         outbound.to.map( ( email : string ) : { email : string; type : string } => ( { email, type: "to" } ) ),
                subject:    outbound.subject,
                html:       outbound.html,
                text:       outbound.text,
            };
            // Mandrill has no dedicated reply-to field — it's set as a message header
            if( outbound.replyTo !== undefined ) message.headers = { "Reply-To": outbound.replyTo };
            const payload : Record<string, unknown> = { key: ctx.apiKey, message };

            const response : Response = await fetch( MailchimpProvider.SEND_URL, {
                method:  "POST",
                headers: { "Content-Type": "application/json" },
                body:    JSON.stringify( payload ),
            } );

            // Mandrill returns 200 with a per-recipient status array; a non-2xx is an API/auth error
            if( !response.ok ) return { ok: false, error: `Mailchimp send failed (${ response.status })`, retryable: response.status >= NetworkUtils.Status.INTERNAL_SERVER_ERROR };
            const results : Array<{ _id? : string; status? : string; reject_reason? : string }> = await response.json() as Array<{ _id? : string; status? : string; reject_reason? : string }>;
            const first : { _id? : string; status? : string; reject_reason? : string } | undefined = results[ 0 ];
            if( first !== undefined && ( first.status === "sent" || first.status === "queued" || first.status === "scheduled" ) ) return { ok: true, providerMessageId: first._id };
            return { ok: false, error: first?.reject_reason ?? "Mailchimp rejected the message", retryable: false };
        }
        catch( error ) { return { ok: false, error: String( error ), retryable: true }; }
    }
}

export default MailchimpProvider;
// eof

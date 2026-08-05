//
import { Email } from "@repo/api";
import { NetworkUtils } from "@repo/common";

import { EmailProvider, EmailContext } from "../EmailProvider";

//
// PostmarkProvider — the Postmark single-send adapter (email-3.1). Auth is the server token in the
// `X-Postmark-Server-Token` header. Maps the Outbound onto Postmark's PascalCase JSON and normalizes the reply
// (`{ MessageID, ErrorCode }` — a non-zero ErrorCode is a permanent failure). 429/5xx are retryable.
//
export class PostmarkProvider implements EmailProvider
{
    public readonly provider : Email.Provider = Email.Provider.POSTMARK;

    private static readonly SEND_URL : string = "https://api.postmarkapp.com/email";

    ////////////////////////////////////////////////////////////////////////////////////////////
    public async send( outbound : Email.Outbound, ctx : EmailContext ) : Promise<Email.SendResult>
    {
        if( !ctx.apiKey ) return { ok: false, error: "Postmark server token not configured", retryable: false };

        try
        {
            // Postmark takes a comma-separated recipient list + PascalCase fields
            const payload : Record<string, unknown> =
            {
                From:     outbound.from,
                To:       outbound.to.join( "," ),
                Cc:       outbound.cc?.join( "," ),
                Bcc:      outbound.bcc?.join( "," ),
                Subject:  outbound.subject,
                HtmlBody: outbound.html,
                TextBody: outbound.text,
                // reply-to override, when present (same formatted-string shape as From)
                ReplyTo:  outbound.replyTo,
            };

            const response : Response = await fetch( PostmarkProvider.SEND_URL, {
                method:  "POST",
                headers: { "Content-Type": "application/json", Accept: "application/json", "X-Postmark-Server-Token": ctx.apiKey },
                body:    JSON.stringify( payload ),
            } );

            // parse the JSON reply — ErrorCode 0 is success
            const body : { MessageID? : string; ErrorCode? : number; Message? : string } = await response.json().catch( () : Record<string, never> => ( {} ) ) as { MessageID? : string; ErrorCode? : number; Message? : string };
            if( response.ok && ( body.ErrorCode === undefined || body.ErrorCode === 0 ) ) return { ok: true, providerMessageId: body.MessageID };
            const retryable : boolean = response.status === NetworkUtils.Status.TOO_MANY_REQUESTS || response.status >= NetworkUtils.Status.INTERNAL_SERVER_ERROR;
            return { ok: false, error: body.Message ?? `Postmark send failed (${ response.status })`, retryable };
        }
        catch( error ) { return { ok: false, error: String( error ), retryable: true }; }
    }
}

export default PostmarkProvider;
// eof

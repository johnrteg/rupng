//
import { Email } from "@repo/api";
import { NetworkUtils } from "@repo/common";

import { EmailProvider, EmailContext } from "../EmailProvider";

//
// LettrProvider — the Lettr ESP adapter (email-3.1), the platform's chosen HTTP-API provider. Auth is a Bearer
// API key resolved from Secrets (injected on the context). The vendor endpoint lives here in the adapter (the
// house rule: endpoints in adapter code, not config). Maps the rendered `Email.Outbound` onto Lettr's send
// payload and normalizes the reply to an `Email.SendResult`; a 429/5xx is retryable, a 4xx is permanent.
//
// lttr_sandbox_d4b1082478ee53b760cb31dd71da2381c19814be9ea8aa0aa4417ce307cdb5ff
export class LettrProvider implements EmailProvider
{
    public readonly provider : Email.Provider = Email.Provider.LETTR;

    // Lettr's transactional send endpoint (adjust to the vendor's actual base if it differs).
    private static readonly SEND_URL : string = "https://api.lettr.io/v1/messages";

    ////////////////////////////////////////////////////////////////////////////////////////////
    // POST the message to Lettr and normalize the reply. Wrapped so a network throw becomes a retryable
    // SendResult rather than propagating (the interface contract: send never throws).
    public async send( outbound : Email.Outbound, ctx : EmailContext ) : Promise<Email.SendResult>
    {
        if( !ctx.apiKey ) return { ok: false, error: "Lettr API key not configured", retryable: false };

        try
        {
            // build Lettr's payload from the rendered Outbound
            const payload : Record<string, unknown> =
            {
                from:     outbound.from,
                to:       outbound.to,
                cc:       outbound.cc,
                bcc:      outbound.bcc,
                subject:  outbound.subject,
                html:     outbound.html,
                text:     outbound.text,
                headers:  outbound.headers,
            };

            // send it (Bearer-authenticated JSON)
            const response : Response = await fetch( LettrProvider.SEND_URL, {
                method:  "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${ ctx.apiKey }` },
                body:    JSON.stringify( payload ),
            } );

            // normalize the reply — a 2xx is a success (pull the provider message id); else map by status class
            if( response.ok )
            {
                const body : { id? : string; messageId? : string } = await response.json() as { id? : string; messageId? : string };
                return { ok: true, providerMessageId: body.id ?? body.messageId };
            }
            const retryable : boolean = response.status === NetworkUtils.Status.TOO_MANY_REQUESTS || response.status >= NetworkUtils.Status.INTERNAL_SERVER_ERROR;
            return { ok: false, error: `Lettr send failed (${ response.status })`, retryable };
        }
        catch( error )
        {
            // a network / DNS / timeout error — transient, so retryable
            return { ok: false, error: String( error ), retryable: true };
        }
    }
}

export default LettrProvider;
// eof

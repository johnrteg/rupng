//
import { Email } from "@repo/api";
import { NetworkUtils } from "@repo/common";

import { EmailProvider, EmailContext, ParsedAddress, parseAddress } from "../EmailProvider";

//
// MailtrapProvider — the Mailtrap sending adapter (email-3.1). Bearer API token. Maps the Outbound onto
// Mailtrap's from/to/html/text shape and normalizes the reply (`{ success, message_ids }`); 429/5xx are
// retryable. (Uses the live sending host; the testing sandbox host is a config swap for a later flag.)
//
export class MailtrapProvider implements EmailProvider
{
    public readonly provider : Email.Provider = Email.Provider.MAILTRAP;

    private static readonly SEND_URL : string = "https://send.api.mailtrap.io/api/send";

    ////////////////////////////////////////////////////////////////////////////////////////////
    public async send( outbound : Email.Outbound, ctx : EmailContext ) : Promise<Email.SendResult>
    {
        if( !ctx.apiKey ) return { ok: false, error: "Mailtrap API token not configured", retryable: false };

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

            const response : Response = await fetch( MailtrapProvider.SEND_URL, {
                method:  "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${ ctx.apiKey }` },
                body:    JSON.stringify( payload ),
            } );

            if( response.ok )
            {
                const body : { message_ids? : Array<string> } = await response.json() as { message_ids? : Array<string> };
                return { ok: true, providerMessageId: body.message_ids?.[ 0 ] };
            }
            const retryable : boolean = response.status === NetworkUtils.Status.TOO_MANY_REQUESTS || response.status >= NetworkUtils.Status.INTERNAL_SERVER_ERROR;
            return { ok: false, error: `Mailtrap send failed (${ response.status })`, retryable };
        }
        catch( error ) { return { ok: false, error: String( error ), retryable: true }; }
    }
}

export default MailtrapProvider;
// eof

//
import { Email } from "@repo/api";
import { NetworkUtils } from "@repo/common";

import { EmailProvider, EmailContext, ParsedAddress, parseAddress } from "../EmailProvider";

//
// MailjetProvider — the Mailjet Send API v3.1 adapter (email-3.1). Mailjet uses a TWO-PART credential (API key
// + secret key); the resolved secret is stored colon-joined (`apiKey:secretKey`) and HTTP-Basic-authed here.
// Maps the Outbound onto Mailjet's Messages shape and normalizes the reply; 429/5xx are retryable.
//
export class MailjetProvider implements EmailProvider
{
    public readonly provider : Email.Provider = Email.Provider.MAILJET;

    private static readonly SEND_URL : string = "https://api.mailjet.com/v3.1/send";

    ////////////////////////////////////////////////////////////////////////////////////////////
    public async send( outbound : Email.Outbound, ctx : EmailContext ) : Promise<Email.SendResult>
    {
        if( !ctx.apiKey || !ctx.apiKey.includes( ":" ) ) return { ok: false, error: "Mailjet credential must be apiKey:secretKey", retryable: false };

        try
        {
            const from : ParsedAddress = parseAddress( outbound.from );
            const message : Record<string, unknown> =
            {
                From:     { Email: from.email, Name: from.name },
                To:       outbound.to.map( ( email : string ) : { Email : string } => ( { Email: email } ) ),
                Subject:  outbound.subject,
                HTMLPart: outbound.html,
                TextPart: outbound.text,
            };

            const authorization : string = `Basic ${ Buffer.from( ctx.apiKey ).toString( "base64" ) }`;
            const response : Response = await fetch( MailjetProvider.SEND_URL, {
                method:  "POST",
                headers: { "Content-Type": "application/json", Authorization: authorization },
                body:    JSON.stringify( { Messages: [ message ] } ),
            } );

            if( response.ok )
            {
                const body : { Messages? : Array<{ To? : Array<{ MessageID? : string }> }> } = await response.json() as { Messages? : Array<{ To? : Array<{ MessageID? : string }> }> };
                return { ok: true, providerMessageId: body.Messages?.[ 0 ]?.To?.[ 0 ]?.MessageID };
            }
            const retryable : boolean = response.status === NetworkUtils.Status.TOO_MANY_REQUESTS || response.status >= NetworkUtils.Status.INTERNAL_SERVER_ERROR;
            return { ok: false, error: `Mailjet send failed (${ response.status })`, retryable };
        }
        catch( error ) { return { ok: false, error: String( error ), retryable: true }; }
    }
}

export default MailjetProvider;
// eof

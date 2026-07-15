//
import { Email } from "@repo/api";
import { NetworkUtils } from "@repo/common";

import { EmailProvider, EmailContext, ParsedAddress, parseAddress } from "../EmailProvider";

//
// MailgunProvider — the Mailgun messages adapter (email-3.1). HTTP Basic auth (`api:<key>`), form-encoded body.
// The sending DOMAIN is taken from the From address (so a single API-key secret suffices). Maps the Outbound
// onto Mailgun's form fields and normalizes the reply (`{ id }`); 429/5xx are retryable.
//
export class MailgunProvider implements EmailProvider
{
    public readonly provider : Email.Provider = Email.Provider.MAILGUN;

    private static readonly API_BASE : string = "https://api.mailgun.net/v3";

    ////////////////////////////////////////////////////////////////////////////////////////////
    public async send( outbound : Email.Outbound, ctx : EmailContext ) : Promise<Email.SendResult>
    {
        if( !ctx.apiKey ) return { ok: false, error: "Mailgun API key not configured", retryable: false };

        // the Mailgun domain = the From address's domain
        const from : ParsedAddress = parseAddress( outbound.from );
        const domain : string = from.email.split( "@" )[ 1 ] ?? "";
        if( domain.length === 0 ) return { ok: false, error: "Mailgun: From address has no domain", retryable: false };

        try
        {
            // form-encode the message (Mailgun repeats `to` per recipient)
            const form : URLSearchParams = new URLSearchParams();
            form.set( "from", outbound.from );
            for( const recipient of outbound.to ) form.append( "to", recipient );
            form.set( "subject", outbound.subject );
            if( outbound.html !== undefined ) form.set( "html", outbound.html );
            if( outbound.text !== undefined ) form.set( "text", outbound.text );

            // Basic-authed send to the domain's messages endpoint
            const authorization : string = `Basic ${ Buffer.from( `api:${ ctx.apiKey }` ).toString( "base64" ) }`;
            const response : Response = await fetch( `${ MailgunProvider.API_BASE }/${ domain }/messages`, {
                method:  "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: authorization },
                body:    form.toString(),
            } );

            // 2xx = accepted → pull the message id; else map by status class
            if( response.ok )
            {
                const body : { id? : string } = await response.json() as { id? : string };
                return { ok: true, providerMessageId: body.id };
            }
            const retryable : boolean = response.status === NetworkUtils.Status.TOO_MANY_REQUESTS || response.status >= NetworkUtils.Status.INTERNAL_SERVER_ERROR;
            return { ok: false, error: `Mailgun send failed (${ response.status })`, retryable };
        }
        catch( error ) { return { ok: false, error: String( error ), retryable: true }; }
    }
}

export default MailgunProvider;
// eof

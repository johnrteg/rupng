//
import { Ses } from "@repo/services";
import { Email } from "@repo/api";

//
// EmailProvider — the adapter interface every email transport implements (email-3.1). One interface, many
// ESPs; a concrete adapter maps a rendered, canSend-approved `Email.Outbound` to the vendor's send API and
// normalizes the reply to an `Email.SendResult`. Selected + instantiated by the EmailFactory; the resolved
// credential (Secrets) and the SES facade are injected per-call via `EmailContext` so adapters stay stateless.
//
export interface EmailProvider
{
    /** Which provider this adapter is (the factory key). */
    readonly provider : Email.Provider;

    /** Put one rendered message on the wire. NEVER throws — it returns an `Email.SendResult` whose `retryable`
     *  distinguishes a transient failure (→ retry/DLQ) from a permanent one (email-5.2). */
    send( outbound : Email.Outbound, ctx : EmailContext ) : Promise<Email.SendResult>;
}

/** Per-call context handed to an adapter — the resolved API key (for key-auth ESPs), the region, and the SES
 *  facade (for the IAM-auth SES adapter, which needs no key). */
export interface EmailContext
{
    apiKey? : string;
    region? : string;
    ses?    : Ses;
}

/** A parsed sending identity — `{ email, name? }` from a header string. */
export interface ParsedAddress { email : string; name? : string; }

/** Parse an RFC-ish header value (`"Name" <email>` or a bare `email`) into `{ email, name? }`. `Email.Outbound`
 *  carries `from` as a formatted string; ESPs that want a structured sender use this. */
export function parseAddress( formatted : string ) : ParsedAddress
{
    const match : RegExpExecArray | null = /^\s*"?([^"<]*)"?\s*<([^>]+)>\s*$/.exec( formatted );
    if( match !== null ) return { email: match[ 2 ].trim(), name: match[ 1 ].trim() || undefined };
    return { email: formatted.trim() };
}

export default EmailProvider;
// eof

//
import type { Type } from "@repo/common";
import { Email } from "@repo/api";

import { EmailProvider, EmailContext } from "../EmailProvider";

//
// SesProvider — the Amazon SES adapter (email-3.1). SES authenticates by IAM (the task role), so no API key is
// resolved; the send goes through the `Ses` facade injected on the context. A missing facade is a programmer
// error (the service always injects it) → a non-retryable failure rather than a throw.
//
export class SesProvider implements EmailProvider
{
    public readonly provider : Email.Provider = Email.Provider.SES;

    ////////////////////////////////////////////////////////////////////////////////////////////
    // Map the Outbound onto the SES facade and normalize the Result → SendResult. A facade error is treated as
    // retryable (SES throttling / transient) — the send worker decides retry-vs-DLQ from `retryable`.
    public async send( outbound : Email.Outbound, ctx : EmailContext ) : Promise<Email.SendResult>
    {
        if( ctx.ses === undefined ) return { ok: false, error: "SES facade unavailable", retryable: false };

        // hand the rendered message to SES v2 (bcc is applied by the worker's recipient fan-out, not here)
        const sent : Type.Result<void> = await ctx.ses.send( {
            from:    outbound.from,
            to:      outbound.to,
            subject: outbound.subject,
            html:    outbound.html,
            text:    outbound.text,
        } );
        if( !sent.ok ) return { ok: false, error: sent.error, retryable: true };
        return { ok: true };
    }
}

export default SesProvider;
// eof

//
import { Email } from "@repo/api";
import { NetworkUtils } from "@repo/common";

import { EmailProvider, EmailContext } from "../EmailProvider";

//
// FakeProvider — the adapter for the STANDALONE fake email service (a DEV-ONLY simulated ESP, apps/core/fake-email;
// see apps/core/email/specs/FAKE_PROVIDER.md). It is a thin HTTP client — indistinguishable from a real ESP
// adapter — that POSTs the rendered message to the fake service and normalizes the reply. This exercises the
// full real send path (HTTP call, auth, retry/DLQ, idempotency) offline, unlike an in-process stub.
//
// The base URL defaults to the fake service's local port (Ports.FAKE_EMAIL.MAIN = 9100), overridable via
// `FAKE_EMAIL_URL`. Auth uses the resolved key (per-account fake key) or the well-known default key.
//
export class FakeProvider implements EmailProvider
{
    public readonly provider : Email.Provider = Email.Provider.FAKE;

    // the fake service's send endpoint (its local dev port; env-overridable for a non-default host)
    private static readonly BASE_URL : string = process.env.FAKE_EMAIL_URL ?? "http://localhost:9100";
    // the always-accepted default fake key (mirrors FakeService.DEFAULT_KEY) when no per-account key is resolved
    private static readonly DEFAULT_KEY : string = "0000-00-0000";

    ////////////////////////////////////////////////////////////////////////////////////////////
    // POST the rendered message to the fake ESP and normalize the reply. Never throws (a network error becomes a
    // retryable SendResult) — same contract as every real adapter.
    public async send( outbound : Email.Outbound, ctx : EmailContext ) : Promise<Email.SendResult>
    {
        try
        {
            // build the vendor-shaped payload (the fake service's SendBody = the Outbound shape)
            const payload : Record<string, unknown> =
            {
                from:           outbound.from,
                to:             outbound.to,
                cc:             outbound.cc,
                bcc:            outbound.bcc,
                subject:        outbound.subject,
                html:           outbound.html,
                text:           outbound.text,
                headers:        outbound.headers,
                idempotencyKey: outbound.idempotencyKey,
            };

            // Bearer-authed send (per-account key if resolved, else the well-known default)
            const key : string = ctx.apiKey ?? FakeProvider.DEFAULT_KEY;
            const response : Response = await fetch( `${ FakeProvider.BASE_URL }/v1/messages`, {
                method:  "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${ key }` },
                body:    JSON.stringify( payload ),
            } );

            // 2xx = accepted → pull the message id; else map by status class
            if( response.ok )
            {
                const body : { id? : string } = await response.json() as { id? : string };
                return { ok: true, providerMessageId: body.id };
            }
            const retryable : boolean = response.status === NetworkUtils.Status.TOO_MANY_REQUESTS || response.status >= NetworkUtils.Status.INTERNAL_SERVER_ERROR;
            return { ok: false, error: `fake ESP send failed (${ response.status })`, retryable };
        }
        catch( error )
        {
            // the fake service may be down in dev — a network error is transient (retryable)
            return { ok: false, error: String( error ), retryable: true };
        }
    }
}

export default FakeProvider;
// eof

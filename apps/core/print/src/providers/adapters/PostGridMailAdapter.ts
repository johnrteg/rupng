//
import { Print } from "@repo/api";

import { MailProvider, MailSubmission, MailContext, MailSubmitResult, MailNormalizedTracking } from "../MailProvider";

//
// PostGridMailAdapter — the PostGrid mail-fulfillment adapter (print-3.1). UNVERIFIED at author time (no live
// credential to round-trip against) — the request/response shapes follow PostGrid's documented Postcards/
// Letters REST API; adjust field names once wired to a real sandbox key. `ctx.secret` is the decoded
// `print-postgrid` Secrets Manager entry (`{ apiKey }`).
//
export class PostGridMailAdapter implements MailProvider
{
    public readonly provider : Print.Provider = Print.Provider.POSTGRID;

    private static readonly BASE_URL : string = "https://api.postgrid.com/print-mail/v1";

    ////////////////////////////////////////////////////////////////////////////////////////////
    // POST the mailpiece to PostGrid's postcards/letters endpoint (chosen by `type`) — never throws; a
    // network/HTTP failure is reported as a RETRYABLE result, never surfaced as an exception.
    public async submit( piece : MailSubmission, ctx : MailContext ) : Promise<MailSubmitResult>
    {
        const apiKey : string | undefined = ctx.secret?.apiKey as string | undefined;
        if( apiKey === undefined ) return { ok: false, error: "no PostGrid credential configured", retryable: false };

        const resource : string = piece.type === Print.MailpieceType.LETTER ? "letters" : "postcards";
        try
        {
            const response : Response = await fetch( `${ PostGridMailAdapter.BASE_URL }/${ resource }`, {
                method: "POST",
                headers: { "x-api-key": apiKey, "content-type": "application/json" },
                body: JSON.stringify( {
                    to:   PostGridMailAdapter.toContact( piece.recipient ),
                    from: PostGridMailAdapter.toContact( piece.sender ),
                    pdf:  piece.pdfUrl,
                    mailingClass: piece.mailClass === Print.MailClass.FIRST_CLASS ? "first_class" : "standard_class",
                    metadata: { mailId: piece.mailId },
                } ),
            } );
            const body : { id? : string; message? : string } = await response.json() as { id? : string; message? : string };
            if( !response.ok ) return { ok: false, error: body.message ?? `PostGrid submit failed (${ response.status })`, retryable: response.status >= 500 };
            return { ok: true, providerRefId: body.id };
        }
        catch( error ) { return { ok: false, error: String( error ), retryable: true }; }
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // PostGrid's letter/postcard status vocabulary → our TrackingStatus (see PostGrid's docs for the full set;
    // unmapped statuses fall back to IN_PRODUCTION so an unknown-but-valid event never drops silently).
    public trackingNormalize( payload : Record<string, unknown> ) : MailNormalizedTracking
    {
        const raw : string = String( payload.status ?? payload.type ?? "" ).toLowerCase();
        const status : Print.TrackingStatus = PostGridMailAdapter.STATUS_MAP[ raw ] ?? Print.TrackingStatus.IN_PRODUCTION;
        return {
            mailId:          ( payload.metadata as { mailId? : string } | undefined )?.mailId,
            status,
            occurredAt:      ( payload.updatedAt as string | undefined ) ?? new Date().toISOString(),
            providerEventId: payload.id as string | undefined,
        };
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** PostGrid signs webhooks with an HMAC-SHA256 over the raw body (`x-postgrid-signature`); verification
     *  needs the raw request bytes (see `Webhook.hmacSha256RawBody`) — wired at the service layer, not here,
     *  since this adapter only sees the parsed body. Returns true for now (documented gap — print-3.2). */
    public verifySignature() : boolean { return true; }

    ////////////////////////////////////////////////////////////////////////////////////////////
    private static toContact( address : Print.Address ) : Record<string, unknown>
    {
        return { addressLine1: address.line1, addressLine2: address.line2, city: address.city, provinceOrState: address.region, postalOrZip: address.postalCode, country: address.country, companyName: address.name };
    }

    private static readonly STATUS_MAP : Record<string, Print.TrackingStatus> =
    {
        ready:       Print.TrackingStatus.IN_PRODUCTION,
        printing:    Print.TrackingStatus.IN_PRODUCTION,
        processed_for_delivery: Print.TrackingStatus.MAILED,
        in_transit:  Print.TrackingStatus.IN_TRANSIT,
        in_local_area: Print.TrackingStatus.IN_TRANSIT,
        delivered:   Print.TrackingStatus.DELIVERED,
        returned_to_sender: Print.TrackingStatus.RETURNED,
        cancelled:   Print.TrackingStatus.UNDELIVERABLE,
    };
}

export default PostGridMailAdapter;
// eof

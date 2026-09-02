//
import { Print } from "@repo/api";

import { MailProvider, MailSubmission, MailContext, MailSubmitResult, MailNormalizedTracking } from "../MailProvider";

//
// LobMailAdapter — the Lob mail-fulfillment adapter (print-3.1). UNVERIFIED at author time (no live credential
// to round-trip against) — the request/response shapes follow Lob's documented Postcards/Letters REST API;
// adjust field names once wired to a real sandbox key. `ctx.secret` is the decoded `print-lob` Secrets Manager
// entry (`{ apiKey }`), sent as HTTP Basic per Lob's convention (username = key, no password).
//
export class LobMailAdapter implements MailProvider
{
    public readonly provider : Print.Provider = Print.Provider.LOB;

    private static readonly BASE_URL : string = "https://api.lob.com/v1";

    ////////////////////////////////////////////////////////////////////////////////////////////
    public async submit( piece : MailSubmission, ctx : MailContext ) : Promise<MailSubmitResult>
    {
        const apiKey : string | undefined = ctx.secret?.apiKey as string | undefined;
        if( apiKey === undefined ) return { ok: false, error: "no Lob credential configured", retryable: false };

        const resource : string = piece.type === Print.MailpieceType.LETTER ? "letters" : "postcards";
        try
        {
            const response : Response = await fetch( `${ LobMailAdapter.BASE_URL }/${ resource }`, {
                method: "POST",
                headers: { authorization: `Basic ${ Buffer.from( `${ apiKey }:` ).toString( "base64" ) }`, "content-type": "application/json" },
                body: JSON.stringify( {
                    to:   LobMailAdapter.toAddress( piece.recipient ),
                    from: LobMailAdapter.toAddress( piece.sender ),
                    file: piece.pdfUrl,
                    mail_type: piece.mailClass === Print.MailClass.FIRST_CLASS ? "usps_first_class" : "usps_standard",
                    metadata:  { mailId: piece.mailId },
                } ),
            } );
            const body : { id? : string; error? : { message? : string } } = await response.json() as { id? : string; error? : { message? : string } };
            if( !response.ok ) return { ok: false, error: body.error?.message ?? `Lob submit failed (${ response.status })`, retryable: response.status >= 500 };
            return { ok: true, providerRefId: body.id };
        }
        catch( error ) { return { ok: false, error: String( error ), retryable: true }; }
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // Lob's tracking-event `name` vocabulary → our TrackingStatus.
    public trackingNormalize( payload : Record<string, unknown> ) : MailNormalizedTracking
    {
        const raw : string = String( ( payload.event_type as { name? : string } | undefined )?.name ?? payload.name ?? "" ).toLowerCase();
        const status : Print.TrackingStatus = LobMailAdapter.STATUS_MAP[ raw ] ?? Print.TrackingStatus.IN_PRODUCTION;
        const body : { metadata? : { mailId? : string } } = payload as { metadata? : { mailId? : string } };
        return { mailId: body.metadata?.mailId, status, occurredAt: ( payload.date_created as string | undefined ) ?? new Date().toISOString(), providerEventId: payload.id as string | undefined };
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Lob signs webhooks with an HMAC-SHA256 over `<timestamp>.<raw body>` (`Lob-Signature` +
     *  `Lob-Signature-Timestamp` headers); verification needs the raw request bytes (see `Webhook.
     *  hmacSha256RawBody`) — wired at the service layer, not here. Returns true for now (documented gap —
     *  print-3.2). */
    public verifySignature() : boolean { return true; }

    ////////////////////////////////////////////////////////////////////////////////////////////
    private static toAddress( address : Print.Address ) : Record<string, unknown>
    {
        return { name: address.name, address_line1: address.line1, address_line2: address.line2, address_city: address.city, address_state: address.region, address_zip: address.postalCode, address_country: address.country };
    }

    private static readonly STATUS_MAP : Record<string, Print.TrackingStatus> =
    {
        "postcard.created":            Print.TrackingStatus.IN_PRODUCTION,
        "postcard.rendered_pdf":        Print.TrackingStatus.IN_PRODUCTION,
        "postcard.processed_for_delivery": Print.TrackingStatus.MAILED,
        "postcard.mailed":              Print.TrackingStatus.MAILED,
        "postcard.in_transit":          Print.TrackingStatus.IN_TRANSIT,
        "postcard.in_local_area":       Print.TrackingStatus.IN_TRANSIT,
        "postcard.processed_for_return": Print.TrackingStatus.RETURNED,
        "postcard.re_routed":           Print.TrackingStatus.IN_TRANSIT,
        "postcard.returned_to_sender":  Print.TrackingStatus.RETURNED,
        "postcard.delivered":           Print.TrackingStatus.DELIVERED,
    };
}

export default LobMailAdapter;
// eof

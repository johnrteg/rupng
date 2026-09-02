//
import { Texting } from "@repo/api";

import { SmsProvider, SmsContext } from "../SmsProvider";

//
// TelnyxSmsAdapter — the real Telnyx Messaging v2 adapter (texting-3.1). Bearer-token REST API; a single
// instance serves BOTH `telnyx` and its dupe-account variant `telnyx3` (a distinct API key, same wire
// dialect) — the constructor tags which `Texting.Provider` this instance reports, mirroring
// BandwidthSmsAdapter's *3 pattern.
//
// SIMPLIFICATION (documented, not silent): Telnyx signs webhooks with Ed25519 against a well-known Telnyx
// PUBLIC key, not a per-account shared secret — there's no secret material in `ctx` to verify against, so
// `verifySignature` accepts any request that carries Telnyx's signature headers (fails closed only when
// they're entirely absent). Real Ed25519 verification is a follow-up (needs Telnyx's public key vendored).
//
// `ctx.statusCallbackUrl` is UNUSED here — Telnyx's DLR webhook is configured account-wide on the
// Messaging Profile (Telnyx Portal), not per-message. Paste `TextingService.statusUrl(Texting.Provider.TELNYX)`
// (or `.TELNYX3` for the dupe-account profile) into that Messaging Profile's webhook URL field.
//
export class TelnyxSmsAdapter implements SmsProvider
{
    public readonly provider : Texting.Provider;
    public readonly capabilities : Set<Texting.MessageType> = new Set( [ Texting.MessageType.SMS, Texting.MessageType.MMS, Texting.MessageType.RCS ] );
    // real carousel support (2-10 cards) — the only adapter today `SmsFactory.selectForRcs` can route a
    // multi-card `RcsContent` to.
    public readonly rcsLimits : Texting.RcsLimits = { carousel: true, maxCards: 10 };
    private static readonly API_BASE : string = "https://api.telnyx.com/v2";

    constructor( provider : Texting.Provider = Texting.Provider.TELNYX ) { this.provider = provider; }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public async send( req : Texting.OutboundRequest, ctx : SmsContext ) : Promise<Texting.AdapterSendResult>
    {
        const apiKey : string | undefined = ctx.secret?.apiKey as string | undefined ?? ctx.secret?.value as string | undefined;
        if( !apiKey ) return { ok: false };

        return req.rcsContent !== undefined ? this.sendRcs( req, apiKey, ctx.secret ) : this.sendSms( req, apiKey );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    private async sendSms( req : Texting.OutboundRequest, apiKey : string ) : Promise<Texting.AdapterSendResult>
    {
        try
        {
            const response : Response = await fetch( `${ TelnyxSmsAdapter.API_BASE }/messages`, {
                method:  "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${ apiKey }` },
                body:    JSON.stringify( {
                    to:   req.to,
                    from: req.from,
                    text: req.body,
                    ...( req.mediaUrls && req.mediaUrls.length > 0 ? { media_urls: req.mediaUrls } : {} ),
                } ),
            } );
            const parsed : { data? : { id? : string } } = await response.json() as { data? : { id? : string } };
            if( !response.ok || !parsed.data?.id ) return { ok: false, rawCode: `telnyx send failed (${ response.status })` };
            return { ok: true, messageId: parsed.data.id, segments: 1 };
        }
        catch( error ) { return { ok: false, rawCode: String( error ) }; }
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // build + POST an RCS message against Telnyx's `/v2/messages/rcs` endpoint. Needs TWO fields the
    // plain SMS credential never carried — `rcsAgentId` (the approved RCS agent) and `messagingProfileId`
    // (a messaging profile with RCS enabled) — both read from the SAME resolved secret, so an account that
    // hasn't provisioned an RCS agent yet just fails this send (`ok:false`) rather than silently degrading.
    // A single card sends as a `standalone_card`; TWO OR MORE (`RcsContent.cards`, min 2 per Telnyx) send as
    // a real `carousel_card` — unlike Infobip/Vonage above, Telnyx's carousel shape is verified (GSMA RBM
    // vocabulary), so this is a genuine carousel, not a first-card fallback.
    private async sendRcs( req : Texting.OutboundRequest, apiKey : string, secret : Record<string, unknown> | undefined ) : Promise<Texting.AdapterSendResult>
    {
        const agentId : string | undefined = secret?.rcsAgentId as string | undefined;
        const messagingProfileId : string | undefined = secret?.messagingProfileId as string | undefined;
        if( !agentId || !messagingProfileId ) return { ok: false, rawCode: "telnyx rcs send failed (no rcsAgentId/messagingProfileId configured)" };

        const rcs : Texting.RcsContent = req.rcsContent as Texting.RcsContent;
        const cards : Array<Texting.RcsCard> = rcs.cards ?? [ rcs ];
        const toContent : ( card : Texting.RcsCard ) => Record<string, unknown> = ( card : Texting.RcsCard ) : Record<string, unknown> => TelnyxSmsAdapter.toCardContent( card, req.body );
        const contentMessage : Record<string, unknown> = cards.length >= 2
            ? { rich_card: { carousel_card: { card_width: "MEDIUM", card_contents: cards.map( toContent ) } } }
            : ( cards[ 0 ].title !== undefined || cards[ 0 ].mediaUrl !== undefined
                ? { rich_card: { standalone_card: { card_orientation: "VERTICAL", card_content: toContent( cards[ 0 ] ) } } }
                : { text: req.body ?? "" } );

        try
        {
            const response : Response = await fetch( `${ TelnyxSmsAdapter.API_BASE }/messages/rcs`, {
                method:  "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${ apiKey }` },
                body:    JSON.stringify( {
                    agent_id: agentId, to: req.to, messaging_profile_id: messagingProfileId,
                    agent_message: { content_message: contentMessage },
                    ...( req.body ? { fallback: { from: req.from, text: req.body } } : {} ),
                } ),
            } );
            const parsed : { data? : { id? : string } } = await response.json() as { data? : { id? : string } };
            if( !response.ok || !parsed.data?.id ) return { ok: false, rawCode: `telnyx rcs send failed (${ response.status })` };
            return { ok: true, messageId: parsed.data.id, segments: 1 };
        }
        catch( error ) { return { ok: false, rawCode: String( error ) }; }
    }

    // one `card_content` entry (standalone or carousel) — title/media + the suggestions chip row. Our
    // `RcsCard` model has no PER-CARD description, only the request's overall `body` fallback text, which
    // becomes every card's `description` (a real limitation for a multi-card carousel, not a bug).
    private static toCardContent( card : Texting.RcsCard, body : string | undefined ) : Record<string, unknown>
    {
        return {
            title:       card.title,
            description: body,
            ...( card.mediaUrl ? { media: { height: "MEDIUM", content_info: { file_url: card.mediaUrl } } } : {} ),
            suggestions: TelnyxSmsAdapter.toSuggestions( card ),
        };
    }

    // Telnyx's `suggestions` chip row (GSMA RBM vocabulary): a REPLY echoes its own text back as
    // `postback_data`; a suggested action with a `url` becomes an `open_url_action` chip.
    private static toSuggestions( card : Texting.RcsCard ) : Array<Record<string, unknown>>
    {
        const replies : Array<Record<string, unknown>> = ( card.suggestedReplies ?? [] ).map(
            ( text : string ) : Record<string, unknown> => ( { reply: { text, postback_data: text } } ) );
        const actions : Array<Record<string, unknown>> = ( card.suggestedActions ?? [] )
            .filter( ( action : { text: string; url?: string } ) : boolean => action.url !== undefined )
            .map( ( action : { text: string; url?: string } ) : Record<string, unknown> =>
                ( { action: { text: action.text, open_url_action: { url: action.url } } } ) );
        return [ ...replies, ...actions ];
    }

    // Telnyx's numeric error `code` (in each `errors[]` entry) → the platform's normalized `ErrCode`
    // (texting-6.5). Starter set; an unmapped code still surfaces via `providerCode` for the operator.
    private static readonly ERR_CODE_MAP : Record<string, Texting.ErrCode> =
    {
        "40001": Texting.ErrCode.BAD,            // invalid "to" number
        "40300": Texting.ErrCode.DEACT,          // number not found / deactivated
        "40310": Texting.ErrCode.LANDLINE,       // destination is not SMS-capable
        "10001": Texting.ErrCode.TEMP,           // internal/transient send failure
    };

    ////////////////////////////////////////////////////////////////////////////////////////////
    // Telnyx's webhook envelope wraps the actual event under `data.event_type` / `data.payload` (texting-3.3 UDF).
    public normalizeStatus( payload : Record<string, unknown> ) : Texting.NormalizedEvent
    {
        const data : Record<string, unknown> = ( payload.data as Record<string, unknown> ) ?? payload;
        const messagePayload : Record<string, unknown> = ( data.payload as Record<string, unknown> ) ?? {};
        const eventType : string = String( data.event_type ?? "" );

        const MAP : Record<string, Texting.DeliveryStatus> =
        {
            "message.queued":    Texting.DeliveryStatus.QUEUED,
            "message.sent":      Texting.DeliveryStatus.SENT,
            "message.finalized": Texting.DeliveryStatus.DELIVERED,
        };
        const errors : Array<{ code? : string }> = ( messagePayload.errors as Array<{ code? : string }> ) ?? [];
        const status : Texting.DeliveryStatus = errors.length > 0 ? Texting.DeliveryStatus.FAILED : ( MAP[ eventType ] ?? Texting.DeliveryStatus.UNKNOWN );
        const rawCode : string | undefined = errors[ 0 ]?.code !== undefined ? String( errors[ 0 ].code ) : undefined;

        return {
            kind:               "dlr",
            from:               String( ( messagePayload.from as { phone_number? : string } )?.phone_number ?? "" ),
            to:                 String( ( ( messagePayload.to as Array<{ phone_number? : string }> )?.[ 0 ] )?.phone_number ?? "" ),
            providerMessageId:  messagePayload.id !== undefined ? String( messagePayload.id ) : undefined,
            status,
            errCode:            rawCode !== undefined ? TelnyxSmsAdapter.ERR_CODE_MAP[ rawCode ] : undefined,
            providerCode:       rawCode,   // verbatim Telnyx code, even when it didn't map to an ErrCode
            receivedAt:         new Date().toISOString(),
        };
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public verifySignature( headers : Record<string, string | undefined> ) : boolean
    {
        return headers[ "telnyx-signature-ed25519" ] !== undefined && headers[ "telnyx-timestamp" ] !== undefined;
    }
}

export default TelnyxSmsAdapter;
// eof

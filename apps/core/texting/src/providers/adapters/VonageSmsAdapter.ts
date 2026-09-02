//
import { Texting } from "@repo/api";

import { SmsProvider, SmsContext } from "../SmsProvider";

//
// VonageSmsAdapter — the real Vonage (Nexmo) SMS API adapter (texting-3.1) PLUS RCS Business Messaging
// via the newer Messages API. `api_key`/`api_secret` are query/form params for the legacy SMS API's own
// convention; the newer Messages API (RCS) reuses that same pair as HTTP Basic auth.
//
// SIMPLIFICATION: Vonage's delivery-receipt webhook supports an OPTIONAL signed-JWT scheme that isn't wired
// up here — `verifySignature` accepts unconditionally, a documented gap (same posture as Sinch's).
//
// SIMPLIFICATION (RCS auth): Vonage's RECOMMENDED Messages-API auth is a per-application JWT (private key +
// application id) — that also unlocks app-level features (its own webhooks, Secure Inbound Media). This
// adapter instead reuses the account-level `apiKey`/`apiSecret` as HTTP Basic auth (Vonage's documented
// alternative), so RCS shares the ONE credential the SMS path already resolves — a deliberate simplification,
// not a silent gap. Move to JWT/application-id if a future need (per-app webhooks, richer ACLs) requires it.
//
export class VonageSmsAdapter implements SmsProvider
{
    public readonly provider : Texting.Provider = Texting.Provider.VONAGE;
    public readonly capabilities : Set<Texting.MessageType> = new Set( [ Texting.MessageType.SMS, Texting.MessageType.MMS, Texting.MessageType.RCS ] );
    // carousel:false — same first-card fallback as Infobip (see `sendRcs`); maxSuggestions matches
    // Vonage's documented 4-suggestion cap on a standalone rich card.
    public readonly rcsLimits : Texting.RcsLimits = { carousel: false, maxSuggestions: 4 };
    private static readonly MESSAGES_API_BASE : string = "https://api.nexmo.com/v1/messages";

    // Vonage's numeric SMS `err-code` → the platform's normalized `ErrCode` (texting-6.5). Starter set; an
    // unmapped code still surfaces via `providerCode` for the operator.
    private static readonly ERR_CODE_MAP : Record<string, Texting.ErrCode> =
    {
        "1":  Texting.ErrCode.TEMP,           // throttled — transient
        "6":  Texting.ErrCode.BAD,            // invalid message / bad destination
        "9":  Texting.ErrCode.OVER_CAPACITY,   // partner quota exceeded
        "15": Texting.ErrCode.INVALID,        // invalid sender address (bench the sending number)
        "29": Texting.ErrCode.DND,            // non-whitelisted destination (opted out in sandbox)
    };

    ////////////////////////////////////////////////////////////////////////////////////////////
    public async send( req : Texting.OutboundRequest, ctx : SmsContext ) : Promise<Texting.AdapterSendResult>
    {
        const secret : VonageCredential | undefined = ctx.secret as VonageCredential | undefined;
        if( !secret?.apiKey || !secret.apiSecret ) return { ok: false };

        return req.rcsContent !== undefined ? this.sendRcs( req, secret ) : this.sendSms( req, secret, ctx.statusCallbackUrl );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    private async sendSms( req : Texting.OutboundRequest, secret : VonageCredential, statusCallbackUrl : string | undefined ) : Promise<Texting.AdapterSendResult>
    {
        try
        {
            const form : URLSearchParams = new URLSearchParams( {
                api_key: secret.apiKey, api_secret: secret.apiSecret,
                to: req.to, from: req.from, text: req.body ?? "",
                ...( statusCallbackUrl ? { callback: statusCallbackUrl } : {} ),
            } );
            const response : Response = await fetch( "https://rest.nexmo.com/sms/json", {
                method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form.toString(),
            } );
            const parsed : { messages? : Array<{ status? : string; ["message-id"]? : string; ["error-text"]? : string }> } =
                await response.json() as { messages? : Array<{ status? : string; ["message-id"]? : string; ["error-text"]? : string }> };
            const message : { status? : string; ["message-id"]? : string } | undefined = parsed.messages?.[ 0 ];
            if( !response.ok || message?.status !== "0" || !message[ "message-id" ] )
                return { ok: false, rawCode: `vonage send failed (status ${ message?.status ?? response.status })` };
            return { ok: true, messageId: message[ "message-id" ], segments: 1 };
        }
        catch( error ) { return { ok: false, rawCode: String( error ) }; }
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // build + POST an RCS message against Vonage's Messages API (`message_type: "text"` for a plain
    // body, `"custom"` wrapping a `richCard.standaloneCard` for a titled/media card). A `RcsContent.cards`
    // carousel isn't sent as a real Vonage carousel yet — same documented fallback as Infobip: send
    // the FIRST card only, rather than guess at Vonage's (unverified in this adapter) carousel wire shape.
    private async sendRcs( req : Texting.OutboundRequest, secret : VonageCredential ) : Promise<Texting.AdapterSendResult>
    {
        const rcs : Texting.RcsContent = req.rcsContent as Texting.RcsContent;
        const card : Texting.RcsCard = rcs.cards?.[ 0 ] ?? rcs;
        const isCard : boolean = card.title !== undefined || card.mediaUrl !== undefined;

        const body : Record<string, unknown> = {
            to: req.to, from: req.from, channel: "rcs",
            ...( isCard
                ? { message_type: "custom", custom: { contentMessage: { richCard: { standaloneCard: {
                    cardOrientation: "VERTICAL",
                    cardContent: {
                        title:       card.title,
                        description: req.body,
                        ...( card.mediaUrl ? { media: { height: "MEDIUM", contentInfo: { fileUrl: card.mediaUrl } } } : {} ),
                        suggestions: VonageSmsAdapter.toSuggestions( card ),
                    },
                } } } } }
                : { message_type: "text", text: req.body ?? "" } ),
        };

        try
        {
            const auth : string = Buffer.from( `${ secret.apiKey }:${ secret.apiSecret }` ).toString( "base64" );
            const response : Response = await fetch( VonageSmsAdapter.MESSAGES_API_BASE, {
                method:  "POST",
                headers: { "Content-Type": "application/json", Authorization: `Basic ${ auth }` },
                body:    JSON.stringify( body ),
            } );
            const parsed : { message_uuid? : string } = await response.json() as { message_uuid? : string };
            if( !response.ok || !parsed.message_uuid ) return { ok: false, rawCode: `vonage rcs send failed (${ response.status })` };
            return { ok: true, messageId: parsed.message_uuid, segments: 1 };
        }
        catch( error ) { return { ok: false, rawCode: String( error ) }; }
    }

    // Vonage's `suggestions` chip row mirrors the GSMA RCS vocabulary: a REPLY echoes its own text back
    // as `postbackData`; a suggested action with a `url` becomes an `openUrlAction` chip.
    private static toSuggestions( card : Texting.RcsCard ) : Array<Record<string, unknown>>
    {
        const replies : Array<Record<string, unknown>> = ( card.suggestedReplies ?? [] ).map(
            ( text : string ) : Record<string, unknown> => ( { reply: { text, postbackData: text } } ) );
        const actions : Array<Record<string, unknown>> = ( card.suggestedActions ?? [] )
            .filter( ( action : { text: string; url?: string } ) : boolean => action.url !== undefined )
            .map( ( action : { text: string; url?: string } ) : Record<string, unknown> =>
                ( { action: { text: action.text, postbackData: action.text, openUrlAction: { url: action.url } } } ) );
        return [ ...replies, ...actions ];
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // handles BOTH the legacy SMS API's DLR shape (`messageId`/`err-code`) and the newer Messages-API
    // shape RCS DLRs arrive in (`message_uuid`, `status: "submitted"|"delivered"|"read"|"failed"|"rejected"`).
    public normalizeStatus( payload : Record<string, unknown> ) : Texting.NormalizedEvent
    {
        const rawCode : string | undefined = payload[ "err-code" ] !== undefined ? String( payload[ "err-code" ] ) : undefined;
        const MAP : Record<string, Texting.DeliveryStatus> =
        {
            delivered: Texting.DeliveryStatus.DELIVERED, accepted: Texting.DeliveryStatus.SENT,
            buffered: Texting.DeliveryStatus.QUEUED, failed: Texting.DeliveryStatus.FAILED, rejected: Texting.DeliveryStatus.UNDELIVERED,
            expired: Texting.DeliveryStatus.FAILED, unknown: Texting.DeliveryStatus.UNKNOWN,
            submitted: Texting.DeliveryStatus.SENT, read: Texting.DeliveryStatus.DELIVERED, // Messages-API (RCS) vocabulary
        };
        const providerMessageId : string | undefined = payload.messageId !== undefined
            ? String( payload.messageId )
            : ( payload.message_uuid !== undefined ? String( payload.message_uuid ) : undefined );
        return {
            kind:               "dlr",
            from:               String( payload.from ?? "" ),
            to:                 String( payload.to ?? "" ),
            providerMessageId,
            status:             MAP[ String( payload.status ?? "" ) ] ?? Texting.DeliveryStatus.UNKNOWN,
            errCode:            rawCode !== undefined ? VonageSmsAdapter.ERR_CODE_MAP[ rawCode ] : undefined,
            providerCode:       rawCode,   // verbatim Vonage err-code, even when it didn't map to an ErrCode
            receivedAt:         new Date().toISOString(),
        };
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public verifySignature() : boolean { return true; }
}

/** Vonage's stored secret shape — `{apiKey, apiSecret}`. */
interface VonageCredential { apiKey : string; apiSecret : string; }

export default VonageSmsAdapter;
// eof

//
import { Texting } from "@repo/api";

import { SmsProvider, SmsContext } from "../SmsProvider";

//
// InfobipSmsAdapter — the real Infobip SMS Advanced (v2) + RCS Business Messaging adapter (texting-3.1).
// `App <key>` auth against the ACCOUNT-SPECIFIC base URL Infobip assigns per customer (there's no shared
// api.infobip.com host, so `baseUrl` is part of the credential, not hardcoded).
//
// SIMPLIFICATION: Infobip's delivery-report webhook has no standard HMAC signature in this platform's
// integration — `verifySignature` accepts unconditionally, a documented gap (same posture as Broadnet's).
//
// RCS scope (texting-model rcs sketch): a single TEXT or rich CARD message via Infobip's
// `/ott/rcs/1/message` endpoint — verified against Infobip's published schema. A `RcsContent.cards`
// carousel is NOT sent as a real carousel yet: Infobip's carousel schema lives on a different bulk
// endpoint (`/rcs/2/messages`, `content.type: "CAROUSEL"`) with a distinct request shape this adapter
// hasn't been verified against, so a carousel request falls back to sending its FIRST card as a single
// CARD rather than guessing at an unverified wire format.
//
export class InfobipSmsAdapter implements SmsProvider
{
    public readonly provider : Texting.Provider = Texting.Provider.INFOBIP;
    public readonly capabilities : Set<Texting.MessageType> = new Set( [ Texting.MessageType.SMS, Texting.MessageType.MMS, Texting.MessageType.RCS ] );
    // carousel:false — a multi-card request sends only its first card (see the class header) — so
    // `SmsFactory.selectForRcs` skips Infobip whenever a request actually needs a carousel.
    public readonly rcsLimits : Texting.RcsLimits = { carousel: false };

    ////////////////////////////////////////////////////////////////////////////////////////////
    public async send( req : Texting.OutboundRequest, ctx : SmsContext ) : Promise<Texting.AdapterSendResult>
    {
        const secret : InfobipCredential | undefined = ctx.secret as InfobipCredential | undefined;
        if( !secret?.apiKey || !secret.baseUrl ) return { ok: false };

        return req.rcsContent !== undefined
            ? this.sendRcs( req, secret, ctx.statusCallbackUrl )
            : this.sendSms( req, secret, ctx.statusCallbackUrl );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    private async sendSms( req : Texting.OutboundRequest, secret : InfobipCredential, statusCallbackUrl : string | undefined ) : Promise<Texting.AdapterSendResult>
    {
        try
        {
            const response : Response = await fetch( `https://${ secret.baseUrl }/sms/2/text/advanced`, {
                method:  "POST",
                headers: { "Content-Type": "application/json", Authorization: `App ${ secret.apiKey }` },
                body:    JSON.stringify( { messages: [ {
                    from: req.from, destinations: [ { to: req.to } ], text: req.body,
                    ...( statusCallbackUrl ? { notifyUrl: statusCallbackUrl, notifyContentType: "application/json" } : {} ),
                } ] } ),
            } );
            const parsed : { messages? : Array<{ messageId? : string; status? : { groupName? : string } }> } =
                await response.json() as { messages? : Array<{ messageId? : string; status? : { groupName? : string } }> };
            const message : { messageId? : string; status? : { groupName? : string } } | undefined = parsed.messages?.[ 0 ];
            if( !response.ok || !message?.messageId ) return { ok: false, rawCode: `infobip send failed (${ response.status })` };
            return { ok: true, messageId: message.messageId, segments: 1 };
        }
        catch( error ) { return { ok: false, rawCode: String( error ) }; }
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // build + POST a single RCS message (TEXT if no title/media, otherwise a rich CARD) against
    // Infobip's `/ott/rcs/1/message` endpoint. `req.body` is the TEXT/CARD-description fallback text.
    private async sendRcs( req : Texting.OutboundRequest, secret : InfobipCredential, statusCallbackUrl : string | undefined ) : Promise<Texting.AdapterSendResult>
    {
        const rcs : Texting.RcsContent = req.rcsContent as Texting.RcsContent;
        const card : Texting.RcsCard = rcs.cards?.[ 0 ] ?? rcs;
        const suggestions : Array<InfobipRcsSuggestion> = InfobipSmsAdapter.toSuggestions( card );
        const isCard : boolean = card.title !== undefined || card.mediaUrl !== undefined;

        const content : Record<string, unknown> = isCard
            ? {
                type: "CARD",
                content: {
                    title:       card.title,
                    description: req.body,
                    ...( card.mediaUrl ? { media: { file: { url: card.mediaUrl } } } : {} ),
                },
                suggestions,
            }
            : { type: "TEXT", text: req.body ?? "", suggestions };

        try
        {
            const response : Response = await fetch( `https://${ secret.baseUrl }/ott/rcs/1/message`, {
                method:  "POST",
                headers: { "Content-Type": "application/json", Authorization: `App ${ secret.apiKey }` },
                body:    JSON.stringify( {
                    from: req.from, to: req.to, content,
                    ...( statusCallbackUrl ? { notifyUrl: statusCallbackUrl } : {} ),
                } ),
            } );
            const parsed : { messages? : Array<{ messageId? : string }> } = await response.json() as { messages? : Array<{ messageId? : string }> };
            const message : { messageId? : string } | undefined = parsed.messages?.[ 0 ];
            if( !response.ok || !message?.messageId ) return { ok: false, rawCode: `infobip rcs send failed (${ response.status })` };
            return { ok: true, messageId: message.messageId, segments: 1 };
        }
        catch( error ) { return { ok: false, rawCode: String( error ) }; }
    }

    // Infobip's `suggestions` chip row: a suggested REPLY echoes its own text back as `postbackData`;
    // a suggested action with a `url` becomes an OPEN_URL chip (the only action kind our model carries today).
    private static toSuggestions( card : Texting.RcsCard ) : Array<InfobipRcsSuggestion>
    {
        const replies : Array<InfobipRcsSuggestion> = ( card.suggestedReplies ?? [] ).map(
            ( text : string ) : InfobipRcsSuggestion => ( { type: "REPLY", text, postbackData: text } ) );
        const actions : Array<InfobipRcsSuggestion> = ( card.suggestedActions ?? [] )
            .filter( ( action : { text: string; url?: string } ) : boolean => action.url !== undefined )
            .map( ( action : { text: string; url?: string } ) : InfobipRcsSuggestion => ( { type: "OPEN_URL", text: action.text, postbackData: action.text, url: action.url } ) );
        return [ ...replies, ...actions ];
    }

    // Infobip's `status.name` (the fine-grained reason under a `groupName` bucket) → the platform's
    // normalized `ErrCode` (texting-6.5). Starter set; an unmapped name still surfaces via `providerCode`.
    private static readonly ERR_CODE_MAP : Record<string, Texting.ErrCode> =
    {
        REJECTED_NOT_ENOUGH_CREDITS:      Texting.ErrCode.OVER_CAPACITY,
        REJECTED_DESTINATION_UNKNOWN:     Texting.ErrCode.BAD,
        REJECTED_NETWORK:                 Texting.ErrCode.NOCARRIER,
        UNDELIVERABLE_REJECTED_OPERATOR:  Texting.ErrCode.SPAM,
        EXPIRED:                          Texting.ErrCode.TEMP,
    };

    ////////////////////////////////////////////////////////////////////////////////////////////
    public normalizeStatus( payload : Record<string, unknown> ) : Texting.NormalizedEvent
    {
        const result : Record<string, unknown> = ( ( payload.results as Array<Record<string, unknown>> ) ?? [] )[ 0 ] ?? payload;
        const status : Record<string, unknown> = ( result.status as Record<string, unknown> ) ?? {};
        const rawName : string | undefined = status.name !== undefined ? String( status.name ) : undefined;

        const MAP : Record<string, Texting.DeliveryStatus> =
        {
            PENDING: Texting.DeliveryStatus.QUEUED, DELIVERED: Texting.DeliveryStatus.DELIVERED,
            UNDELIVERABLE: Texting.DeliveryStatus.UNDELIVERED, REJECTED: Texting.DeliveryStatus.FAILED, EXPIRED: Texting.DeliveryStatus.FAILED,
        };

        return {
            kind:               "dlr",
            from:               String( result.from ?? "" ),
            to:                 String( result.to ?? "" ),
            providerMessageId:  result.messageId !== undefined ? String( result.messageId ) : undefined,
            status:             MAP[ String( status.groupName ?? "" ) ] ?? Texting.DeliveryStatus.UNKNOWN,
            errCode:            rawName !== undefined ? InfobipSmsAdapter.ERR_CODE_MAP[ rawName ] : undefined,
            providerCode:       rawName,   // verbatim Infobip status name, even when it didn't map to an ErrCode
            receivedAt:         new Date().toISOString(),
        };
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public verifySignature() : boolean { return true; }
}

/** Infobip's stored secret shape — `{apiKey, baseUrl}` (the account's own `<name>.api.infobip.com` host). */
interface InfobipCredential { apiKey : string; baseUrl : string; }

/** One entry of an RCS message's `suggestions` chip row (`/ott/rcs/1/message`). */
interface InfobipRcsSuggestion { type : "REPLY" | "OPEN_URL"; text : string; postbackData : string; url? : string; }

export default InfobipSmsAdapter;
// eof

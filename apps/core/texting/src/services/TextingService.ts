//
import { randomUUID } from "node:crypto";

import { Application, Service, Ports, Register, Dynamo, Sqs, Kafka, Secrets, Webhook } from "@repo/services";
import { Events } from "@repo/system";
import { Texting, TextingConfig, Analytics } from "@repo/api";
import { ObjectUtils } from "@repo/common";
import type { Type } from "@repo/common";

import { SmsFactory } from "../providers/SmsFactory";
import { SmsProvider, SmsContext } from "../providers/SmsProvider";
import { ContactClient } from "../clients/ContactClient";

//
// TextingService — the texting domain's Service BASE (not deployed alone). Holds the shared domain
// wiring (Dynamo + SQS + Kafka + Secrets facades, the adapter factory, the contact client, the runtime
// config reader) so the concrete role (TextingMainService) inherits it. Owns the send-log store and the
// SEND + DLR workers (fan out per message: resolve contact's phone → adapter.send → log → emit), run off
// the request path via the texting-send / texting-dlr queues.
//
// Real CPaaS adapters: Twilio, Telnyx(3), Bandwidth(3), Broadnet, Infobip, SignalWire, Sinch, Vonage,
// plus FAKE (`SmsFactory`) — selected via `TextingConfig.defaultProvider` (config/settings, no redeploy),
// its credential resolved per-send from Secrets Manager by the config entry's `secretRef` (mirrors
// EmailService/VoiceService's own `providerContext` pattern).
//
// MVP cut (documented, not silently scoped down — see SPECS.md gap register): no number routing/
// sticky-number binding (a fixed placeholder `from`) or per-account provider override — one
// `defaultProvider` serves every send. No rate gating, no opt-out/suppression enforcement, no
// inbound/conversation store, no P2P workflow, no drip/surveys. This mirrors print's and email's own
// "scaffold" cut — a real, working send→DLR→analytics path, not the full spec.
//
export class TextingService extends Service
{
    private _dynamo?  : Dynamo;
    private _sqs?     : Sqs;
    private _kafka?   : Kafka;
    private _secrets? : Secrets;
    private _contact? : ContactClient;

    /** The transport-adapter registry (FAKE + the real CPaaS adapters). */
    protected readonly providers : SmsFactory = new SmsFactory();

    // MVP placeholder sending number — number routing/binding (texting-4.x) isn't built yet.
    private static readonly PLACEHOLDER_FROM : Type.PhoneE164 = "+15550000000";

    ////////////////////////////////////////////////////////////////////////////////////////////
    constructor( role : TextingService.Role )
    {
        super( Register.Service.TEXTING, role, TextingService.PORT[ role ] );
        const pkg : Application.PackageInfo = this.loadPackageInfo( __dirname );
        this.setVersion( pkg.version );
        this.log.info( "version", { name: pkg.name, version: pkg.version } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public get dynamo() : Dynamo { return this._dynamo ??= new Dynamo( this.cloud ); }
    public get sqs() : Sqs { return this._sqs ??= new Sqs( this.cloud ); }
    public get kafka() : Kafka { return this._kafka ??= new Kafka( this.cloud ); }
    /** Secrets facade — provider API keys (resolved by the config's `secretRef`). Lazy + cached. */
    public get secrets() : Secrets { return this._secrets ??= new Secrets( this.cloud ); }
    public get contact() : ContactClient { return this._contact ??= new ContactClient(); }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Seed the runtime config on a fresh environment so the service (and the Console Config tab) have
     *  usable defaults from first boot. */
    protected override async init() : Promise<void>
    {
        super.init();
        const seeded : Type.Result<TextingConfig.Config> = await this.appConfig.ensureSeeded( "config", "settings", TextingConfig.DEFAULT );
        if( seeded.ok ) this.log.info( "texting config ready" );
        else this.log.warn( "texting config seed failed — using DEFAULT until deployed", { error: seeded.error } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** The live runtime config (AppConfig config/settings), deep-filled from DEFAULT so an older/partial
     *  hosted row tolerates schema drift. Exposed so endpoint impls (which can't reach the protected
     *  `appConfig`) read the provider policy. */
    public async textingConfig() : Promise<TextingConfig.Config>
    {
        const got : Type.Result<TextingConfig.Config | undefined> = await this.appConfig.json<TextingConfig.Config>( "config", "settings" );
        this.log.trace( "config read: config/settings", { found: got.ok && got.data !== undefined } );
        return got.ok && got.data ? ObjectUtils.withDefaults( got.data, TextingConfig.DEFAULT ) : TextingConfig.DEFAULT;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** The `Webhook` helper (`packages/services/src/Webhook.ts`), configured for ONE provider's signature
     *  scheme — built fresh per call (cheap) rather than cached, since the provider varies per inbound
     *  request. `this.cloud` is `protected` (on `Application`), so endpoint impls — which aren't `Service`
     *  subclasses — go through this method rather than reaching it directly. */
    public webhookFor( provider : Texting.Provider ) : Webhook
    {
        return new Webhook( this.cloud, {
            auth: { verify: ( request : Webhook.Request ) : Promise<boolean> => this.verifyWebhook( provider, request.headers, request.url, request.body as Record<string, unknown> ) },
            log: this.log,
        } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Verify a provider webhook's signature — resolves the adapter + credential, delegates to
     *  `SmsProvider.verifySignature`. Fails closed (false) when the provider/adapter can't be resolved. */
    public async verifyWebhook( provider : Texting.Provider, headers : Record<string, string | undefined>, url : string, body : Record<string, unknown> ) : Promise<boolean>
    {
        const adapter : SmsProvider | undefined = this.providers.get( provider );
        if( adapter === undefined ) return false;
        const config : TextingConfig.Config = await this.textingConfig();
        const context : SmsContext = await this.providerContext( provider, config );
        return adapter.verifySignature( headers, url, body, context );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Enqueue a send (the endpoint's fast path). */
    public async enqueueSend( request : Texting.SendRequest ) : Promise<Type.Result<void>>
    {
        return this.sqs.send( "texting-send", request );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** WORKER: resolve the contact's phone → adapter.send (the config's `defaultProvider`) → write the
     *  send-log row → emit an engagement event. Never throws. */
    public async processSend( request : Texting.SendRequest ) : Promise<void>
    {
        const resolved : Type.Result<string | undefined> = await this.contact.resolvePhone( request.accountId, request.contactId );
        const to : string | undefined = resolved.ok ? resolved.data : undefined;
        if( !to )
        {
            this.log.warn( "send aborted — contact phone unresolved", { accountId: request.accountId, contactId: request.contactId } );
            return;
        }

        const config : TextingConfig.Config = await this.textingConfig();
        // an RCS request routes to whichever ENABLED provider can actually carry it (capability + rcsLimits
        // — carousel support, card/suggestion caps); falls back to `defaultProvider` when none qualify, same
        // as a plain SMS send (texting-model rcs sketch).
        const providerId : Texting.Provider = ( request.rcsContent !== undefined ? this.providers.selectForRcs( request.rcsContent, config ) : undefined ) ?? config.defaultProvider;
        const adapter : SmsProvider | undefined = this.providers.get( providerId );
        if( adapter === undefined ) { this.log.warn( "send aborted — no adapter", { provider: providerId } ); return; }
        const context : SmsContext = await this.providerContext( providerId, config );

        // a campaign's number-selection (ALL/AREA_CODE/SINGLE), synced from registration via
        // RegistrationSyncConsumer — falls back to the placeholder when the campaign hasn't synced yet, isn't
        // ACTIVE, or has no eligible number (texting-4.10; never blocks the send on a routing miss).
        const resolvedFrom : Type.PhoneE164 | undefined = request.campaignId !== undefined ? await this.resolveFromNumber( request.accountId, request.campaignId ) : undefined;
        const from : Type.PhoneE164 = resolvedFrom ?? TextingService.PLACEHOLDER_FROM;
        this.log.trace( "from-number resolved", { accountId: request.accountId, campaignId: request.campaignId, from, placeholder: resolvedFrom === undefined } );

        // RCS only goes out if the resolved adapter has actually wired up the channel (`capabilities`) —
        // otherwise this silently falls back to the plain SMS `body` below, same as an unreachable-RCS-device fallback.
        const sendRcs : boolean = request.rcsContent !== undefined && adapter.capabilities.has( Texting.MessageType.RCS );
        const type : Texting.MessageType = sendRcs
            ? Texting.MessageType.RCS
            : ( request.mediaKeys !== undefined && request.mediaKeys.length > 0 ? Texting.MessageType.MMS : Texting.MessageType.SMS );

        const outbound : Texting.OutboundRequest = {
            from, to, body: request.body, idempotencyKey: request.idempotencyKey,
            rcsContent: sendRcs ? request.rcsContent : undefined,
        };
        const result : Texting.AdapterSendResult = await adapter.send( outbound, context );
        const status : Texting.DeliveryStatus = result.ok ? Texting.DeliveryStatus.SENT : Texting.DeliveryStatus.FAILED;

        const message : Texting.Message = await this.writeLog( request, to, providerId, status, result, type, from );
        await this.emitEngagementEvent( message );
        if( result.ok ) this.log.info( "sms sent", { accountId: request.accountId, provider: providerId, to, messageId: result.messageId } );
        else this.log.warn( "sms send failed", { accountId: request.accountId, provider: providerId, to, error: result.rawCode } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Resolve a real `from` for a campaign send from its synced number-selection (texting-4.10) — reads the
     *  `campaigns` row `RegistrationSyncConsumer` synced from `registration.campaign`, then the account's
     *  `numbers` candidates for that campaign, and applies ALL/AREA_CODE/SINGLE. Picks RANDOMLY among what's
     *  eligible — no persistent round-robin cursor or sticky-reply pinning yet (`Texting.NumberUsage` is
     *  modeled but unused); a documented simplification, not a silent one. Returns undefined (→ the caller
     *  falls back to `PLACEHOLDER_FROM`) when the campaign hasn't synced, isn't ACTIVE, or has nothing eligible. */
    private async resolveFromNumber( accountId : string, campaignId : string ) : Promise<Type.PhoneE164 | undefined>
    {
        const campaign : Type.Result<TextingService.CampaignRow | undefined> = await this.dynamo.get<TextingService.CampaignRow>( "campaigns", { accountId, campaignId } );
        if( !campaign.ok || campaign.data === undefined || !campaign.data.active || campaign.data.numberSelection === undefined ) return undefined;

        const numbers : Type.Result<Array<Texting.NumberRecord>> = await this.dynamo.query<Texting.NumberRecord>( "numbers", {
            KeyConditionExpression: "accountId = :a", ExpressionAttributeValues: { ":a": accountId },
        } );
        if( !numbers.ok ) return undefined;

        const selection : Texting.NumberSelection = campaign.data.numberSelection;
        const inCampaign : Array<Texting.NumberRecord> = numbers.data.filter( ( record : Texting.NumberRecord ) : boolean =>
            record.status === Texting.NumberStatus.ACTIVE && record.tcr.campaignId === campaignId );

        const eligible : Array<Texting.NumberRecord> = selection.mode === Texting.NumberSelectionMode.SINGLE
            ? inCampaign.filter( ( record : Texting.NumberRecord ) : boolean => record.number === selection.number )
            : selection.mode === Texting.NumberSelectionMode.AREA_CODE
                ? inCampaign.filter( ( record : Texting.NumberRecord ) : boolean => record.number.startsWith( `+1${ selection.areaCode }` ) )
                : inCampaign;

        return eligible.length > 0 ? eligible[ Math.floor( Math.random() * eligible.length ) ].number : undefined;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** WORKER: apply an inbound DLR — normalize via the ORIGINATING provider's adapter (stamped onto the
     *  payload by `PostTextingWebhookImpl` at intake, since each vendor's DLR body has a different shape),
     *  update the send-log row's status + normalized `errCode` (raw `providerCode` always kept for
     *  operator/audit visibility — texting-6.5), emit an engagement event. Never throws. */
    public async processDlr( envelope : Record<string, unknown> ) : Promise<void>
    {
        const provider : Texting.Provider = ( envelope.provider as Texting.Provider ) ?? Texting.Provider.FAKE;
        const payload : Record<string, unknown> = ( envelope.payload as Record<string, unknown> ) ?? {};

        const adapter : SmsProvider | undefined = this.providers.get( provider );
        if( adapter === undefined ) { this.log.warn( "dlr ignored — no adapter", { provider } ); return; }
        const normalized : Texting.NormalizedEvent = adapter.normalizeStatus( payload );
        if( normalized.status === undefined || normalized.providerMessageId === undefined )
        { this.log.warn( "dlr ignored — no status/providerMessageId", { provider, payload } ); return; }

        const found : Type.Result<Array<Texting.Message>> = await this.dynamo.query<Texting.Message>( "messages", {
            IndexName: "gsi_providerMessageId", KeyConditionExpression: "providerCode = :p", ExpressionAttributeValues: { ":p": normalized.providerMessageId },
        } );
        if( !found.ok || found.data.length === 0 ) { this.log.warn( "dlr ignored — message not found", { provider, providerMessageId: normalized.providerMessageId } ); return; }

        const message : Texting.Message = {
            ...found.data[ 0 ], status: normalized.status, errCode: normalized.errCode,
            deliveredAt: normalized.status === Texting.DeliveryStatus.DELIVERED ? new Date().toISOString() : undefined,
        };
        const wrote : Type.Result<void> = await this.dynamo.put( "messages", { ...message } );
        if( !wrote.ok ) { this.log.warn( "dlr status update failed", { messageId: message.messageId, error: wrote.error } ); return; }

        await this.emitEngagementEvent( message );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public async listLog( accountId : string ) : Promise<Type.Result<Array<Texting.Message>>>
    {
        return this.dynamo.query<Texting.Message>( "messages", {
            KeyConditionExpression: "accountId = :a", ExpressionAttributeValues: { ":a": accountId },
        } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    private async writeLog( request : Texting.SendRequest, to : string, provider : Texting.Provider, status : Texting.DeliveryStatus, result : Texting.AdapterSendResult, type : Texting.MessageType, from : Type.PhoneE164 ) : Promise<Texting.Message>
    {
        const now : Type.ISODateTime = new Date().toISOString();
        const message : Texting.Message =
        {
            accountId: request.accountId, messageId: result.messageId ?? request.idempotencyKey,
            direction: Texting.Direction.OUTBOUND, type,
            contactId: request.contactId, from, to,
            provider, campaignId: request.campaignId,
            conversationId: `${ request.accountId }#${ request.contactId }`,
            body: request.body, segments: result.segments,
            mediaKeys: request.mediaKeys,
            rcsContent: type === Texting.MessageType.RCS ? request.rcsContent : undefined,
            status, providerCode: result.messageId,
            createdAt: now, sentAt: status === Texting.DeliveryStatus.SENT ? now : undefined,
            idempotencyKey: request.idempotencyKey,
        };
        const wrote : Type.Result<void> = await this.dynamo.put( "messages", { ...message } );
        if( !wrote.ok ) this.log.warn( "send-log write failed", { accountId: request.accountId, error: wrote.error } );
        return message;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // resolve the transport credential for a provider from the config's registry + Secrets. `FAKE` needs
    // none. A provider's secret is either a multi-field JSON object (most CPaaS credentials — Twilio's
    // {accountSid, authToken}, etc.) or a single opaque string (e.g. Telnyx's bare API key) — try JSON
    // first, fall back to a plain string wrapped as `{ value }` so single-field adapters can read it
    // uniformly via `ctx.secret.value` alongside `ctx.secret.apiKey`/etc. for multi-field ones. An account
    // enabling RCS on Telnyx must switch that secret to the multi-field JSON form — `{apiKey, rcsAgentId,
    // messagingProfileId}` — since `TelnyxSmsAdapter.sendRcs` needs the extra two fields (texting-model rcs sketch).
    private async providerContext( provider : Texting.Provider, config : TextingConfig.Config ) : Promise<SmsContext>
    {
        if( provider === Texting.Provider.FAKE ) return {};

        const entry : TextingConfig.ProviderEntry | undefined = config.providers[ provider ];
        if( entry?.secretRef === undefined ) return {};
        this.log.trace( "secret resolved", { provider, secretRef: entry.secretRef } );

        const statusCallbackUrl : string = TextingService.statusUrl( provider );
        const asJson : Type.Result<Record<string, unknown> | undefined> = await this.secrets.getJson<Record<string, unknown>>( entry.secretRef );
        if( asJson.ok && asJson.data !== undefined ) return { secret: asJson.data, statusCallbackUrl };

        const asString : Type.Result<string | undefined> = await this.secrets.get( entry.secretRef );
        return asString.ok && asString.data !== undefined ? { secret: { value: asString.data }, statusCallbackUrl } : { statusCallbackUrl };
    }

    // the externally-reachable base URL this service's webhooks are hosted at (an API Gateway custom domain
    // in a deploy; overridable in dev via a tunnel URL so a real provider like Twilio can reach a local box).
    private static webhookBaseUrl() : string
    {
        return process.env.TEXTING_PUBLIC_URL ?? `http://localhost:${ Ports.TEXTING.MAIN }`;
    }

    /** The exact DLR webhook URL handed to the provider at send time (Twilio's `statusCallback`,
     *  SignalWire's `StatusCallback`, …) — reconstructed identically by `PostTextingWebhookImpl` to verify
     *  the provider's request signature, so neither side depends on the raw incoming request URL (mirrors
     *  voice's `VoiceService.statusUrl`). */
    public static statusUrl( provider : Texting.Provider ) : string
    {
        return `${ TextingService.webhookBaseUrl() }/api/texting/v1/webhook/${ provider }`;
    }

    // UDF status -> the analytics canonical event-type taxonomy (analytics-1.2).
    private static readonly ANALYTICS_EVENT_TYPE_FROM_STATUS : Partial<Record<Texting.DeliveryStatus, Analytics.EventType>> =
    {
        [ Texting.DeliveryStatus.SENT ]:        Analytics.EventType.SENT,
        [ Texting.DeliveryStatus.DELIVERED ]:   Analytics.EventType.DELIVERED,
        [ Texting.DeliveryStatus.UNDELIVERED ]: Analytics.EventType.DELIVERY_FAILED,
        [ Texting.DeliveryStatus.FAILED ]:      Analytics.EventType.DELIVERY_FAILED,
    };

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Build + publish this message's `Analytics.Event` onto `Events.Stream.ENGAGEMENT`
     *  (analytics-1.7) — best-effort. `message.contactId` is already known (texting resolves the
     *  contact BEFORE sending), so — unlike email's bare-address case — there's no identity
     *  resolution step here. */
    private async emitEngagementEvent( message : Texting.Message ) : Promise<void>
    {
        const eventType : Analytics.EventType | undefined = TextingService.ANALYTICS_EVENT_TYPE_FROM_STATUS[ message.status ];
        if( eventType === undefined ) return;

        const event : Analytics.Event =
        {
            eventId:         randomUUID(),
            occurredAt:      message.deliveredAt ?? message.sentAt ?? message.createdAt,
            ingestedAt:      new Date().toISOString(),
            accountId:       message.accountId,
            campaignId:      message.campaignId ?? null,
            messageId:       message.messageId,
            contactId:       message.contactId,
            channel:         "sms",
            provider:        message.provider,
            eventType,
            providerEventId: `${ message.messageId }:${ message.status }`,
        };
        const published : Type.Result<void> = await this.kafka.publishStream<Analytics.Event>(
            Events.Stream.ENGAGEMENT, event, { key: ( value : Analytics.Event ) : string => value.accountId } );
        if( !published.ok ) this.log.warn( "engagement event publish failed", { messageId: message.messageId, eventType, error: published.error } );
    }
}

export namespace TextingService
{
    export enum Role { MAIN = "main" }

    export const PORT : Record<Role, number> =
    {
        [ Role.MAIN ] : Ports.TEXTING.MAIN,
    };

    /** The `campaigns` table's row shape — the synced fields send-time routing needs, written by
     *  `RegistrationSyncConsumer` from `registration.campaign` events. Owned here (not in the consumer) since
     *  this Service is what reads it. */
    export interface CampaignRow
    {
        accountId        : string;
        campaignId       : string;
        active           : boolean;
        numberSelection? : Texting.NumberSelection;
        mps?             : { perMinute? : number; perHour? : number; perDay? : number };
    }
}

export default TextingService;
// eof

//
import { randomUUID, createHash } from "node:crypto";

import { Application, Service, Register, Dynamo, S3, Sqs, Kafka, Secrets, WorkQueue, Cache, Webhook } from "@repo/services";
import { Events } from "@repo/system";
import { Ports } from "@repo/cloud-manifest";
import { Voice, VoiceConfig, AiRouting, Media } from "@repo/api";
import { Ai } from "@repo/ai";
import { ObjectUtils, StringUtils } from "@repo/common";
import type { Type } from "@repo/common";
import type { Message } from "@aws-sdk/client-sqs";

import { VoiceFactory } from "../providers/VoiceFactory";
import { VoiceProvider, VoiceCall, VoiceContext, IvrRender } from "../providers/VoiceProvider";
import { MediaClient } from "../clients/MediaClient";

//
// VoiceService — the voice domain's Service BASE (not deployed alone). Holds the shared domain wiring
// (Dynamo + SQS + Kafka + Secrets facades, the provider factory, the runtime config reader) so the concrete
// role (VoiceMainService) inherits it. Owns the call-log store, the suppression list, the caller-ID number
// table, and the SEND worker (gate → resolve → dial → log) + the STATUS worker (normalize → log → opt-out),
// run off the request path via the voice-send / voice-status queues. Same shape as
// apps/core/email/src/services/EmailService.ts.
//
export class VoiceService extends Service
{
    private _dynamo?  : Dynamo;
    private _s3?      : S3;
    private _sqs?     : Sqs;
    private _kafka?   : Kafka;
    private _secrets? : Secrets;
    private _mediaClient? : MediaClient;
    private _workQueue? : WorkQueue;
    private _cache?   : Cache;

    /** The telephony adapter registry (Twilio / fake + more as they land). */
    protected readonly providers : VoiceFactory = new VoiceFactory();

    ////////////////////////////////////////////////////////////////////////////////////////////
    constructor( role : VoiceService.Role )
    {
        // super( serviceId, role, defaultLocalPort ) — env PORT overrides the default when set.
        super( Register.Service.VOICE, role, VoiceService.PORT[ role ] );

        // stamp the running version from package.json (walks up from bin/services at runtime)
        const pkg : Application.PackageInfo = this.loadPackageInfo( __dirname );
        this.setVersion( pkg.version );
        this.log.info( "version", { name: pkg.name, version: pkg.version } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** DynamoDB facade — the SoT for the call-log + suppression + numbers. Lazy + cached. */
    public get dynamo() : Dynamo { return this._dynamo ??= new Dynamo( this.cloud ); }
    /** S3 facade — the content-hash-keyed synthesized-TTS-audio cache. Lazy + cached. */
    public get s3() : S3 { return this._s3 ??= new S3( this.cloud ); }
    /** SQS facade — the voice-send + voice-status work queues. Lazy + cached. */
    public get sqs() : Sqs { return this._sqs ??= new Sqs( this.cloud ); }
    /** Kafka facade — voice.call lifecycle events, best-effort. Lazy + cached. */
    public get kafka() : Kafka { return this._kafka ??= new Kafka( this.cloud ); }
    /** Secrets facade — provider credentials (resolved by the config's `secretRef`). Lazy + cached. */
    public get secrets() : Secrets { return this._secrets ??= new Secrets( this.cloud ); }
    /** S2S client to media's internal asset-storage API (a freshly-synthesized TTS clip's best-effort
     *  cross-service registration). Lazy + cached. */
    public get mediaClient() : MediaClient { return this._mediaClient ??= new MediaClient(); }
    /** The `WorkQueue` dispatch governor (`packages/services/src/WorkQueue.ts`) — voice's adoption for
     *  abandoned-call rate control (SPECS.md gap #8): per-account connect-rate (token bucket, seeded from
     *  `VoiceConfig.limits.defaultRatePerMinute`) + concurrency (batch/low-water-mark), fairly ordered across
     *  accounts (WFQ/DRR) so one account's bulk campaign can't starve another's. Lazy + cached. */
    public get workQueue() : WorkQueue
    {
        return this._workQueue ??= new WorkQueue( this.cloud, "voice", {
            limits: { perMinute: VoiceConfig.DEFAULT.limits.defaultRatePerMinute },
            batchSize: 20, lowWaterMark: 50, leaseSeconds: 120,
        } );
    }
    /** Redis facade — same `"cache"` resource the `WorkQueue` governor uses; also backs the dispatch-loop
     *  single-flight lock (see `VoiceMainService.startDispatchLoop`). Lazy + cached. */
    public get cache() : Cache { return this._cache ??= new Cache( this.cloud, "cache" ); }

    /** The `Webhook` helper (`packages/services/src/Webhook.ts`), configured for ONE provider's signature
     *  scheme — built fresh per call (cheap; `Sqs`'s own client is lazy) rather than cached, since the
     *  provider varies per inbound request. `this.cloud` is `protected` (on `Application`), so endpoint
     *  impls — which aren't `Service` subclasses — go through this method rather than reaching it directly. */
    public webhookFor( provider : Voice.Provider ) : Webhook
    {
        return new Webhook( this.cloud, {
            auth: { verify: ( request : Webhook.Request ) : Promise<boolean> => this.verifyWebhook( provider, request.headers, request.url, request.body as Record<string, unknown> ) },
            log: this.log,
        } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Seed the runtime config on a fresh environment so the service (and the Console Config tab) have usable
     *  defaults from first boot. */
    protected override async init() : Promise<void>
    {
        super.init();
        const seeded : Type.Result<VoiceConfig.Config> = await this.appConfig.ensureSeeded( "config", "settings", VoiceConfig.DEFAULT );
        if( seeded.ok ) this.log.info( "voice config ready" );
        else this.log.warn( "voice config seed failed — using DEFAULT until deployed", { error: seeded.error } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** The live runtime config (AppConfig config/settings), deep-filled from DEFAULT so an older/partial hosted
     *  row tolerates schema drift. Exposed so endpoint impls (which can't reach the protected `appConfig`) read
     *  the provider/limits/quiet-hours policy. */
    public async voiceConfig() : Promise<VoiceConfig.Config>
    {
        const got : Type.Result<VoiceConfig.Config | undefined> = await this.appConfig.json<VoiceConfig.Config>( "config", "settings" );
        this.log.trace( "config read: config/settings", { found: got.ok && got.data !== undefined } );
        return got.ok && got.data ? ObjectUtils.withDefaults( got.data, VoiceConfig.DEFAULT ) : VoiceConfig.DEFAULT;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Persist a new config version + deploy it (AppConfig control plane) — the PUT-config write path. */
    public async saveConfig( config : VoiceConfig.Config, environment : string = process.env.APPCONFIG_ENV ?? "default" ) : Promise<Type.Result<void>>
    {
        const profileId : Type.Result<string> = await this.appConfig.profileId( "config", "settings" );
        if( !profileId.ok ) return { ok: false, error: profileId.error };
        const environmentId : Type.Result<string> = await this.appConfig.environmentId( "config", environment );
        if( !environmentId.ok ) return { ok: false, error: environmentId.error };

        const version : Type.Result<number> = await this.appConfig.createVersion( "config", profileId.data, JSON.stringify( config ) );
        if( !version.ok ) return { ok: false, error: version.error };
        const deployed : Type.Result<number> = await this.appConfig.deploy( "config", profileId.data, environmentId.data, version.data, { description: "voice config update" } );
        if( !deployed.ok ) return { ok: false, error: deployed.error };
        return { ok: true, data: undefined };
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // ── Send path (voice-1 / voice-4) ─────────────────────────────────────────────────────────────

    /** ENQUEUE a call request — the endpoint's fast path. Drops the request onto the voice-send queue and
     *  returns; the worker (drained by MAIN locally / a Job Lambda in prod) does the gate/dial/log. */
    public async enqueueCall( request : Voice.SendRequest, delaySeconds : number = 0 ) : Promise<Type.Result<string>>
    {
        const jobId : string = randomUUID();
        // SQS delay caps at 900s, same convention as email's enqueueSend
        const sent : Type.Result<void> = await this.sqs.send( "voice-send", { jobId, request }, delaySeconds > 0 ? { delaySeconds: Math.min( 900, delaySeconds ) } : {} );
        if( !sent.ok ) return { ok: false, error: sent.error };
        this.log.trace( "message enqueued (SQS voice-send)", { jobId, accountId: request.accountId, delaySeconds } );
        return { ok: true, data: jobId };
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** WORKER: process one enqueued call request end-to-end — per-destination fan-out: quiet-hours + suppression
     *  gate → resolve provider → QUEUE for paced dispatch (never dials inline — see {@link dispatchPending}).
     *  Never throws (a bad call is logged FAILED). */
    public async processSend( request : Voice.SendRequest ) : Promise<void>
    {
        this.log.trace( "processSend: start", { accountId: request.accountId, recipients: request.to.length } );
        const config : VoiceConfig.Config = await this.voiceConfig();
        const accountId : string = request.accountId ?? "system";

        if( request.to.length > config.limits.maxRecipientsPerSend )
        {
            this.log.warn( "call rejected — too many recipients", { accountId, count: request.to.length, max: config.limits.maxRecipientsPerSend } );
            return;
        }

        const providerId : Voice.Provider = request.provider ?? config.defaultProvider;
        const adapter : VoiceProvider | undefined = this.providers.get( providerId );
        if( adapter === undefined ) { this.log.warn( "call aborted — no adapter for provider", { accountId, provider: providerId } ); return; }

        // a flow-driven call (voice-2.1) — the entry step supplies the first prompt; every later step is
        // resolved LAZILY by the call-control webhook (ivrStep), never synthesized up front here.
        if( request.flowId !== undefined )
        {
            const found : Type.Result<Voice.IvrFlow | undefined> = await this.getFlow( accountId, request.flowId );
            if( !found.ok || found.data === undefined ) { this.log.warn( "call aborted — flow not found", { accountId, flowId: request.flowId } ); return; }
            for( const to of request.to ) await this.dialFlow( to, providerId, request, found.data, config, accountId );
            return;
        }

        if( request.message === undefined ) { this.log.warn( "call aborted — neither message nor flowId given", { accountId } ); return; }

        // resolve TTS ONCE per request (not per recipient) — every destination plays the same rendered audio
        const message : Voice.Message = await this.synthesizeMessage( accountId, request.message, request.mergeData );

        for( const to of request.to )
        {
            await this.dialOne( to, providerId, request, message, config, accountId );
        }
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // GATE + QUEUE one call: quiet-hours + suppression gate → build the per-call webhook URLs → write the
    // call-log row as QUEUED → hand the job to the `WorkQueue` governor (abandoned-call / concurrency+
    // connect-rate pacing, SPECS.md gap #8) instead of dialing inline. The actual `adapter.initiate` happens
    // later, off {@link dispatchPending}, once the governor admits this account's next call. `message` is the
    // ALREADY-RESOLVED message (post-TTS-synthesis) — the call-log stores exactly what will be played, and the
    // IVR call-control webhook later just replays it, never re-synthesizing.
    private async dialOne( to : string, providerId : Voice.Provider,
                            request : Voice.SendRequest, message : Voice.Message, config : VoiceConfig.Config, accountId : string ) : Promise<void>
    {
        const callId : string = randomUUID();

        if( !VoiceService.withinQuietHours( config.quietHours ) )
        {
            await this.writeLog( { accountId, callId, to, callerId: request.callerId, provider: providerId, status: Voice.Status.SUPPRESSED, message, campaignId: request.campaignId, voicemailMessage: request.voicemailMessage } );
            return;
        }
        const suppressed : boolean = await this.isSuppressed( accountId, to );
        if( suppressed )
        {
            await this.writeLog( { accountId, callId, to, callerId: request.callerId, provider: providerId, status: Voice.Status.SUPPRESSED, message, campaignId: request.campaignId, voicemailMessage: request.voicemailMessage } );
            return;
        }

        const call : VoiceCall =
        {
            callId, to, callerId: request.callerId, message,
            controlUrl:   VoiceService.controlUrl( providerId, accountId, callId ),
            statusUrl:    VoiceService.statusUrl( providerId, accountId, callId ),
            recordingUrl: VoiceService.recordingUrl( providerId, accountId, callId ),
        };

        await this.writeLog( { accountId, callId, to, callerId: request.callerId, provider: providerId, status: Voice.Status.QUEUED, message, campaignId: request.campaignId, voicemailMessage: request.voicemailMessage } );
        await this.queueDial( accountId, callId, providerId, call, { campaignId: request.campaignId, voicemailMessage: request.voicemailMessage } );
        this.log.trace( "call queued for paced dispatch", { accountId, callId, to, provider: providerId } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // GATE + QUEUE one flow-driven call — same gate as dialOne, but the call-log carries `flowId` +
    // `currentStepId` (the entry step) instead of a fully-resolved message; the call-control webhook
    // (ivrStep) does the per-step TTS resolution + branch advance lazily as the call progresses.
    private async dialFlow( to : string, providerId : Voice.Provider,
                             request : Voice.SendRequest, flow : Voice.IvrFlow, config : VoiceConfig.Config, accountId : string ) : Promise<void>
    {
        const callId : string = randomUUID();
        const entryStep : Voice.IvrStep | undefined = flow.steps[ flow.entryStepId ];
        const entryMessage : Voice.Message = entryStep?.message ?? { kind: "tts", text: "" };

        if( !VoiceService.withinQuietHours( config.quietHours ) || await this.isSuppressed( accountId, to ) )
        {
            await this.writeLog( {
                accountId, callId, to, callerId: request.callerId, provider: providerId, status: Voice.Status.SUPPRESSED,
                message: entryMessage, campaignId: request.campaignId, flowId: flow.id, currentStepId: flow.entryStepId,
                mergeData: request.mergeData, voicemailMessage: request.voicemailMessage,
            } );
            return;
        }

        const call : VoiceCall =
        {
            callId, to, callerId: request.callerId, message: entryMessage,
            controlUrl:   VoiceService.controlUrl( providerId, accountId, callId ),
            statusUrl:    VoiceService.statusUrl( providerId, accountId, callId ),
            recordingUrl: VoiceService.recordingUrl( providerId, accountId, callId ),
        };

        await this.writeLog( {
            accountId, callId, to, callerId: request.callerId, provider: providerId, status: Voice.Status.QUEUED,
            message: entryMessage, campaignId: request.campaignId, flowId: flow.id, currentStepId: flow.entryStepId,
            mergeData: request.mergeData, voicemailMessage: request.voicemailMessage,
        } );
        await this.queueDial( accountId, callId, providerId, call, {
            campaignId: request.campaignId, flowId: flow.id, currentStepId: flow.entryStepId,
            mergeData: request.mergeData, voicemailMessage: request.voicemailMessage,
        } );
        this.log.trace( "call queued for paced dispatch (flow)", { accountId, callId, to, provider: providerId, flowId: flow.id } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // Hand ONE gated call to the `WorkQueue` governor. `meta` deliberately carries NO resolved credentials
    // (`VoiceContext`'s accountSid/authToken) — only what's needed to re-resolve them fresh at dispatch time
    // ({@link dispatchOne} calls `providerContext` again) — so a provider secret never lands at rest in the
    // governor's durable job store. The JSON round-trip drops `undefined` fields so the result satisfies
    // `Type.JsonObject` (a boundary cast, same pattern the AWS facades use for a raw SDK response).
    private async queueDial( accountId : string, callId : string, providerId : Voice.Provider, call : VoiceCall, extra : VoiceService.DispatchExtra ) : Promise<void>
    {
        const meta : VoiceService.DispatchMeta = { call, providerId, ...extra };
        const json : Type.JsonObject = JSON.parse( JSON.stringify( meta ) ) as Type.JsonObject;
        await this.workQueue.enqueue( {
            jobId: callId, accountId, queue: "voice", priority: 5, payloadRef: callId,
            idempotencyKey: callId, createdAt: new Date().toISOString(), meta: json,
        } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** COORDINATOR TICK: pull the next paced batch from the `WorkQueue` governor (fair-share across accounts +
     *  the connect-rate/concurrency caps) and actually place those calls. Driven by `VoiceMainService`'s
     *  self-scheduled dispatch loop — see its `startDispatchLoop`. Never throws (one bad lease is logged and
     *  skipped, not fatal to the round). */
    public async dispatchPending() : Promise<void>
    {
        const leases : Array<WorkQueue.Lease> = await this.workQueue.dispatch();
        if( leases.length === 0 ) return;
        const config : VoiceConfig.Config = await this.voiceConfig();
        this.log.trace( "dispatch round", { leased: leases.length } );
        for( const lease of leases ) await this.dispatchOne( lease, config );
    }

    // place ONE governed call: resolve the adapter + a FRESH credential context (never the persisted job meta —
    // see queueDial), dial, then update the call-log row + settle the WorkQueue job. A dial ATTEMPT that
    // completes (however the call itself turns out — answered/no-answer/failed) is a COMPLETE governed job; only
    // an unresolvable provider/adapter (a config problem, not a call outcome) is a governor-level FAIL.
    private async dispatchOne( lease : WorkQueue.Lease, config : VoiceConfig.Config ) : Promise<void>
    {
        const meta : VoiceService.DispatchMeta | undefined = lease.job.meta as unknown as VoiceService.DispatchMeta | undefined;
        if( meta === undefined ) { this.log.warn( "dispatch skipped — job has no dial metadata", { jobId: lease.job.jobId } ); await this.workQueue.fail( lease.job.jobId, "missing dispatch metadata" ); return; }

        const adapter : VoiceProvider | undefined = this.providers.get( meta.providerId );
        if( adapter === undefined ) { this.log.warn( "dispatch failed — no adapter for provider", { jobId: lease.job.jobId, provider: meta.providerId } ); await this.workQueue.fail( lease.job.jobId, `no adapter for provider ${ meta.providerId }` ); return; }
        const context : VoiceContext = await this.providerContext( meta.providerId, config );

        this.log.trace( "call dialing (paced)", { accountId: lease.job.accountId, callId: meta.call.callId, to: meta.call.to, provider: meta.providerId } );
        const result : Voice.CallResult = await adapter.initiate( meta.call, context );
        const status : Voice.Status = result.status ?? ( result.ok ? Voice.Status.RINGING : Voice.Status.FAILED );

        const existing : Type.Result<Voice.CallLog | undefined> = await this.getCall( lease.job.accountId, meta.call.callId );
        if( existing.ok && existing.data !== undefined )
        {
            const row : Voice.CallLog = { ...existing.data, status, providerCallId: result.providerCallId, error: result.error, updatedAt: new Date().toISOString() };
            await this.putCall( row );
            await this.emitCall( Events.Verb.UPDATED, row );
        }

        if( result.ok ) this.log.info( "call placed (paced)", { accountId: lease.job.accountId, callId: meta.call.callId, to: meta.call.to, provider: meta.providerId, providerCallId: result.providerCallId, status } );
        else this.log.warn( "call failed (paced)", { accountId: lease.job.accountId, callId: meta.call.callId, to: meta.call.to, retryable: result.retryable, error: result.error } );

        await this.workQueue.complete( lease.job.jobId );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Resolve a `"tts"` message to a playable `"recording"` — synthesizes ONCE via `@repo/ai`'s
     *  provider-agnostic speech capability (`AiRouting.Modality.TEXT_TO_SPEECH`, the SAME abstraction media uses
     *  for voice cloning/narration — no voice-specific TTS adapter reinvented here), caches the audio in the
     *  `voice` bucket keyed by a content hash (repeat text/voice never re-synthesizes), and returns a
     *  short-lived presigned playback URL. A `"recording"` message, or a provider/synthesis miss, passes
     *  through unchanged — the telephony adapter then falls back to its own native `<Say>` for `"tts"` (a
     *  degraded but still-functional path, never a hard failure). `mergeData`, if given, substitutes
     *  `{{ dotted.path }}` tags in the text BEFORE synthesis/hashing — the same `{{...}}` convention email uses
     *  (`StringUtils.mergeTags`), so a personalized script still caches correctly per resolved text. On a FRESH
     *  synthesis (cache miss), also best-effort registers the clip in `media`'s asset library (voice-9.0's
     *  TTS-cache migration) — cross-service reuse + operator visibility, without giving up voice's own fast
     *  local cache (a `media` outage never blocks a call). */
    private async synthesizeMessage( accountId : string, message : Voice.Message, mergeData? : Record<string, unknown> ) : Promise<Voice.Message>
    {
        if( message.kind !== "tts" || !message.text ) return message;
        const text : string = mergeData ? StringUtils.mergeTags( message.text, mergeData ) : message.text;

        // content-hash cache key so identical (voice, text) pairs are synthesized only once
        const hash : string = createHash( "sha256" ).update( `${ message.voiceId ?? "" }:${ text }` ).digest( "hex" );
        const cacheKey : string = `tts/${ hash }.audio`;

        const cached : Type.Result<boolean> = await this.s3.exists( "voice", cacheKey );
        if( !cached.ok || !cached.data )
        {
            const client : Ai | undefined = await this.aiFor( AiRouting.Modality.TEXT_TO_SPEECH );
            if( client === undefined || !client.capabilities.has( Ai.Capability.SPEECH ) )
            {
                this.log.warn( "tts synthesis skipped — no TEXT_TO_SPEECH provider configured; falling back to the telephony provider's native say" );
                return message;
            }

            const spoken : Ai.SpeakResponse = await client.speak( { text, voiceId: message.voiceId, format: Ai.AudioFormat.MP3 } );
            if( !spoken.ok )
            {
                this.log.warn( "tts synthesis failed — falling back to the telephony provider's native say", { error: spoken.error } );
                return message;
            }

            const stored : Type.Result<void> = await this.s3.put( "voice", cacheKey, Buffer.from( spoken.audio ), spoken.mime );
            if( !stored.ok ) { this.log.warn( "tts cache write failed — falling back to the telephony provider's native say", { error: stored.error } ); return message; }
            this.log.trace( "tts synthesized + cached", { provider: client.provider, cacheKey } );

            void this.registerSynthesizedAsset( accountId, text, message.voiceId, spoken );
        }

        // a short TTL is fine — the call-control webhook resolves + plays it within seconds of dialing, not
        // hours later (unlike a durable asset link); re-synthesis on cache-miss is cheap since it's hashed.
        const presigned : Type.Result<string> = await this.s3.presignGet( "voice", cacheKey, 3600 );
        if( !presigned.ok ) { this.log.warn( "tts playback url presign failed — falling back to the telephony provider's native say", { error: presigned.error } ); return message; }
        return { kind: "recording", recordingUrl: presigned.data };
    }

    // best-effort registration of a freshly-synthesized clip in media's asset library (voice-9.0) — a `media`
    // outage/error is logged and swallowed, never surfaced to the caller (voice's own cache already has the
    // clip; this is purely for cross-service reuse + operator visibility, not on the critical dial path).
    private async registerSynthesizedAsset( accountId : string, text : string, voiceId : string | undefined, spoken : Ai.SpeakResponse ) : Promise<void>
    {
        try
        {
            const extension : string = spoken.mime.includes( "wav" ) ? "wav" : spoken.mime.includes( "mpeg" ) ? "mp3" : "audio";
            const stored : Type.Result<{ asset : { guid : string } }> = await this.mediaClient.storeAsset( {
                accountId, name: text.slice( 0, 60 ) || "voice TTS clip", kind: Media.Kind.AUDIO, mime: spoken.mime, extension,
                data: Buffer.from( spoken.audio ).toString( "base64" ),
                source: { origin: Media.SourceOrigin.GENERATED, provider: "voice-tts", model: spoken.model, prompt: text, acquiredAt: new Date().toISOString() },
            } );
            if( !stored.ok ) { this.log.warn( "media asset registration failed (voice's own cache still serves this call)", { error: stored.error } ); return; }
            this.log.trace( "tts clip registered in media", { guid: stored.data.asset.guid } );
        }
        catch( error ) { this.log.warn( "media asset registration threw (voice's own cache still serves this call)", { error: String( error ) } ); }
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** ENQUEUE an inbound status-webhook event — the webhook's fast path (ACK the provider immediately; the
     *  voice-status worker does the normalize + log update). */
    public async enqueueStatus( accountId : string, callId : string, provider : Voice.Provider, payload : Record<string, unknown> ) : Promise<Type.Result<void>>
    {
        const sent : Type.Result<void> = await this.sqs.send( "voice-status", { accountId, callId, provider, payload } );
        if( sent.ok ) this.log.trace( "message enqueued (SQS voice-status)", { accountId, callId, provider } );
        return sent;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** WORKER: apply an inbound call-status event — normalize via the resolved provider's adapter, update the
     *  call-log row, and (on an in-call opt-out) add the destination to the suppression list. Never throws. */
    public async processStatus( accountId : string, callId : string, provider : Voice.Provider, payload : Record<string, unknown> ) : Promise<void>
    {
        const adapter : VoiceProvider | undefined = this.providers.get( provider );
        if( adapter === undefined ) { this.log.warn( "status ignored — no adapter for provider", { accountId, callId, provider } ); return; }

        const normalized = adapter.statusNormalize( payload );
        const existing : Type.Result<Voice.CallLog | undefined> = await this.getCall( accountId, callId );
        if( !existing.ok || existing.data === undefined ) { this.log.warn( "status ignored — call not found", { accountId, callId } ); return; }

        const row : Voice.CallLog = { ...existing.data, status: normalized.status, durationSec: normalized.durationSec ?? existing.data.durationSec, optedOut: normalized.optedOut ?? existing.data.optedOut, error: normalized.error ?? existing.data.error, updatedAt: new Date().toISOString() };
        await this.putCall( row );
        if( normalized.optedOut ) await this.suppress( accountId, row.to );
        await this.emitCall( Events.Verb.UPDATED, row );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // ── Recordings & transcripts (voice-7.0/2.3 — PII, TTL'd via the `voice` bucket's lifecycle) ────

    /** ENQUEUE an inbound recording-status webhook event — the webhook's fast path (ACK the provider
     *  immediately; the voice-recording worker downloads + stores the audio and, if configured, transcribes it). */
    public async enqueueRecording( accountId : string, callId : string, provider : Voice.Provider, payload : Record<string, unknown> ) : Promise<Type.Result<void>>
    {
        const sent : Type.Result<void> = await this.sqs.send( "voice-recording", { accountId, callId, provider, payload } );
        if( sent.ok ) this.log.trace( "message enqueued (SQS voice-recording)", { accountId, callId, provider } );
        return sent;
    }

    /** WORKER: download a completed recording, store it in the `voice` bucket (`recordings/` prefix, TTL'd by
     *  the bucket lifecycle — see CloudManifest), and — if `transcriptionEnabled` — transcribe it via
     *  `@repo/ai`'s SPEECH_TO_TEXT modality (the same provider-agnostic pattern TTS uses). Never throws (a
     *  download/transcribe miss is logged, not raised — the call-log row simply keeps no recording/transcript). */
    public async processRecording( accountId : string, callId : string, provider : Voice.Provider, payload : Record<string, unknown> ) : Promise<void>
    {
        const adapter : VoiceProvider | undefined = this.providers.get( provider );
        if( adapter === undefined ) { this.log.warn( "recording ignored — no adapter for provider", { accountId, callId, provider } ); return; }

        const info : { recordingId : string; durationSec? : number } | undefined = adapter.recordingInfo( payload );
        if( info === undefined ) { this.log.trace( "recording webhook carried no recording", { accountId, callId, provider } ); return; }

        const found : Type.Result<Voice.CallLog | undefined> = await this.getCall( accountId, callId );
        if( !found.ok || found.data === undefined ) { this.log.warn( "recording ignored — call not found", { accountId, callId } ); return; }

        const config : VoiceConfig.Config = await this.voiceConfig();
        const context : VoiceContext = await this.providerContext( provider, config );
        const fetched : { audio : Uint8Array; mime : string } | undefined = await adapter.fetchRecording( info.recordingId, context );
        if( fetched === undefined ) { this.log.warn( "recording download failed", { accountId, callId, provider } ); return; }

        const key : string = `recordings/${ accountId }/${ callId }.audio`;
        const stored : Type.Result<void> = await this.s3.put( "voice", key, Buffer.from( fetched.audio ), fetched.mime );
        if( !stored.ok ) { this.log.warn( "recording store failed", { accountId, callId, error: stored.error } ); return; }

        let row : Voice.CallLog = { ...found.data, recordingKey: key, durationSec: info.durationSec ?? found.data.durationSec, updatedAt: new Date().toISOString() };
        this.log.info( "recording stored", { accountId, callId, key } );

        if( config.transcriptionEnabled )
        {
            const client : Ai | undefined = await this.aiFor( AiRouting.Modality.SPEECH_TO_TEXT );
            if( client !== undefined && client.capabilities.has( Ai.Capability.TRANSCRIBE ) )
            {
                const transcribed : Ai.TranscribeResponse = await client.transcribe( { audio: fetched.audio, mime: fetched.mime } );
                if( transcribed.ok ) row = { ...row, transcript: transcribed.text };
                else this.log.warn( "transcription failed", { accountId, callId, error: transcribed.error } );
            }
            else this.log.warn( "transcription skipped — no SPEECH_TO_TEXT provider configured", { accountId, callId } );
        }

        await this.putCall( row );
        await this.emitCall( Events.Verb.UPDATED, row );
    }

    /** A short-lived presigned playback URL for a call's recording, or undefined if none was captured. */
    public async recordingPlaybackUrl( accountId : string, callId : string ) : Promise<string | undefined>
    {
        const found : Type.Result<Voice.CallLog | undefined> = await this.getCall( accountId, callId );
        if( !found.ok || found.data?.recordingKey === undefined ) return undefined;
        const presigned : Type.Result<string> = await this.s3.presignGet( "voice", found.data.recordingKey, 900 );
        return presigned.ok ? presigned.data : undefined;
    }

    /** A call's transcript text, or undefined if none was produced. */
    public async transcriptFor( accountId : string, callId : string ) : Promise<string | undefined>
    {
        const found : Type.Result<Voice.CallLog | undefined> = await this.getCall( accountId, callId );
        return found.ok ? found.data?.transcript : undefined;
    }

    /** S2S forget hook (voice-9.0) — purge the recording (S3 object) + transcript for every call to `to`, and
     *  obfuscate the `to` attribute on those rows (the call-log row itself is kept; only its PII is erased).
     *  Idempotent — re-erasing an already-erased number just matches zero rows. Returns the row count erased. */
    public async eraseContact( accountId : string, to : string ) : Promise<Type.Result<number>>
    {
        const found : Type.Result<Array<Voice.CallLog>> = await this.listCalls( accountId );
        if( !found.ok ) return { ok: false, error: found.error };

        const matches : Array<Voice.CallLog> = found.data.filter( ( call : Voice.CallLog ) : boolean => call.to === to );
        for( const call of matches )
        {
            if( call.recordingKey !== undefined )
            {
                const removed : Type.Result<void> = await this.s3.remove( "voice", call.recordingKey );
                if( !removed.ok ) this.log.warn( "erase: recording removal failed", { accountId, callId: call.callId, error: removed.error } );
            }
            const row : Voice.CallLog = { ...call, to: "[erased]", recordingKey: undefined, transcript: undefined, updatedAt: new Date().toISOString() };
            await this.putCall( row );
        }
        this.log.info( "voice erase applied", { accountId, to, rows: matches.length } );
        return { ok: true, data: matches.length };
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Render the NEXT IVR step for an in-progress call from the SYNCHRONOUS call-control webhook — checks the
     *  provider's answering-machine-detection signal FIRST (voice-2.4: a machine ends the call right here,
     *  never entering the IVR/flow), then resolves the caller's collected digit (via `collectedInput`),
     *  advances a flow-driven call's branch (or applies the legacy fixed "press 1" opt-out for a single-message
     *  call), and delegates the FINAL render to the provider adapter. Returns undefined when the call/provider
     *  can't be resolved (impl → 404). */
    public async ivrStep( accountId : string, callId : string, provider : Voice.Provider, body : Record<string, unknown> ) : Promise<string | undefined>
    {
        const adapter : VoiceProvider | undefined = this.providers.get( provider );
        if( adapter === undefined ) return undefined;
        const found : Type.Result<Voice.CallLog | undefined> = await this.getCall( accountId, callId );
        if( !found.ok || found.data === undefined ) return undefined;
        const config : VoiceConfig.Config = await this.voiceConfig();
        const context : VoiceContext = await this.providerContext( provider, config );

        if( config.amdEnabled && adapter.answeredBy( body ) === "machine" )
            return adapter.ivrInstructions( await this.ivrVoicemailStep( found.data ), context );

        const input : string | undefined = adapter.collectedInput( body );
        const render : IvrRender = found.data.flowId !== undefined
            ? await this.ivrFlowStep( found.data, input )
            : await this.ivrLegacyStep( found.data, input );
        return adapter.ivrInstructions( render, context );
    }

    // a machine answered (voice-2.4): mark the call VOICEMAIL, then either play the request's configured
    // voicemail-drop message (terminal — no gather) or hang up silently if none was given.
    private async ivrVoicemailStep( call : Voice.CallLog ) : Promise<IvrRender>
    {
        const row : Voice.CallLog = { ...call, status: Voice.Status.VOICEMAIL, updatedAt: new Date().toISOString() };
        await this.putCall( row );
        await this.emitCall( Events.Verb.UPDATED, row );

        if( call.voicemailMessage === undefined ) return { message: undefined };
        const message : Voice.Message = await this.synthesizeMessage( call.accountId, call.voicemailMessage, call.mergeData );
        return { message };
    }

    // legacy single-message call: gather a fixed one-digit opt-out ("1") every step; anything else re-plays
    // the same message + gather (a caller who mis-dials just hears it again, same as before this rewrite).
    private async ivrLegacyStep( call : Voice.CallLog, input : string | undefined ) : Promise<IvrRender>
    {
        if( input === "1" )
        {
            await this.applyOptOut( call );
            return { message: VoiceService.OPT_OUT_MESSAGE };
        }
        return { message: call.message, gather: { numDigits: 1 } };
    }

    // flow-driven call: resolve the current step (advancing on a branch match if input was just collected),
    // then lazily synthesize + render that step's message.
    private async ivrFlowStep( call : Voice.CallLog, input : string | undefined ) : Promise<IvrRender>
    {
        const found : Type.Result<Voice.IvrFlow | undefined> = await this.getFlow( call.accountId, call.flowId as string );
        if( !found.ok || found.data === undefined ) return { message: VoiceService.FLOW_MISSING_MESSAGE };
        const flow : Voice.IvrFlow = found.data;

        let stepId : string = call.currentStepId ?? flow.entryStepId;
        let step : Voice.IvrStep | undefined = flow.steps[ stepId ];
        if( step === undefined ) return { message: VoiceService.FLOW_MISSING_MESSAGE };

        // an input just arrived for a step that offers a gather — resolve the branch (or opt-out) before rendering
        if( input !== undefined && step.gather !== undefined )
        {
            if( step.gather.optOutOn?.includes( input ) )
            {
                await this.applyOptOut( call );
                return { message: VoiceService.OPT_OUT_MESSAGE };
            }

            const nextStepId : string | undefined = step.gather.branches[ input ] ?? step.gather.branches[ "default" ];
            const nextStep : Voice.IvrStep | undefined = nextStepId !== undefined ? flow.steps[ nextStepId ] : undefined;
            if( nextStepId === undefined || nextStep === undefined ) return { message: VoiceService.GOODBYE_MESSAGE };

            stepId = nextStepId;
            step = nextStep;
            await this.putCall( { ...call, currentStepId: stepId, updatedAt: new Date().toISOString() } );
            this.log.trace( "ivr flow advanced", { accountId: call.accountId, callId: call.callId, flowId: flow.id, stepId } );
        }

        const message : Voice.Message = await this.synthesizeMessage( call.accountId, step.message, call.mergeData );
        return { message, gather: step.gather ? { numDigits: step.gather.numDigits, timeoutSec: step.gather.timeoutSec } : undefined };
    }

    // suppress the destination + mark the call log OPTED_OUT — shared by the legacy + flow opt-out paths.
    private async applyOptOut( call : Voice.CallLog ) : Promise<void>
    {
        await this.suppress( call.accountId, call.to );
        const row : Voice.CallLog = { ...call, status: Voice.Status.OPTED_OUT, optedOut: true, updatedAt: new Date().toISOString() };
        await this.putCall( row );
        await this.emitCall( Events.Verb.UPDATED, row );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Verify a provider webhook's signature — resolves the adapter + credential, delegates to
     *  `VoiceProvider.verifySignature`. Fails closed (false) when the provider/credential can't be resolved. */
    public async verifyWebhook( provider : Voice.Provider, headers : Record<string, string | undefined>, url : string, body : Record<string, unknown> ) : Promise<boolean>
    {
        const adapter : VoiceProvider | undefined = this.providers.get( provider );
        if( adapter === undefined ) return false;
        const config : VoiceConfig.Config = await this.voiceConfig();
        const context : VoiceContext = await this.providerContext( provider, config );
        return adapter.verifySignature( headers, url, body, context );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // ── Call-log store (voice-7.1) ────────────────────────────────────────────────────────────

    /** One call by id. */
    public async getCall( accountId : string, callId : string ) : Promise<Type.Result<Voice.CallLog | undefined>>
    {
        this.log.trace( "item read: voice_calls", { accountId, callId } );
        return this.dynamo.get<Voice.CallLog>( "voice_calls", { accountId, callId } );
    }

    /** List an account's call-log rows. */
    public async listCalls( accountId : string ) : Promise<Type.Result<Array<Voice.CallLog>>>
    {
        this.log.trace( "item query: voice_calls", { accountId } );
        return this.dynamo.query<Voice.CallLog>( "voice_calls", {
            KeyConditionExpression:    "accountId = :a",
            ExpressionAttributeValues: { ":a": accountId },
        } );
    }

    /** Persist a call-log row. */
    private async putCall( row : Voice.CallLog ) : Promise<Type.Result<void>>
    {
        const wrote : Type.Result<void> = await this.dynamo.put( "voice_calls", { ...row } );
        if( !wrote.ok ) this.log.warn( "call-log write failed", { accountId: row.accountId, callId: row.callId, error: wrote.error } );
        else this.log.trace( "item stored: voice_calls", { accountId: row.accountId, callId: row.callId, status: row.status } );
        return wrote;
    }

    // write one call-log row from the fields collected at each stage (dial-time or status-update time)
    private async writeLog( fields : VoiceService.WriteLogFields ) : Promise<void>
    {
        const now : string = new Date().toISOString();
        const row : Voice.CallLog =
        {
            accountId: fields.accountId, callId: fields.callId, to: fields.to, callerId: fields.callerId,
            provider: fields.provider, status: fields.status, message: fields.message, campaignId: fields.campaignId,
            providerCallId: fields.providerCallId, error: fields.error, createdAt: now, updatedAt: now,
            flowId: fields.flowId, currentStepId: fields.currentStepId, mergeData: fields.mergeData,
            voicemailMessage: fields.voicemailMessage,
        };
        await this.putCall( row );
        await this.emitCall( Events.Verb.CREATED, row );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Publish a `voice.call` lifecycle event (best-effort — a bus miss is logged, never fails the request). */
    public async emitCall( verb : Events.Verb, entity : Voice.CallLog ) : Promise<void>
    {
        const published : Type.Result<void> = await this.kafka.publishEvent( Events.envelope( {
            object:    Events.Object.VOICE_CALL,
            verb,
            accountId: entity.accountId,
            target:    { type: "voice.call", id: entity.callId },
            data:      entity,
        } ) );
        if( !published.ok ) this.log.warn( "voice.call event publish failed", { callId: entity.callId, verb, error: published.error } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // ── IVR flow store (voice-2.1) ────────────────────────────────────────────────────────────

    /** One flow by id. */
    public async getFlow( accountId : string, flowId : string ) : Promise<Type.Result<Voice.IvrFlow | undefined>>
    {
        this.log.trace( "item read: voice_flows", { accountId, flowId } );
        return this.dynamo.get<Voice.IvrFlow>( "voice_flows", { accountId, flowId } );
    }

    /** List an account's saved flows. */
    public async listFlows( accountId : string ) : Promise<Type.Result<Array<Voice.IvrFlow>>>
    {
        this.log.trace( "item query: voice_flows", { accountId } );
        return this.dynamo.query<Voice.IvrFlow>( "voice_flows", {
            KeyConditionExpression:    "accountId = :a",
            ExpressionAttributeValues: { ":a": accountId },
        } );
    }

    /** Persist a flow (create or full-replace update). Stamps `updatedAt`/`updatedBy`; the caller sets
     *  `createdAt`/`createdBy` once at creation. */
    public async putFlow( flow : Voice.IvrFlow ) : Promise<Type.Result<void>>
    {
        const wrote : Type.Result<void> = await this.dynamo.put( "voice_flows", { ...flow } );
        if( !wrote.ok ) this.log.warn( "flow write failed", { accountId: flow.accountId, flowId: flow.id, error: wrote.error } );
        else this.log.trace( "item stored: voice_flows", { accountId: flow.accountId, flowId: flow.id } );
        return wrote;
    }

    /** Delete a flow. Returns whether a row was found + removed (an absent flow is not an error). */
    public async deleteFlow( accountId : string, flowId : string ) : Promise<Type.Result<boolean>>
    {
        const found : Type.Result<Voice.IvrFlow | undefined> = await this.getFlow( accountId, flowId );
        if( !found.ok ) return { ok: false, error: found.error };
        if( found.data === undefined ) return { ok: true, data: false };
        const removed : Type.Result<void> = await this.dynamo.remove( "voice_flows", { accountId, flowId } );
        if( !removed.ok ) return { ok: false, error: removed.error };
        await this.emitFlow( Events.Verb.DELETED, found.data );
        return { ok: true, data: true };
    }

    /** Publish a `voice.ivr_flow` lifecycle event (best-effort). */
    public async emitFlow( verb : Events.Verb, entity : Voice.IvrFlow ) : Promise<void>
    {
        const published : Type.Result<void> = await this.kafka.publishEvent( Events.envelope( {
            object:    Events.Object.VOICE_IVR_FLOW,
            verb,
            accountId: entity.accountId,
            target:    { type: "voice.ivr_flow", id: entity.id },
            data:      entity,
            actorUserId: entity.updatedBy,
        } ) );
        if( !published.ok ) this.log.warn( "voice.ivr_flow event publish failed", { flowId: entity.id, verb, error: published.error } );
    }

    /** Validate a flow's step graph: the entry step must exist, and every `branches`/`optOutOn` target must
     *  name an existing step. Returns undefined when valid, else a human-readable error for the impl to 400. */
    public static validateFlow( entryStepId : string, steps : Record<string, Voice.IvrStep> ) : string | undefined
    {
        if( steps[ entryStepId ] === undefined ) return `entryStepId "${ entryStepId }" is not one of the provided steps`;
        for( const [ stepId, step ] of Object.entries( steps ) )
        {
            if( step.gather === undefined ) continue;
            for( const targetStepId of Object.values( step.gather.branches ) )
            {
                if( targetStepId !== "default" && steps[ targetStepId ] === undefined && targetStepId.length > 0 )
                    return `step "${ stepId }" branches to unknown step "${ targetStepId }"`;
            }
        }
        return undefined;
    }

    /** Render + (for a `"tts"` step) synthesize a PREVIEW of one flow step — no call placed. Returns undefined
     *  when the flow/step can't be resolved (impl → 404). */
    public async previewStep( accountId : string, flowId : string, stepId : string | undefined, mergeData : Record<string, unknown> | undefined ) : Promise<VoiceService.FlowPreview | undefined>
    {
        const found : Type.Result<Voice.IvrFlow | undefined> = await this.getFlow( accountId, flowId );
        if( !found.ok || found.data === undefined ) return undefined;
        const flow : Voice.IvrFlow = found.data;
        const resolvedStepId : string = stepId ?? flow.entryStepId;
        const step : Voice.IvrStep | undefined = flow.steps[ resolvedStepId ];
        if( step === undefined ) return undefined;

        if( step.message.kind !== "tts" ) return { text: step.message.recordingUrl ?? "" };

        const text : string = StringUtils.mergeTags( step.message.text ?? "", mergeData ?? {} );
        const synthesized : Voice.Message = await this.synthesizeMessage( accountId, step.message, mergeData );
        return { text, audioUrl: synthesized.kind === "recording" ? synthesized.recordingUrl : undefined };
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // ── Suppression (the canSend() gate) ──────────────────────────────────────────────────────

    /** Is a destination suppressed for this account (opted out)? */
    public async isSuppressed( accountId : string, to : string ) : Promise<boolean>
    {
        this.log.trace( "item read: voice_suppression", { accountId, to } );
        const got : Type.Result<{ to : string } | undefined> = await this.dynamo.get<{ to : string }>( "voice_suppression", { accountId, to } );
        return got.ok && got.data !== undefined;
    }

    /** Add a destination to the account's suppression list (from an in-call opt-out). Idempotent. */
    public async suppress( accountId : string, to : string ) : Promise<void>
    {
        const wrote : Type.Result<void> = await this.dynamo.put( "voice_suppression", { accountId, to, at: new Date().toISOString() } );
        if( !wrote.ok ) this.log.warn( "suppression write failed", { accountId, to, error: wrote.error } );
        else this.log.trace( "item stored: voice_suppression", { accountId, to } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // ── Numbers (voice-8.0 — a minimal, voice-owned copy until `registration` owns this) ──────

    /** List an account's configured caller-ID numbers. */
    public async listNumbers( accountId : string ) : Promise<Type.Result<Array<Voice.NumberEntry>>>
    {
        this.log.trace( "item query: voice_numbers", { accountId } );
        return this.dynamo.query<Voice.NumberEntry>( "voice_numbers", {
            KeyConditionExpression:    "accountId = :a",
            ExpressionAttributeValues: { ":a": accountId },
        } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // ── Retry / DLQ (voice-5.0) ────────────────────────────────────────────────────────────────

    /** List dead-lettered messages from one (or every) queue's `<queue>-dlq` companion. A `receive` only PEEKS
     *  (the message stays in-flight for the queue's visibility timeout) — nothing is deleted here; that only
     *  happens on a successful {@link requeueDlq}, so a list-without-requeue naturally releases the messages
     *  back to the DLQ once the visibility window elapses. */
    public async listDlq( queue? : Voice.DlqQueue, max : number = 10 ) : Promise<Type.Result<Array<Voice.DlqItem>>>
    {
        const queues : Array<Voice.DlqQueue> = queue ? [ queue ] : Object.values( Voice.DlqQueue );
        const items : Array<Voice.DlqItem> = [];
        for( const oneQueue of queues )
        {
            const received : Type.Result<Array<Message>> = await this.sqs.receive( `${ oneQueue }-dlq`, Math.min( max, 10 ), 0 );
            if( !received.ok ) { this.log.warn( "dlq receive failed", { queue: oneQueue, error: received.error } ); continue; }
            for( const message of received.data )
            {
                const approxReceiveCount : number | undefined = message.Attributes?.ApproximateReceiveCount !== undefined
                    ? Number( message.Attributes.ApproximateReceiveCount ) : undefined;
                items.push( { queue: oneQueue, messageId: message.MessageId ?? "", receiptHandle: message.ReceiptHandle ?? "", body: message.Body ?? "", approxReceiveCount } );
            }
        }
        return { ok: true, data: items };
    }

    /** Resend each item's EXACT original body to its source queue, then delete it from the `<queue>-dlq`
     *  companion — items come from a prior {@link listDlq} call (never re-received here), so their receipt
     *  handles are still valid. A per-item failure is logged and skipped, not fatal to the batch. Returns the
     *  count actually requeued. */
    public async requeueDlq( items : Array<Voice.DlqItem> ) : Promise<Type.Result<number>>
    {
        let requeued : number = 0;
        for( const item of items )
        {
            const sent : Type.Result<void> = await this.sqs.send( item.queue, item.body );
            if( !sent.ok ) { this.log.warn( "dlq requeue send failed", { queue: item.queue, messageId: item.messageId, error: sent.error } ); continue; }
            const deleted : Type.Result<void> = await this.sqs.delete( `${ item.queue }-dlq`, item.receiptHandle );
            if( !deleted.ok ) this.log.warn( "dlq requeue delete failed (message resent but not removed from DLQ — may double-process)", { queue: item.queue, messageId: item.messageId, error: deleted.error } );
            requeued += 1;
        }
        this.log.info( "dlq requeue applied", { requested: items.length, requeued } );
        return { ok: true, data: requeued };
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // resolve the transport credential for a provider from the config's registry + Secrets, plus the
    // config-level AMD/recording toggles (every provider gets them — `fake` just ignores them).
    private async providerContext( provider : Voice.Provider, config : VoiceConfig.Config ) : Promise<VoiceContext>
    {
        const toggles : { amdEnabled : boolean; recordingEnabled : boolean } = { amdEnabled: config.amdEnabled, recordingEnabled: config.recordingEnabled };
        if( provider === Voice.Provider.FAKE ) return toggles;

        const entry : VoiceConfig.ProviderEntry | undefined = config.providers[ provider ];
        if( entry?.secretRef === undefined ) return toggles;
        this.log.trace( "secret resolved", { provider, secretRef: entry.secretRef } );
        const secret : Type.Result<VoiceService.TwilioCredential | undefined> = await this.secrets.getJson<VoiceService.TwilioCredential>( entry.secretRef );
        if( !secret.ok || secret.data === undefined ) return toggles;
        return { accountSid: secret.data.accountSid, authToken: secret.data.authToken, ...toggles };
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // a simple recipient-LOCAL quiet-hours check — CURRENT SIMPLIFICATION: uses the server's UTC hour, not a
    // per-destination timezone (a documented gap — SPECS.md voice-4.1/4.7 needs a real timezone source per
    // number before this is launch-accurate).
    private static withinQuietHours( quietHours : VoiceConfig.QuietHours ) : boolean
    {
        const hour : number = new Date().getUTCHours();
        if( quietHours.startHour <= quietHours.endHour ) return hour >= quietHours.startHour && hour < quietHours.endHour;
        return hour >= quietHours.startHour || hour < quietHours.endHour;   // a window that wraps midnight
    }

    // the externally-reachable base URL this service's webhooks are hosted at (an API Gateway custom domain in
    // a deploy; overridable in dev via a tunnel URL so a real provider like Twilio can reach a local box).
    private static webhookBaseUrl() : string
    {
        return process.env.VOICE_PUBLIC_URL ?? `http://localhost:${ Ports.VOICE.MAIN }`;
    }

    /** The exact call-control webhook URL handed to the provider at dial time — reconstructed identically by
     *  the webhook impl (from the URI's own path params) to verify the provider's request signature, so
     *  neither side depends on the raw incoming request URL. */
    public static controlUrl( provider : Voice.Provider, accountId : string, callId : string ) : string
    {
        return `${ VoiceService.webhookBaseUrl() }/api/voice/v1/webhook/${ provider }/control/${ accountId }/${ callId }`;
    }

    /** The exact status webhook URL handed to the provider at dial time (see {@link controlUrl}). */
    public static statusUrl( provider : Voice.Provider, accountId : string, callId : string ) : string
    {
        return `${ VoiceService.webhookBaseUrl() }/api/voice/v1/webhook/${ provider }/status/${ accountId }/${ callId }`;
    }

    /** The exact recording-status webhook URL handed to the provider at dial time (see {@link controlUrl}). */
    public static recordingUrl( provider : Voice.Provider, accountId : string, callId : string ) : string
    {
        return `${ VoiceService.webhookBaseUrl() }/api/voice/v1/webhook/${ provider }/recording/${ accountId }/${ callId }`;
    }

    // fixed, non-personalized terminal prompts for the paths that don't have their own authored message
    private static readonly OPT_OUT_MESSAGE : Voice.Message = { kind: "tts", text: "You have been removed from future calls. Goodbye." };
    private static readonly GOODBYE_MESSAGE : Voice.Message = { kind: "tts", text: "Goodbye." };
    private static readonly FLOW_MISSING_MESSAGE : Voice.Message = { kind: "tts", text: "This call cannot continue. Goodbye." };
}

export namespace VoiceService
{
    export enum Role { MAIN = "main" }
    export const PORT : Record<Role, number> = { [ Role.MAIN ]: Ports.VOICE.MAIN };

    /** The fields collected at dial-time (or the pre-dial suppression short-circuit) for one call-log row. */
    export interface WriteLogFields
    {
        accountId       : string;
        callId          : string;
        to              : string;
        callerId        : string;
        provider        : Voice.Provider;
        status          : Voice.Status;
        message         : Voice.Message;
        campaignId?     : string;
        providerCallId? : string;
        error?          : string;
        flowId?         : string;
        currentStepId?  : string;
        mergeData?      : Record<string, unknown>;
        voicemailMessage? : Voice.Message;
    }

    /** The shape of a Twilio secret (`voice-twilio`) — account SID + auth token, mirroring texting's existing
     *  `texting-twilio` secret fields. */
    export interface TwilioCredential { accountSid : string; authToken : string; }

    /** The result of {@link VoiceService.previewStep} — merged step text + (for a TTS step) a playable URL. */
    export interface FlowPreview { text : string; audioUrl? : string; }

    /** Everything BESIDES `call`/`providerId` a {@link VoiceService.queueDial}'d job needs to resolve at dispatch
     *  time — deliberately excludes any resolved credential (see {@link VoiceService.queueDial}'s doc). */
    export interface DispatchExtra
    {
        campaignId?       : string;
        flowId?           : string;
        currentStepId?    : string;
        mergeData?        : Record<string, unknown>;
        voicemailMessage? : Voice.Message;
    }

    /** The `WorkQueue.Job.meta` shape a governed voice dial job carries — everything {@link VoiceService.
     *  dispatchOne} needs to actually place the call, EXCEPT the resolved provider credential (re-resolved
     *  fresh at dispatch time so a secret never lands at rest in the governor's durable job store). */
    export interface DispatchMeta extends DispatchExtra { call : VoiceCall; providerId : Voice.Provider; }
}

export default VoiceService;
// eof

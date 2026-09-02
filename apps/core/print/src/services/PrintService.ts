//
import { randomUUID, createHash } from "node:crypto";

import { Application, Service, Register, Dynamo, S3, Sqs, Kafka, Secrets, WorkQueue, Cache, Webhook } from "@repo/services";
import { Events } from "@repo/system";
import { Ports } from "@repo/cloud-manifest";
import { Print, PrintConfig, Analytics } from "@repo/api";
import { ObjectUtils } from "@repo/common";
import type { Type } from "@repo/common";
import type { Message } from "@aws-sdk/client-sqs";

import { MailFactory } from "../providers/MailFactory";
import { MailProvider, MailSubmission, MailContext, MailSubmitResult } from "../providers/MailProvider";
import { AddressVerifierFactory } from "../providers/AddressVerifierFactory";
import { AddressVerifierProvider, CassResult, NcoaResult } from "../providers/AddressVerifierProvider";
import { ProofRenderer } from "../render/ProofRenderer";

//
// PrintService — the print domain's Service BASE (not deployed alone). Holds the shared domain wiring
// (Dynamo + S3 + SQS + Kafka + Secrets facades, the TWO independent provider factories, the runtime config
// reader) so the concrete role (PrintMainService) inherits it. Owns the mailpiece store, the template store,
// the global contact-free address database, and the RENDER worker (merge → verify → PDF proof) + the paced
// SUBMIT path (via `WorkQueue`) + the TRACKING worker (normalize → log), run off the request path via the
// print-render / print-submit / print-tracking queues. Same shape as
// apps/core/voice/src/services/VoiceService.ts.
//
export class PrintService extends Service
{
    private _dynamo?  : Dynamo;
    private _s3?      : S3;
    private _sqs?     : Sqs;
    private _kafka?   : Kafka;
    private _secrets? : Secrets;
    private _workQueue? : WorkQueue;
    private _cache?   : Cache;

    /** The mail-fulfillment adapter registry (PostGrid / Lob / fake). */
    protected readonly mailProviders : MailFactory = new MailFactory();
    /** The address-verification adapter registry — SEPARATE from `mailProviders` (print-2.6): verify with one
     *  source, mail with another. */
    protected readonly addressVerifiers : AddressVerifierFactory = new AddressVerifierFactory();

    ////////////////////////////////////////////////////////////////////////////////////////////
    constructor( role : PrintService.Role )
    {
        super( Register.Service.PRINT, role, PrintService.PORT[ role ] );
        const pkg : Application.PackageInfo = this.loadPackageInfo( __dirname );
        this.setVersion( pkg.version );
        this.log.info( "version", { name: pkg.name, version: pkg.version } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** DynamoDB facade — mailpieces / templates / tracking / suppression / the global address database. */
    public get dynamo() : Dynamo { return this._dynamo ??= new Dynamo( this.cloud ); }
    /** S3 facade — rendered proof PDFs (archived, never expired — print-8.2). */
    public get s3() : S3 { return this._s3 ??= new S3( this.cloud ); }
    /** SQS facade — the print-render / print-submit / print-tracking work queues. */
    public get sqs() : Sqs { return this._sqs ??= new Sqs( this.cloud ); }
    /** Kafka facade — print.mailpiece / print.template lifecycle events, best-effort. */
    public get kafka() : Kafka { return this._kafka ??= new Kafka( this.cloud ); }
    /** Secrets facade — mail-fulfillment + address-verifier credentials (resolved by each config's `secretRef`). */
    public get secrets() : Secrets { return this._secrets ??= new Secrets( this.cloud ); }
    /** The `WorkQueue` dispatch governor — print's adoption for paced batch submission (print-9.4): per-account
     *  submit rate (token bucket, seeded from `PrintConfig.limits.defaultRatePerMinute`) + concurrency, fairly
     *  ordered across accounts. */
    public get workQueue() : WorkQueue
    {
        return this._workQueue ??= new WorkQueue( this.cloud, "print", {
            limits: { perMinute: PrintConfig.DEFAULT.limits.defaultRatePerMinute },
            batchSize: 20, lowWaterMark: 50, leaseSeconds: 120,
        } );
    }
    /** Redis facade — same `"cache"` resource the `WorkQueue` governor uses; also backs the dispatch-loop
     *  single-flight lock. */
    public get cache() : Cache { return this._cache ??= new Cache( this.cloud, "cache" ); }

    /** The `Webhook` helper, configured for ONE mail-fulfillment provider's signature scheme. */
    public webhookFor( provider : Print.Provider ) : Webhook
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
        const seeded : Type.Result<PrintConfig.Config> = await this.appConfig.ensureSeeded( "config", "settings", PrintConfig.DEFAULT );
        if( seeded.ok ) this.log.info( "print config ready" );
        else this.log.warn( "print config seed failed — using DEFAULT until deployed", { error: seeded.error } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** The live runtime config (AppConfig config/settings), deep-filled from DEFAULT so an older/partial hosted
     *  row tolerates schema drift. */
    public async printConfig() : Promise<PrintConfig.Config>
    {
        const got : Type.Result<PrintConfig.Config | undefined> = await this.appConfig.json<PrintConfig.Config>( "config", "settings" );
        this.log.trace( "config read: config/settings", { found: got.ok && got.data !== undefined } );
        return got.ok && got.data ? ObjectUtils.withDefaults( got.data, PrintConfig.DEFAULT ) : PrintConfig.DEFAULT;
    }

    /** Persist a new config version + deploy it (AppConfig control plane). */
    public async saveConfig( config : PrintConfig.Config, environment : string = process.env.APPCONFIG_ENV ?? "default" ) : Promise<Type.Result<void>>
    {
        const profileId : Type.Result<string> = await this.appConfig.profileId( "config", "settings" );
        if( !profileId.ok ) return { ok: false, error: profileId.error };
        const environmentId : Type.Result<string> = await this.appConfig.environmentId( "config", environment );
        if( !environmentId.ok ) return { ok: false, error: environmentId.error };
        const version : Type.Result<number> = await this.appConfig.createVersion( "config", profileId.data, JSON.stringify( config ) );
        if( !version.ok ) return { ok: false, error: version.error };
        const deployed : Type.Result<number> = await this.appConfig.deploy( "config", profileId.data, environmentId.data, version.data, { description: "print config update" } );
        if( !deployed.ok ) return { ok: false, error: deployed.error };
        return { ok: true, data: undefined };
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // ── Mailpieces — enqueue (print-1/6) ──────────────────────────────────────────────────────

    /** ENQUEUE a single mailpiece — writes a DRAFT row, then drops it onto the print-render queue. */
    public async enqueueMailpiece( fields : PrintService.MailpieceInput ) : Promise<Type.Result<string>>
    {
        const mailId : string = randomUUID();
        const now : string = new Date().toISOString();
        const row : Print.Mailpiece =
        {
            accountId: fields.accountId, mailId, type: fields.type, templateId: fields.templateId,
            mergeData: fields.mergeData ?? {}, recipient: fields.recipient, sender: fields.sender,
            provider: fields.provider ?? Print.Provider.FAKE, mailClass: fields.mailClass ?? Print.MailClass.MARKETING,
            status: Print.MailpieceStatus.DRAFT, campaignId: fields.campaignId, contactId: fields.contactId,
            arriveBy: fields.arriveBy, createdAt: now, updatedAt: now,
        };
        const wrote : Type.Result<void> = await this.putMailpiece( row );
        if( !wrote.ok ) return { ok: false, error: wrote.error };
        await this.emitMailpiece( Events.Verb.CREATED, row );

        const sent : Type.Result<void> = await this.sqs.send( "print-render", { mailId, accountId: fields.accountId } );
        if( !sent.ok ) return { ok: false, error: sent.error };
        this.log.trace( "message enqueued (SQS print-render)", { mailId, accountId: fields.accountId } );
        return { ok: true, data: mailId };
    }

    /** ENQUEUE a batch — one row + one render job per recipient. Cost-cap allocation enforcement against the
     *  campaign's budget slice (print-6.3) is a documented follow-up — no `campaign` S2S client is wired yet,
     *  so this admits the whole batch today. */
    public async enqueueMailpiecesBatch( fields : PrintService.BatchInput ) : Promise<Type.Result<Array<string>>>
    {
        const config : PrintConfig.Config = await this.printConfig();
        if( fields.recipients.length > config.limits.maxRecipientsPerBatch )
            return { ok: false, error: `batch exceeds maxRecipientsPerBatch (${ config.limits.maxRecipientsPerBatch })` };

        const mailIds : Array<string> = [];
        for( const recipientRow of fields.recipients )
        {
            const enqueued : Type.Result<string> = await this.enqueueMailpiece( {
                accountId: fields.accountId, type: fields.type, templateId: fields.templateId,
                mergeData: recipientRow.mergeData, recipient: recipientRow.recipient, sender: fields.sender,
                provider: fields.provider, mailClass: fields.mailClass, campaignId: fields.campaignId,
                contactId: recipientRow.contactId, arriveBy: fields.arriveBy,
            } );
            if( enqueued.ok ) mailIds.push( enqueued.data );
            else this.log.warn( "batch: one recipient failed to enqueue", { accountId: fields.accountId, error: enqueued.error } );
        }
        return { ok: true, data: mailIds };
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** WORKER: render one mailpiece end-to-end — verify the recipient address (suppress on a bad/undeliverable
     *  result), render the proof PDF, store it, then hand off to the paced `WorkQueue` submit governor. Never
     *  throws (a failure is logged + the row marked FAILED). */
    public async processRender( accountId : string, mailId : string ) : Promise<void>
    {
        const found : Type.Result<Print.Mailpiece | undefined> = await this.getMailpiece( accountId, mailId );
        if( !found.ok || found.data === undefined ) { this.log.warn( "render skipped — mailpiece not found", { accountId, mailId } ); return; }
        const piece : Print.Mailpiece = found.data;

        const verifyResult : Type.Result<Print.AddressVerifyResult> = await this.verifyAddress( { accountId, address: piece.recipient, contactId: piece.contactId } );
        if( !verifyResult.ok )
        {
            await this.updateMailpiece( piece, { status: Print.MailpieceStatus.FAILED, error: verifyResult.error } );
            return;
        }
        if( verifyResult.data.verification.deliverability === Print.Deliverability.UNDELIVERABLE || verifyResult.data.verification.deceased || verifyResult.data.verification.vacant )
        {
            await this.updateMailpiece( piece, { status: Print.MailpieceStatus.SUPPRESSED, addressVerification: verifyResult.data.verification } );
            return;
        }

        const template : Type.Result<Print.Template | undefined> = await this.getTemplate( accountId, piece.templateId );
        if( !template.ok || template.data === undefined )
        {
            await this.updateMailpiece( piece, { status: Print.MailpieceStatus.FAILED, error: "template not found" } );
            return;
        }

        const pdfBytes : Uint8Array = await ProofRenderer.render( piece.type, template.data, piece.mergeData, verifyResult.data.verification.standardized );
        const key : string = `mailpieces/${ accountId }/${ mailId }.pdf`;
        const stored : Type.Result<void> = await this.s3.put( "print", key, Buffer.from( pdfBytes ), "application/pdf" );
        if( !stored.ok )
        {
            await this.updateMailpiece( piece, { status: Print.MailpieceStatus.FAILED, error: stored.error } );
            return;
        }

        const updated : Print.Mailpiece = { ...piece, status: Print.MailpieceStatus.READY, renderedPdfKey: key, addressVerification: verifyResult.data.verification, updatedAt: new Date().toISOString() };
        await this.putMailpiece( updated );
        await this.emitMailpiece( Events.Verb.UPDATED, updated );
        this.log.info( "mailpiece rendered", { accountId, mailId, key } );

        await this.queueSubmit( updated );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // hand ONE ready mailpiece to the `WorkQueue` governor for paced submission (print-9.4).
    private async queueSubmit( piece : Print.Mailpiece ) : Promise<void>
    {
        await this.workQueue.enqueue( {
            jobId: piece.mailId, accountId: piece.accountId, queue: "print", priority: 5, payloadRef: piece.mailId,
            idempotencyKey: piece.mailId, createdAt: new Date().toISOString(), meta: { mailId: piece.mailId, accountId: piece.accountId },
        } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** COORDINATOR TICK: pull the next paced batch from the `WorkQueue` governor and actually submit those
     *  mailpieces to their mail-fulfillment provider. Driven by `PrintMainService`'s self-scheduled dispatch
     *  loop. Never throws (one bad lease is logged and skipped). */
    public async dispatchPending() : Promise<void>
    {
        const leases : Array<WorkQueue.Lease> = await this.workQueue.dispatch();
        if( leases.length === 0 ) return;
        this.log.trace( "dispatch round", { leased: leases.length } );
        for( const lease of leases ) await this.dispatchOne( lease );
    }

    // submit ONE governed mailpiece: resolve the adapter + a fresh credential, presign the rendered PDF,
    // submit, then update the mailpiece row + settle the WorkQueue job.
    private async dispatchOne( lease : WorkQueue.Lease ) : Promise<void>
    {
        const meta : { mailId? : string; accountId? : string } = lease.job.meta as unknown as { mailId? : string; accountId? : string };
        if( meta.mailId === undefined || meta.accountId === undefined ) { await this.workQueue.fail( lease.job.jobId, "missing dispatch metadata" ); return; }

        const found : Type.Result<Print.Mailpiece | undefined> = await this.getMailpiece( meta.accountId, meta.mailId );
        if( !found.ok || found.data === undefined ) { await this.workQueue.fail( lease.job.jobId, "mailpiece not found" ); return; }
        const piece : Print.Mailpiece = found.data;
        if( piece.renderedPdfKey === undefined ) { await this.workQueue.fail( lease.job.jobId, "mailpiece has no rendered PDF" ); return; }

        const adapter : MailProvider | undefined = this.mailProviders.get( piece.provider );
        if( adapter === undefined ) { await this.workQueue.fail( lease.job.jobId, `no adapter for provider ${ piece.provider }` ); return; }
        const config : PrintConfig.Config = await this.printConfig();
        const ctx : MailContext = await this.providerContext( piece.provider, config );
        const presigned : Type.Result<string> = await this.s3.presignGet( "print", piece.renderedPdfKey, 3600 );
        if( !presigned.ok ) { await this.workQueue.fail( lease.job.jobId, presigned.error ); return; }

        const submission : MailSubmission =
        {
            mailId: piece.mailId, type: piece.type, mailClass: piece.mailClass, recipient: piece.recipient,
            sender: piece.sender, pdfUrl: presigned.data, webhookUrl: PrintService.webhookUrl( piece.provider ),
        };
        const result : MailSubmitResult = await adapter.submit( submission, ctx );
        const status : Print.MailpieceStatus = result.ok ? Print.MailpieceStatus.SUBMITTED : Print.MailpieceStatus.FAILED;
        const updated : Print.Mailpiece = { ...piece, status, providerRefId: result.providerRefId, costEstimateCents: result.costEstimateCents ?? piece.costEstimateCents, error: result.error, updatedAt: new Date().toISOString() };
        await this.putMailpiece( updated );
        await this.emitMailpiece( Events.Verb.UPDATED, updated );

        if( result.ok ) this.log.info( "mailpiece submitted", { accountId: piece.accountId, mailId: piece.mailId, provider: piece.provider, providerRefId: result.providerRefId } );
        else this.log.warn( "mailpiece submit failed", { accountId: piece.accountId, mailId: piece.mailId, retryable: result.retryable, error: result.error } );

        await this.workQueue.complete( lease.job.jobId );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // ── Tracking ingestion (print-4) ──────────────────────────────────────────────────────────

    /** ENQUEUE an inbound tracking-webhook event — ACK-fast (the webhook's fast path). */
    public async enqueueTracking( provider : Print.Provider, payload : Record<string, unknown> ) : Promise<Type.Result<void>>
    {
        const sent : Type.Result<void> = await this.sqs.send( "print-tracking", { provider, payload } );
        if( sent.ok ) this.log.trace( "message enqueued (SQS print-tracking)", { provider } );
        return sent;
    }

    /** WORKER: normalize an inbound provider tracking event, resolve its owning account (the webhook is ONE
     *  global endpoint per provider, not per-account — see `gsi_mailid`), write the `TrackingEvent` row, and
     *  update the mailpiece's status. Never throws. */
    public async processTracking( provider : Print.Provider, payload : Record<string, unknown> ) : Promise<void>
    {
        const adapter : MailProvider | undefined = this.mailProviders.get( provider );
        if( adapter === undefined ) { this.log.warn( "tracking ignored — no adapter for provider", { provider } ); return; }
        const normalized = adapter.trackingNormalize( payload );
        if( normalized.mailId === undefined ) { this.log.warn( "tracking ignored — payload carried no mailId", { provider } ); return; }

        const piece : Print.Mailpiece | undefined = await this.findMailpieceByMailId( normalized.mailId );
        if( piece === undefined ) { this.log.warn( "tracking ignored — mailpiece not found", { provider, mailId: normalized.mailId } ); return; }

        const event : Print.TrackingEvent = { accountId: piece.accountId, mailId: normalized.mailId, status: normalized.status, occurredAt: normalized.occurredAt, providerEventId: normalized.providerEventId };
        const wrote : Type.Result<void> = await this.dynamo.put( "print_tracking", { ...event, sk: `MAIL#${ event.mailId }#${ event.occurredAt }` } );
        if( !wrote.ok ) this.log.warn( "tracking event write failed", { accountId: piece.accountId, mailId: event.mailId, error: wrote.error } );

        const status : Print.MailpieceStatus = PrintService.MAILPIECE_STATUS_FROM_TRACKING[ normalized.status ];
        await this.updateMailpiece( piece, { status } );

        // analytics-1.7: also record this scan as a canonical engagement event (the OPERATIONAL reaction
        // above and this HISTORY emit are not either/or — see apps/core/analytics/SPECS.md "Architecture")
        await this.emitEngagementEvent( piece, event );
    }

    // resolve a mailpiece's owning account from its mailId alone — the tracking webhook doesn't carry accountId.
    private async findMailpieceByMailId( mailId : string ) : Promise<Print.Mailpiece | undefined>
    {
        const found : Type.Result<Array<Print.Mailpiece>> = await this.dynamo.query<Print.Mailpiece>( "print_mailpieces", {
            IndexName: "gsi_mailid", KeyConditionExpression: "mailId = :m", ExpressionAttributeValues: { ":m": mailId },
        } );
        if( !found.ok || found.data.length === 0 ) return undefined;
        return found.data[ 0 ];
    }

    /** Verify a provider webhook's signature — fails closed when the provider/credential can't be resolved. */
    public async verifyWebhook( provider : Print.Provider, headers : Record<string, string | undefined>, url : string, body : Record<string, unknown> ) : Promise<boolean>
    {
        const adapter : MailProvider | undefined = this.mailProviders.get( provider );
        if( adapter === undefined ) return false;
        const config : PrintConfig.Config = await this.printConfig();
        const ctx : MailContext = await this.providerContext( provider, config );
        return adapter.verifySignature( headers, url, body, ctx );
    }

    /** A mailpiece's tracking-event timeline, oldest first. */
    public async listTracking( accountId : string, mailId : string ) : Promise<Type.Result<Array<Print.TrackingEvent>>>
    {
        return this.dynamo.query<Print.TrackingEvent>( "print_tracking", {
            KeyConditionExpression: "accountId = :a AND begins_with( sk, :prefix )",
            ExpressionAttributeValues: { ":a": accountId, ":prefix": `MAIL#${ mailId }#` },
        } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // ── Mailpiece store (print-8.1) ───────────────────────────────────────────────────────────

    public async getMailpiece( accountId : string, mailId : string ) : Promise<Type.Result<Print.Mailpiece | undefined>>
    { return this.dynamo.get<Print.Mailpiece>( "print_mailpieces", { accountId, mailId } ); }

    public async listMailpieces( accountId : string, filters : { campaignId? : string; status? : Print.MailpieceStatus } = {} ) : Promise<Type.Result<Array<Print.Mailpiece>>>
    {
        const found : Type.Result<Array<Print.Mailpiece>> = await this.dynamo.query<Print.Mailpiece>( "print_mailpieces", {
            KeyConditionExpression: "accountId = :a", ExpressionAttributeValues: { ":a": accountId },
        } );
        if( !found.ok ) return found;
        const filtered : Array<Print.Mailpiece> = found.data.filter( ( row : Print.Mailpiece ) : boolean =>
            ( filters.campaignId === undefined || row.campaignId === filters.campaignId ) &&
            ( filters.status === undefined || row.status === filters.status ) );
        return { ok: true, data: filtered };
    }

    private async putMailpiece( row : Print.Mailpiece ) : Promise<Type.Result<void>>
    {
        const wrote : Type.Result<void> = await this.dynamo.put( "print_mailpieces", { ...row } );
        if( !wrote.ok ) this.log.warn( "mailpiece write failed", { accountId: row.accountId, mailId: row.mailId, error: wrote.error } );
        else this.log.trace( "item stored: print_mailpieces", { accountId: row.accountId, mailId: row.mailId, status: row.status } );
        return wrote;
    }

    private async updateMailpiece( piece : Print.Mailpiece, patch : Partial<Print.Mailpiece> ) : Promise<void>
    {
        const row : Print.Mailpiece = { ...piece, ...patch, updatedAt: new Date().toISOString() };
        await this.putMailpiece( row );
        await this.emitMailpiece( Events.Verb.UPDATED, row );
    }

    /** Approve a mailpiece's rendered proof (print-1.4) — required before large-run submission. */
    public async approveMailpiece( accountId : string, mailId : string, approvedBy : string ) : Promise<Type.Result<boolean>>
    {
        const found : Type.Result<Print.Mailpiece | undefined> = await this.getMailpiece( accountId, mailId );
        if( !found.ok ) return { ok: false, error: found.error };
        if( found.data === undefined ) return { ok: true, data: false };
        await this.updateMailpiece( found.data, { status: Print.MailpieceStatus.PROOF_APPROVED, approvedAt: new Date().toISOString(), approvedBy } );
        return { ok: true, data: true };
    }

    /** Publish a `print.mailpiece` lifecycle event (best-effort). */
    public async emitMailpiece( verb : Events.Verb, entity : Print.Mailpiece ) : Promise<void>
    {
        const published : Type.Result<void> = await this.kafka.publishEvent( Events.envelope( {
            object: Events.Object.PRINT_MAILPIECE, verb, accountId: entity.accountId,
            target: { type: "print.mailpiece", id: entity.mailId }, data: entity,
        } ) );
        if( !published.ok ) this.log.warn( "print.mailpiece event publish failed", { mailId: entity.mailId, verb, error: published.error } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // ── Templates (print-1.1/3.3) ─────────────────────────────────────────────────────────────

    public async getTemplate( accountId : string, id : string ) : Promise<Type.Result<Print.Template | undefined>>
    { return this.dynamo.get<Print.Template>( "print_templates", { accountId, id } ); }

    public async listTemplates( accountId : string ) : Promise<Type.Result<Array<Print.Template>>>
    {
        const found : Type.Result<Array<Print.Template>> = await this.dynamo.query<Print.Template>( "print_templates", {
            KeyConditionExpression: "accountId = :a", ExpressionAttributeValues: { ":a": accountId },
        } );
        if( !found.ok ) return found;
        return { ok: true, data: found.data.filter( ( row : Print.Template ) : boolean => !row.archived ) };
    }

    public async createTemplate( accountId : string, name : string, type : Print.MailpieceType, schema : Record<string, unknown> = {} ) : Promise<Type.Result<Print.Template>>
    {
        const now : string = new Date().toISOString();
        const template : Print.Template = { id: randomUUID(), accountId, name, type, schema, createdAt: now, updatedAt: now };
        const wrote : Type.Result<void> = await this.dynamo.put( "print_templates", { ...template } );
        if( !wrote.ok ) return { ok: false, error: wrote.error };
        await this.emitTemplate( Events.Verb.CREATED, template );
        return { ok: true, data: template };
    }

    public async updateTemplate( accountId : string, id : string, patch : { name? : string; schema? : Record<string, unknown> } ) : Promise<Type.Result<Print.Template | undefined>>
    {
        const found : Type.Result<Print.Template | undefined> = await this.getTemplate( accountId, id );
        if( !found.ok || found.data === undefined ) return found;
        const template : Print.Template = { ...found.data, ...patch, updatedAt: new Date().toISOString() };
        const wrote : Type.Result<void> = await this.dynamo.put( "print_templates", { ...template } );
        if( !wrote.ok ) return { ok: false, error: wrote.error };
        await this.emitTemplate( Events.Verb.UPDATED, template );
        return { ok: true, data: template };
    }

    public async archiveTemplate( accountId : string, id : string ) : Promise<Type.Result<boolean>>
    {
        const found : Type.Result<Print.Template | undefined> = await this.getTemplate( accountId, id );
        if( !found.ok ) return { ok: false, error: found.error };
        if( found.data === undefined ) return { ok: true, data: false };
        const template : Print.Template = { ...found.data, archived: true, updatedAt: new Date().toISOString() };
        const wrote : Type.Result<void> = await this.dynamo.put( "print_templates", { ...template } );
        if( !wrote.ok ) return { ok: false, error: wrote.error };
        await this.emitTemplate( Events.Verb.DELETED, template );
        return { ok: true, data: true };
    }

    /** Publish a `print.template` lifecycle event (best-effort). */
    public async emitTemplate( verb : Events.Verb, entity : Print.Template ) : Promise<void>
    {
        const published : Type.Result<void> = await this.kafka.publishEvent( Events.envelope( {
            object: Events.Object.PRINT_TEMPLATE, verb, accountId: entity.accountId,
            target: { type: "print.template", id: entity.id }, data: entity,
        } ) );
        if( !published.ok ) this.log.warn( "print.template event publish failed", { id: entity.id, verb, error: published.error } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // ── Proof + cost preview (print-1.4/6.2) ──────────────────────────────────────────────────

    /** Render a standalone proof PDF for a template + sample merge data — creates no mailpiece. */
    public async renderProof( accountId : string, templateId : string, mergeData : Record<string, unknown> = {} ) : Promise<Type.Result<Print.ProofResult>>
    {
        const found : Type.Result<Print.Template | undefined> = await this.getTemplate( accountId, templateId );
        if( !found.ok ) return { ok: false, error: found.error };
        if( found.data === undefined ) return { ok: false, error: "template not found" };

        const pdfBytes : Uint8Array = await ProofRenderer.render( found.data.type, found.data, mergeData );
        const key : string = `proofs/${ accountId }/${ randomUUID() }.pdf`;
        const stored : Type.Result<void> = await this.s3.put( "print", key, Buffer.from( pdfBytes ), "application/pdf" );
        if( !stored.ok ) return { ok: false, error: stored.error };
        const presigned : Type.Result<string> = await this.s3.presignGet( "print", key, 3600 );
        if( !presigned.ok ) return { ok: false, error: presigned.error };
        return { ok: true, data: { proofUrl: presigned.data } };
    }

    /** Per-piece × recipients cost + production/transit lead-time estimate (print-6.2). Uses the FAKE
     *  adapter's illustrative rate table when the resolved provider has no live pricing call wired yet — real
     *  providers quote per-account contract pricing, a documented follow-up once credentials land. */
    public async costPreview( request : Print.CostPreviewRequest ) : Promise<Print.CostPreviewResult>
    {
        const perPieceCents : number = PrintService.RATE_CENTS[ request.type ];
        const leadTimeDays : number = PrintService.LEAD_TIME_DAYS[ request.mailClass ] + PrintService.PRODUCTION_DAYS[ request.type ];
        return { perPieceCents, recipients: request.recipients, totalCents: perPieceCents * request.recipients, leadTimeDays, mailClass: request.mailClass };
    }

    private static readonly RATE_CENTS : Record<Print.MailpieceType, number> =
    { [ Print.MailpieceType.POSTCARD ]: 55, [ Print.MailpieceType.LETTER ]: 120, [ Print.MailpieceType.SELF_MAILER ]: 95, [ Print.MailpieceType.CHECK ]: 200 };
    private static readonly PRODUCTION_DAYS : Record<Print.MailpieceType, number> =
    { [ Print.MailpieceType.POSTCARD ]: 1, [ Print.MailpieceType.LETTER ]: 2, [ Print.MailpieceType.SELF_MAILER ]: 2, [ Print.MailpieceType.CHECK ]: 2 };
    private static readonly LEAD_TIME_DAYS : Record<Print.MailClass, number> =
    { [ Print.MailClass.FIRST_CLASS ]: 3, [ Print.MailClass.MARKETING ]: 10 };

    ////////////////////////////////////////////////////////////////////////////////////////////
    // ── Address verification (print-2) — global, contact-free VerifiedAddress cache ──────────

    /** CASS (+ optional NCOA) address verification (print-2.1/2.2/2.7/2.8). Served from the global
     *  `VerifiedAddress` cache when possible; charge-once-per-account via `AddressUsage`. */
    public async verifyAddress( request : Print.AddressVerifyRequest ) : Promise<Type.Result<Print.AddressVerifyResult>>
    {
        const config : PrintConfig.Config = await this.printConfig();
        const hash : string = PrintService.addrHash( request.address );

        // 1. address-intrinsic layer — the GLOBAL cache (print-2.7)
        const cached : Type.Result<Print.VerifiedAddress | undefined> = await this.dynamo.get<Print.VerifiedAddress>( "print_address", { addrHash: hash, sk: "META" } );
        if( !cached.ok ) return { ok: false, error: cached.error };

        let record : Print.VerifiedAddress | undefined = cached.data;
        const isFresh : boolean = record !== undefined && ( record.freshUntil === undefined || record.freshUntil > new Date().toISOString() );
        const cacheHit : boolean = record !== undefined && isFresh;

        if( !cacheHit )
        {
            const verifierId : Print.AddressVerifierId = request.verifier ?? config.defaultAddressVerifier;
            const adapter : AddressVerifierProvider | undefined = this.addressVerifiers.get( verifierId );
            if( adapter === undefined ) return { ok: false, error: `no address-verifier adapter for ${ verifierId }` };
            const ctx = { secret: await this.verifierSecret( verifierId, config ) };
            const result : CassResult = await adapter.verifyCass( request.address, ctx );
            if( !result.ok || result.standardized === undefined ) return { ok: false, error: result.error ?? "address verification failed" };

            const freshDays : number | undefined = config.addressFreshDays;
            record =
            {
                addrHash: hash, standardized: result.standardized, deliverability: result.deliverability ?? Print.Deliverability.UNKNOWN,
                vacant: result.vacant, verifier: verifierId, externalRefId: result.externalRefId, verifiedAt: new Date().toISOString(),
                freshUntil: freshDays !== undefined ? new Date( Date.now() + freshDays * 86400000 ).toISOString() : undefined,
            };
            const wrote : Type.Result<void> = await this.dynamo.put( "print_address", { ...record, sk: "META" } );
            if( !wrote.ok ) this.log.warn( "VerifiedAddress cache write failed", { addrHash: hash, error: wrote.error } );
        }

        // 2. person-specific layer — NCOA (print-2.2/gap #5). No `contact` S2S client is wired yet, so this
        // does a live per-request call rather than the documented contact-scoped ≤95d cache — a follow-up.
        let ncoaApplied : boolean | undefined;
        let deceased : boolean | undefined;
        if( request.ncoa )
        {
            const verifierId : Print.AddressVerifierId = request.verifier ?? config.defaultAddressVerifier;
            const adapter : AddressVerifierProvider | undefined = this.addressVerifiers.get( verifierId );
            if( adapter !== undefined && adapter.capabilities.includes( Print.Capability.NCOA ) )
            {
                const ctx = { secret: await this.verifierSecret( verifierId, config ) };
                const ncoa : NcoaResult = await adapter.verifyNcoa( record!.standardized, ctx );
                if( ncoa.ok ) { ncoaApplied = ncoa.moved ?? false; deceased = ncoa.deceased; }
                else this.log.warn( "NCOA lookup failed", { addrHash: hash, error: ncoa.error } );
            }
            else this.log.warn( "NCOA requested but resolved verifier has no ncoa capability", { verifier: verifierId } );
        }

        // 3. billing — charge-once-per-account (print-2.8)
        const charged : boolean = await this.chargeAddressUsage( hash, request.accountId, !cacheHit );

        const verification : Print.AddressVerification =
        { standardized: record!.standardized, deliverability: record!.deliverability, vacant: record!.vacant, ncoaApplied, deceased, verifier: record!.verifier, verifiedAt: record!.verifiedAt, cacheHit };
        return { ok: true, data: { verification, cacheHit, charged } };
    }

    // charge-once-per-account (print-2.8) — returns whether THIS call actually charged the account.
    private async chargeAddressUsage( addrHash : string, accountId : string, wasVendorCost : boolean ) : Promise<boolean>
    {
        const existing : Type.Result<Print.AddressUsage | undefined> = await this.dynamo.get<Print.AddressUsage>( "print_address", { addrHash, sk: `ACCT#${ accountId }` } );
        if( existing.ok && existing.data !== undefined ) return false;   // already paid — idempotent, no double charge

        const usage : Print.AddressUsage = { addrHash, accountId, chargedAt: new Date().toISOString(), amountChargedCents: PrintService.ADDRESS_VERIFY_PRICE_CENTS, wasVendorCost, ourCostCents: wasVendorCost ? PrintService.ADDRESS_VERIFY_VENDOR_COST_CENTS : undefined };
        const wrote : Type.Result<void> = await this.dynamo.put( "print_address", { ...usage, sk: `ACCT#${ accountId }` } );
        if( !wrote.ok ) { this.log.warn( "AddressUsage write failed", { addrHash, accountId, error: wrote.error } ); return false; }
        return true;
    }

    private static readonly ADDRESS_VERIFY_PRICE_CENTS : number = 3;        // illustrative markup price
    private static readonly ADDRESS_VERIFY_VENDOR_COST_CENTS : number = 1;  // illustrative vendor cost

    /** A deterministic hash of a NORMALIZED address — the `VerifiedAddress` partition key (print-2.7). */
    public static addrHash( address : Print.Address ) : string
    {
        const normalized : string = [ address.line1, address.line2 ?? "", address.city, address.region, address.postalCode, address.country ]
            .map( ( part : string ) : string => part.trim().toUpperCase() ).join( "|" );
        return createHash( "sha256" ).update( normalized ).digest( "hex" );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // ── Retry / DLQ ────────────────────────────────────────────────────────────────────────────

    public async listDlq( queue? : Print.DlqQueue, max : number = 10 ) : Promise<Type.Result<Array<Print.DlqItem>>>
    {
        const queues : Array<Print.DlqQueue> = queue ? [ queue ] : Object.values( Print.DlqQueue );
        const items : Array<Print.DlqItem> = [];
        for( const oneQueue of queues )
        {
            const received : Type.Result<Array<Message>> = await this.sqs.receive( `${ oneQueue }-dlq`, Math.min( max, 10 ), 0 );
            if( !received.ok ) { this.log.warn( "dlq receive failed", { queue: oneQueue, error: received.error } ); continue; }
            for( const message of received.data )
            {
                const approxReceiveCount : number | undefined = message.Attributes?.ApproximateReceiveCount !== undefined ? Number( message.Attributes.ApproximateReceiveCount ) : undefined;
                items.push( { queue: oneQueue, messageId: message.MessageId ?? "", receiptHandle: message.ReceiptHandle ?? "", body: message.Body ?? "", approxReceiveCount } );
            }
        }
        return { ok: true, data: items };
    }

    public async requeueDlq( items : Array<Print.DlqItem> ) : Promise<Type.Result<number>>
    {
        let requeued : number = 0;
        for( const item of items )
        {
            const sent : Type.Result<void> = await this.sqs.send( item.queue, item.body );
            if( !sent.ok ) { this.log.warn( "dlq requeue send failed", { queue: item.queue, messageId: item.messageId, error: sent.error } ); continue; }
            const deleted : Type.Result<void> = await this.sqs.delete( `${ item.queue }-dlq`, item.receiptHandle );
            if( !deleted.ok ) this.log.warn( "dlq requeue delete failed", { queue: item.queue, messageId: item.messageId, error: deleted.error } );
            requeued += 1;
        }
        return { ok: true, data: requeued };
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** S2S forget hook (print-7.1) — purges address + merge data in every mailpiece addressed to `contactId`.
     *  The global, contact-free `VerifiedAddress` cache is NEVER touched (no person linkage — gap #8).
     *  Idempotent — matches zero rows for an unknown contact. */
    public async eraseContact( accountId : string, contactId : string ) : Promise<Type.Result<number>>
    {
        const found : Type.Result<Array<Print.Mailpiece>> = await this.listMailpieces( accountId );
        if( !found.ok ) return { ok: false, error: found.error };

        const matches : Array<Print.Mailpiece> = found.data.filter( ( row : Print.Mailpiece ) : boolean => row.contactId === contactId );
        for( const row of matches )
        {
            const erased : Print.Mailpiece =
            {
                ...row, mergeData: {}, contactId: undefined,
                recipient: { line1: "[erased]", city: "[erased]", region: "", postalCode: "", country: row.recipient.country },
                updatedAt: new Date().toISOString(),
            };
            await this.putMailpiece( erased );
        }
        this.log.info( "print erase applied", { accountId, contactId, rows: matches.length } );
        return { ok: true, data: matches.length };
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // resolve a mail-fulfillment provider's transport credential from the config's registry + Secrets.
    private async providerContext( provider : Print.Provider, config : PrintConfig.Config ) : Promise<MailContext>
    {
        if( provider === Print.Provider.FAKE ) return {};
        const entry : PrintConfig.ProviderEntry | undefined = config.providers[ provider ];
        if( entry?.secretRef === undefined ) return {};
        const secret : Type.Result<Record<string, unknown> | undefined> = await this.secrets.getJson<Record<string, unknown>>( entry.secretRef );
        return { secret: secret.ok ? secret.data : undefined };
    }

    // resolve an address-verifier source's credential from the config's registry + Secrets.
    private async verifierSecret( verifierId : Print.AddressVerifierId, config : PrintConfig.Config ) : Promise<Record<string, unknown> | undefined>
    {
        if( verifierId === Print.AddressVerifierId.FAKE ) return undefined;
        const entry : PrintConfig.VerifierEntry | undefined = config.addressVerifiers[ verifierId ];
        if( entry?.secretRef === undefined ) return undefined;
        const secret : Type.Result<Record<string, unknown> | undefined> = await this.secrets.getJson<Record<string, unknown>>( entry.secretRef );
        return secret.ok ? secret.data : undefined;
    }

    // the externally-reachable base URL this service's webhooks are hosted at.
    private static webhookBaseUrl() : string { return process.env.PRINT_PUBLIC_URL ?? `http://localhost:${ Ports.PRINT.MAIN }`; }

    /** The tracking-webhook URL handed to a mail-fulfillment provider at submit time. */
    public static webhookUrl( provider : Print.Provider ) : string { return `${ PrintService.webhookBaseUrl() }/api/print/v1/webhook/${ provider }`; }

    // provider tracking status → the mailpiece's own status vocabulary (a strict subset — see Print.MailpieceStatus).
    private static readonly MAILPIECE_STATUS_FROM_TRACKING : Record<Print.TrackingStatus, Print.MailpieceStatus> =
    {
        [ Print.TrackingStatus.IN_PRODUCTION ]: Print.MailpieceStatus.IN_PRODUCTION,
        [ Print.TrackingStatus.MAILED ]:        Print.MailpieceStatus.MAILED,
        [ Print.TrackingStatus.IN_TRANSIT ]:    Print.MailpieceStatus.IN_TRANSIT,
        [ Print.TrackingStatus.DELIVERED ]:     Print.MailpieceStatus.DELIVERED,
        [ Print.TrackingStatus.RETURNED ]:      Print.MailpieceStatus.RETURNED,
        [ Print.TrackingStatus.UNDELIVERABLE ]: Print.MailpieceStatus.UNDELIVERABLE,
    };

    // provider tracking status → the analytics canonical event-type taxonomy (analytics-1.2). IN_PRODUCTION
    // and IN_TRANSIT are internal/pre-engagement states — not emitted (`undefined` = skip).
    private static readonly ANALYTICS_EVENT_TYPE_FROM_TRACKING : Record<Print.TrackingStatus, Analytics.EventType | undefined> =
    {
        [ Print.TrackingStatus.IN_PRODUCTION ]: undefined,
        [ Print.TrackingStatus.MAILED ]:        Analytics.EventType.SENT,
        [ Print.TrackingStatus.IN_TRANSIT ]:    undefined,
        [ Print.TrackingStatus.DELIVERED ]:     Analytics.EventType.DELIVERED,
        [ Print.TrackingStatus.RETURNED ]:      Analytics.EventType.BOUNCED,
        [ Print.TrackingStatus.UNDELIVERABLE ]: Analytics.EventType.DELIVERY_FAILED,
    };

    /** Build + publish this tracking scan's `Analytics.Event` onto `Events.Stream.ENGAGEMENT` (analytics-1.7)
     *  — best-effort, never blocks the tracking worker. `piece.contactId` is already known (print addresses a
     *  specific contact at send time), so there's no identity-resolution/anonId step here — that's only
     *  needed for an INBOUND event from an unresolved sender (e.g. texting/email), not this outbound scan. */
    private async emitEngagementEvent( piece : Print.Mailpiece, event : Print.TrackingEvent ) : Promise<void>
    {
        const eventType : Analytics.EventType | undefined = PrintService.ANALYTICS_EVENT_TYPE_FROM_TRACKING[ event.status ];
        if( eventType === undefined ) return;   // not an engagement-worthy state (in-production / in-transit)

        const analyticsEvent : Analytics.Event =
        {
            eventId:         randomUUID(),
            occurredAt:      event.occurredAt,
            ingestedAt:      new Date().toISOString(),
            accountId:       event.accountId,
            campaignId:      piece.campaignId ?? null,
            messageId:       event.mailId,
            contactId:       piece.contactId ?? null,
            channel:         "print",
            provider:        "postgrid",   // TODO: carry the actual adapter id through TrackingEvent once print-4 threads it
            eventType,
            providerEventId: event.providerEventId ?? `${ event.mailId }:${ event.status }`,
        };
        const published : Type.Result<void> = await this.kafka.publishStream<Analytics.Event>(
            Events.Stream.ENGAGEMENT, analyticsEvent, { key: ( value : Analytics.Event ) : string => value.accountId } );
        if( !published.ok ) this.log.warn( "engagement event publish failed", { mailId: event.mailId, eventType, error: published.error } );
    }
}

export namespace PrintService
{
    export enum Role { MAIN = "main" }
    export const PORT : Record<Role, number> = { [ Role.MAIN ]: Ports.PRINT.MAIN };

    /** Fields to enqueue one mailpiece — the shape `PostPrintMailpieces`'s impl + the batch path share. */
    export interface MailpieceInput
    {
        accountId   : string;
        type        : Print.MailpieceType;
        templateId  : string;
        mergeData?  : Record<string, unknown>;
        recipient   : Print.Address;
        sender      : Print.Address;
        provider?   : Print.Provider;
        mailClass?  : Print.MailClass;
        campaignId? : string;
        contactId?  : string;
        arriveBy?   : string;
    }

    /** Fields to enqueue a batch — one shared template/sender + N recipient rows. */
    export interface BatchInput
    {
        accountId   : string;
        type        : Print.MailpieceType;
        templateId  : string;
        sender      : Print.Address;
        provider?   : Print.Provider;
        mailClass?  : Print.MailClass;
        campaignId? : string;
        arriveBy?   : string;
        recipients  : Array<{ recipient : Print.Address; mergeData? : Record<string, unknown>; contactId? : string }>;
    }
}

export default PrintService;
// eof

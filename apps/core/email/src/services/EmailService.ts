//
import { randomUUID } from "node:crypto";

import { Application, Service, Register, Dynamo, S3, Sqs, Kafka, Secrets, Ses, AnalyticsIdentity } from "@repo/services";
import { Events, Providers, Payloads } from "@repo/system";
import { Ports } from "@repo/cloud-manifest";
import { Email, EmailConfig, EmailTemplate, Notification, Analytics } from "@repo/api";
import { ObjectUtils } from "@repo/common";
import type { Type } from "@repo/common";

import { EmailFactory } from "../providers/EmailFactory";
import { EmailProvider, EmailContext } from "../providers/EmailProvider";
import { MjmlRenderer } from "../render/MjmlRenderer";

//
// EmailService — the email domain's Service BASE (not deployed alone). Holds the shared domain wiring (Dynamo +
// S3 + SQS + Kafka + Secrets + SES facades, the provider factory, the runtime config reader) so the concrete
// role (EmailMainService) inherits it. Owns the versioned template store (DDB frontend + S3 body history), the
// MJML/HTML compile, and the SEND worker (resolve recipients → render → gate → transport → log), run off the
// request path via the email-send queue.
//
export class EmailService extends Service
{
    private _dynamo?  : Dynamo;
    private _s3?      : S3;
    private _sqs?     : Sqs;
    private _kafka?   : Kafka;
    private _secrets? : Secrets;
    private _ses?     : Ses;
    private _analyticsIdentity? : AnalyticsIdentity;

    /** The transport-adapter registry (SES / Lettr / fake + marketplace). */
    protected readonly providers : EmailFactory = new EmailFactory();

    /** The reserved partition for PLATFORM/system templates (isolated from any account). */
    public static readonly SYSTEM_ACCOUNT : string = "system";

    ////////////////////////////////////////////////////////////////////////////////////////////
    constructor( role : EmailService.Role )
    {
        // super( serviceId, role, defaultLocalPort ) — env PORT overrides the default when set.
        super( Register.Service.EMAIL, role, EmailService.PORT[ role ] );

        // stamp the running version from package.json (walks up from bin/services at runtime)
        const pkg : Application.PackageInfo = this.loadPackageInfo( __dirname );
        this.setVersion( pkg.version );
        this.log.info( "version", { name: pkg.name, version: pkg.version } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** DynamoDB facade — the SoT for templates + send log + suppression. Lazy + cached. */
    public get dynamo() : Dynamo { return this._dynamo ??= new Dynamo( this.cloud ); }
    /** S3 facade — the per-version template body history. Lazy + cached. */
    public get s3() : S3 { return this._s3 ??= new S3( this.cloud ); }
    /** SQS facade — the email-send + email-feedback work queues. Lazy + cached. */
    public get sqs() : Sqs { return this._sqs ??= new Sqs( this.cloud ); }
    /** Kafka facade — email.template CRUD events, best-effort. Lazy + cached. */
    public get kafka() : Kafka { return this._kafka ??= new Kafka( this.cloud ); }
    /** Secrets facade — provider API keys (resolved by the config's `secretRef`). Lazy + cached. */
    public get secrets() : Secrets { return this._secrets ??= new Secrets( this.cloud ); }
    /** Resolves an unknown recipient address to an analytics `contactId`/`anonId` (analytics-1.7) — a known
     *  `recipient.contactId` short-circuits this; only a bare literal address needs it. Lazy + cached. */
    public get analyticsIdentity() : AnalyticsIdentity { return this._analyticsIdentity ??= new AnalyticsIdentity( this.cloud ); }
    /** SES facade — the IAM-auth SES transport (no API key). Lazy + cached. */
    public get ses() : Ses { return this._ses ??= new Ses( this.cloud ); }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Seed the runtime config on a fresh environment so the service (and the Console Config tab) have usable
     *  defaults from first boot. */
    protected override async init() : Promise<void>
    {
        super.init();
        const seeded : Type.Result<EmailConfig.Config> = await this.appConfig.ensureSeeded( "config", "settings", EmailConfig.DEFAULT );
        if( seeded.ok ) this.log.info( "email config ready" );
        else this.log.warn( "email config seed failed — using DEFAULT until deployed", { error: seeded.error } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** The live runtime config (AppConfig config/settings), deep-filled from DEFAULT so an older/partial hosted
     *  row tolerates schema drift. Exposed so endpoint impls (which can't reach the protected `appConfig`) read
     *  the provider/limits policy. */
    public async emailConfig() : Promise<EmailConfig.Config>
    {
        const got : Type.Result<EmailConfig.Config | undefined> = await this.appConfig.json<EmailConfig.Config>( "config", "settings" );
        this.log.trace( "config read: config/settings", { found: got.ok && got.data !== undefined } );
        return got.ok && got.data ? ObjectUtils.withDefaults( got.data, EmailConfig.DEFAULT ) : EmailConfig.DEFAULT;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Whether a usable transport ADAPTER exists for a provider (the factory knows it). MARKETPLACE resolves at
     *  install, so it's treated as available. Used to semantically validate a config's chosen default/system
     *  provider beyond the schema's enum-membership check. */
    public hasProviderAdapter( provider : Email.Provider ) : boolean
    {
        return provider === Email.Provider.MARKETPLACE || this.providers.get( provider ) !== undefined;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Persist a new config version + deploy it (AppConfig control plane) — the PUT-config write path. Resolves
     *  the profile + environment ids, creates a hosted version from the validated config, and rolls it out
     *  AllAtOnce. */
    public async saveConfig( config : EmailConfig.Config, environment : string = process.env.APPCONFIG_ENV ?? "default" ) : Promise<Type.Result<void>>
    {
        // resolve the AppConfig control-plane ids (names → ids)
        const profileId : Type.Result<string> = await this.appConfig.profileId( "config", "settings" );
        if( !profileId.ok ) return { ok: false, error: profileId.error };
        const environmentId : Type.Result<string> = await this.appConfig.environmentId( "config", environment );
        if( !environmentId.ok ) return { ok: false, error: environmentId.error };

        // create the version, then deploy it
        const version : Type.Result<number> = await this.appConfig.createVersion( "config", profileId.data, JSON.stringify( config ) );
        if( !version.ok ) return { ok: false, error: version.error };
        const deployed : Type.Result<number> = await this.appConfig.deploy( "config", profileId.data, environmentId.data, version.data, { description: "email config update" } );
        if( !deployed.ok ) return { ok: false, error: deployed.error };
        return { ok: true, data: undefined };
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // ── Template store (email-2) — DDB frontend + S3 per-version body history ─────────────────────

    /** List an account's templates (its own partition; pass SYSTEM_ACCOUNT for the platform set). */
    public async listTemplates( accountId : string ) : Promise<Type.Result<Array<EmailTemplate.Entity>>>
    {
        this.log.trace( "item query: email_templates", { accountId } );
        return this.dynamo.query<EmailTemplate.Entity>( "email_templates", {
            KeyConditionExpression:    "accountId = :a",
            ExpressionAttributeValues: { ":a": accountId },
        } );
    }

    /** One template by id. */
    public async getTemplate( accountId : string, templateId : string ) : Promise<Type.Result<EmailTemplate.Entity | undefined>>
    {
        this.log.trace( "item read: email_templates", { accountId, templateId } );
        return this.dynamo.get<EmailTemplate.Entity>( "email_templates", { accountId, templateId } );
    }

    /** Persist a template: append the version-history entry, write the DDB frontend, AND snapshot the version's
     *  full body to S3 (history). Best-effort on the S3 snapshot — a miss is logged, never fails the save (the
     *  DDB row is the current truth). */
    public async putTemplate( entity : EmailTemplate.Entity ) : Promise<Type.Result<void>>
    {
        // the DDB partition — SYSTEM templates live under the reserved "system" partition (the table PK is
        // `accountId`, so it's stamped even when the logical entity omits it for a platform template)
        const partition : string = entity.accountId ?? EmailService.SYSTEM_ACCOUNT;

        // append this version to the history log (replace any stale entry for the same version number)
        const info : EmailTemplate.VersionInfo = { version: entity.version, savedAt: entity.audit.modifiedAt, savedBy: entity.audit.modifiedBy, status: entity.status };
        const versions : Array<EmailTemplate.VersionInfo> = [ ...( entity.versions ?? [] ).filter( ( item : EmailTemplate.VersionInfo ) : boolean => item.version !== entity.version ), info ];
        const stored : EmailTemplate.Entity = { ...entity, versions };

        // DDB is the current-version frontend (doc/mjml/html + the version log inline for a fast read)
        const wrote : Type.Result<void> = await this.dynamo.put( "email_templates", { ...stored, accountId: partition, templateId: entity.id } );
        if( !wrote.ok ) return wrote;
        this.log.trace( "item stored: email_templates", { accountId: partition, templateId: entity.id, version: entity.version } );

        // S3 keeps the immutable per-version body snapshot for history/rollback (subject included so a restore
        // brings back the whole editable state, not just the block doc)
        const body : EmailTemplate.VersionBody = { version: entity.version, savedAt: entity.audit.modifiedAt, subject: entity.subject, doc: entity.doc, mjml: entity.mjml, html: entity.html };
        const key : string = EmailService.templateBodyKey( partition, entity.id, entity.version );
        const snapshot : Type.Result<void> = await this.s3.put( "email", key, JSON.stringify( body ), "application/json" );
        if( !snapshot.ok ) this.log.warn( "template body snapshot failed", { templateId: entity.id, version: entity.version, error: snapshot.error } );
        return { ok: true, data: undefined };
    }

    /** Read an immutable version-body snapshot from S3 (email-2.7). Returns undefined when that version's
     *  snapshot is absent (e.g. a save whose best-effort snapshot missed). */
    public async getTemplateVersionBody( accountId : string, templateId : string, version : number ) : Promise<Type.Result<EmailTemplate.VersionBody | undefined>>
    {
        const partition : string = accountId || EmailService.SYSTEM_ACCOUNT;
        const key : string = EmailService.templateBodyKey( partition, templateId, version );
        // fetch the JSON body and parse it — a missing object is a normal "no such version" (not an error)
        const got : Type.Result<{ Body? : { transformToString() : Promise<string> } }> = await this.s3.get( "email", key );
        if( !got.ok || !got.data.Body ) return { ok: true, data: undefined };
        const text : string = await got.data.Body.transformToString();
        const parsed : EmailTemplate.VersionBody = JSON.parse( text ) as EmailTemplate.VersionBody;
        return { ok: true, data: parsed };
    }

    /** Remove a template row (bodies remain in S3 history). */
    public async deleteTemplate( accountId : string, templateId : string ) : Promise<Type.Result<void>>
    {
        this.log.trace( "item removed: email_templates", { accountId, templateId } );
        return this.dynamo.remove( "email_templates", { accountId, templateId } );
    }

    /** Resolve the PUBLISHED template for a transactional case (scope's partition + notificationType), or
     *  undefined. Used by the send worker when a request names a `notificationType` instead of a `templateId`. */
    public async publishedTemplateFor( accountId : string, notificationType : Email.NotificationType ) : Promise<EmailTemplate.Entity | undefined>
    {
        this.log.trace( "item query: email_templates (byType)", { accountId, notificationType } );
        const found : Type.Result<Array<EmailTemplate.Entity>> = await this.dynamo.query<EmailTemplate.Entity>( "email_templates", {
            IndexName:                 "byType",
            KeyConditionExpression:    "accountId = :a AND notificationType = :t",
            ExpressionAttributeValues: { ":a": accountId, ":t": notificationType },
        } );
        if( !found.ok ) return undefined;
        return found.data.find( ( template : EmailTemplate.Entity ) : boolean => template.status === EmailTemplate.Status.PUBLISHED );
    }

    /** Compile a template's doc → mjml + html (called on save/publish). ASYNC — the mjml v5 engine is async. */
    public compile( doc : EmailTemplate.Doc ) : Promise<MjmlRenderer.Compiled> { return MjmlRenderer.render( doc ); }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Publish an `email.template` lifecycle event (best-effort — a bus miss is logged, never fails the request).
     *  The envelope's `data` is the template entity a websocket/webhook subscriber receives. */
    public async emitTemplate( verb : Events.Verb, entity : EmailTemplate.Entity, userId? : string ) : Promise<void>
    {
        const published : Type.Result<void> = await this.kafka.publishEvent( Events.envelope( {
            object:      Events.Object.EMAIL_TEMPLATE,
            verb,
            accountId:   entity.accountId ?? EmailService.SYSTEM_ACCOUNT,
            target:      { type: "email.template", id: entity.id },
            data:        entity,
            actorUserId: userId,
        } ) );
        if( !published.ok ) this.log.warn( "email.template event publish failed", { templateId: entity.id, verb, error: published.error } );
    }

    /** `email.template created` — a new template exists. */
    public templateCreated( entity : EmailTemplate.Entity, userId? : string ) : Promise<void> { return this.emitTemplate( Events.Verb.CREATED, entity, userId ); }
    /** `email.template updated` — name/subject/doc/status changed (edit / publish / archive). */
    public templateUpdated( entity : EmailTemplate.Entity, userId? : string ) : Promise<void> { return this.emitTemplate( Events.Verb.UPDATED, entity, userId ); }
    /** `email.template deleted` — the template row was removed. */
    public templateDeleted( entity : EmailTemplate.Entity, userId? : string ) : Promise<void> { return this.emitTemplate( Events.Verb.DELETED, entity, userId ); }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Publish an `email.message` event for a send-log row (best-effort — a bus miss is logged, never fails
     *  the send). The envelope's `data` is a slim `Payloads.EmailMessage`, not the full send-log entity. */
    public async emitMessage( row : Email.SendLog ) : Promise<void>
    {
        const payload : Payloads.EmailMessage = { id: row.messageId, accountId: row.accountId, to: row.to, subject: row.subject, status: row.status };
        const published : Type.Result<void> = await this.kafka.publishEvent( Events.envelope( {
            object:    Events.Object.EMAIL_MESSAGE,
            verb:      Events.Verb.CREATED,
            accountId: row.accountId,
            target:    { type: "email.message", id: row.messageId },
            data:      payload,
        } ) );
        if( !published.ok ) this.log.warn( "email.message event publish failed", { messageId: row.messageId, error: published.error } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // ── Send path (email-1 / email-5) ─────────────────────────────────────────────────────────────

    /** ENQUEUE a send — the endpoint's fast path. Drops the request onto the email-send queue and returns; the
     *  worker (drained by MAIN locally / a Job Lambda in prod) does the heavy resolve/render/transport. */
    public async enqueueSend( request : Email.SendRequest, delaySeconds : number = 0 ) : Promise<Type.Result<string>>
    {
        const jobId : string = randomUUID();
        // SQS delay caps at 900s — a longer scheduled lead is handled by the batch worker's paced re-enqueue
        // (or EventBridge Scheduler in prod); this delay paces the near-term fan-out.
        const sent : Type.Result<void> = await this.sqs.send( "email-send", { jobId, request }, delaySeconds > 0 ? { delaySeconds: Math.min( 900, delaySeconds ) } : {} );
        if( !sent.ok ) return { ok: false, error: sent.error };
        this.log.trace( "message enqueued (SQS email-send)", { jobId, accountId: request.accountId, delaySeconds } );
        return { ok: true, data: jobId };
    }

    /** The SQS delay (seconds, ≤ 900) for a SINGLE scheduled send — the lead until its `startAt`, enforced
     *  against the safe buffer. 0 for an immediate send. */
    public async sendDelaySeconds( schedule? : Email.SendSchedule ) : Promise<number>
    {
        if( schedule?.startAt === undefined ) return 0;
        const config : EmailConfig.Config = await this.emailConfig();
        const start : { startAt : string; timezone : string } = this.resolveStart( schedule, config );
        return Math.min( 900, Math.max( 0, Math.round( ( Date.parse( start.startAt ) - Date.now() ) / 1000 ) ) );
    }

    /** WORKER: process one enqueued send end-to-end — resolve recipients (contact UUIDs → address + merge),
     *  render the body (template / notification case / inline), gate each recipient (suppression + limits), then
     *  transport + log per recipient. Never throws (a bad send is logged FAILED, not raised). */
    public async processSend( request : Email.SendRequest ) : Promise<void>
    {
        this.log.trace( "processSend: start", { accountId: request.accountId, recipients: request.to.length, templateId: request.templateId, notificationType: request.notificationType } );
        const config : EmailConfig.Config = await this.emailConfig();
        const accountId : string = request.accountId ?? EmailService.SYSTEM_ACCOUNT;
        const system : boolean = request.notificationType !== undefined && EmailService.isSystemNotification( request.notificationType );

        // guard the batch size before doing any work (a cheap, real limit check)
        if( request.to.length > config.limits.maxRecipientsPerSend )
        {
            this.log.warn( "send rejected — too many recipients", { accountId, count: request.to.length, max: config.limits.maxRecipientsPerSend } );
            return;
        }

        // resolve the body ONCE (subject/html/text) — merged per-recipient below
        const rendered : EmailService.RenderedBody | undefined = await this.renderBody( request, accountId, system );
        if( rendered === undefined ) { this.log.warn( "send aborted — no renderable body", { accountId } ); return; }

        // pick + prepare the transport (provider override → else system/account default from config)
        const providerId : Email.Provider = request.provider ?? ( system ? config.systemProvider : config.defaultProvider );
        const adapter : EmailProvider | undefined = this.providers.get( providerId );
        if( adapter === undefined ) { this.log.warn( "send aborted — no adapter for provider", { accountId, provider: providerId } ); return; }
        const context : EmailContext = await this.providerContext( providerId, config );
        const providerEntry : EmailConfig.ProviderEntry | undefined = config.providers[ providerId ];

        // the verified from-identity (request override → template override → THIS PROVIDER's own default →
        // system sender fallback). The provider-level default lets an operator test several ESPs side by side,
        // each needing its own verified/sandboxed sending identity (e.g. a Mailgun sandbox domain).
        const from : string = EmailService.formatAddress( request.from ?? rendered.from ?? providerEntry?.from ?? EmailService.systemSenderFor( config, request.notificationType ) );

        // the reply-to override, if any (request override → template override → provider default → none)
        const replyToAddress : Email.Address | undefined = request.replyTo ?? rendered.replyTo ?? providerEntry?.replyTo;
        const replyTo : string | undefined = replyToAddress ? EmailService.formatAddress( replyToAddress ) : undefined;
        this.log.trace( "processSend: resolved identity", { accountId, provider: providerId, from, replyTo } );

        // fan out per recipient — each resolves its own address + merge context, gates, sends, and logs
        for( const recipient of request.to )
        {
            await this.sendToRecipient( recipient, { request, config, accountId, system, rendered, adapter, context, from, replyTo } );
        }
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // send to ONE recipient: resolve address + merge → suppression gate → merge subject/body → transport → log
    private async sendToRecipient( recipient : Email.Recipient, ctx : EmailService.SendContext ) : Promise<void>
    {
        // resolve the address + per-recipient merge fields (a contact UUID is resolved to its address here)
        const resolved : EmailService.ResolvedRecipient | undefined = await this.resolveRecipient( ctx.accountId, recipient );
        if( resolved === undefined ) { this.log.warn( "recipient skipped — unresolved", { accountId: ctx.accountId, contactId: recipient.contactId } ); return; }

        // suppression gate (unsubscribe / hard-bounce / complaint) — the account-scoped block list
        const suppressed : boolean = await this.isSuppressed( ctx.accountId, resolved.email );
        if( suppressed )
        {
            await this.writeLog( ctx.accountId, resolved.email, ctx.rendered.subject, ctx.request, Email.Status.SUPPRESSED,
                { provider: ctx.adapter.provider, from: ctx.from, replyTo: ctx.replyTo, html: ctx.rendered.html, text: ctx.rendered.text } );
            return;
        }

        // merge context = request-level data ← per-recipient overrides ← resolved contact fields (last wins)
        const mergeData : Record<string, unknown> = { ...( ctx.request.mergeData ?? {} ), ...( recipient.mergeData ?? {} ), ...resolved.merge };

        // render the final message for this recipient (placeholder name-merge just before send)
        const outbound : Email.Outbound =
        {
            idempotencyKey: ctx.request.idempotencyKey ?? randomUUID(),
            accountId:      ctx.system ? undefined : ctx.accountId,
            from:           ctx.from,
            replyTo:        ctx.replyTo,
            to:             [ resolved.email ],
            subject:        MjmlRenderer.merge( ctx.rendered.subject, mergeData ),
            html:           ctx.rendered.html !== undefined ? MjmlRenderer.merge( ctx.rendered.html, mergeData ) : undefined,
            text:           ctx.rendered.text !== undefined ? MjmlRenderer.merge( ctx.rendered.text, mergeData ) : undefined,
        };

        // transport + log the outcome
        this.log.trace( "message sending", { accountId: ctx.accountId, to: resolved.email, provider: ctx.adapter.provider } );
        const result : Email.SendResult = await ctx.adapter.send( outbound, ctx.context );
        const status : Email.Status = result.ok ? Email.Status.SENT : Email.Status.FAILED;
        const row : Email.SendLog = await this.writeLog( ctx.accountId, resolved.email, outbound.subject, ctx.request, status,
            { provider: ctx.adapter.provider, from: outbound.from, replyTo: outbound.replyTo, html: outbound.html, text: outbound.text, headers: outbound.headers,
              providerMessageId: result.providerMessageId, error: result.error } );
        await this.emitEngagementEvent( row, recipient.contactId );
        await this.emitMessage( row );
        if( result.ok ) this.log.info( "email sent", { accountId: ctx.accountId, to: resolved.email, provider: ctx.adapter.provider, providerMessageId: result.providerMessageId } );
        else this.log.warn( "email send failed", { accountId: ctx.accountId, to: resolved.email, retryable: result.retryable, error: result.error } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // render the subject + html/text body for a request: a stored template, a transactional case, or inline
    private async renderBody( request : Email.SendRequest, accountId : string, system : boolean ) : Promise<EmailService.RenderedBody | undefined>
    {
        // 1) an explicit stored template
        if( request.templateId !== undefined )
        {
            const template : Type.Result<EmailTemplate.Entity | undefined> = await this.getTemplate( accountId, request.templateId );
            if( template.ok && template.data ) return await this.bodyFromTemplate( template.data, request.subject );
        }

        // 2) a transactional case → its PUBLISHED template (system cases live in the SYSTEM partition)
        if( request.notificationType !== undefined )
        {
            const partition : string = system ? EmailService.SYSTEM_ACCOUNT : accountId;
            const template : EmailTemplate.Entity | undefined = await this.publishedTemplateFor( partition, request.notificationType );
            if( template !== undefined ) return await this.bodyFromTemplate( template, request.subject );
        }

        // 3) inline html/text (no template) — the raw-body path
        if( request.html !== undefined || request.text !== undefined )
            return { subject: request.subject ?? "", html: request.html, text: request.text };

        // 4) a transactional case with NO published template → the shared bare-bones fallback (email-4) so a
        //    verification / MFA / reset always sends SOMETHING (subject + plain text, merge tags substituted)
        if( request.notificationType !== undefined )
        {
            const fallback : { subject : string; text : string } | undefined = Notification.fallbackFor( request.notificationType );
            if( fallback !== undefined ) return { subject: request.subject ?? fallback.subject, html: undefined, text: fallback.text };
        }

        return undefined;
    }

    // a rendered body from a template entity (its compiled html; the request subject overrides the template's).
    // async — a template missing its stored html is compiled on the fly through the (async) mjml engine.
    private async bodyFromTemplate( template : EmailTemplate.Entity, subjectOverride? : string ) : Promise<EmailService.RenderedBody>
    {
        // prefer the stored compiled html; fall back to a fresh compile when it's absent (older/partial rows)
        const compiled : string | undefined = template.html ?? ( await this.compile( template.doc ) ).html;
        return { subject: subjectOverride ?? template.subject, html: compiled, text: undefined, from: template.from, replyTo: template.replyTo };
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // resolve a recipient to a concrete address + merge fields. A literal `email` is used as-is; a `contactId`
    // is resolved via the contact service (S2S) so the account can address a contact by UUID and let the email
    // service do the name-merge at send time.
    private async resolveRecipient( accountId : string, recipient : Email.Recipient ) : Promise<EmailService.ResolvedRecipient | undefined>
    {
        // literal address — carry the display name into the merge context
        if( recipient.email !== undefined && recipient.email.length > 0 )
            return { email: recipient.email, merge: recipient.name ? { name: recipient.name } : {} };

        // contact UUID — resolve to the contact's address + merge fields (name, first/last, custom attributes)
        if( recipient.contactId !== undefined )
        {
            const contact : EmailService.ResolvedRecipient | undefined = await this.resolveContact( accountId, recipient.contactId );
            return contact;
        }
        return undefined;
    }

    // resolve a contact UUID → { email, merge } via the contact service. TODO(email-1.4): wire the S2S call
    // (GET /contact/:id, INTERNAL audience) or a Kafka-fed local read model; until then unresolved (the send
    // worker skips + logs). Kept as its own seam so only this method changes when the S2S client lands.
    private async resolveContact( accountId : string, contactId : string ) : Promise<EmailService.ResolvedRecipient | undefined>
    {
        this.log.info( "contact resolution not yet wired (S2S) — recipient skipped", { accountId, contactId } );
        return undefined;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Is an address suppressed for this account (unsubscribe / hard-bounce / complaint)? The canSend() gate. */
    public async isSuppressed( accountId : string, email : string ) : Promise<boolean>
    {
        this.log.trace( "item read: email_suppression", { accountId, email } );
        const got : Type.Result<{ email : string } | undefined> = await this.dynamo.get<{ email : string }>( "email_suppression", { accountId, email } );
        return got.ok && got.data !== undefined;
    }

    /** Add an address to the account's suppression list (from a bounce/complaint feedback event, or an
     *  unsubscribe). Idempotent — a repeat write is harmless. */
    public async suppress( accountId : string, email : string, reason : Email.Status ) : Promise<void>
    {
        const wrote : Type.Result<void> = await this.dynamo.put( "email_suppression", { accountId, email, reason, at: new Date().toISOString() } );
        if( !wrote.ok ) this.log.warn( "suppression write failed", { accountId, email, error: wrote.error } );
        else this.log.trace( "item stored: email_suppression", { accountId, email, reason } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** WORKER: apply an inbound delivery-FEEDBACK notification (bounce/complaint) — suppress the address so
     *  future sends are gated, and (best-effort) mark the log row. Never throws. */
    public async processFeedback( feedback : EmailService.Feedback ) : Promise<void>
    {
        // a hard bounce or a complaint permanently suppresses the address for the account
        if( feedback.status === Email.Status.BOUNCED || feedback.status === Email.Status.COMPLAINED )
            await this.suppress( feedback.accountId, feedback.email, feedback.status );
        this.log.info( "email feedback applied", { accountId: feedback.accountId, email: feedback.email, status: feedback.status } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // resolve the transport context (credential + region) for a provider from the config's registry + Secrets.
    // SES needs no key (IAM) — it gets the SES facade instead.
    private async providerContext( provider : Email.Provider, config : EmailConfig.Config ) : Promise<EmailContext>
    {
        if( provider === Email.Provider.SES ) return { ses: this.ses };
        if( provider === Email.Provider.FAKE ) return {};

        // key-auth ESP — resolve the credential named by the config entry's secretRef (fallback to the
        // registry's logical secretKey for the provider's category)
        const entry : EmailConfig.ProviderEntry | undefined = config.providers[ provider ];
        const secretRef : string | undefined = entry?.secretRef ?? EmailService.registrySecretKey( provider );
        if( secretRef === undefined ) return { region: entry?.region };
        this.log.trace( "secret resolved", { provider, secretRef } );
        const secret : Type.Result<string | undefined> = await this.secrets.get( secretRef );
        return { apiKey: secret.ok ? secret.data : undefined, region: entry?.region };
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // write one send-log row (best-effort — the log is observability, never fails a send). `detail` carries the
    // ACTUALLY-RESOLVED provider + the exact rendered Outbound (from/replyTo/html/text/headers) — absent for the
    // pre-render suppression short-circuit's minimal call (caller still passes what it has at that point).
    private async writeLog( accountId : string, to : string, subject : string, request : Email.SendRequest, status : Email.Status, detail : EmailService.WriteLogDetail = {} ) : Promise<Email.SendLog>
    {
        const row : Email.SendLog =
        {
            accountId, messageId: randomUUID(), to, subject, status,
            provider:          detail.provider ?? request.provider,
            from:              detail.from,
            replyTo:           detail.replyTo,
            html:              detail.html,
            text:              detail.text,
            headers:           detail.headers,
            notificationType:  request.notificationType,
            campaignId:        request.campaignId,
            providerMessageId: detail.providerMessageId,
            error:             detail.error,
            createdAt:         new Date().toISOString(),
        };
        const wrote : Type.Result<void> = await this.dynamo.put( "email_log", { ...row } );
        if( !wrote.ok ) this.log.warn( "send-log write failed", { accountId, to, error: wrote.error } );
        else this.log.trace( "item stored: email_log", { accountId, to, status, messageId: row.messageId } );
        return row;
    }

    // provider-reported status -> the analytics canonical event-type taxonomy (analytics-1.2). SUPPRESSED
    // is our OWN compliance block (no provider send even attempted) — not emitted here.
    private static readonly ANALYTICS_EVENT_TYPE_FROM_STATUS : Partial<Record<Email.Status, Analytics.EventType>> =
    {
        [ Email.Status.SENT ]:   Analytics.EventType.SENT,
        [ Email.Status.FAILED ]: Analytics.EventType.DELIVERY_FAILED,
    };

    /** Build + publish this send's `Analytics.Event` onto `Events.Stream.ENGAGEMENT` (analytics-1.7) —
     *  best-effort, never blocks the send path. A recipient sent by `contactId` already carries it; a bare
     *  literal address resolves through `AnalyticsIdentity` (contactId, or a stable anonId for an unknown
     *  address — never the raw email itself). */
    private async emitEngagementEvent( row : Email.SendLog, recipientContactId : string | undefined ) : Promise<void>
    {
        const eventType : Analytics.EventType | undefined = EmailService.ANALYTICS_EVENT_TYPE_FROM_STATUS[ row.status ];
        if( eventType === undefined ) return;

        const identity : AnalyticsIdentity.Result = recipientContactId !== undefined
            ? { contactId: recipientContactId }
            : await this.analyticsIdentity.resolve( row.accountId, row.to.toLowerCase() );

        const event : Analytics.Event =
        {
            eventId:         randomUUID(),
            occurredAt:      row.createdAt,
            ingestedAt:      new Date().toISOString(),
            accountId:       row.accountId,
            campaignId:      row.campaignId ?? null,
            messageId:       row.messageId,
            contactId:       identity.contactId ?? null,
            anonId:          identity.anonId,
            channel:         "email",
            provider:        row.provider ?? "unknown",
            eventType,
            providerEventId: row.providerMessageId ?? row.messageId,
        };
        const published : Type.Result<void> = await this.kafka.publishStream<Analytics.Event>(
            Events.Stream.ENGAGEMENT, event, { key: ( value : Analytics.Event ) : string => value.accountId } );
        if( !published.ok ) this.log.warn( "engagement event publish failed", { messageId: row.messageId, eventType, error: published.error } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // ── Blasts (email-1.8/1.9) — a tracked, controllable, paced batch/scheduled send ──────────────

    /** Create + persist a SCHEDULED blast from a batch request (resolving the effective start against the
     *  safe-buffer + max-lead + timezone policy) and enqueue its fan-out. Returns the stored Blast. */
    public async createBlast( request : Email.BatchSendRequest, accountId : string, userId? : string ) : Promise<Type.Result<Email.Blast>>
    {
        const config : EmailConfig.Config = await this.emailConfig();
        const start : { startAt : string; timezone : string } = this.resolveStart( request.schedule, config );
        const now : string = new Date().toISOString();
        const blast : Email.Blast =
        {
            id: randomUUID(), accountId, status: Email.BlastStatus.SCHEDULED, request,
            total: 0, sent: 0, startAt: start.startAt, timezone: start.timezone,
            createdAt: now, createdBy: userId, modifiedAt: now, modifiedBy: userId,
        };
        const wrote : Type.Result<void> = await this.dynamo.put( "email_blasts", { ...blast, blastId: blast.id } );
        if( !wrote.ok ) return { ok: false, error: wrote.error };
        this.log.trace( "item stored: email_blasts", { accountId, blastId: blast.id, status: blast.status } );

        // enqueue the expansion + paced fan-out (the worker honors startAt + status)
        const enqueued : Type.Result<void> = await this.sqs.send( "email-batch", { blastId: blast.id, accountId } );
        if( !enqueued.ok ) this.log.warn( "batch enqueue failed", { blastId: blast.id, error: enqueued.error } );
        return { ok: true, data: blast };
    }

    /** One blast by id. */
    public async getBlast( accountId : string, blastId : string ) : Promise<Type.Result<Email.Blast | undefined>>
    {
        this.log.trace( "item read: email_blasts", { accountId, blastId } );
        return this.dynamo.get<Email.Blast>( "email_blasts", { accountId, blastId } );
    }

    /** List an account's blasts. */
    public async listBlasts( accountId : string ) : Promise<Type.Result<Array<Email.Blast>>>
    {
        this.log.trace( "item query: email_blasts", { accountId } );
        return this.dynamo.query<Email.Blast>( "email_blasts", {
            KeyConditionExpression:    "accountId = :a",
            ExpressionAttributeValues: { ":a": accountId },
        } );
    }

    /** List an account's send-log rows (email-8.1) — the "Sent" view's data source. Unordered by the table's
     *  key (SK is a random messageId, not time); the caller (endpoint impl) sorts newest-first. */
    public async listLog( accountId : string ) : Promise<Type.Result<Array<Email.SendLog>>>
    {
        this.log.trace( "item query: email_log", { accountId } );
        return this.dynamo.query<Email.SendLog>( "email_log", {
            KeyConditionExpression:    "accountId = :a",
            ExpressionAttributeValues: { ":a": accountId },
        } );
    }

    /** Persist a blast (status / cursor / schedule change), stamping modifiedAt. */
    public async putBlast( blast : Email.Blast ) : Promise<Type.Result<void>>
    {
        const next : Email.Blast = { ...blast, modifiedAt: new Date().toISOString() };
        this.log.trace( "item stored: email_blasts", { accountId: next.accountId, blastId: next.id, status: next.status, sent: next.sent } );
        return this.dynamo.put( "email_blasts", { ...next, blastId: next.id } );
    }

    /** Apply a control action (suspend / resume / reschedule) to a blast, enforcing the status state-machine
     *  and the safe buffer on a reschedule. `undefined` data = not found (impl → 404); an error string that
     *  isn't a DB error = a conflict (impl → 409). */
    public async controlBlast( accountId : string, blastId : string, action : Email.BlastAction, startAt? : string, userId? : string ) : Promise<Type.Result<Email.Blast | undefined>>
    {
        const got : Type.Result<Email.Blast | undefined> = await this.getBlast( accountId, blastId );
        if( !got.ok ) return { ok: false, error: got.error };
        if( got.data === undefined ) return { ok: true, data: undefined };   // not found
        const blast : Email.Blast = got.data;

        // a terminal blast can't be controlled
        if( blast.status === Email.BlastStatus.COMPLETED || blast.status === Email.BlastStatus.CANCELLED )
            return { ok: false, error: "conflict: blast is terminal" };

        if( action === Email.BlastAction.SUSPEND )
        {
            blast.status = Email.BlastStatus.SUSPENDED;
        }
        else if( action === Email.BlastAction.RESUME )
        {
            // continue from the cursor — re-enqueue the fan-out
            blast.status = Email.BlastStatus.SCHEDULED;
            const enqueued : Type.Result<void> = await this.sqs.send( "email-batch", { blastId: blast.id, accountId } );
            if( !enqueued.ok ) this.log.warn( "batch resume enqueue failed", { blastId: blast.id, error: enqueued.error } );
        }
        else
        {
            // reschedule — re-resolve the effective start against the buffer/timezone policy
            const config : EmailConfig.Config = await this.emailConfig();
            const start : { startAt : string; timezone : string } = this.resolveStart( { ...blast.request.schedule, startAt }, config );
            blast.startAt = start.startAt; blast.timezone = start.timezone; blast.status = Email.BlastStatus.SCHEDULED;
        }
        blast.modifiedBy = userId;
        const wrote : Type.Result<void> = await this.putBlast( blast );
        if( !wrote.ok ) return { ok: false, error: wrote.error };
        return { ok: true, data: blast };
    }

    /** Cancel a blast (status → CANCELLED); the worker halts the remaining fan-out at its next status check.
     *  Returns whether a blast was found + cancelled. */
    public async cancelBlast( accountId : string, blastId : string, userId? : string ) : Promise<Type.Result<boolean>>
    {
        const got : Type.Result<Email.Blast | undefined> = await this.getBlast( accountId, blastId );
        if( !got.ok ) return { ok: false, error: got.error };
        if( got.data === undefined ) return { ok: true, data: false };
        got.data.status = Email.BlastStatus.CANCELLED; got.data.modifiedBy = userId;
        const wrote : Type.Result<void> = await this.putBlast( got.data );
        if( !wrote.ok ) return { ok: false, error: wrote.error };
        return { ok: true, data: true };
    }

    /** WORKER: expand a blast's audience and pace the per-recipient fan-out. Re-checks blast status before each
     *  recipient (a suspend/cancel stops it; resume continues from `sent`, the cursor). Never throws. */
    public async processBatch( accountId : string, blastId : string ) : Promise<void>
    {
        this.log.trace( "processBatch: start", { accountId, blastId } );
        const config : EmailConfig.Config = await this.emailConfig();
        const loaded : Type.Result<Email.Blast | undefined> = await this.getBlast( accountId, blastId );
        if( !loaded.ok || loaded.data === undefined ) { this.log.warn( "batch: blast not found", { blastId } ); return; }
        const blast : Email.Blast = loaded.data;
        if( blast.status === Email.BlastStatus.SUSPENDED || blast.status === Email.BlastStatus.CANCELLED || blast.status === Email.BlastStatus.COMPLETED ) return;

        // resolve recipients (explicit list + expanded segment) and mark the blast SENDING
        const recipients : Array<Email.Recipient> = await this.resolveAudience( accountId, blast.request.audience );
        blast.total = recipients.length;
        blast.status = Email.BlastStatus.SENDING;
        await this.putBlast( blast );

        // paced fan-out from the resume cursor — one send per recipient with a computed delay
        const base : Email.SendRequest = { ...blast.request, to: [] };
        for( let index : number = blast.sent; index < recipients.length; index += 1 )
        {
            // re-check status so a suspend/cancel stops the fan-out promptly
            const check : Type.Result<Email.Blast | undefined> = await this.getBlast( accountId, blastId );
            if( check.ok && check.data && ( check.data.status === Email.BlastStatus.SUSPENDED || check.data.status === Email.BlastStatus.CANCELLED ) )
            { this.log.info( "batch halted", { blastId, status: check.data.status, at: index } ); return; }

            // enqueue this recipient's send, paced by the schedule (start lead + rate/warm-up offset)
            const recipient : Email.Recipient = recipients[ index ];
            const delaySeconds : number = this.pacingDelay( index, blast, config );
            const enqueued : Type.Result<string> = await this.enqueueSend( { ...base, to: [ recipient ], accountId: blast.request.accountId ?? accountId }, delaySeconds );
            if( !enqueued.ok ) this.log.warn( "batch: enqueue send failed", { blastId, index, error: enqueued.error } );

            // advance the cursor (persist periodically to bound writes)
            blast.sent = index + 1;
            if( blast.sent % 25 === 0 ) await this.putBlast( blast );
        }
        blast.status = Email.BlastStatus.COMPLETED;
        await this.putBlast( blast );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // combine the explicit recipient list with the expanded segment membership
    private async resolveAudience( accountId : string, audience : Email.BatchAudience ) : Promise<Array<Email.Recipient>>
    {
        const recipients : Array<Email.Recipient> = [ ...( audience.recipients ?? [] ) ];
        if( audience.segmentId !== undefined ) recipients.push( ...await this.resolveSegment( accountId, audience.segmentId ) );
        return recipients;
    }

    // expand a segment UUID → its member recipients. TODO(email-1.8): wire the S2S call to the contact service
    // (segment membership) — until then empty (logged). Its own seam like resolveContact.
    private async resolveSegment( accountId : string, segmentId : string ) : Promise<Array<Email.Recipient>>
    {
        this.log.info( "segment expansion not yet wired (S2S) — no members added", { accountId, segmentId } );
        return [];
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // resolve the effective start instant + timezone from a schedule against the scheduling policy. A provided
    // startAt is clamped to [now + safe-buffer, now + max-lead]; NO startAt means send immediately (now).
    private resolveStart( schedule : Email.SendSchedule | undefined, config : EmailConfig.Config ) : { startAt : string; timezone : string }
    {
        const nowMs : number = Date.now();
        const timezone : string = schedule?.timezone ?? config.scheduling.defaultTimezone;
        if( schedule?.startAt === undefined ) return { startAt: new Date( nowMs ).toISOString(), timezone };

        // enforce the safe buffer (minimum lead) and the max-lead ceiling on a scheduled start
        const requestedMs : number = Date.parse( schedule.startAt );
        const floorMs : number = nowMs + config.scheduling.minLeadMinutes * 60_000;
        const ceilMs : number = nowMs + config.scheduling.maxLeadDays * 24 * 60 * 60_000;
        const effectiveMs : number = Math.min( ceilMs, Math.max( floorMs, Number.isFinite( requestedMs ) ? requestedMs : floorMs ) );
        return { startAt: new Date( effectiveMs ).toISOString(), timezone };
    }

    // seconds to delay the Nth recipient's send: the schedule's start lead + the pacing offset (rate/warm-up),
    // clamped to SQS's 900s max (a longer horizon needs EventBridge Scheduler in prod).
    private pacingDelay( index : number, blast : Email.Blast, config : EmailConfig.Config ) : number
    {
        const startLeadSec : number = blast.startAt ? Math.max( 0, ( Date.parse( blast.startAt ) - Date.now() ) / 1000 ) : 0;
        const offsetSec : number = this.pacingOffset( index, blast.request.schedule, config );
        return Math.min( 900, Math.round( startLeadSec + offsetSec ) );
    }

    // cumulative seconds before the Nth message — a steady rate (60/rate spacing) or, with a warm-up, the ramp
    // integrated message-by-message (rate grows linearly start→target across rampMinutes).
    private pacingOffset( index : number, schedule : Email.SendSchedule | undefined, config : EmailConfig.Config ) : number
    {
        if( schedule?.warmup === undefined )
        {
            const steady : number = schedule?.ratePerMinute ?? config.limits.defaultRatePerMinute;
            return steady > 0 ? ( index * 60 ) / steady : 0;
        }
        const warm : Email.WarmupPlan = schedule.warmup;
        let seconds : number = 0;
        for( let sentSoFar : number = 0; sentSoFar < index; sentSoFar += 1 )
        {
            const minute : number = seconds / 60;
            const ramp : number = warm.rampMinutes > 0 ? Math.min( 1, minute / warm.rampMinutes ) : 1;
            const rate : number = warm.startRatePerMinute + ( warm.targetRatePerMinute - warm.startRatePerMinute ) * ramp;
            seconds += rate > 0 ? 60 / rate : 60;
        }
        return seconds;
    }
}

export namespace EmailService
{
    export enum Role { MAIN = "main" }
    export const PORT : Record<Role, number> = { [ Role.MAIN ]: Ports.EMAIL.MAIN };

    /** A compiled body ready for per-recipient merge. `from`/`replyTo` carry a template's saved overrides (undefined
     *  for inline/notification-case sends), applied by the caller ahead of the request-level / system defaults. */
    export interface RenderedBody { subject : string; html? : string; text? : string; from? : Email.Address; replyTo? : Email.Address; }

    /** A recipient resolved to a concrete address + its merge context. */
    export interface ResolvedRecipient { email : string; merge : Record<string, unknown>; }

    /** The per-send context threaded through the recipient fan-out (avoids re-resolving per recipient). */
    export interface SendContext
    {
        request  : Email.SendRequest;
        config   : EmailConfig.Config;
        accountId : string;
        system   : boolean;
        rendered : RenderedBody;
        adapter  : EmailProvider;
        context  : EmailContext;
        from     : string;
        replyTo? : string;
    }

    /** An inbound delivery-feedback notification (bounce/complaint) fed to the feedback worker. */
    export interface Feedback { accountId : string; email : string; status : Email.Status; }

    /** The optional detail {@link EmailService.writeLog} captures onto a send-log row — the ACTUALLY-RESOLVED
     *  provider (not the request's override) + the exact rendered `Outbound` handed to the adapter, plus the
     *  transport result. All optional: the pre-render suppression short-circuit passes only what it has. */
    export interface WriteLogDetail
    {
        provider?          : Email.Provider;
        from?              : string;
        replyTo?           : string;
        html?              : string;
        text?              : string;
        headers?           : Record<string, string>;
        providerMessageId? : string;
        error?             : string;
    }

    /** The system/platform transactional cases (system sender + SYSTEM-scope templates). */
    const SYSTEM_CASES : ReadonlySet<Email.NotificationType> = new Set<Email.NotificationType>( [
        Email.NotificationType.PASSWORD_RESET,
        Email.NotificationType.EMAIL_VERIFICATION,
        Email.NotificationType.MFA_CODE,
        Email.NotificationType.ACCOUNT_INVITE,
        Email.NotificationType.WELCOME,
        Email.NotificationType.SECURITY_ALERT,
    ] );

    /** Whether a notification case is platform/system mail (vs an account transactional case). */
    export function isSystemNotification( type : Email.NotificationType ) : boolean { return SYSTEM_CASES.has( type ); }

    /** Format an address as a header value — `"Name" <email>` when a display name is present, else the bare email. */
    export function formatAddress( address : Email.Address ) : string { return address.name ? `"${ address.name }" <${ address.email }>` : address.email; }

    /** Resolve the platform system FROM-identity for a notification case: the routed sender for that case, else
     *  the configured default, else the first sender (or a hard fallback if none). Lets different system needs
     *  (security vs verification vs receipts) send from different verified addresses. */
    export function systemSenderFor( config : EmailConfig.Config, notificationType? : Email.NotificationType ) : Email.Address
    {
        const routedKey : string | undefined = notificationType ? config.systemSenderRouting[ notificationType ] : undefined;
        const key : string = routedKey ?? config.defaultSystemSenderKey;
        const sender : Email.Sender | undefined = config.systemSenders.find( ( entry : Email.Sender ) : boolean => entry.key === key ) ?? config.systemSenders[ 0 ];
        return sender !== undefined ? { email: sender.email, name: sender.name } : { email: "no-reply@platform.local", name: "Platform" };
    }

    /** The S3 object key for a template version's body snapshot. */
    export function templateBodyKey( accountId : string, templateId : string, version : number ) : string
    { return `acct/${ accountId }/email-templates/${ templateId }/v${ version }.json`; }

    /** The provider's logical secret key via the UNIVERSAL provider registry (`<category>-<id>`, e.g.
     *  Postmark → "email-postmark"). Secrets key management is centralized in `@repo/system` Providers so the
     *  same logical key resolves the physical Secrets Manager name everywhere (manifest provisioning + runtime
     *  read). Returns undefined for a provider with no registry entry (e.g. SES uses IAM, not a key). */
    export function registrySecretKey( provider : Email.Provider ) : string | undefined
    {
        return Providers.byId( provider )?.secretKey;
    }
}

export default EmailService;
// eof

//
import { randomUUID } from "node:crypto";

import { Application, Service, Ports, Register, Dynamo, Kafka, Sqs, Secrets, WorkQueue } from "@repo/services";
import { Survey, Question, SurveyResponse, Distribution, Contact, SurveyConfig } from "@repo/api";
import { ObjectUtils, type Type } from "@repo/common";
import { Events, Payloads } from "@repo/system";

import SurveyTokenStore from "./SurveyTokenStore";
import ContactUpdateClient from "./ContactUpdateClient";
import ContactSegmentClient from "./ContactSegmentClient";
import SurveyProviderFactory from "../providers/SurveyProviderFactory";
import VoiceClient from "./VoiceClient";
import { PhoneRunner } from "../runners/PhoneRunner";

//
// SurveyService — the survey domain's Service BASE (not deployed alone). Holds the shared domain wiring
// (Dynamo + Kafka + SQS + Secrets facades, the WorkQueue distribution governor, the PURL/submission-token
// store, the contact-update client, the scoring engine, and public-form input sanitization) so BOTH concrete
// roles inherit it — SurveyMainService (authed /survey/* API) and SurveyFormService (public hosted-form
// ingress). Survey never sends directly (survey-9.6) — it composes contact/campaign/channels/workflow.
//
export class SurveyService extends Service
{
    private _dynamo?      : Dynamo;
    private _kafka?       : Kafka;
    private _sqs?         : Sqs;
    private _secrets?     : Secrets;
    private _workQueue?   : WorkQueue;
    private _tokens?      : SurveyTokenStore;
    private _contacts?    : ContactUpdateClient;
    private _segments?    : ContactSegmentClient;
    private _voice?       : VoiceClient;

    /** The external-connector registry (survey-2.3/6.0) — a marketplace provider registers its adapter here. */
    public readonly providers : SurveyProviderFactory = new SurveyProviderFactory();

    ////////////////////////////////////////////////////////////////////////////////////////////
    constructor( role : SurveyService.Role )
    {
        // super( serviceId, role, defaultLocalPort ) — env PORT overrides the default when set.
        super( Register.Service.SURVEY, role, SurveyService.PORT[ role ] );

        // stamp the running version from package.json (walks up from bin/services at runtime)
        const pkg : Application.PackageInfo = this.loadPackageInfo( __dirname );
        this.setVersion( pkg.version );
        this.log.info( "version", { name: pkg.name, version: pkg.version } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** DynamoDB facade — the SoT for definitions/distributions/responses/tokens. Lazy + cached. */
    public get dynamo() : Dynamo { return this._dynamo ??= new Dynamo( this.cloud ); }
    /** Kafka facade — survey.* CRUD + response/completed events, best-effort. Lazy + cached. */
    public get kafka() : Kafka { return this._kafka ??= new Kafka( this.cloud ); }
    /** SQS facade — the response/ingest/distribution work queues. Lazy + cached. */
    public get sqs() : Sqs { return this._sqs ??= new Sqs( this.cloud ); }
    /** Secrets facade — the CAPTCHA/Turnstile secret. Lazy + cached. */
    public get secrets() : Secrets { return this._secrets ??= new Secrets( this.cloud ); }
    /** The PURL/submission-token store (survey's OWN table — never `auth_actions`). Lazy + cached. */
    public get tokens() : SurveyTokenStore { return this._tokens ??= new SurveyTokenStore( this.dynamo ); }
    /** S2S client that lands scores/tags on a contact (survey-4.2). Lazy + cached. */
    public get contacts() : ContactUpdateClient { return this._contacts ??= new ContactUpdateClient(); }
    /** S2S client that resolves a segment's member contacts for audience (survey-3.2). Lazy + cached. */
    public get segments() : ContactSegmentClient { return this._segments ??= new ContactSegmentClient(); }
    /** S2S client that compiles + places IVR calls for the PHONE channel (survey-2.4). Lazy + cached. */
    public get voice() : VoiceClient { return this._voice ??= new VoiceClient(); }

    /** The distribution-fan-out governor (survey-9.6) — same adoption shape as `PrintService.workQueue`. */
    public get workQueue() : WorkQueue
    {
        return this._workQueue ??= new WorkQueue( this.cloud, "survey", {
            limits:     { perMinute: 600 },
            batchSize:  20,
            lowWaterMark: 50,
            leaseSeconds: 120,
        } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** The live runtime config (AppConfig config/settings) — anonymity default + abandonment/retention
     *  policy (survey-4.4) — deep-filled from DEFAULT so an older/partial hosted row tolerates schema drift. */
    public async surveyConfig() : Promise<SurveyConfig.Config>
    {
        const got : Type.Result<SurveyConfig.Config | undefined> = await this.appConfig.json<SurveyConfig.Config>( "config", "settings" );
        return got.ok && got.data ? ObjectUtils.withDefaults( got.data, SurveyConfig.DEFAULT ) : SurveyConfig.DEFAULT;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Persist a new config version + deploy it (AppConfig control plane) — the PUT /survey/config write path. */
    public async saveSurveyConfig( config : SurveyConfig.Config, environment : string = process.env.APPCONFIG_ENV ?? "default" ) : Promise<Type.Result<void>>
    {
        const profileId : Type.Result<string> = await this.appConfig.profileId( "config", "settings" );
        if( !profileId.ok ) return { ok: false, error: profileId.error };
        const environmentId : Type.Result<string> = await this.appConfig.environmentId( "config", environment );
        if( !environmentId.ok ) return { ok: false, error: environmentId.error };

        const version : Type.Result<number> = await this.appConfig.createVersion( "config", profileId.data, JSON.stringify( config ) );
        if( !version.ok ) return { ok: false, error: version.error };
        const deployed : Type.Result<number> = await this.appConfig.deploy( "config", profileId.data, environmentId.data, version.data, { description: "survey config update" } );
        if( !deployed.ok ) return { ok: false, error: deployed.error };
        return { ok: true, data: undefined };
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Publish a `survey.*` lifecycle event (definition CRUD) or a `response`/`completed` event (survey-5.2).
     *  Best-effort — a bus miss is logged, never fails the caller. `data` is the entity's `@repo/api` wire
     *  model; `actorUserId` (if given) makes it a USER-actored event, else a SERVICE-actored one. */
    public async emit( verb : Events.Verb, targetId : string, accountId : string, data : unknown, actorUserId? : string ) : Promise<void>
    {
        const env : Events.Envelope = Events.envelope( { object: Events.Object.SURVEY_SURVEY, verb, accountId, target: { type: "survey", id: targetId }, data, actorUserId } );
        const published : Type.Result<void> = await this.kafka.publishEvent( env );
        if( !published.ok ) this.log.warn( "survey event publish failed", { action: env.action, targetId, error: published.error } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Publish a `survey.response` event (survey-5.2) — a response's CREATED (capture started) or UPDATED
     *  (completed/abandoned transition) — the completion-as-conversion / workflow-trigger signal. */
    public async emitResponse( verb : Events.Verb, response : SurveyResponse.Entity ) : Promise<void>
    {
        const payload : Payloads.SurveyResponse = { id: response.id, accountId: response.accountId, surveyId: response.surveyId, contactId: response.contactId, status: response.status, score: response.score };
        const env : Events.Envelope = Events.envelope( { object: Events.Object.SURVEY_RESPONSE, verb, accountId: response.accountId, target: { type: "survey-response", id: response.id }, data: payload } );
        const published : Type.Result<void> = await this.kafka.publishEvent( env );
        if( !published.ok ) this.log.warn( "survey response event publish failed", { action: env.action, responseId: response.id, error: published.error } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Minimal allowlist HTML sanitizer for author-supplied / echoed-back text (question prompts, open-text
     *  answers) — the public form is internet-facing (survey-7.2.1). Strips script/style tags and any
     *  `on*` event-handler attribute. TODO: swap for the shared `Application.sanitizeHtml` once it lands
     *  (packages/services/src/Application.ts) — this is a narrower stand-in, not a parallel long-term sanitizer. */
    public sanitizeText( value : string ) : string
    {
        return value
            .replace( /<\s*(script|style)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, "" )
            .replace( /<[^>]+>/g, "" )
            .trim();
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Sanitize every question's prompt/choice labels/placeholder before it's ever rendered or stored
     *  (survey-7.2.1) — applied on both store (PutSurvey) and output (GetSurveyForm). */
    public sanitizeQuestions( questions : Array<Question.Entity> ) : Array<Question.Entity>
    {
        return questions.map( ( question : Question.Entity ) : Question.Entity => ( {
            ...question,
            prompt:  this.sanitizeText( question.prompt ),
            config:  question.config ? {
                ...question.config,
                placeholder: question.config.placeholder ? this.sanitizeText( question.config.placeholder ) : undefined,
                choices:     question.config.choices?.map( ( choice : Question.Choice ) : Question.Choice => ( { ...choice, label: this.sanitizeText( choice.label ) } ) ),
            } : undefined,
        } ) );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Compute the standard score(s) for a completed/partial response against its survey's scoring config,
     *  and return the primary score to store on `Response.score` (the first configured rule that has a
     *  matching answer). Pure — delegates to `Survey.computeScore` (packages/api/src/survey/model/Survey.ts)
     *  so the SAME formula runs in preview, capture, and results. */
    public computeResponseScore( survey : Survey.Entity, response : SurveyResponse.Entity ) : number | undefined
    {
        for( const config of survey.scoring ?? [] )
        {
            const answer : SurveyResponse.Answer | undefined = response.answers.find( ( entry : SurveyResponse.Answer ) : boolean => entry.questionId === config.questionId );
            if( answer === undefined || typeof answer.value !== "number" ) continue;
            return Survey.computeScore( config, answer.value ).score;
        }
        return undefined;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Capture one batch of answers into a Response row (survey-4.1) — the SHARED core both the public form
     *  (`PostSurveyFormImpl`) and the S2S internal ingest (`PostInternalResponseImpl`, workflow's
     *  `collect-input` completions) call. Creates the row on first contact (`in_progress`), merges answers on
     *  every subsequent call, and — once `complete` — computes the standard score, lands it on the contact
     *  (survey-4.2, best-effort, skipped when anonymous), and emits `survey.response` (survey-5.2). */
    public async captureAnswers( input : SurveyService.CaptureInput ) : Promise<Type.Result<SurveyResponse.Entity>>
    {
        const survey : Type.Result<Survey.Entity | undefined> = await this.dynamo.get<Survey.Entity>( "survey_surveys", { accountId: input.accountId, surveyId: input.surveyId } );
        if( !survey.ok )   return { ok: false, error: survey.error, cause: survey.cause };
        if( !survey.data ) return { ok: false, error: "survey not found" };

        const responseId : Type.UUID = input.responseId ?? randomUUID();
        const existing : Type.Result<SurveyResponse.Entity | undefined> = input.responseId
            ? await this.dynamo.get<SurveyResponse.Entity>( "survey_responses", { accountId: input.accountId, responseId } )
            : { ok: true, data: undefined };
        if( !existing.ok ) return { ok: false, error: existing.error, cause: existing.cause };

        const now : Type.ISODateTime = new Date().toISOString();
        const current : SurveyResponse.Entity = existing.data
            ? ObjectUtils.withDefaults( existing.data, SurveyResponse.DEFAULT )
            : {
                ...SurveyResponse.DEFAULT,
                id:             responseId,
                accountId:      input.accountId,
                surveyId:       input.surveyId,
                surveyVersion:  survey.data.version,
                distributionId: input.distributionId,
                contactId:      input.contactId,
                channel:        input.channel,
                answers:        [],
                startedAt:      now,
              } as SurveyResponse.Entity;

        // merge new answers over any already-answered questionId, tracking the drop-off step
        const merged : Array<SurveyResponse.Answer> = [ ...current.answers ];
        for( const incoming of input.answers )
        {
            const answeredAt : Type.ISODateTime = now;
            const index : number = merged.findIndex( ( entry : SurveyResponse.Answer ) : boolean => entry.questionId === incoming.questionId );
            const answer : SurveyResponse.Answer = { questionId: incoming.questionId, value: incoming.value as Type.Json, answeredAt };
            if( index >= 0 ) merged[ index ] = answer; else merged.push( answer );
        }
        const lastQuestionId : string | undefined = input.answers[ input.answers.length - 1 ]?.questionId ?? current.lastQuestionId;

        const requiredIds : Array<string> = survey.data.questions.filter( ( question : Question.Entity ) : boolean => question.required ).map( ( question : Question.Entity ) : string => question.id );
        const answeredIds : Array<string> = merged.map( ( entry : SurveyResponse.Answer ) : string => entry.questionId );
        const allRequiredAnswered : boolean = requiredIds.every( ( id : string ) : boolean => answeredIds.includes( id ) );
        const justCompleted : boolean = current.status !== SurveyResponse.Status.COMPLETED && ( input.complete === true || allRequiredAnswered );

        const response : SurveyResponse.Entity =
        {
            ...current,
            answers:        merged,
            lastQuestionId,
            status:         justCompleted ? SurveyResponse.Status.COMPLETED : SurveyResponse.Status.IN_PROGRESS,
            completedAt:    justCompleted ? now : current.completedAt,
            score:          justCompleted ? this.computeResponseScore( survey.data, { ...current, answers: merged } ) : current.score,
        };

        const wrote : Type.Result<void> = await this.dynamo.put( "survey_responses", { ...response, responseId } );
        if( !wrote.ok ) return { ok: false, error: wrote.error, cause: wrote.cause };

        void this.emitResponse( existing.data ? Events.Verb.UPDATED : Events.Verb.CREATED, response );

        // land the score/bucket tag on the contact — never for an anonymous response (survey-4.4)
        if( justCompleted && response.contactId )
        {
            for( const config of survey.data.scoring ?? [] )
            {
                const answer : SurveyResponse.Answer | undefined = merged.find( ( entry : SurveyResponse.Answer ) : boolean => entry.questionId === config.questionId );
                if( answer === undefined || typeof answer.value !== "number" ) continue;
                const computed : { score : number; bucket? : Survey.NpsBucket } = Survey.computeScore( config, answer.value );
                void this.contacts.update( input.accountId, response.contactId, {
                    setCustomFields: config.contactFieldUid ? { [ config.contactFieldUid ]: String( computed.score ) } : undefined,
                    addTags:         config.tagOnBucket && computed.bucket ? [ { namespace: Contact.TagNamespace.SYSTEM, value: `survey-${ config.scoreType }-${ computed.bucket }` } ] : undefined,
                } ).then( ( result : Type.Result<unknown> ) : void =>
                {
                    if( !result.ok ) this.log.warn( "landing survey score on contact failed", { responseId, error: result.error } );
                } );
            }
        }

        return { ok: true, data: response };
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Expand a distribution's audience into per-recipient work (survey-3.1/9.6) — resolves the segment's
     *  members via contact's S2S list (survey-3.2), opens an `in_progress` Response + mints a submission
     *  token per contact (skipping the contact link entirely when `anonymous`, survey-4.4), and enqueues one
     *  `WorkQueue` job per recipient for `dispatchDistribution` to hand to the channel. Marks the distribution
     *  SENDING immediately and SENT once every recipient has a queued job (not once actually delivered —
     *  delivery status lives on the per-recipient Response, same as email's blast/recipient split). */
    public async expandDistribution( accountId : string, distributionId : string ) : Promise<Type.Result<void>>
    {
        const distGot : Type.Result<Distribution.Entity | undefined> = await this.dynamo.get<Distribution.Entity>( "survey_distributions", { accountId, distributionId } );
        if( !distGot.ok )   return { ok: false, error: distGot.error, cause: distGot.cause };
        if( !distGot.data ) return { ok: false, error: "distribution not found" };
        const distribution : Distribution.Entity = ObjectUtils.withDefaults( distGot.data, Distribution.DEFAULT );

        const surveyGot : Type.Result<Survey.Entity | undefined> = await this.dynamo.get<Survey.Entity>( "survey_surveys", { accountId, surveyId: distribution.surveyId } );
        if( !surveyGot.ok )   return { ok: false, error: surveyGot.error, cause: surveyGot.cause };
        if( !surveyGot.data ) return { ok: false, error: "survey not found" };
        const survey : Survey.Entity = surveyGot.data;

        const members : Type.Result<Array<Contact.Entity>> = await this.segments.membersOf( accountId, distribution.audience.segmentId );
        if( !members.ok ) return { ok: false, error: members.error, cause: members.cause };

        // PHONE compiles the survey to a voice IVR flow ONCE per distribution (survey-2.4) — every
        // recipient's call reuses the same flowId, distinguished only by the per-recipient `mergeData` token.
        let flowId : string | undefined = distribution.flowId;
        if( distribution.channel === Distribution.Channel.PHONE && !flowId )
        {
            const compiled : PhoneRunner.CompiledFlow = PhoneRunner.compile( survey );
            const created : Type.Result<string> = await this.voice.createFlow( accountId, `survey:${ survey.id }`, compiled );
            if( !created.ok ) return { ok: false, error: created.error, cause: created.cause };
            flowId = created.data;
        }

        await this.dynamo.put( "survey_distributions", { ...distribution, distributionId, flowId, status: Distribution.Status.SENDING, modifiedAt: new Date().toISOString() } );

        for( const contact of members.data )
        {
            const responseId : Type.UUID = randomUUID();
            const now : Type.ISODateTime = new Date().toISOString();
            const response : SurveyResponse.Entity =
            {
                ...SurveyResponse.DEFAULT,
                id:             responseId,
                accountId,
                surveyId:       survey.id,
                surveyVersion:  survey.version,
                distributionId,
                contactId:      distribution.anonymous ? undefined : contact.id,
                channel:        distribution.channel,
                answers:        [],
                startedAt:      now,
            } as SurveyResponse.Entity;
            const wroteResponse : Type.Result<void> = await this.dynamo.put( "survey_responses", { ...response, responseId } );
            if( !wroteResponse.ok ) { this.log.warn( "distribution recipient response create failed", { distributionId, contactId: contact.id, error: wroteResponse.error } ); continue; }
            void this.emitResponse( Events.Verb.CREATED, response );

            const token : Type.Result<SurveyTokenStore.Entity> = await this.tokens.create( {
                accountId, surveyId: survey.id, surveyVersion: survey.version, distributionId,
                contactId: distribution.anonymous ? undefined : contact.id, responseId,
            } );
            if( !token.ok ) { this.log.warn( "distribution recipient token mint failed", { distributionId, contactId: contact.id, error: token.error } ); continue; }

            const phone : string | undefined = contact.phones.find( ( entry : Contact.PhoneEntry ) : boolean => entry.isDefault )?.value ?? contact.phones[ 0 ]?.value;

            await this.workQueue.enqueue( {
                jobId: token.data.token, accountId, queue: "survey", priority: 5,
                payloadRef: token.data.token, idempotencyKey: token.data.token, createdAt: now,
                meta: { distributionId, channel: distribution.channel, contactId: contact.id, token: token.data.token, phone: phone ?? null, callerId: distribution.callerId ?? null, flowId: flowId ?? null },
            } );
        }

        await this.dynamo.put( "survey_distributions", { ...distribution, distributionId, flowId, status: Distribution.Status.SENT, recipientCount: members.data.length, modifiedAt: new Date().toISOString() } );
        return { ok: true, data: undefined };
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Drain the distribution `WorkQueue` (survey-9.6) — hands each leased recipient to its channel. Survey
     *  never sends directly: the SMS branch compiles the survey to workflow steps (`SmsRunner.compile`, not
     *  executed here — see the implementation plan's workflow-runtime dependency note); the email/web branch
     *  is the hosted-form link (`GetSurveyForm`/`PostSurveyForm`, `/s/:token`) a real send would carry.
     *  The PHONE branch IS fully wired — voice's IVR flow engine + `PostVoiceInternalFlow`/`PostVoiceCalls`
     *  already exist, so `VoiceClient.placeCall` really dials (survey-2.4).
     *  TODO: wire SMS/email's actual transport once workflow ships a runtime / email-texting expose a generic
     *  S2S "send arbitrary content" endpoint (today's `PostInternalSend`/dispatch surfaces are
     *  notification-template-shaped, not this). */
    public async dispatchDistributions() : Promise<void>
    {
        const leases : Array<WorkQueue.Lease> = await this.workQueue.dispatch();
        for( const lease of leases )
        {
            const meta = lease.job.meta as { distributionId? : string; channel? : Distribution.Channel; contactId? : string; token? : string; phone? : string; callerId? : string; flowId? : string } | undefined;

            if( meta?.channel === Distribution.Channel.PHONE && meta.phone && meta.callerId && meta.flowId && meta.token )
            {
                const called : Type.Result<void> = await this.voice.placeCall( lease.job.accountId, meta.phone, meta.callerId, meta.flowId, meta.token );
                if( !called.ok ) this.log.warn( "survey phone dispatch failed", { distributionId: meta.distributionId, contactId: meta.contactId, error: called.error } );
                else this.log.info( "survey phone dispatched", { distributionId: meta.distributionId, contactId: meta.contactId } );
            }
            else this.log.info( "survey distribution dispatched", { distributionId: meta?.distributionId, channel: meta?.channel, contactId: meta?.contactId } );

            await this.workQueue.complete( lease.job.jobId );
        }
    }
}

export namespace SurveyService
{
    /** MAIN = the authed /survey/* API (also drains the response/ingest/distribution queues locally, same
     *  pattern as email's MAIN). FORM = the PUBLIC hosted-form capture ingress (survey-9.3). */
    export enum Role { MAIN = "main", FORM = "form" }

    /** Default local port per role (also the manifest containerPort — one source, can't drift). */
    export const PORT : Record<Role, number> = { [ Role.MAIN ]: Ports.SURVEY.MAIN, [ Role.FORM ]: Ports.SURVEY.FORM };

    /** Input to `captureAnswers` — one batch of answers from any runner (public form, S2S ingest). */
    export interface CaptureInput
    {
        accountId:       string;
        surveyId:        string;
        distributionId?: string;
        contactId?:      string;
        channel:         Distribution.Channel;
        responseId?:     string;   // omit to start a new response
        answers:         Array<{ questionId : string; value : unknown }>;
        complete?:       boolean;
    }
}

export default SurveyService;
// eof

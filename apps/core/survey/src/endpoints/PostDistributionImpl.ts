//
import { randomUUID } from "node:crypto";

import { PostDistribution, Distribution, Survey, Question } from "@repo/api";
import { NetworkUtils, ObjectUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";
import SurveyService from "../services/SurveyService";
import { PhoneRunner } from "../runners/PhoneRunner";

//
// Distribute a published survey to an audience over a channel, on a schedule (survey-3.1). Locks the
// distribution to the survey's CURRENT published version (edits after this point start a new version,
// never retroactively changing this send). Enqueues to `survey-distribution` for `SurveyMainService`'s
// dispatch consumer to expand the audience + fan out (survey-9.6) — this endpoint stays fast (validate →
// write → enqueue → return), per CLAUDE.md's "anything slower than ~500ms is a job" rule.
//
export class PostDistributionImpl extends PostDistribution
{
    private service : SurveyService;
    constructor( service : SurveyService ) { super(); this.service = service; }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId )   return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };
        const accountId : string | undefined = auth.accountId;
        if( !accountId )     return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "no acting account (X-Account)" } };
        const body : PostDistribution.Body | null = this.body;
        if( !body?.surveyId || !body.channel || !body.audience?.segmentId || !body.schedule )
            return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "surveyId, channel, audience.segmentId and schedule are required" } };
        if( body.channel === Distribution.Channel.PHONE && !body.callerId )
            return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "callerId is required for the PHONE channel (a registered outbound number)" } };

        const surveyGot : Type.Result<Survey.Entity | undefined> = await this.service.dynamo.get<Survey.Entity>( "survey_surveys", { accountId, surveyId: body.surveyId } );
        if( !surveyGot.ok )   return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "survey read failed" } };
        if( !surveyGot.data ) return { status: NetworkUtils.Status.NOT_FOUND, data: { message: "survey not found" } };
        const survey : Survey.Entity = ObjectUtils.withDefaults( surveyGot.data, Survey.DEFAULT );
        if( survey.status !== Survey.Status.PUBLISHED ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "only a published survey can be distributed" } };

        const config = await this.service.surveyConfig();
        const now : Type.ISODateTime = new Date().toISOString();
        const id : Type.UUID = randomUUID();
        const entity : Distribution.Entity =
        {
            id,
            accountId,
            surveyId:      body.surveyId,
            surveyVersion: survey.version,
            status:        Distribution.Status.SCHEDULED,
            channel:       body.channel,
            audience:      body.audience,
            schedule:      body.schedule,
            sendAt:        body.sendAt,
            anonymous:     body.anonymous ?? config.anonymousDefault,
            callerId:      body.callerId,
            ownerId:       auth.userId,
            createdAt:     now,
            modifiedAt:    now,
        };

        const wrote : Type.Result<void> = await this.service.dynamo.put( "survey_distributions", { ...entity, distributionId: id } );
        if( !wrote.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "distribution write failed" } };

        const enqueued : Type.Result<void> = await this.service.sqs.send( "survey-distribution", { accountId, distributionId: id } );
        if( !enqueued.ok ) this.service.log.warn( "distribution enqueue failed — will not auto-dispatch", { distributionId: id, error: enqueued.error } );

        // PHONE's gather is DTMF-only (survey-2.4) — flag any question the phone runner will silently skip,
        // rather than let a recipient's answer to one just go missing with no trace. Non-blocking: the
        // caller decides whether that's acceptable for this send (e.g. a mixed-type survey run on SMS/email too).
        const warnings : Array<string> | undefined = body.channel === Distribution.Channel.PHONE
            ? survey.questions
                .filter( ( question : Question.Entity ) : boolean => !PhoneRunner.isDtmfCompatible( question ) )
                .map( ( question : Question.Entity ) : string => `Question "${ question.prompt }" (${ question.type }) has no DTMF equivalent and will be skipped on the phone/IVR runner.` )
            : undefined;

        return { status: NetworkUtils.Status.OK, data: { ...entity, warnings: warnings?.length ? warnings : undefined } };
    }
}

export default PostDistributionImpl;
// eof

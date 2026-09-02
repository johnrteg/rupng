//
import { Type } from "@repo/common";
import { Validation } from "../../model/Validation";

//
// Distribution — a send of a Survey to an audience over a channel, on a schedule (survey-3.0): "a campaign
// of type survey". Distribution never sends itself (survey-9.6) — SurveyDistributionJob hands recipients off
// to texting/email/voice via dispatch (canSend() gate applies, survey-7.1); the SMS channel gets the Survey
// compiled to a workflow definition (survey-2.1), and the PHONE channel gets it compiled to a voice IVR flow
// (survey-2.4), instead of a direct send.
//
export namespace Distribution
{
    /** Distribution lifecycle. */
    export enum Status { SCHEDULED = "scheduled", SENDING = "sending", SENT = "sent", CANCELED = "canceled", FAILED = "failed" }

    /** The channel a distribution rides. */
    export enum Channel { SMS = "sms", EMAIL = "email", PHONE = "phone" }

    /** When a distribution fires. `NOW` sends on creation; `SCHEDULED` at a fixed instant. */
    export enum Schedule { NOW = "now", SCHEDULED = "scheduled" }

    /** The audience a distribution targets — a contact segment (survey-3.2). Modeled minimally; a future
     *  cut may add an explicit campaign-audience-snapshot reference alongside the live segment query. */
    export interface AudienceRef
    {
        segmentId : Type.UUID;
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Distribution (the resource)
    //   DynamoDB: survey_distributions  PK: accountId  SK: distributionId   GSI bySurvey: (accountId, surveyId)
    // ──────────────────────────────────────────────────────────────────────────

    export interface Entity
    {
        id:          Type.UUID;
        accountId:   Type.UUID;
        surveyId:    Type.UUID;
        surveyVersion: number;         // the published Survey.version this distribution locks to
        status:      Status;
        channel:     Channel;
        audience:    AudienceRef;
        schedule:    Schedule;
        sendAt?:     Type.ISODateTime; // when schedule = SCHEDULED
        anonymous:   boolean;          // per-send flag (survey-4.4); account SurveyConfig.anonymousDefault seeds it
        recipientCount?: number;       // materialized at send time
        callerId?:   string;           // PHONE only — the account's registered outbound E.164 number to dial from
        flowId?:     string;           // PHONE only — the voice IVR flow compiled from the survey (cached on first expand)
        ownerId:     Type.UUID;
        createdAt:   Type.ISODateTime;
        modifiedAt:  Type.ISODateTime;
    }

    /** Create payload — server assigns id / accountId / status(SCHEDULED) / surveyVersion / flowId / timestamps.
     *  `anonymous` defaults from the account's SurveyConfig when omitted. `callerId` is REQUIRED when
     *  `channel === PHONE` (checked in the impl, not the type — mirrors PostVoiceCalls' loose body validation). */
    export type CreateDistribution = Pick<Entity, "surveyId" | "channel" | "audience" | "schedule"> & Partial<Pick<Entity, "sendAt" | "anonymous" | "callerId">>;

    export const DEFAULT : Partial<Entity> =
    {
        status: Status.SCHEDULED,
    };

    export const SCHEMA : Validation.Schema =
    {
        $schema: "http://json-schema.org/draft-07/schema#",
        type: "object", additionalProperties: false,
        required: [ "id", "accountId", "surveyId", "surveyVersion", "status", "channel", "audience", "schedule", "anonymous", "ownerId", "createdAt", "modifiedAt" ],
        properties:
        {
            id:            { type: "string", format: "uuid" },
            accountId:     { type: "string", format: "uuid" },
            surveyId:      { type: "string", format: "uuid" },
            surveyVersion: { type: "number" },
            status:        { type: "string", enum: Object.values( Status ) },
            channel:       { type: "string", enum: Object.values( Channel ) },
            audience:      {
                type: "object", additionalProperties: false, required: [ "segmentId" ],
                properties: { segmentId: { type: "string" } },
            },
            schedule:        { type: "string", enum: Object.values( Schedule ) },
            sendAt:          { type: "string", format: "date-time" },
            anonymous:       { type: "boolean" },
            recipientCount:  { type: "number" },
            callerId:        { type: "string" },
            flowId:          { type: "string" },
            ownerId:         { type: "string", format: "uuid" },
            createdAt:       { type: "string", format: "date-time" },
            modifiedAt:      { type: "string", format: "date-time" },
        },
    };

    /** Validate a `Distribution.Entity` (a wire payload, a Kafka/SQS message body). */
    export const validate : Validation.Validator<Entity> = Validation.compile<Entity>( SCHEMA );
}

export default Distribution;
// eof

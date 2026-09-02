//
import { Type } from "@repo/common";
import { Validation } from "../../model/Validation";
import { Question } from "./Question";

//
// Survey — the channel-agnostic DEFINITION (apps/core/survey/SPECS.md "One definition, per-channel runners").
// This is the single source of truth every runner (SMS-via-workflow, email/web hosted form, phone/IVR later)
// renders identically, and every Response answer normalizes back to this Survey's `id` + its Question ids —
// that's what makes a survey coordinated/unified across channels. Survey does NOT own delivery or two-way
// capture; see Distribution.ts / Response.ts for the rest of the domain.
//
export namespace Survey
{
    /** Definition lifecycle (survey-1.4). A `Response` pins the `version` it answered so edits after
     *  publish never retroactively change historical results. */
    export enum Status { DRAFT = "draft", PUBLISHED = "published", ARCHIVED = "archived" }

    /** The standard score an NPS/CSAT/CES question computes, landed on the contact (survey-1.3/4.2). */
    export enum ScoreType { NPS = "nps", CSAT = "csat", CES = "ces" }

    /** NPS bucketing of a 0-10 answer (contact.nps / promoter-detractor segmentation). */
    export enum NpsBucket { DETRACTOR = "detractor", PASSIVE = "passive", PROMOTER = "promoter" }

    /** Which question(s) feed the survey-level standard score, and what contact field/tag it lands on. */
    export interface ScoringConfig
    {
        scoreType:        ScoreType;
        questionId:       Type.UUID;    // the NPS/CSAT/CES question whose answer computes the score
        contactFieldUid?: Type.UUID;    // the contact CustomFieldDef to write the numeric score onto
        tagOnBucket?:     boolean;      // NPS only — also add a promoter/passive/detractor tag
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Survey (the resource)
    //   DynamoDB: survey_surveys  PK: accountId  SK: surveyId   GSI status: (accountId, status)
    // ──────────────────────────────────────────────────────────────────────────

    export interface Entity
    {
        id:            Type.UUID;
        accountId:     Type.UUID;
        name:          string;
        status:        Status;
        version:       number;               // bumped on every publish; responses pin the version they answered
        questions:     Array<Question.Entity>;
        scoring?:      Array<ScoringConfig>;
        ownerId:       Type.UUID;
        createdAt:     Type.ISODateTime;
        modifiedAt:    Type.ISODateTime;
        publishedAt?:  Type.ISODateTime;
    }

    /** Create payload — server assigns id / accountId / status(DRAFT) / version(0) / ownerId / timestamps. */
    export type CreateSurvey = Pick<Entity, "name"> & Partial<Pick<Entity, "questions" | "scoring">>;

    /** Update payload — editable while DRAFT; publishing is its own endpoint (bumps version + flips status). */
    export type UpdateSurvey = Partial<Pick<Entity, "name" | "questions" | "scoring">>;

    /** Read-time DEFAULTs (CLAUDE.md config-model convention) — identity/lifecycle fields omitted. */
    export const DEFAULT : Partial<Entity> =
    {
        status:    Status.DRAFT,
        version:   0,
        questions: [],
    };

    export const SCHEMA : Validation.Schema =
    {
        $schema: "http://json-schema.org/draft-07/schema#",
        type: "object", additionalProperties: false,
        required: [ "id", "accountId", "name", "status", "version", "questions", "ownerId", "createdAt", "modifiedAt" ],
        properties:
        {
            id:        { type: "string", format: "uuid" },
            accountId: { type: "string", format: "uuid" },
            name:      { type: "string" },
            status:    { type: "string", enum: Object.values( Status ) },
            version:   { type: "number" },
            questions: { type: "array", items: Question.SCHEMA },
            scoring:   { type: "array", items: {
                type: "object", additionalProperties: false, required: [ "scoreType", "questionId" ],
                properties:
                {
                    scoreType:        { type: "string", enum: Object.values( ScoreType ) },
                    questionId:       { type: "string" },
                    contactFieldUid:  { type: "string" },
                    tagOnBucket:      { type: "boolean" },
                },
            } },
            ownerId:      { type: "string", format: "uuid" },
            createdAt:    { type: "string", format: "date-time" },
            modifiedAt:   { type: "string", format: "date-time" },
            publishedAt:  { type: "string", format: "date-time" },
        },
    };

    /** Validate a `Survey.Entity` (a wire payload, a Kafka/SQS message body). */
    export const validate : Validation.Validator<Entity> = Validation.compile<Entity>( SCHEMA );

    // ──────────────────────────────────────────────────────────────────────────
    // Scoring engine — pure functions, shared by SurveyService (web/native) and SurveyResponseJob (async
    // scoring on capture). Kept here (not the job) so the SAME formula runs where a definition is authored
    // (preview) and where a response is scored (capture) — one source of truth, testable without transport.
    // ──────────────────────────────────────────────────────────────────────────

    /** Bucket a raw NPS answer (0-10) into detractor/passive/promoter. */
    export function npsBucket( answer : number ) : NpsBucket
    {
        if( answer <= 6 ) return NpsBucket.DETRACTOR;
        if( answer <= 8 ) return NpsBucket.PASSIVE;
        return NpsBucket.PROMOTER;
    }

    /** Compute the standard score for one scoring config given the contact's raw answer to its question.
     *  NPS/CES pass the raw 0-10 / 1-7 answer through; CSAT is the raw 1-5 answer. The bucket is NPS-only. */
    export function computeScore( config : ScoringConfig, rawAnswer : number ) : { score : number; bucket? : NpsBucket }
    {
        if( config.scoreType === ScoreType.NPS ) return { score: rawAnswer, bucket: npsBucket( rawAnswer ) };
        return { score: rawAnswer };
    }
}

export default Survey;
// eof

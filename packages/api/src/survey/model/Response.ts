//
import { Type } from "@repo/common";
import { Validation } from "../../model/Validation";
import { Distribution } from "./Distribution";

//
// Response — one contact's answers to a Survey (+ partials), captured over any channel (survey-4.0). Every
// runner (SMS-via-workflow, email/web form, external provider ingest) writes the SAME shape here, keyed by
// Survey/Question ids, which is what lets an SMS response and a web response aggregate together. Tracks full
// lifecycle + timing so partial/abandoned responses are first-class, not just a completed-or-nothing record
// (survey-4.3). An `anonymous` Distribution's Response carries no `contactId` (survey-4.4) — no token
// binding, no per-contact scoring, aggregates only.
//
export namespace Response
{
    /** Response lifecycle. `abandoned` is set by the abandonment sweep once an `in_progress` response goes
     *  idle past SurveyConfig's inactivity timeout. */
    export enum Status { IN_PROGRESS = "in_progress", COMPLETED = "completed", ABANDONED = "abandoned" }

    /** One answered question. `value` is a JSON-serializable answer shape appropriate to the Question.Type
     *  (a number for nps/csat/ces/rating/scale, a choice id or array of choice ids for select/ranking, a
     *  boolean for yes_no, sanitized text for open_text — see Question.ts). */
    export interface Answer
    {
        questionId: Type.UUID;
        value:      Type.Json;
        answeredAt: Type.ISODateTime;
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Response (the resource)
    //   DynamoDB: survey_responses  PK: accountId  SK: responseId
    //   GSI bySurvey: (accountId, surveyId) · GSI byStatus: (accountId, status) — abandonment sweep scan
    // ──────────────────────────────────────────────────────────────────────────

    export interface Entity
    {
        id:             Type.UUID;
        accountId:      Type.UUID;
        surveyId:       Type.UUID;
        surveyVersion:  number;
        distributionId?: Type.UUID;
        channel:        Distribution.Channel;
        contactId?:     Type.UUID;       // absent when the distribution is anonymous
        answers:        Array<Answer>;
        status:         Status;
        lastQuestionId?: Type.UUID;      // the drop-off step, for in_progress / abandoned
        score?:         number;          // the computed standard score (survey-1.3), when scoring config applies
        startedAt:      Type.ISODateTime;
        completedAt?:   Type.ISODateTime;
        abandonedAt?:   Type.ISODateTime;
        expiresAt?:     number;          // epoch seconds — DynamoDB TTL for stale partials (retention)
    }

    export const DEFAULT : Partial<Entity> =
    {
        status:  Status.IN_PROGRESS,
        answers: [],
    };

    export const SCHEMA : Validation.Schema =
    {
        $schema: "http://json-schema.org/draft-07/schema#",
        type: "object", additionalProperties: false,
        required: [ "id", "accountId", "surveyId", "surveyVersion", "channel", "answers", "status", "startedAt" ],
        properties:
        {
            id:             { type: "string", format: "uuid" },
            accountId:      { type: "string", format: "uuid" },
            surveyId:       { type: "string", format: "uuid" },
            surveyVersion:  { type: "number" },
            distributionId: { type: "string" },
            channel:        { type: "string", enum: Object.values( Distribution.Channel ) },
            contactId:      { type: "string" },
            answers:        { type: "array", items: {
                type: "object", additionalProperties: false, required: [ "questionId", "value", "answeredAt" ],
                properties:
                {
                    questionId: { type: "string" },
                    value:      {},
                    answeredAt: { type: "string", format: "date-time" },
                },
            } },
            status:         { type: "string", enum: Object.values( Status ) },
            lastQuestionId: { type: "string" },
            score:          { type: "number" },
            startedAt:      { type: "string", format: "date-time" },
            completedAt:    { type: "string", format: "date-time" },
            abandonedAt:    { type: "string", format: "date-time" },
            expiresAt:      { type: "number" },
        },
    };

    /** Validate a `Response.Entity` (a wire payload, a Kafka/SQS message body). */
    export const validate : Validation.Validator<Entity> = Validation.compile<Entity>( SCHEMA );
}

export default Response;
// eof

//
import { Type } from "@repo/common";
import { Validation } from "../../model/Validation";

//
// WorkflowInstance — one durable run of a `Workflow.Entity` VERSION for one subject. This pass models a
// SINGLE-frontier instance (one active/waiting node at a time) — the full "frontier, not a cursor" model
// (parallel `split`/`merge`/`for-each`) is deferred with those node types (see Workflow.ts's header note
// and README.md's `workflow-3.6`). Persisted on every transition (SPECS.md "durable interpreter").
//
export namespace WorkflowInstance
{
    /** `running → waiting → running → …` until a terminal state. Mirrors README.md's instance lifecycle,
     *  minus `canceled`/`archived` (deferred with the cancel/kill-switch endpoints). */
    export enum Status
    {
        RUNNING   = "running",
        WAITING   = "waiting",
        COMPLETED = "completed",
        FAILED    = "failed",
    }

    /** How a step finished — the troubleshooting trace (SPECS.md `workflow-3.5`). */
    export enum Outcome
    {
        ADVANCED = "advanced",
        WAITING  = "waiting",
        FAILED   = "failed",
    }

    /** One entry in the per-node activity log. */
    export interface HistoryEntry
    {
        nodeId:    Type.ID;
        enteredAt: Type.ISODateTime;
        outcome:   Outcome;
        output?:   Record<string, unknown>;
        error?:    string;
    }

    export interface Entity
    {
        instanceId:    Type.UUID;
        accountId:     Type.UUID;
        definitionId:  Type.UUID;
        defVersion:    number;
        subject:       string;              // e.g. a contactId, or "manual" for an author-initiated run
        status:        Status;
        context:       Record<string, unknown>;
        currentNodeId: Type.ID;
        waitKey?:      string;              // set while WAITING on wait_for_response — see Engine.ts
        history:       Array<HistoryEntry>;
        startedAt:     Type.ISODateTime;
        updatedAt:     Type.ISODateTime;
    }

    export const SCHEMA : Validation.Schema =
    {
        $schema: "http://json-schema.org/draft-07/schema#",
        type: "object", additionalProperties: false,
        required: [ "instanceId", "accountId", "definitionId", "defVersion", "subject", "status", "context", "currentNodeId", "history", "startedAt", "updatedAt" ],
        properties:
        {
            instanceId:    { type: "string", format: "uuid" },
            accountId:     { type: "string", format: "uuid" },
            definitionId:  { type: "string", format: "uuid" },
            defVersion:    { type: "number" },
            subject:       { type: "string" },
            status:        { type: "string", enum: Object.values( Status ) },
            context:       { type: "object" },
            currentNodeId: { type: "string" },
            waitKey:       { type: "string" },
            history:       { type: "array", items: {
                type: "object", additionalProperties: false, required: [ "nodeId", "enteredAt", "outcome" ],
                properties: {
                    nodeId:    { type: "string" },
                    enteredAt: { type: "string", format: "date-time" },
                    outcome:   { type: "string", enum: Object.values( Outcome ) },
                    output:    { type: "object" },
                    error:     { type: "string" },
                },
            } },
            startedAt: { type: "string", format: "date-time" },
            updatedAt: { type: "string", format: "date-time" },
        },
    };

    export const validate : Validation.Validator<Entity> = Validation.compile<Entity>( SCHEMA );
}

export default WorkflowInstance;
// eof

//
import { Type } from "@repo/common";
import { Validation } from "../../model/Validation";

//
// Question — a single typed question within a Survey definition (apps/core/survey/SPECS.md survey-1.2).
// Every channel runner (SMS/email/phone) renders the SAME Question against its own widget (SMS keyword vs
// web widget vs voice prompt) and every Response normalizes its answer back to this Question's `id` — that's
// what keeps results unified across channels. NPS/CSAT/CES questions additionally drive the scoring engine
// (see Survey.ts scoring helpers) and can trigger branching via `Question.Branch`.
//
export namespace Question
{
    /** The first-class question/score types (survey-1.2). A closed set → enum, never a free string. */
    export enum Type_
    {
        NPS          = "nps",            // 0-10 "how likely to recommend" — standard NPS score
        CSAT         = "csat",           // 1-5 satisfaction — standard CSAT score
        CES          = "ces",            // 1-7 "how easy" — standard CES score
        RATING       = "rating",         // n-star rating
        SCALE        = "scale",          // 1..n numeric scale
        SINGLE_SELECT = "single_select", // pick one of `choices`
        MULTI_SELECT  = "multi_select",  // pick any of `choices`
        RANKING       = "ranking",       // order `choices`
        OPEN_TEXT     = "open_text",     // free text — sanitized per survey-7.2.1
        YES_NO        = "yes_no",        // boolean
    }

    /** A selectable option for `single_select` / `multi_select` / `ranking` questions. */
    export interface Choice
    {
        id:    Type.UUID;
        label: string;
    }

    /** Per-type render config — only the fields relevant to `type` are set/read. */
    export interface Config
    {
        choices?:  Array<Choice>;   // single_select / multi_select / ranking
        ratingMax?: number;         // rating (default 5 stars)
        scaleMax?:  number;         // scale (default 10)
        placeholder?: string;       // open_text hint
    }

    /** A branch rule — "if the answer to this question matches `whenValue`, jump to `nextQuestionId`" (else
     *  fall through to the next question in `Survey.questions` order). Compiled to a workflow `switch` node
     *  by the SMS runner (survey-2.1); the email/web runner applies it client-side on submit-per-step. */
    export interface Branch
    {
        whenValue:      string;    // the choice id / yes-no value / keyword this branch matches
        nextQuestionId: Type.UUID;
    }

    /** One question in a Survey definition. `id` is stable across versions/channels — it's the join key every
     *  Response answer and every scoring/branching rule references. */
    export interface Entity
    {
        id:        Type.UUID;
        type:      Type_;
        prompt:    string;
        required:  boolean;
        order:     number;
        config?:   Config;
        branches?: Array<Branch>;   // evaluated in order; first match wins
    }

    const CHOICE_SCHEMA : Validation.Schema =
    {
        type: "object", additionalProperties: false, required: [ "id", "label" ],
        properties: { id: { type: "string" }, label: { type: "string" } },
    };

    const CONFIG_SCHEMA : Validation.Schema =
    {
        type: "object", additionalProperties: false,
        properties:
        {
            choices:     { type: "array", items: CHOICE_SCHEMA },
            ratingMax:   { type: "number" },
            scaleMax:    { type: "number" },
            placeholder: { type: "string" },
        },
    };

    const BRANCH_SCHEMA : Validation.Schema =
    {
        type: "object", additionalProperties: false, required: [ "whenValue", "nextQuestionId" ],
        properties: { whenValue: { type: "string" }, nextQuestionId: { type: "string" } },
    };

    export const SCHEMA : Validation.Schema =
    {
        type: "object", additionalProperties: false, required: [ "id", "type", "prompt", "required", "order" ],
        properties:
        {
            id:       { type: "string" },
            type:     { type: "string", enum: Object.values( Type_ ) },
            prompt:   { type: "string" },
            required: { type: "boolean" },
            order:    { type: "number" },
            config:   CONFIG_SCHEMA,
            branches: { type: "array", items: BRANCH_SCHEMA },
        },
    };

    /** Validate one `Question.Entity` (used as a nested schema by `Survey.SCHEMA`). */
    export const validate : Validation.Validator<Entity> = Validation.compile<Entity>( SCHEMA );
}

export default Question;
// eof

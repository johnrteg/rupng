//
import { Survey, Question } from "@repo/api";

//
// PhoneRunner — compiles a channel-agnostic Survey definition to a voice IVR flow (survey-2.4). Mirrors
// SmsRunner's shape (one step per question, in `order`) but targets voice's OWN flow model
// (packages/api/src/voice/model/Voice.ts: `IvrStep`/`IvrGather`, a `Record<stepId, IvrStep>` keyed graph,
// not a node/edge list) — phone is a REAL, resolvable dependency (voice ships an IVR flow engine +
// `PostVoiceInternalFlow` S2S create endpoint today), unlike the SMS runner's workflow target which has no
// runtime yet. `question.id` is reused as the voice step id, exactly like SmsRunner reuses it as `varName` —
// that's what lets a phone answer normalize back to the same Question id as every other runner (survey-2.5).
//
// Voice's `IvrGather` is DTMF-only (no speech/NLU gather yet) — so only closed-answer question types
// (`yes_no`, `single_select` with single-digit choice ids, `nps`/`csat`/`ces`/`rating`/`scale` whose value fits
// one digit) compile cleanly; `open_text`/`multi_select`/`ranking` have no DTMF equivalent and are SKIPPED on
// this runner (an account distributing over PHONE should avoid those question types — a future speech-gather
// runner would lift this restriction).
//
export namespace PhoneRunner
{
    /** Local mirror of `packages/api/src/voice/model/Voice.ts`'s `IvrStep`/`IvrGather` shape — kept minimal
     *  (only the fields this compiler emits) so survey doesn't need a full `Voice` model dependency for a
     *  shape it only ever WRITES via `PostVoiceInternalFlow`, never reads. */
    export interface IvrStep
    {
        id      : string;
        message : { kind : "tts"; text : string };
        gather? : { numDigits : number; timeoutSec : number; branches : Record<string, string> };
    }

    export interface CompiledFlow
    {
        entryStepId : string;
        steps       : Record<string, IvrStep>;
    }

    const DTMF_QUESTION_TYPES : ReadonlySet<Question.Type_> = new Set( [
        Question.Type_.NPS, Question.Type_.CSAT, Question.Type_.CES, Question.Type_.RATING, Question.Type_.SCALE,
        Question.Type_.SINGLE_SELECT, Question.Type_.YES_NO,
    ] );

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Whether a question can render as a DTMF gather (survey-2.4's scoping note above). */
    export function isDtmfCompatible( question : Question.Entity ) : boolean
    {
        return DTMF_QUESTION_TYPES.has( question.type );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Compile a Survey definition to a voice IVR flow — one `IvrStep` per DTMF-compatible question (in
     *  `order`), each gathering a single digit and branching per `Question.Branch`, falling through to the
     *  next question via `branches["default"]`. Terminates in a message-only (no `gather`) thank-you step. */
    export function compile( survey : Survey.Entity ) : CompiledFlow
    {
        const questions : Array<Question.Entity> = survey.questions
            .filter( isDtmfCompatible )
            .sort( ( first : Question.Entity, second : Question.Entity ) : number => first.order - second.order );

        const steps : Record<string, IvrStep> = {};
        const THANK_YOU_STEP_ID : string = "__complete";
        steps[ THANK_YOU_STEP_ID ] = { id: THANK_YOU_STEP_ID, message: { kind: "tts", text: "Thank you for completing the survey. Goodbye." } };

        questions.forEach( ( question : Question.Entity, index : number ) : void =>
        {
            const next : Question.Entity | undefined = questions[ index + 1 ];
            const nextStepId : string = next ? next.id : THANK_YOU_STEP_ID;
            const branches : Record<string, string> = { default: nextStepId };
            for( const branch of question.branches ?? [] ) branches[ branch.whenValue ] = branch.nextQuestionId;

            steps[ question.id ] = {
                id: question.id,
                message: { kind: "tts", text: question.prompt },
                gather:  { numDigits: 1, timeoutSec: 10, branches },
            };
        } );

        return { entryStepId: questions[ 0 ]?.id ?? THANK_YOU_STEP_ID, steps };
    }
}

export default PhoneRunner;
// eof

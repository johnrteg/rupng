//
import { Distribution } from "@repo/api";

//
// SurveyProvider — the adapter interface an external survey tool (SurveyMonkey/Typeform/...) implements
// (survey-2.3/6.0). One interface, many providers; a concrete adapter normalizes that provider's webhook
// payload into the SAME `answers` shape `SurveyService.captureAnswers` accepts for every other runner — so
// an externally-collected response still aggregates on the same Survey/Question ids (survey-2.5). Selected +
// instantiated by `SurveyProviderFactory`; the real per-provider question-id mapping (their question id →
// ours) is a marketplace-installation concern, deferred here to a `questionIdMap` the caller supplies.
//
export interface SurveyProvider
{
    /** Which provider this adapter is (the factory key). */
    readonly id : string;

    /** Verify the webhook's signature against the given secret. Never throws. */
    verify( payload : unknown, signature : string | undefined, secret : string ) : boolean;

    /** Normalize a verified payload into a capture-ready batch. Returns `undefined` if the payload doesn't
     *  map to a recognized survey/response (e.g. a provider ping/test event). */
    normalize( payload : unknown, questionIdMap : Record<string, string> ) : SurveyProvider.Normalized | undefined;
}

export namespace SurveyProvider
{
    export interface Normalized
    {
        surveyId:        string;
        distributionId?: string;
        contactId?:      string;
        channel:         Distribution.Channel;
        answers:         Array<{ questionId : string; value : unknown }>;
        complete:        boolean;
    }
}

export default SurveyProvider;
// eof

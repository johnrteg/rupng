//
// Survey service payloads
//
import type { Type } from "@repo/common";

/** A survey definition — the `survey.survey` entity representation. */
export interface Survey
{
    id:        Type.ID;
    accountId: Type.ID;
    name:      string;
    status:    string;
    version:   number;
}

/** A captured response — the `survey.response` entity representation (survey-5.2's completion trigger). */
export interface SurveyResponse
{
    id:        Type.ID;
    accountId: Type.ID;
    surveyId:  Type.ID;
    contactId?: Type.ID;
    status:    string;
    score?:    number;
}

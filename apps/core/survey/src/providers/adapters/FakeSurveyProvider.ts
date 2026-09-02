//
import { Distribution } from "@repo/api";
import { SurveyProvider } from "../SurveyProvider";

//
// FakeSurveyProvider — a dev/test adapter (no real vendor call): treats the incoming payload as ALREADY in
// our shape (`{ surveyId, distributionId?, contactId?, answers, complete }`), skipping signature verification.
// Scaffold-only, mirroring how email/print/voice ship a fake provider first (`FakeProvider.ts`).
//
export class FakeSurveyProvider implements SurveyProvider
{
    public readonly id : string = "fake";

    ////////////////////////////////////////////////////////////////////////////////////////////
    public verify( _payload : unknown, _signature : string | undefined, _secret : string ) : boolean { return true; }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public normalize( payload : unknown, _questionIdMap : Record<string, string> ) : SurveyProvider.Normalized | undefined
    {
        const body = payload as Partial<SurveyProvider.Normalized> & { surveyId? : string };
        if( !body.surveyId || !body.answers ) return undefined;
        return {
            surveyId:        body.surveyId,
            distributionId:  body.distributionId,
            contactId:       body.contactId,
            channel:         Distribution.Channel.EMAIL,
            answers:         body.answers,
            complete:        body.complete ?? true,
        };
    }
}

export default FakeSurveyProvider;
// eof

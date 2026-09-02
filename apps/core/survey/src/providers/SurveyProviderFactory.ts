//
import { SurveyProvider } from "./SurveyProvider";
import { FakeSurveyProvider } from "./adapters/FakeSurveyProvider";

//
// SurveyProviderFactory — the external-connector registry (survey-2.3/6.0), same registry-of-adapters shape
// as `EmailFactory`. A marketplace-installed provider (SurveyMonkey/Typeform/...) registers its adapter here
// at install time; only the `fake` adapter ships today (scaffold, matching email/print/voice's own first cut).
//
export class SurveyProviderFactory
{
    private readonly registry : Map<string, () => SurveyProvider> = new Map( [
        [ "fake", () : SurveyProvider => new FakeSurveyProvider() ],
    ] );

    ////////////////////////////////////////////////////////////////////////////////////////////
    public register( id : string, make : () => SurveyProvider ) : void { this.registry.set( id, make ); }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public get( id : string ) : SurveyProvider | undefined { return this.registry.get( id )?.(); }
}

export default SurveyProviderFactory;
// eof

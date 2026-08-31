//
import { ReportGenerator } from "./ReportGenerator";
import { ContactsReportGenerator } from "./ContactsReportGenerator";
import { AccountsReportGenerator } from "./AccountsReportGenerator";
import { CampaignsReportGenerator } from "./CampaignsReportGenerator";
import { RegistrationBrandPipelineReportGenerator } from "./RegistrationBrandPipelineReportGenerator";
import { RegistrationCampaignsReportGenerator } from "./RegistrationCampaignsReportGenerator";
import { RegistrationChargesReportGenerator } from "./RegistrationChargesReportGenerator";
import { RegistrationOpsQueueReportGenerator } from "./RegistrationOpsQueueReportGenerator";

//
// GeneratorFactory — the registry of report generators (report-9.1), keyed by the catalog `Definition.
// generator` id (a plain string, not an enum — the catalog is an open, code-defined registry any future
// report adds an entry to). Mirrors VoiceFactory's `Map<key, make>` + `register()`/`get()` shape.
//
export class GeneratorFactory
{
    private readonly registry : Map<string, () => ReportGenerator> = new Map<string, () => ReportGenerator>( [
        [ "contacts",  () => new ContactsReportGenerator() ],
        [ "accounts",  () => new AccountsReportGenerator() ],
        [ "campaigns", () => new CampaignsReportGenerator() ],
        [ "registration_brand_pipeline", () => new RegistrationBrandPipelineReportGenerator() ],
        [ "registration_campaigns", () => new RegistrationCampaignsReportGenerator() ],
        [ "registration_cost_estimates", () => new RegistrationChargesReportGenerator() ],
        [ "registration_ops_queue", () => new RegistrationOpsQueueReportGenerator() ],
    ] );

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Register (or replace) a generator — add a report type without editing call sites. */
    public register( generator : string, make : () => ReportGenerator ) : void { this.registry.set( generator, make ); }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Instantiate one report's generator, or undefined if none is registered. */
    public get( generator : string ) : ReportGenerator | undefined
    {
        const make : ( () => ReportGenerator ) | undefined = this.registry.get( generator );
        return make ? make() : undefined;
    }
}

export default GeneratorFactory;
// eof

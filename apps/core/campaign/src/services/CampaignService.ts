//
import { Application, Service, Ports, Register, Dynamo, Kafka } from "@repo/services";
import type { Type } from "@repo/common";

//
// CampaignService — the campaign domain's Service BASE (not deployed alone). Holds the shared domain wiring
// (DynamoDB + Kafka facades, version) so the concrete role (CampaignMainService) inherits it. Campaign is an
// orchestrator + state machine: it owns the definition/lifecycle, composes contact + the channels, and never
// sends directly.
//
export class CampaignService extends Service
{
    private _dynamo? : Dynamo;
    private _kafka?  : Kafka;

    ////////////////////////////////////////////////////////////////////////////////////////////
    constructor( role : CampaignService.Role )
    {
        // super( serviceId, role, defaultLocalPort ) — env PORT overrides the default when set.
        super( Register.Service.CAMPAIGN, role, CampaignService.PORT[ role ] );

        // stamp the running version from package.json (walks up from bin/services at runtime)
        const pkg : Application.PackageInfo = this.loadPackageInfo( __dirname );
        this.setVersion( pkg.version );
        this.log.info( "version", { name: pkg.name, version: pkg.version } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** DynamoDB facade — the source of truth for campaigns. Lazy + cached. */
    public get dynamo() : Dynamo { return this._dynamo ??= new Dynamo( this.cloud ); }

    /** Kafka facade — CRUD event emission (campaign.* topics), best-effort. Lazy + cached. */
    public get kafka() : Kafka { return this._kafka ??= new Kafka( this.cloud ); }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Allocate the next per-account sequential reference number for an entity kind (starts at 1). Atomic +
     *  monotonic + never-reused (see `Dynamo.increment`): a burned number on a failed create is an acceptable
     *  gap, and a purged entity never frees its number. The caller stamps the returned value onto the new row's
     *  immutable `ref` field. Returns a Result — a failed allocation aborts the create (no unnumbered rows). */
    public async nextRef( accountId : Type.UUID, kind : CampaignService.SequenceKind ) : Promise<Type.Result<number>>
    {
        return this.dynamo.increment( "campaign_counters", { accountId, kind }, "n" );
    }
}

export namespace CampaignService
{
    /** campaign is single-role: MAIN serves the /campaign/* API. */
    export enum Role { MAIN = "main" }

    /** The entity kinds that carry a per-account sequence (the SK of the `campaign_counters` table). */
    export enum SequenceKind { CAMPAIGN = "campaign" }

    /** Default local port per role (also the manifest containerPort — one source, can't drift). */
    export const PORT : Record<Role, number> = { [ Role.MAIN ]: Ports.CAMPAIGN.MAIN };
}

export default CampaignService;

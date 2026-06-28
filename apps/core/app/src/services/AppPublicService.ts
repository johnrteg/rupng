//
import { GetBootstrap } from '@repo/api';
import { GetBootstrapImpl } from '../endpoints/GetBootstrapImpl';
import AppService from './AppService';
import { Type } from '@repo/common';

//
// public, edge-fronted, high-volume role — /app/bootstrap (+ login notices[]), public flags,
// and the unauthenticated, rate-limited, intake-only endpoints (/app/telemetry, /app/events).
// Adds no authority; scales independently of the authed app. (SPECS app-11.* / Two security tiers)
//
export class AppPublicService extends AppService
{
    /////////////////////////////////////////////////////////////////////
    constructor()
    {
        super( AppService.Role.PUBLIC );
    }

    /////////////////////////////////////////////////////////////////////
    protected override async init() : Promise<void>
    {
        await super.init();

        // The public role owns the WEB config (GetBootstrap.Config) in AppConfig (profile "web").
        // Ensure it exists — seed it with GetBootstrap.SEED on first run so a fresh environment serves
        // a usable bootstrap without a manual console step. (Distinct from the authed AppService config.)
        const seeded : Type.Result<GetBootstrap.Config> = await this.appConfig.ensureSeeded( "config", "web", GetBootstrap.SEED );
        if ( seeded.ok ) this.log.info( "web config ready" );
        else this.log.warn( "web config seed failed — serving SEED until deployed", { error: seeded.error } );
    }

    /////////////////////////////////////////////////////////////////////
    protected override async registerEndpoints() : Promise<void>
    {
        await super.registerEndpoints();              // keeps /health
        this.register( new GetBootstrapImpl( this ) );
    }
}

export default AppPublicService;

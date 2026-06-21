//
import { GetBootstrapImpl } from '../endpoints/GetBootstrapImpl';
import AppService from './AppService';

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
    protected override async registerEndpoints() : Promise<void>
    {
        await super.registerEndpoints();              // keeps /health
        this.register( new GetBootstrapImpl( this ) );
    }
}

export default AppPublicService;

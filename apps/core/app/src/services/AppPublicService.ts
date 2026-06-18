//
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
}

export default AppPublicService;

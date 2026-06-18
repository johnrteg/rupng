//
import AppService from './AppService';

//
// authed BFF — UI aggregation (/app/views/*), the full feature-flag set, notices CRUD/admin,
// support glue (ticket / page-share), and ops. Adds no authority of its own. (SPECS app-11.2)
//
export class AppMainService extends AppService
{
    /////////////////////////////////////////////////////////////////////
    constructor()
    {
        super( AppService.Role.MAIN );
    }
}

export default AppMainService;

//
import DispatchService from './DispatchService';

//
// reader service
//
export class ConfigMainService extends DispatchService
{
    /////////////////////////////////////////////////////////////////////
    constructor()
    {
        super( DispatchService.Role.MAIN );
    }
}


export default ConfigMainService;
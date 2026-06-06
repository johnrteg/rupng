//
import DispatchService from './DispatchService';

//
// reader service
//
export class DispatchMainService extends DispatchService
{
    /////////////////////////////////////////////////////////////////////
    constructor()
    {
        super( DispatchService.Role.MAIN );
    }
}


export default DispatchMainService;
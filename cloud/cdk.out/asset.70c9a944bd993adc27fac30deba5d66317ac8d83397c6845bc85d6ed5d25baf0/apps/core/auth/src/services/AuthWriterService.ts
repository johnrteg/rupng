//
import AuthService from './AuthService';

//
// reader service
//
export class AuthWriterService extends AuthService
{
    /////////////////////////////////////////////////////////////////////
    constructor()
    {
        super( AuthService.Role.WRITER );
    }
}


export default AuthWriterService;
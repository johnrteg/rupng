//
import AuthService from './AuthService';

//
// reader service
//
export class AuthReaderService extends AuthService
{
    /////////////////////////////////////////////////////////////////////
    constructor()
    {
        super( AuthService.Role.READER );
    }
}


export default AuthReaderService;
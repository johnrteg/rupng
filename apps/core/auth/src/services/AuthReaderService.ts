//
import AuthService from './AuthService';

//
// reader service — read-only auth lookups (user search, existence check, user-metadata reads, sessions,
// accounts, passkeys). Scales independently from the writer so a read flood can't starve sign-in/sign-up
// writes. Endpoint impls live on AuthService (shared with the combined Main role).
//
export class AuthReaderService extends AuthService
{
    /////////////////////////////////////////////////////////////////////
    constructor()
    {
        super( AuthService.Role.READER );
    }

    /////////////////////////////////////////////////////////////////////
    protected override async registerEndpoints() : Promise<void>
    {
        await super.registerEndpoints();          // keeps /health + /version
        this.registerReadEndpoints();
    }
}


export default AuthReaderService;

//
import AuthService from './AuthService';

//
// writer service — owns the mutating auth flows (stepped login → session, registration, contact
// verification, password reset, passkeys, metadata writes). Split from the read-only reader role for
// prod scale-out. Endpoint impls live on AuthService (shared with the combined Main role).
//
export class AuthWriterService extends AuthService
{
    /////////////////////////////////////////////////////////////////////
    constructor()
    {
        super( AuthService.Role.WRITER );
    }

    /////////////////////////////////////////////////////////////////////
    protected override async registerEndpoints() : Promise<void>
    {
        await super.registerEndpoints();          // keeps /health + /version
        this.registerWriteEndpoints();
    }
}


export default AuthWriterService;

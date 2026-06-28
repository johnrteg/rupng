//
import AuthService from './AuthService';

//
// MAIN role — the COMBINED auth service: registers BOTH the read and write endpoints in one process.
// This is what local dev + the webproxy target (/api/auth → :8110), and a simple single-task deploy.
// The reader/writer split (separate roles) exists for prod scale-out; Main is the all-in-one.
//
export class AuthMainService extends AuthService
{
    /////////////////////////////////////////////////////////////////////
    constructor()
    {
        super( AuthService.Role.MAIN );
    }

    /////////////////////////////////////////////////////////////////////
    protected override async registerEndpoints() : Promise<void>
    {
        await super.registerEndpoints();          // keeps /health + /version
        this.registerReadEndpoints();
        this.registerWriteEndpoints();
    }
}


export default AuthMainService;

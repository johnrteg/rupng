//
import { GetUserExists } from '@repo/api';
import { NetworkUtils } from '@repo/common';
import { RestfulEndpoint } from '@repo/endpoint';
import AuthService from '../services/AuthService';
import type UserStore from '../services/UserStore';
import { authError, type AuthFailure } from './AuthErrors';

//
// Email/phone existence check (authed admin/staff — never the anonymous sign-up path). Cognito is
// authoritative for both identifiers.
//
export class GetUserExistsImpl extends GetUserExists
{
    private service : AuthService;

    ////////////////////////////////////////////////////////////////////////////////////////////////////////////
    constructor( service : AuthService )
    {
        super();
        this.service = service;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////////////////////
    public async execute( _auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        try
        {
            const existence : UserStore.Existence = await this.service.users.exists( this.query?.email, this.query?.phone );
            const reply : GetUserExists.Response = { exists: existence.exists, emailTaken: existence.emailTaken, phoneTaken: existence.phoneTaken };
            return { status: NetworkUtils.Status.OK, data: reply };
        }
        catch( err )
        {
            const failure : AuthFailure = authError( err );
            return { status: failure.status, data: { message: failure.message } };
        }
    }
}

export default GetUserExistsImpl;

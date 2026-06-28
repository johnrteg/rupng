//
import { PostRegister } from '@repo/api';
import { NetworkUtils } from '@repo/common';
import { RestfulEndpoint } from '@repo/endpoint';
import AuthService from '../services/AuthService';
import type UserStore from '../services/UserStore';
import { authError, type AuthFailure } from './AuthErrors';

//
// Create the pending account: Cognito SignUp (sends the verification code) + a DynamoDB `users` row.
// Enumeration-neutral — an already-registered identifier returns the SAME acknowledgement (the truthful
// "you already have an account" is emailed to the owner out-of-band, never surfaced here).
//
export class PostRegisterImpl extends PostRegister
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
        const body : PostRegister.Body = this.body!;
        const account : string = body.account;
        const verify  : string = body.method === "phone" ? "phone" : "email";
        try
        {
            const registered : UserStore.Registered = await this.service.users.register( {
                method: body.method, account, firstName: body.firstName, lastName: body.lastName, accountName: body.accountName, password: body.password,
            } );
            const reply : PostRegister.Response = { registrationToken: account, verify: registered.verify };
            return { status: NetworkUtils.Status.OK, data: reply };
        }
        catch( err )
        {
            const failure : AuthFailure = authError( err );
            // already-exists → neutral acknowledgement (do not reveal); other errors surface.
            if( failure.status === NetworkUtils.Status.CONFLICT )
            {
                const reply : PostRegister.Response = { registrationToken: account, verify };
                return { status: NetworkUtils.Status.OK, data: reply };
            }
            return { status: failure.status, data: { message: failure.message } };
        }
    }
}

export default PostRegisterImpl;

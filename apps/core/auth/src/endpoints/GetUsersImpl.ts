//
import { GetUsers } from '@repo/api';
import { NetworkUtils } from '@repo/common';
import { RestfulEndpoint } from '@repo/endpoint';
import AuthService from '../services/AuthService';
import { authError, type AuthFailure } from './AuthErrors';

//
// Admin user search — Cognito ListUsers (by filter) composed with the DynamoDB users row.
//
export class GetUsersImpl extends GetUsers
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
            const users = await this.service.users.list( this.query ?? {} );
            const reply : GetUsers.Response = { users, total: users.length };
            return { status: NetworkUtils.Status.OK, data: reply };
        }
        catch( err )
        {
            const failure : AuthFailure = authError( err );
            return { status: failure.status, data: { message: failure.message } };
        }
    }
}

export default GetUsersImpl;

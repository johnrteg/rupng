import {
    ListUserPoolsCommand,
    ListUsersCommand, type UserType, type AttributeType,
    AdminCreateUserCommand, AdminUpdateUserAttributesCommand,
    AdminEnableUserCommand, AdminDisableUserCommand,
    AdminDeleteUserCommand, AdminSetUserPasswordCommand
} from "@aws-sdk/client-cognito-identity-provider";

import { cognitoClient, awsErr, isReadOnly } from "./aws";
import type { CognitoPool, CognitoResult, CognitoUser } from "../shared/types";

//
// Cognito user-pool browser/editor for the Cognito tab (auth only). Pools are physically named
// `<env>-<service>-userpool-<key>`, so a service's pools are those whose name contains
// `-<service>-userpool-`. Targets LocalStack or real AWS via the shared aws.ts client; real AWS is
// READ-ONLY here (mutations refused — same guard as the Config tab).
//

const USER_PAGE : number = 60;

///////////////////////////////////////////////////////////////////////////////////////////////////
/** The Cognito user pools owned by a service (by physical-name convention). */
export async function cognitoPools( service : string ) : Promise<{ pools : CognitoPool[]; error? : string }>
{
    try
    {
        const pools : CognitoPool[] = [];
        let token : string | undefined;
        do
        {
            const page = await cognitoClient().send( new ListUserPoolsCommand( { MaxResults: 50, NextToken: token } ) );
            ( page.UserPools ?? [] ).forEach( ( p ) => { if ( p.Id && p.Name ) pools.push( { id: p.Id, name: p.Name } ); } );
            token = page.NextToken;
        }
        while ( token );

        const marker : string = `-${service}-userpool-`;
        return { pools: pools.filter( ( p ) => p.name.includes( marker ) ) };
    }
    catch ( err )
    {
        return { pools: [], error: awsErr( err ) };
    }
}

///////////////////////////////////////////////////////////////////////////////////////////////////
/** List users in a pool. `filter` (optional) matches the email prefix. */
export async function cognitoUsers( poolId : string, filter? : string ) : Promise<{ users : CognitoUser[]; error? : string }>
{
    try
    {
        const out = await cognitoClient().send( new ListUsersCommand( {
            UserPoolId: poolId,
            Limit:      USER_PAGE,
            Filter:     filter && filter.trim() !== "" ? `email ^= "${filter.trim()}"` : undefined,
        } ) );
        return { users: ( out.Users ?? [] ).map( mapUser ) };
    }
    catch ( err )
    {
        return { users: [], error: awsErr( err ) };
    }
}

///////////////////////////////////////////////////////////////////////////////////////////////////
/** Create a user (invite email suppressed — console-created). `attributes` e.g. { email, given_name, … }. */
export async function cognitoCreateUser( poolId : string, username : string, attributes : Record<string, string>, tempPassword? : string ) : Promise<CognitoResult>
{
    if ( isReadOnly() ) return readOnly();
    try
    {
        await cognitoClient().send( new AdminCreateUserCommand( {
            UserPoolId:        poolId,
            Username:          username,
            UserAttributes:    toAttrList( attributes ),
            TemporaryPassword: tempPassword && tempPassword !== "" ? tempPassword : undefined,
            MessageAction:     "SUPPRESS",
        } ) );
        return { ok: true };
    }
    catch ( err )
    {
        return { ok: false, error: awsErr( err ) };
    }
}

///////////////////////////////////////////////////////////////////////////////////////////////////
/** Update a user's attributes. */
export async function cognitoUpdateUser( poolId : string, username : string, attributes : Record<string, string> ) : Promise<CognitoResult>
{
    if ( isReadOnly() ) return readOnly();
    try
    {
        await cognitoClient().send( new AdminUpdateUserAttributesCommand( { UserPoolId: poolId, Username: username, UserAttributes: toAttrList( attributes ) } ) );
        return { ok: true };
    }
    catch ( err )
    {
        return { ok: false, error: awsErr( err ) };
    }
}

///////////////////////////////////////////////////////////////////////////////////////////////////
/** Enable / disable a user's access. */
export async function cognitoSetEnabled( poolId : string, username : string, enabled : boolean ) : Promise<CognitoResult>
{
    if ( isReadOnly() ) return readOnly();
    try
    {
        await cognitoClient().send( enabled
            ? new AdminEnableUserCommand( { UserPoolId: poolId, Username: username } )
            : new AdminDisableUserCommand( { UserPoolId: poolId, Username: username } ) );
        return { ok: true };
    }
    catch ( err )
    {
        return { ok: false, error: awsErr( err ) };
    }
}

///////////////////////////////////////////////////////////////////////////////////////////////////
/** Delete a user. */
export async function cognitoDeleteUser( poolId : string, username : string ) : Promise<CognitoResult>
{
    if ( isReadOnly() ) return readOnly();
    try
    {
        await cognitoClient().send( new AdminDeleteUserCommand( { UserPoolId: poolId, Username: username } ) );
        return { ok: true };
    }
    catch ( err )
    {
        return { ok: false, error: awsErr( err ) };
    }
}

///////////////////////////////////////////////////////////////////////////////////////////////////
/** Set a user's password. `permanent` true = active password; false = force change on next sign-in. */
export async function cognitoSetPassword( poolId : string, username : string, password : string, permanent : boolean ) : Promise<CognitoResult>
{
    if ( isReadOnly() ) return readOnly();
    try
    {
        await cognitoClient().send( new AdminSetUserPasswordCommand( { UserPoolId: poolId, Username: username, Password: password, Permanent: permanent } ) );
        return { ok: true };
    }
    catch ( err )
    {
        return { ok: false, error: awsErr( err ) };
    }
}


// ── helpers ───────────────────────────────────────────────────────────────────────────────────
function mapUser( u : UserType ) : CognitoUser
{
    return {
        username:   u.Username ?? "",
        status:     u.UserStatus,
        enabled:    u.Enabled ?? true,
        attributes: attrsToRecord( u.Attributes ),
        createdAt:  u.UserCreateDate?.toISOString(),
        modifiedAt: u.UserLastModifiedDate?.toISOString(),
    };
}

function attrsToRecord( list? : AttributeType[] ) : Record<string, string>
{
    const out : Record<string, string> = {};
    ( list ?? [] ).forEach( ( a : AttributeType ) => { if ( a.Name ) out[ a.Name ] = a.Value ?? ""; } );
    return out;
}

function toAttrList( o : Record<string, string> ) : AttributeType[]
{
    return Object.entries( o ).map( ( [ Name, Value ] ) => ( { Name, Value: String( Value ) } ) );
}

function readOnly() : CognitoResult
{
    return { ok: false, error: "Read-only on a real AWS account — switch the target to LocalStack to edit." };
}

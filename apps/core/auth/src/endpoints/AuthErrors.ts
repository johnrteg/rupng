//
import { NetworkUtils } from '@repo/common';

/** A mapped auth failure — the HTTP status to return + a safe, caller-visible message. */
export interface AuthFailure
{
    status  : NetworkUtils.Status;
    message : string;
}

////////////////////////////////////////////////////////////////////////////////////////////////////////////
//
// Map a Cognito/SDK error to an HTTP status + safe message for the auth endpoints. Keeps credential
// surfaces enumeration-neutral (don't distinguish "no user" from "wrong password").
//
export function authError( error : unknown ) : AuthFailure
{
    const name : string = ( error as { name? : string } )?.name ?? "";

    if( /NotAuthorized|UserNotFound|NotConfirmed/.test( name ) )
        return { status: NetworkUtils.Status.UNAUTHORIZED, message: "Email or password is incorrect" };

    if( /UsernameExists|AliasExists/.test( name ) )
        return { status: NetworkUtils.Status.CONFLICT, message: "Already exists" };

    if( /CodeMismatch|ExpiredCode|CodeDelivery/.test( name ) )
        return { status: NetworkUtils.Status.UNAUTHORIZED, message: "Invalid or expired code" };

    if( /InvalidPassword|InvalidParameter|LimitExceeded|TooManyRequests/.test( name ) )
        return { status: NetworkUtils.Status.BAD_REQUEST, message: ( error as { message? : string } )?.message ?? "Invalid request" };

    return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, message: "server error" };
}

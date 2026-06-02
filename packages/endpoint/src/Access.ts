

export namespace Access
{
    export enum Role
    {
        USER = "user",          // lowest level, normal authenticated user
        ACCOUNT = "account",    // account admin.
        BILLING = "billing",    // billing activties that a typical account admin cannot
        SUPPORT = "support",    // application support
        ADMIN = "admin",        // application admin across accounts
        ROOT = "root"           // most access, app configuration
    }

    //
    // add new roles relative to their access roles in this array
    //
    export const ROLES : Array<Role> = [Role.USER,Role.ACCOUNT,Role.BILLING,Role.SUPPORT,Role.ADMIN,Role.ROOT];

    ////////////////////////////////////////////////////////////////////////////////////////////
    export function Allowed( role : Access.Role, min : Access.Role ) : boolean
    {
        return ROLES.indexOf( role ) >= ROLES.indexOf( min );
    }
}

export default Access;
//
// Access — the platform's role model and the endpoint access check.
//
// Two INDEPENDENT role ladders (Hierarchical RBAC / NIST RBAC1):
//   * AccountRole — a caller's role WITHIN a specific account
//   * AppRole     — a global staff/application identity, ACROSS accounts
//
// The two scopes are distinct CONCEPTS (where a role is granted / what it identifies),
// but seniority is a SINGLE combined order: the account ladder, then the application
// ladder. Comparison is uniform across both — a senior application role satisfies any
// junior account minimum, because a user who is (say) root can downgrade to user within
// a session and must still pass the lower endpoints. An endpoint declares one minimum
// role; the authorizer checks the caller's highest granted role against it.
//
// NOT here: cross-account / resource-scoped access ("a user from account A may send on
// account B's campaign #123", or "support may enter my account"). That is a SEPARATE
// authorization primitive — delegation GRANTS — owned by auth, layered on these ladders
// (capped at the issuer's own rank, windowed, revocable). Do NOT model it as a role.
// See apps/core/auth/SPECS.md → Cross-account delegation grants.
//

export namespace Access
{
    /** Which ladder a role belongs to. */
    export enum RoleScope
    {
        ACCOUNT     = "account",        // role within a specific account (per-account grant)
        APPLICATION = "application",    // global staff identity, across accounts
    }

    /**
     * Per-account ladder, ascending seniority. A senior role inherits all junior grants.
     * Order IS the relative access — inserting/reordering changes every endpoint's
     * effective minimum, so this is a governed, version-controlled decision.
     */
    export enum AccountRole
    {
        MINIMUM  = "minimum",   // always the first one as a general place holder for the lowest access role
        SENDER  = "sender",     // below user — may only send/queue messages, nothing else
        USER    = "user",       // normal authenticated user
        BILLING = "billing",    // billing activities a typical user cannot perform
        ACCOUNT = "account",    // account admin (senior)
    }

    /** Global staff/application ladder, ascending seniority (across accounts). */
    export enum AppRole
    {
        SUPPORT     = "support",        // application support
        APPLICATION = "application",    // application admin across accounts
        ROOT        = "root",           // most access, app configuration (senior)
    }

    /** Any role from either ladder — e.g. an endpoint's declared minimum. */
    export type Role = AccountRole | AppRole;

    //
    // Per-scope ladder ORDER (ascending). Add a new role by inserting it at the correct
    // position in the appropriate ladder; the combined LADDER below derives from these.
    //
    // ⚠️ ORDER IS THE CONTRACT — blast-radius sensitive. Permission is derived from a role's
    //    POSITION here (rank), not an absolute value, so EVERY endpoint's `minAccess` — plus the
    //    auth role-keyed idle timeout and grant ceilings — depends on this order. Reordering or
    //    inserting a role SILENTLY shifts every endpoint's effective minimum (an access leak or a
    //    break) with no change to any endpoint's own declaration.
    //    This ladder is still PROVISIONAL: as the app is built out, stakeholders will refine the
    //    number, type, and order of roles. Until it's frozen, treat ANY change as a deliberate,
    //    reviewed migration — and guard it in CI (snapshot each endpoint's effective min-role,
    //    fail on any diff without sign-off). See packages/endpoint/SPECS.md → "Role ladder ordering".
    //
    export const ACCOUNT_LADDER : ReadonlyArray<AccountRole> = [ AccountRole.MINIMUM, AccountRole.SENDER, AccountRole.USER, AccountRole.BILLING, AccountRole.ACCOUNT ];
    export const APP_LADDER     : ReadonlyArray<AppRole>     = [ AppRole.SUPPORT, AppRole.APPLICATION, AppRole.ROOT ];

    /**
     * The single combined seniority order — account ladder then application ladder.
     * Comparison is uniform across BOTH scopes: index = absolute seniority, so a senior
     * application role outranks (and therefore satisfies) any junior account minimum.
     */
    export const LADDER : ReadonlyArray<Role> = [ ...ACCOUNT_LADDER, ...APP_LADDER ];

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Which ladder a role lives on (the role's scope/bucket). */
    export function scopeOf( role : Role ) : RoleScope
    {
        return ( ACCOUNT_LADDER as ReadonlyArray<Role> ).includes( role ) ? RoleScope.ACCOUNT : RoleScope.APPLICATION;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Absolute seniority rank in the combined ladder (-1 if unknown). */
    export function rank( role : Role ) : number
    {
        return LADDER.indexOf( role );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /**
     * Does `role` satisfy the `min` requirement? Uniform across both scopes — a higher
     * combined rank always passes, so e.g. an application `root` meets an account `user`
     * minimum (a senior user may downgrade to any lower role within a session).
     */
    export function isAllowed( role : Role, min : Role ) : boolean
    {
        return rank( role ) >= rank( min );
    }
}

export default Access;

//
// AuthAction — a pending, no-auth USER ACTION triggered by an email (email verification, password reset, MFA
// code, account invite, unsubscribe, …). Each is a single DynamoDB row with a DynamoDB TTL (`expiresAt`) so it
// auto-expires after its action-specific window ("X minutes to perform"). The landing pages (no-auth) parse the
// opaque `actionId` token from the URL PATH and verify/consume it against this store. The Console lists + cancels
// pending actions app-wide. Links in email are stored as PATHS only — the protocol + host are resolved at SEND
// time (request Origin → white-label domain → per-env config) so local dev, prod, and white-label all work.
//
export namespace AuthAction
{
    /** The kind of action a landing page performs. A closed set → enum. */
    export enum Type
    {
        EMAIL_VERIFICATION = "email-verification",
        PASSWORD_RESET     = "password-reset",
        MFA_CODE           = "mfa-code",
        ACCOUNT_INVITE     = "account-invite",
        UNSUBSCRIBE        = "unsubscribe",
    }

    /** Lifecycle: PENDING (issued, unused) → CONSUMED (acted upon) | CANCELLED (revoked) | EXPIRED (TTL lapsed). */
    export enum Status { PENDING = "pending", CONSUMED = "consumed", CANCELLED = "cancelled", EXPIRED = "expired" }

    /** One pending action (DynamoDB `auth_actions`: PK actionId, TTL expiresAt, GSI byTarget). `actionId` doubles
     *  as the opaque URL token. `params` carries action-specific data (e.g. an invite role, a pending new email). */
    export interface Entity
    {
        actionId    : string;
        type        : Type;
        status      : Status;
        target      : string;                    // the recipient the action was sent to (email)
        accountId?  : string;
        userId?     : string;
        createdAt   : string;                    // ISO
        expiresAt   : number;                    // epoch SECONDS — the DynamoDB TTL attribute
        consumedAt? : string;
        cancelledAt? : string;
        requestedBy? : string;                   // the actor/user who triggered it (audit)
        params?     : Record<string, string>;    // action-specific attributes
    }

    /** The default lifetime (MINUTES) per action type — the window a user has to act. */
    export const DEFAULT_TTL_MINUTES : Record<Type, number> =
    {
        [ Type.EMAIL_VERIFICATION ]: 24 * 60,    // 24 hours
        [ Type.PASSWORD_RESET ]:     30,         // 30 minutes
        [ Type.MFA_CODE ]:           5,          // 5 minutes
        [ Type.ACCOUNT_INVITE ]:     7 * 24 * 60, // 7 days
        [ Type.UNSUBSCRIBE ]:        30 * 24 * 60, // 30 days
    };

    /** The landing-page PATH each action routes to (NO protocol/host — the base is resolved at send time). */
    export const PATHS : Record<Type, string> =
    {
        [ Type.EMAIL_VERIFICATION ]: "/verify",
        [ Type.PASSWORD_RESET ]:     "/reset",
        [ Type.MFA_CODE ]:           "/mfa",
        [ Type.ACCOUNT_INVITE ]:     "/invite",
        [ Type.UNSUBSCRIBE ]:        "/unsubscribe",
    };

    /** The email MERGE-FIELD token each action fills (the send substitutes `<base><path>` into it). */
    export const MERGE_TOKEN : Partial<Record<Type, string>> =
    {
        [ Type.EMAIL_VERIFICATION ]: "verification_url",
        [ Type.PASSWORD_RESET ]:     "reset_url",
        [ Type.ACCOUNT_INVITE ]:     "invite_url",
        [ Type.UNSUBSCRIBE ]:        "unsubscribe_url",
    };

    /** The landing PATH (with token) for an action — appended to the resolved base URL at send time. */
    export function pathFor( type : Type, token : string ) : string { return `${ PATHS[ type ] }/${ token }`; }

    /** Assemble the full URL for an action given a resolved base (origin). `base` has no trailing slash. */
    export function urlFor( base : string, type : Type, token : string ) : string { return `${ base.replace( /\/$/, "" ) }${ pathFor( type, token ) }`; }

    /** The PUBLIC-safe view a landing page receives (never leaks internal ids beyond the token). */
    export interface PublicView { type : Type; status : Status; target? : string; expiresAt : number; }
}

export default AuthAction;
// eof

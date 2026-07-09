//
// Notification — the SHARED per-type catalog that gives auth + email (and any other producer) ONE common
// vocabulary + model for each transactional case (email-4). Keyed by {@link Email.NotificationType}, each `Spec`
// says: whether the case needs a pending TTL ACTION (a landing-page token — verify/reset/mfa/invite), that
// action's window + landing path + the merge token its URL fills, and a BARE-BONES fallback subject/body used by
// the email send worker when NO template is published for the case (so a verification / MFA code always sends
// something). Producers (auth) drop an `Email.SendRequest` with a `notificationType` on the email SQS queue; the
// email consumer renders the published template, else this fallback.
//
import { Email } from "./Email";

export namespace Notification
{
    /** The per-notification-type spec — the shared contract auth + email both read. */
    export interface Spec
    {
        createsAction     : boolean;   // the case issues a pending TTL AuthAction (a no-auth landing token)
        actionTtlMinutes? : number;    // the action's window (minutes) — how long the user has to act
        landingPath?      : string;    // the no-auth landing page PATH (no protocol/host — resolved at send)
        mergeToken?       : string;    // the merge field the action URL / code fills (verification_url, mfa_code, …)
        fallbackSubject   : string;    // bare-bones subject when no template is published
        fallbackText      : string;    // bare-bones text body (merge tags allowed) when no template is published
    }

    /** The catalog. A case absent here has no special handling (a plain template send, no fallback/action). */
    export const SPEC : Partial<Record<Email.NotificationType, Spec>> =
    {
        [ Email.NotificationType.EMAIL_VERIFICATION ]:
        {
            createsAction: true, actionTtlMinutes: 24 * 60, landingPath: "/verify", mergeToken: "verification_url",
            fallbackSubject: "Verify your email address",
            fallbackText: "Please verify your email address by opening this link:\n\n{{verification_url}}\n\nIf you didn't request this, you can ignore this message.",
        },
        [ Email.NotificationType.PASSWORD_RESET ]:
        {
            createsAction: true, actionTtlMinutes: 30, landingPath: "/reset", mergeToken: "reset_url",
            fallbackSubject: "Reset your password",
            fallbackText: "Reset your password using this link (it expires in 30 minutes):\n\n{{reset_url}}\n\nIf you didn't request this, you can ignore this message.",
        },
        [ Email.NotificationType.MFA_CODE ]:
        {
            createsAction: true, actionTtlMinutes: 5, landingPath: "/mfa", mergeToken: "mfa_code",
            fallbackSubject: "Your verification code",
            fallbackText: "Your verification code is {{mfa_code}}. It is valid for 5 minutes.",
        },
        [ Email.NotificationType.ACCOUNT_INVITE ]:
        {
            createsAction: true, actionTtlMinutes: 7 * 24 * 60, landingPath: "/invite", mergeToken: "invite_url",
            fallbackSubject: "You've been invited",
            fallbackText: "You've been invited to {{account.name}}. Accept your invitation here:\n\n{{invite_url}}",
        },
        [ Email.NotificationType.WELCOME ]:
        {
            createsAction: false,
            fallbackSubject: "Welcome",
            fallbackText: "Welcome, {{name.first}}! We're glad you're here.",
        },
        [ Email.NotificationType.SECURITY_ALERT ]:
        {
            createsAction: false,
            fallbackSubject: "Security alert on your account",
            fallbackText: "We detected activity on your account that you should review. If this wasn't you, secure your account right away.",
        },
    };

    /** The spec for a case (or undefined for a case with no special handling). */
    export function specFor( type : Email.NotificationType ) : Spec | undefined { return SPEC[ type ]; }

    /** The bare-bones fallback body for a case when no template is published (or undefined). */
    export function fallbackFor( type : Email.NotificationType ) : { subject : string; text : string } | undefined
    {
        const spec : Spec | undefined = SPEC[ type ];
        return spec ? { subject: spec.fallbackSubject, text: spec.fallbackText } : undefined;
    }
}

export default Notification;
// eof

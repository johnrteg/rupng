//
// Authentication method enums — shared contract vocabulary (client + server). A user may hold several
// AuthMethods (password + Google + a passkey), which is what enables identity linking + "sign in with …".
// MfaMethod is the second-factor set. Moved here from the auth service's internal model so the wire
// contract (User, login endpoints) and the service agree on one definition.
//

/** How a user signs in. Extensible — add a method here without touching call sites. */
export enum AuthMethod
{
    PASSWORD   = "password",    // Cognito-native email/phone + password (+ MFA)
    GOOGLE     = "google",      // social IdP (Cognito-federated)
    MICROSOFT  = "microsoft",
    APPLE      = "apple",
    SAML       = "saml",        // enterprise IdP (per the account's SSO connection)
    OIDC       = "oidc",        // enterprise IdP (OIDC)
    PASSKEY    = "passkey",     // WebAuthn / FIDO2 — phishing-resistant, strategic primary
    EMAIL_OTP  = "email_otp",   // emailed one-time code (low-priv + recovery)
    MAGIC_LINK = "magic_link",  // reserved, deprioritized in favor of EMAIL_OTP
}

/** Multi-factor methods (auth-3). */
export enum MfaMethod
{
    TOTP  = "totp",             // authenticator app
    SMS   = "sms",              // texted code
    EMAIL = "email",            // emailed code
}

/**
 * Contact CHANNEL used to identify + verify a user (registration / sign-in / reset) — i.e. which of the
 * two contact rails `account` is on, and where a verification code is sent. Distinct from `AuthMethod`
 * (the *credential* — password / passkey / social); this is just email vs phone. Closed set — not free text.
 */
export enum ContactMethod
{
    EMAIL = "email",            // account is an email address; code emailed
    PHONE = "phone",            // account is an E.164 phone; code texted (SMS)
}

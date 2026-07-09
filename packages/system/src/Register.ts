//
// Register — the platform's canonical REGISTRY of system-level identifiers (not event-specific).
//
// `Register.Service` is the unique id of every deployable. It's used across the platform: the identity the
// `Service`/`Job` base carries (process/log name), the **`source`** of events on the bus, the resource-name
// prefix (`<env>-<service>-<kind>-<key>`), AND the FIRST segment of every `Events.Action` (`service.noun.verb`).
// It lives here — not under `Events` — because it's a system registry the event vocabulary merely *uses*.
//
export namespace Register
{
    /**
     * Every deployable's unique id. Most are event-emitting services; a few (e.g. `WEBPROXY`) are
     * non-emitting / local-only but still need an id. Keep STABLE — it's the resource-name prefix + event source.
     */
    export enum Service
    {
        APP          = "app",
        WEBPROXY     = "webproxy",      // local-only dev edge proxy — non-emitting, but still a deployable id
        AUTH         = "auth",
        ACCOUNT      = "account",
        CONTACT      = "contact",
        CAMPAIGN     = "campaign",
        TEXTING      = "texting",
        EMAIL        = "email",
        VOICE        = "voice",         // planned channel
        PRINT        = "print",
        SOCIAL       = "social",
        SURVEY       = "survey",
        REGISTRATION = "registration",
        MARKETPLACE  = "marketplace",
        WORKFLOW     = "workflow",
        MEDIA        = "media",
        LINKS        = "links",
        COLLAB       = "collab",
        REPORT       = "report",
        MONITOR      = "monitor",
        AUDIT        = "audit",
        ANALYTICS    = "analytics",
        PLATFORM     = "platform",   // cross-cutting actions any service emits (config / feature-flag)
        FAKE_EMAIL   = "fake-email", // DEV-ONLY simulated ESP (a "fake provider" leaf; non-emitting) — see FakeService
    }
}

export default Register;
// eof

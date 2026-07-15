//
// Providers — the platform's SINGLE source of truth for external service providers that need credentials
// (AI, browse/stock, email, texting, payments, …). One declaration per provider drives ALL THREE consumers,
// so they can't drift:
//   • CDK           — provisions the provider's Secrets Manager secret (platform-shared or service-owned).
//   • Console       — renders the "Providers" config UI (grouped by category, typed fields, status, hints).
//   • Runtime       — services resolve the provider key by its logical `secretKey` (SecretsKeyProvider).
//
// Pure types/data (no AWS, no runtime) — safe to import anywhere (services, cloud-manifest, cloud app, Console).
// A KEYLESS provider (e.g. AWS Bedrock — IAM-authed) is intentionally NOT listed here; this registry is for
// credential-backed providers only.
//
export namespace Providers
{
    /** The kind of provider — drives Console grouping + which service consumes it. */
    export enum Category
    {
        AI       = "ai",         // LLM / image / video / speech providers (platform-shared)
        BROWSE   = "browse",     // stock-media / marketplace search providers (media service)
        EMAIL    = "email",      // transactional email providers (email service)
        TEXTING  = "texting",    // SMS/MMS providers (texting service)
        PAYMENTS = "payments",   // payment processors (billing)
    }

    /** Where a provider's secret lives: `platform` (shared, every service can read) or a specific service's
     *  own secret (`{ service }`). */
    export type Scope = "platform" | { service : string };

    /** One field of a (possibly multi-field) secret. A single-field provider omits `fields` and stores an
     *  opaque string; a multi-field provider (e.g. Twilio SID + token) stores a JSON object of these. */
    export interface Field
    {
        name    : string;      // JSON key when multi-field
        label   : string;      // Console label
        secret? : boolean;     // mask in the Console (default true for the primary key; false for ids)
    }

    /** A credential-backed external provider. */
    export interface Provider
    {
        id        : string;               // provider id (e.g. "openai", "twilio", "pexels")
        label     : string;               // display name
        category  : Category;
        scope     : Scope;
        secretKey : string;               // logical secret key — `<category>-<id>` (e.g. "ai-openai", "texting-twilio")
        fields?   : Array<Field>;         // multi-field secret (JSON); omit → single opaque string
        keyHint?  : string;               // format hint shown in the Console (e.g. "starts with AIza")
        docsUrl?  : string;               // where to get the key
    }

    // ── The catalog ────────────────────────────────────────────────────────────────────────────────
    // secretKey is always `<category>-<id>` so the physical name is `<env>-<owner>-secret-<category>-<id>`
    // (matches today's `ai-openai` / `browse-pexels`). `owner` = "platform" (platform scope) or the service.
    export const CATALOG : Array<Provider> =
    [
        // AI — platform-shared provider keys (Bedrock omitted: IAM-authed, keyless)
        { id: "openai",     label: "OpenAI",        category: Category.AI, scope: "platform", secretKey: "ai-openai",     keyHint: "starts with sk-",   docsUrl: "https://platform.openai.com/api-keys" },
        { id: "anthropic",  label: "Anthropic",     category: Category.AI, scope: "platform", secretKey: "ai-anthropic",  keyHint: "starts with sk-ant-", docsUrl: "https://console.anthropic.com/settings/keys" },
        { id: "gemini",     label: "Google Gemini", category: Category.AI, scope: "platform", secretKey: "ai-gemini",     keyHint: "AI Studio key — starts with AIza (NOT a Vertex OAuth token)", docsUrl: "https://aistudio.google.com/apikey" },
        { id: "elevenlabs", label: "ElevenLabs",    category: Category.AI, scope: "platform", secretKey: "ai-elevenlabs", docsUrl: "https://elevenlabs.io/app/settings/api-keys" },
        { id: "fish",       label: "fish.audio",    category: Category.AI, scope: "platform", secretKey: "ai-fish",       docsUrl: "https://fish.audio/go-api/" },
        { id: "magnific",   label: "Magnific / Freepik", category: Category.AI, scope: "platform", secretKey: "ai-magnific", docsUrl: "https://www.freepik.com/api" },

        // Browse — stock-media search providers (media service)
        { id: "pexels",   label: "Pexels",   category: Category.BROWSE, scope: { service: "media" }, secretKey: "browse-pexels",   docsUrl: "https://www.pexels.com/api/" },
        { id: "unsplash", label: "Unsplash", category: Category.BROWSE, scope: { service: "media" }, secretKey: "browse-unsplash",
          fields: [ { name: "appId", label: "App ID", secret: false }, { name: "accessKey", label: "Access Key" }, { name: "secretKey", label: "Secret Key" } ],
          docsUrl: "https://unsplash.com/oauth/applications" },

        // Email — transactional email providers (email service; SES is IAM-authed, so not a key here)
        { id: "lettr", label: "Lettr", category: Category.EMAIL, scope: { service: "email" }, secretKey: "email-lettr", keyHint: "Lettr API key", docsUrl: "https://lettr.io/" },
        { id: "sendgrid", label: "SendGrid", category: Category.EMAIL, scope: { service: "email" }, secretKey: "email-sendgrid", keyHint: "starts with SG.", docsUrl: "https://app.sendgrid.com/settings/api_keys" },
        { id: "postmark", label: "Postmark", category: Category.EMAIL, scope: { service: "email" }, secretKey: "email-postmark", keyHint: "Server API token", docsUrl: "https://account.postmarkapp.com/" },
        { id: "mailgun", label: "Mailgun", category: Category.EMAIL, scope: { service: "email" }, secretKey: "email-mailgun", keyHint: "Private API key (the sending domain is taken from the From address)", docsUrl: "https://app.mailgun.com/settings/api_security" },
        { id: "sparkpost", label: "SparkPost", category: Category.EMAIL, scope: { service: "email" }, secretKey: "email-sparkpost", docsUrl: "https://app.sparkpost.com/account/api-keys" },
        { id: "brevo", label: "Brevo", category: Category.EMAIL, scope: { service: "email" }, secretKey: "email-brevo", keyHint: "starts with xkeysib-", docsUrl: "https://app.brevo.com/settings/keys/api" },
        { id: "mailchimp", label: "Mailchimp Transactional", category: Category.EMAIL, scope: { service: "email" }, secretKey: "email-mailchimp", keyHint: "Mandrill API key", docsUrl: "https://mailchimp.com/developer/transactional/" },
        { id: "mailjet", label: "Mailjet", category: Category.EMAIL, scope: { service: "email" }, secretKey: "email-mailjet", keyHint: "store as apiKey:secretKey (colon-joined)", docsUrl: "https://app.mailjet.com/account/apikeys" },
        { id: "mailersend", label: "MailerSend", category: Category.EMAIL, scope: { service: "email" }, secretKey: "email-mailersend", keyHint: "starts with mlsn.", docsUrl: "https://app.mailersend.com/api-tokens" },
        { id: "mailtrap", label: "Mailtrap", category: Category.EMAIL, scope: { service: "email" }, secretKey: "email-mailtrap", keyHint: "Sending API token", docsUrl: "https://mailtrap.io/api-tokens" },
        { id: "resend", label: "Resend", category: Category.EMAIL, scope: { service: "email" }, secretKey: "email-resend", keyHint: "starts with re_", docsUrl: "https://resend.com/api-keys" },

        // Texting — SMS/MMS providers (texting service)
        { id: "twilio", label: "Twilio", category: Category.TEXTING, scope: { service: "texting" }, secretKey: "texting-twilio",
          fields: [ { name: "accountSid", label: "Account SID", secret: false }, { name: "authToken", label: "Auth Token" } ],
          keyHint: "Account SID starts with AC", docsUrl: "https://console.twilio.com/" },
        { id: "telnyx", label: "Telnyx", category: Category.TEXTING, scope: { service: "texting" }, secretKey: "texting-telnyx", docsUrl: "https://portal.telnyx.com/" },

        // Payments — payment processors (platform-shared)
        { id: "stripe", label: "Stripe", category: Category.PAYMENTS, scope: "platform", secretKey: "payments-stripe",
          fields: [ { name: "secretKey", label: "Secret Key" }, { name: "webhookSecret", label: "Webhook Signing Secret" } ],
          keyHint: "Secret key starts with sk_live_ / sk_test_", docsUrl: "https://dashboard.stripe.com/apikeys" },
    ];

    /** True when a provider's secret is platform-shared (vs owned by one service). */
    export function isPlatform( provider : Provider ) : boolean { return provider.scope === "platform"; }

    /** The owner segment of a provider's physical secret name — "platform" or the owning service id. */
    export function owner( provider : Provider ) : string { return provider.scope === "platform" ? "platform" : provider.scope.service; }

    /** All platform-scoped providers (their secrets live in the platform stack). */
    export function platform() : Array<Provider> { return CATALOG.filter( isPlatform ); }

    /** The providers a given service OWNS (their secrets live in that service's stack). */
    export function forService( service : string ) : Array<Provider>
    {
        return CATALOG.filter( ( provider : Provider ) : boolean => provider.scope !== "platform" && provider.scope.service === service );
    }

    /** All providers in a category. */
    export function forCategory( category : Category ) : Array<Provider> { return CATALOG.filter( ( provider : Provider ) : boolean => provider.category === category ); }

    /** Look up a provider by id. */
    export function byId( id : string ) : Provider | undefined { return CATALOG.find( ( provider : Provider ) : boolean => provider.id === id ); }
}

export default Providers;

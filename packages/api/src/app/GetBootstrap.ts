//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils, Type } from "@repo/common";
import PasswordPolicy from "./model/PasswordPolicy";
import { Validation } from "../model/Validation";

/*
    client:
    const endpt : GetBootstrap = new GetBootstrap( { } );
    const response : Restful.Response = await appdata.server.fetch( endpt );
*/
export class GetBootstrap extends RestfulEndpoint< {}, undefined, GetBootstrap.Response >
{
    public readonly uri      : string = GetBootstrap.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.GET;
    public readonly access   : Access.Role | undefined = undefined;   // non-authenticated
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;   // edge-reachable, not a published dev API

    constructor()
    {
        super( {} );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public getMappings(): Array<RestfulEndpoint.FieldMap>
    {
        return [];
    }

    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema():  RestfulEndpoint.Schema | null { return null; }   // method stays, returns null
}


export namespace GetBootstrap
{
    export const URI : string = apiPath( "app", 1, "/bootstrap" );   // /api/app/v1/bootstrap

    //export interface Response
    //{
    //    maxUploadSize : { texting : number };
    //}

    export interface Branding { displayName: string; }

    export interface UploadLimits { maxFileBytes: number; allowedMimeTypes: Array<string>; }

    /** **Publishable** keys ONLY — never secrets (app-1.4). */
    export interface PublishableKeys { stripePublishable?: string; recaptchaSiteKey?: string; mapsKey?: string; }

    /**
     * A feature-flag value. A **boolean** is a simple on/off; a **string** is an A/B **variant**
     * label (the cohort assignment — app-2.4: an experiment is a flag variant, no separate service);
     * a **number** supports staged percentages / numeric gates.
     */
    export type FlagValue = boolean | string | number;

    /** Effective flag set after merging platform (AppConfig) ⊕ account (account override wins, app-2.3). */
    export type FeatureFlags = { [flagKey: string]: FlagValue };

    export enum AudienceKind { PLATFORM = "platform", ACCOUNT = "account", WHITELABEL = "whitelabel", ROLE = "role" }

    /**
     * Who sees the notice (app-3.1) — a TYPED union, not a parsed string.
     * `platform` is staff-authored only (app-3.8); `account`/`whitelabel` are auto-scoped when an
     * account admin authors (the bootstrap is keyed by `Host` → account, so login-placement scoping
     * is automatic). `role` targets everyone at/above a role on the `Access` ladder.
     * Example: `{ kind: "whitelabel", subdomain: "acme" }` · `{ kind: "role", role: Access.AccountRole.BILLING }`
     */
    export type NoticeAudience =
        | { kind: AudienceKind.PLATFORM }
        | { kind: AudienceKind.ACCOUNT;    accountId: Type.ID }
        | { kind: AudienceKind.WHITELABEL; subdomain: string }
        | { kind: AudienceKind.ROLE;       role: Access.Role };

    /**
     * Active window (app-3.1) — **UTC instants + an IANA `timeZone`** for authoring/display, per the
     * platform time discipline ("holiday hours Dec 24–26 ET" stored UTC, shown in zone). A notice is
     * "active now" when `paused == false AND now ∈ [start,end] AND audience matches` (app-3.2).
     */
    export interface NoticeWindow { start: Type.ISODateTime; end: Type.ISODateTime; timeZone: string; }

    /** Optional call-to-action — a **tracked-links** URL so offer/webinar clicks attribute (app-3.1). */
    export interface NoticeCta { label: string; url: string; }   // url = links-service tracked URL

    /** What kind of message it is — drives where/how the client surfaces it (app-3.1). */
    export enum NoticeClass
    {
        SYSTEM    = "system",     // maintenance / outage / holiday hours (incl. the version-gate, app-3.5)
        MARKETING = "marketing",
        SUPPORT   = "support",
        OFFER     = "offer",
        WEBINAR   = "webinar",
    }

    /** Urgency — drives client styling (app-3.1). */
    export enum Severity { ERROR = "error", WARNING = "warning", INFO = "info" }

    /**
     * Where the notice renders — the at-login vs in-app selector (app-3.1).
     * `login` rides the PUBLIC bootstrap blob (pre-auth, public-safe); `banner`/`center`
     * come from the AUTHED `/app/notices` endpoint (app-3.3 / 3.4).
     */
    export enum Placement
    {
        LOGIN  = "login",     // pre-auth login screen — embedded in GET /app/bootstrap → Array<notices>
        BANNER = "banner",    // global in-app banner
        CENTER = "center",    // in-app notification list
    }

    /**
     * A notice / announcement (app-3.1). `title`/`body` are **server-sanitized HTML** via the shared
     * `Application.sanitizeHtml` "vanilla" profile (app-8.4) — sanitized on **store *and* render**.
     * `paused` is the admin kill-switch (excluded regardless of window). Authored in the in-app
     * role-gated Tools section (app-3.6).
     *   PK: accountId | "platform"   SK: noticeId
     */
    export interface Notice
    {
        id:          Type.ID;
        class:       NoticeClass;
        severity:    Severity;
        title:       string;          // sanitized HTML (app-8.4)
        body:        string;          // sanitized HTML (app-8.4)
        placement:   Placement;
        window:      NoticeWindow;
        audience:    NoticeAudience;
        paused:      boolean;          // pause WITHOUT deleting (app-3.6)
        dismissible: boolean;          // may the user dismiss it (and is it remembered — app-3.7)
        cta?:        NoticeCta;
        locale?:     string;           // BCP-47 — localized title/body variant (app-3.9)
        created:     Type.Stamp;
        updated:     Type.Stamp;
    }

    export interface Config
    {
        branding:        Branding;
        name:            string;
        passwordPolicy:  PasswordPolicy.Rule;
        uploadLimits:    UploadLimits;
        publishableKeys: PublishableKeys;
        featureFlags:    FeatureFlags;
        //version:         string;             // drives the version-gate (app-3.5)
        //locale:          string;             // resolved BCP-47 (app-3.9)
        notices         : Array<Notice>;      // active LOGIN-placement notices only (public-safe)
        countries       : Array<string>;
        country         : string;           // country code default
        session         : SessionConfig;    // client session UX timing
    }

    /** Client session UX timing (seconds). The authoritative server-side idle policy lives in auth. */
    export interface SessionConfig
    {
        idleTimeout:       number;          // seconds of inactivity before auto sign-out
        heartbeatInterval: number;          // seconds between session heartbeat polls
    }

    export interface Response extends Config
    {

    }

    // ── Schema + validator (shared: service assembles it, web validates the blob) ────────────────
    // The notices array is server-assembled (its audience union is rich) so it's validated loosely here;
    // the editable scalar/config parts are strict. passwordPolicy reuses the PasswordPolicy schema.
    export const SCHEMA : Validation.Schema =
    {
        $schema: "http://json-schema.org/draft-07/schema#",
        type: "object", additionalProperties: false,
        required: [ "branding", "name", "passwordPolicy", "uploadLimits", "publishableKeys", "featureFlags", "notices", "countries", "country", "session" ],
        properties:
        {
            branding:       { type: "object", additionalProperties: false, required: [ "displayName" ], properties: { displayName: { type: "string" } } },
            name:           { type: "string" },
            passwordPolicy: PasswordPolicy.SCHEMA,
            uploadLimits:   {
                type: "object", additionalProperties: false, required: [ "maxFileBytes", "allowedMimeTypes" ],
                properties: { maxFileBytes: { type: "integer", minimum: 1 }, allowedMimeTypes: { type: "array", items: { type: "string" } } },
            },
            publishableKeys: {
                type: "object", additionalProperties: false,
                properties: { stripePublishable: { type: "string" }, recaptchaSiteKey: { type: "string" }, mapsKey: { type: "string" } },
            },
            featureFlags:   { type: "object", additionalProperties: { type: [ "boolean", "string", "number" ] } },
            notices:        { type: "array", items: { type: "object" } },
            countries:      { type: "array", items: { type: "string" } },
            country:        { type: "string" },
            session:        {
                type: "object", additionalProperties: false, required: [ "idleTimeout", "heartbeatInterval" ],
                properties: { idleTimeout: { type: "integer", minimum: 1 }, heartbeatInterval: { type: "integer", minimum: 1 } },
            },
        },
    };

    export const validate : Validation.Validator<Config> = Validation.compile<Config>( SCHEMA );

    /** Initial/empty bootstrap used before the real blob loads (and as a safe client fallback). */
    export const DEFAULT : Response =
    {
        branding        : { displayName: "" },
        name            : "",
        passwordPolicy  : PasswordPolicy.DEFAULT,
        uploadLimits    : { maxFileBytes: 750_000, allowedMimeTypes: ["image/jpg","image/jpeg","image/gif"] },
        publishableKeys : {},
        featureFlags    : {},
        notices         : [],
        countries       : ["US","CA","GB"],
        country         : "US",
        session         : { idleTimeout: 1800, heartbeatInterval: 60 }
    };



    // possible error type
    export enum Error
    {
        BAD_REQUEST = NetworkUtils.Status.BAD_REQUEST,
        INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR,
    }

}

export default GetBootstrap;
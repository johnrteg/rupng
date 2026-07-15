//
// BrowseConfig — the media Browse service's non-secret runtime policy (AppConfig `config/settings`), tunable
// without a redeploy: which providers are enabled, which media kinds each may serve (per-type enablement,
// media-16.3), and global fan-out limits. Provider API KEYS are NOT here — they're root-managed secrets in
// Secrets Manager (media-16.1). Lives in @repo/api (one definition) so the service seeds `DEFAULT` + the
// Console lints against `SCHEMA`.
//
import { Browse } from "./Browse";
import { Media } from "./Media";
import { Validation } from "../../model/Validation";

export namespace BrowseConfig
{
    /** Per-provider policy (root-controlled). `enabledKinds` limits a multi-kind provider to the enabled subset. */
    export interface ProviderPolicy
    {
        enabled      : boolean;
        enabledKinds : Array<Media.Kind>;   // the media kinds the provider may serve (subset of its capabilities)
        priority     : number;              // merge/rank weight in fan-out (higher first)
    }

    /** Global fan-out limits (media-13). */
    export interface Limits
    {
        maxResultsPerProvider : number;   // cap each provider's page
        perProviderTimeoutMs  : number;   // a slow provider is excluded past this
        resultCacheTtlSec     : number;   // normalized-result cache TTL (0 = off)
    }

    export interface Config
    {
        providers : Partial<Record<Browse.Provider, ProviderPolicy>>;   // keyed by Browse.Provider
        limits    : Limits;
    }

    // ── Schema + validator ──────────────────────────────────────────────────────────────────────
    export const SCHEMA : Validation.Schema =
    {
        $schema: "http://json-schema.org/draft-07/schema#",
        type: "object", additionalProperties: false,
        required: [ "providers", "limits" ],
        properties:
        {
            providers: {
                type: "object",
                additionalProperties: {
                    type: "object", additionalProperties: false,
                    required: [ "enabled", "enabledKinds", "priority" ],
                    properties: {
                        enabled:      { type: "boolean" },
                        enabledKinds: { type: "array", items: { type: "string", enum: Object.values( Media.Kind ) } },
                        priority:     { type: "number" },
                    },
                },
            },
            limits: {
                type: "object", additionalProperties: false,
                required: [ "maxResultsPerProvider", "perProviderTimeoutMs", "resultCacheTtlSec" ],
                properties: {
                    maxResultsPerProvider: { type: "number", minimum: 1 },
                    perProviderTimeoutMs:  { type: "number", minimum: 100 },
                    resultCacheTtlSec:     { type: "number", minimum: 0 },
                },
            },
        },
    };

    export const validate : Validation.Validator<Config> = Validation.compile<Config>( SCHEMA );

    // ── Seeded defaults — providers OFF until root enables them + supplies a key (media-16) ────────
    export const DEFAULT : Config =
    {
        // enabled = true, but a provider is still only usable once its API key resolves (env / Secrets), so
        // it stays excluded from listing/search until a key is configured — safe to default on.
        providers: {
            pexels:   { enabled: true, enabledKinds: [ Media.Kind.IMAGE, Media.Kind.VIDEO ], priority: 50 },
            unsplash: { enabled: true, enabledKinds: [ Media.Kind.IMAGE ],                    priority: 40 },
            svgl:     { enabled: true, enabledKinds: [ Media.Kind.IMAGE ],                    priority: 30 },   // keyless (public API)
            iconify:  { enabled: true, enabledKinds: [ Media.Kind.IMAGE ],                    priority: 20 },   // keyless (public API)
        },
        limits: { maxResultsPerProvider: 30, perProviderTimeoutMs: 8000, resultCacheTtlSec: 300 },
    };
}

export default BrowseConfig;

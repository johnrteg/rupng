//
// SearchConfig — the search service's runtime configuration (its AppConfig `config/settings` profile):
// non-secret operational policy tunable WITHOUT a redeploy. Which doc types are indexed, their per-field
// relevance weights, and the query-audit posture (search-4.2/5.3/7.1). Mirrors VoiceConfig's shape
// (packages/api/src/voice/model/VoiceConfig.ts).
//
import { Search } from "./Search";
import { Validation } from "../../model/Validation";
import { LogLevel } from "../../model/LogLevel";

export namespace SearchConfig
{
    /** Per-type relevance tuning (search-2.4) — field weights (title weighted higher than body by default). */
    export interface TypeWeights { title : number; text : number; }

    /** How much of a query is captured in the audit trail (search-5.3) — `METADATA` never stores the raw
     *  query text, only who/when/type/result-count; `FULL` additionally stores the query string. */
    export enum AuditScope { METADATA = "metadata", FULL = "full" }

    /** Query-audit posture (search-5.3/5.3.1) — runtime-configurable, default on/metadata-only/short TTL. */
    export interface AuditConfig { enabled : boolean; scope : AuditScope; ttlSeconds : number; }

    export interface Config
    {
        indexedTypes: Array<Search.DocType>;
        weights:      Record<Search.DocType, TypeWeights>;
        cacheTtlSeconds: number;   // Redis result-cache TTL (search-2.2)
        audit:        AuditConfig;
        logLevel?:    LogLevel;
    }

    // ── Schema + validator (shared: service / web / Console) ────────────────────────────────────
    export const SCHEMA : Validation.Schema =
    {
        $schema: "http://json-schema.org/draft-07/schema#",
        type: "object", additionalProperties: false,
        required: [ "indexedTypes", "weights", "cacheTtlSeconds", "audit" ],
        properties:
        {
            indexedTypes: { type: "array", items: { type: "string", enum: Object.values( Search.DocType ) } },
            weights:      { type: "object", additionalProperties: {
                            type: "object", additionalProperties: false, required: [ "title", "text" ],
                            properties: { title: { type: "number", minimum: 0 }, text: { type: "number", minimum: 0 } } } },
            cacheTtlSeconds: { type: "number", minimum: 0 },
            audit:        { type: "object", additionalProperties: false, required: [ "enabled", "scope", "ttlSeconds" ],
                            properties: {
                                enabled:    { type: "boolean" },
                                scope:      { type: "string", enum: Object.values( AuditScope ) },
                                ttlSeconds: { type: "number", minimum: 0 },
                            } },
            // minimum log verbosity — optional so older configs tolerate drift (withDefaults fills it)
            logLevel: { type: "string", enum: Object.values( LogLevel ) },
        },
    };

    /** JSON Schema validator for `Config`. */
    export const validate : Validation.Validator<Config> = Validation.compile<Config>( SCHEMA );

    // ── Seeded defaults (the DEFAULT the service seeds + falls back to) ──────────────────────────
    export const DEFAULT : Config =
    {
        indexedTypes: Object.values( Search.DocType ),
        weights:
        {
            [ Search.DocType.CAMPAIGN ]: { title: 3, text: 1 },
            [ Search.DocType.CONTACT ]:  { title: 2, text: 1 },
            [ Search.DocType.SEGMENT ]:  { title: 3, text: 1 },
            [ Search.DocType.EMAIL ]:    { title: 2, text: 1 },
        },
        cacheTtlSeconds: 30,
        audit: { enabled: true, scope: AuditScope.METADATA, ttlSeconds: 60 * 60 * 24 * 30 },   // 30 days
        logLevel: LogLevel.INFO,
    };
}

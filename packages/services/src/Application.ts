//
import * as os from 'os';

import * as fs from 'fs';

import * as path from 'path';

import { randomUUID, UUID } from 'crypto';

import { Trace }    from './Trace';

import { CloudResolver, Environment } from '@repo/cloud-manifest';
import type { Register } from '@repo/system';   // the canonical service id this Application carries
import { AppConfig }   from './aws/AppConfig';
import { Kms }         from './aws/Kms';


export class Application
{
    protected   id      : UUID;
    public      log       : Trace;
    protected   nbr_cpus  : number;
    // The canonical service id (`Register.Service.*`) — the event `source`, resource-name prefix, and
    // base of the process/log name. `serviceName` is the full instance name: `service` or `service:role`.
    protected   readonly service     : Register.Service;
    protected   readonly serviceName : string;

    // Lazily-created cloud access. The base carries only what's common to EVERY Service and
    // Job (the resolver + config + keys); concrete services wire the facades they need.
    private _cloud?     : CloudResolver;
    private _appConfig? : AppConfig;
    private _kms?       : Kms;

    ////////////////////////////////////////////////////////////////////////
    /**
     * @param service   the canonical service id (`Register.Service.*`) — every deployable has one.
     * @param qualifier optional role / job-name distinguishing instances of one service
     *                  (e.g. `main`/`public` for app, `ticket` for a job) → name = `service:qualifier`.
     */
    constructor( service : Register.Service, qualifier ? : string )
    {
        this.service     = service;
        this.serviceName = qualifier ? [ service, qualifier ].join( Application.ID_DIVIDER ) : service;
        this.id          = randomUUID();
        this.log         = new Trace( this.serviceName, this.id );
        this.nbr_cpus    = os.cpus().length;

        this.bindCallbacks();
    }

    // TODO(monitor): transaction-id (request) correlation — a cross-cutting capability the
    // monitor service depends on (see apps/core/monitor/SPECS.md "Tracing & correlation").
    // Today `this.id` / `Trace.id` is ONE process-level UUID; there is no per-request id.
    // Add to this base so every service threads it automatically (no per-service code):
    //   1. Inbound (Service): read `x-transactionid` from the request (API Gateway injects it via
    //      integration mapping); FALL BACK to a generated id when absent.
    //   2. Inbound (Job): read the transaction id off the SQS message attribute / event detail.
    //   3. Per-request logger: spawn a child Trace carrying that id so every log line correlates
    //      (the current single app-scoped Trace can't distinguish concurrent requests).
    //   4. Outbound: propagate the id on every downstream call — HTTP header, SQS message
    //      attribute, EventBridge detail — so the chain stays linked across services.
    // The job-run ledger (monitor) and X-Ray (`X-Amzn-Trace-Id`) both key off this id.

    // TODO(compliance): shared SEND-COMPLIANCE gate — `canSend(...)` on this base so every Service AND Job
    // runs the SAME pre-send checks (no caller can forget one), like the RBAC Access check + entitlements gate.
    // INVOKED BY THE CHANNEL (its send worker) — dispatch governs only fairness/rate, the channel owns send
    // eligibility. See packages/services/README.md "Shared send-compliance gate",
    // apps/core/contact/SPECS.md "Consent & suppression" (contact-5), apps/core/campaign/SPECS.md, and
    // packages/services/DISPATCH.md gap #12 (enforcement point = the channel).
    //   canSend({ accountId, contactId, channel, content, at }) -> { allowed, reasons[] }
    //   composes (aggregates, does not duplicate): per-contact PER-CHANNEL consent/suppression (contact svc) +
    //   account block-list (account) + global frequency cap/fatigue + quiet-hours + SHAFT/content screening.
    //   PER-CHANNEL CONSENT RULE (mirror of contact-5.3 / 5.7): effective state = the consent record with the
    //   LATEST `at` for that channel — an opt-in dated AFTER an opt-out re-enables sending (re-subscribe).
    //   HARD-BLOCK EXCEPTION: a complaint / hard-bounce suppression (SuppressionRecord) is NOT cleared by a
    //   later opt-in timestamp; treat it as send=false regardless. (Block if: not opted_in by latest `at`,
    //   OR a hard-block suppression exists, OR on the account block-list, OR outside quiet-hours, OR over cap.)
    //   MECHANISM TBD: frequency counters likely Redis (atomic, fleet-wide — same as WorkQueue rate-limiter);
    //   quiet-hours/holiday rule source; base-method-backed-by-library vs a dedicated `compliance` service.

    // TODO(sanitize): shared OUTBOUND-HTML sanitizer — `sanitizeHtml(...)` on this base so every Service AND Job
    // that emits or stores HTML runs the SAME allowlist (no caller rolls its own; no XSS / JS slips through).
    // INVOKED BY ANY producer of HTML — email bodies/templates, collab rich-text docs, notices, Zendesk articles,
    // survey forms. Sanitize on STORE *and* OUTPUT (never trust that upstream pre-sanitized). See
    // packages/services/README.md "Shared HTML sanitizer", apps/core/app/SPECS.md (app-8.4 = the reference
    // allowlist), apps/core/email/SPECS.md, apps/core/collab/SPECS.md, apps/core/survey/SPECS.md, and
    // apps/core/web/SPECS.md (web-6.7 = the client-side render-time backstop — defense in depth).
    //   sanitizeHtml(html, profile?) -> string   (allowlist; profiles: "vanilla" default · "email" · "richtext")
    //   ALWAYS STRIPS: <script>, inline <style>/CSS, <iframe>/<object>/<embed>, and ALL `on*` event handlers.
    //   CONSTRAINS URLs: a[href] / img[src] = `https:` only (no `javascript:`/`data:`/`vbscript:`); img = our
    //   media/CDN; links routed via the tracked-[links] service. Profiles widen the TAG allowlist (email >
    //   richtext > vanilla) but NEVER re-enable script/style/`on*`/bad URLs. Backed by a VETTED library
    //   (DOMPurify / sanitize-html), not hand-rolled. Server-side; web sanitizes AGAIN at render (web-6.7).

    // TODO(reputation): shared IP REPUTATION / GEO lookup — `reputation(ip)` on this base so every Service AND
    // Job gets the same signals with no per-service wiring. The DATA + storage live in AUTH (it owns the
    // provider factory, the per-user login-context baseline, and the IP allow/deny rules); this base method is
    // a thin CLIENT that calls auth's generalized internal API. See packages/services/README.md "Shared
    // reputation / geo lookup" + apps/core/auth/specs/SPECS.md + RISK.md (risk-based challenges).
    //   reputation(ip) -> { country, asn, isTor, isVpn, isHosting, score }   (calls GET /auth/internal/reputation)
    //   auth's risk engine owns the RiskPolicy (what to DO with the signals); callers just read them.

    // TODO(audit): shared ACTION-LEVEL audit EMITTER — `audit(event)` on this base so every Service AND Job
    // records "who did what, to what, when, from where, and whether it succeeded" the SAME way. EMIT, DON'T STORE:
    // this method only ENQUEUES the event to SQS (the audit queue); the AUDIT service is the sole writer of the
    // immutable (WORM) trail. See packages/services/README.md "Shared audit emitter" + apps/core/audit/SPECS.md.
    //   audit({ actor, action, target:{type,id}, outcome, source?, context? }) -> void   (enqueues to audit SQS)
    //   PII-LIGHT BY CONTRACT: `target` is an ID not a value; `context` is ids + enums — NEVER field values or
    //   message content. This is why the trail survives a GDPR forget without redaction (audit-1.1 / 3.x).
    //   NOT change-history: audit records THAT a change happened; the field-level {before,after} diff lives in the
    //   owning service co-located (see changeHistory below + apps/core/contact/SPECS.md contact-13). Emit on:
    //   login/access, role/permission change, export, config change, consent change, integration connect, money,
    //   staff.impersonate, data.access. Reads of the audit trail are themselves audited (audit-5.2).

    // TODO(changeHistory): shared FIELD-LEVEL change-history WRITER — `changeHistory.record(...)` so every primary
    // object across services gets the SAME versioned, revertable diff trail with no per-service reinvention. Owned
    // DATA stays CO-LOCATED with each service (PII-dense; purges on GDPR forget); this is the shared MECHANISM,
    // typically invoked from each service's DDB-Streams CDC Job (it sees OldImage/NewImage). See
    // packages/services/README.md "Shared change-history" + apps/core/contact/SPECS.md (contact-13, contact-14.5).
    //   changeHistory.record({ entity:{type,id}, version, actor, source, before, after }) -> diff[]   (append-only)
    //   computes per-field { field, before, after }; supports compare(v1,v2) + revert(field[]) as a NEW guarded
    //   (version/etag) change. CONTRAST audit(): change-history HOLDS PII + purges on forget; audit() is PII-light
    //   + immutable. One per-service `change_history` table (PK accountId#entityId, SK version), NOT centralized.
    //   CHEAPEST PROVIDER: free MaxMind GeoLite2 (geo+ASN) + Tor exit-list + ASN datacenter heuristic ($0/call,
    //   local DB); paid VPN/fraud feed (MaxMind Anonymous-IP / IPQS / Spur) addable by config (provider factory).
    //   LOCAL DB FRESHNESS: keep the GeoLite2/GeoIP2 .mmdb current via MaxMind `geoipupdate`
    //   (github.com/maxmind/geoipupdate) on a schedule → S3; provider hot-reloads it (license key in Secrets
    //   Manager). A stale .mmdb silently degrades geo-fencing + residency — never hand-bundle a one-off DB.

    //
    // cloud access (lazy) — pass cloud-manifest LOGICAL keys; facades resolve physical ids
    // from the env vars the /cloud build injected. Drop to `<facade>.client` for raw SDK.
    //
    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////
    /** Runtime resolver: cloud-manifest logical resource keys -> physical ids. */
    protected get cloud() : CloudResolver
    {
        return this._cloud ??= new CloudResolver( ( process.env.ENVIRONMENT as Environment ) ?? Environment.DEV, this.serviceName );
    }

    /** AppConfig facade — runtime config + feature flags. Common to all services + jobs. */
    protected get appConfig() : AppConfig { return this._appConfig ??= new AppConfig( this.cloud ); }

    /** KMS facade — encrypt/decrypt + envelope data keys. Common to all services + jobs. */
    protected get kms() : Kms { return this._kms ??= new Kms( this.cloud ); }

    //
    // Everything else (S3, SQS, SNS, Secrets, EventBridge, Kafka, Dynamo, …) is wired by the
    // concrete Service/Job that needs it, e.g.:
    //
    //   import { S3 } from "@repo/services";
    //   class MediaService extends Service {
    //       private _s3? : S3;
    //       protected get s3() : S3 { return this._s3 ??= new S3( this.cloud ); }
    //   }
    //
    // A facade that proves common to most services can migrate up here (or to Service/Job).
    //

    //
    // cloud services
    //
    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////
    protected async getSecret( key : string ) : Promise<string | undefined>
    {
        return undefined;
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////
    protected async getConfig() : Promise<Application.Config>
    {
        return {};
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////
    protected async setConfig( config : Application.Config ) : Promise<boolean>
    {
        return false;
    }

    // add:
    // config notification of change
    //

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////
    // Overridable hook for binding instance callbacks. The LONG-RUNNING base (`Daemon`) binds the signal handlers
    // + graceful-drain here — shared by its two kinds, `Service` (request-driven, HTTP) and `Consumer`
    // (self-driven, consumes the Kafka/SQS/stream backbone). The `Application` base does NOTHING so the ONE-SHOT
    // `Job`/Lambda context never installs process-level handlers. (Class hierarchy: Application → Daemon →
    // {Service, Consumer}; Job is the one-shot sibling. See packages/services/README.md "Class hierarchy".)
    protected bindCallbacks() : void
    {
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////
    // allow inherited servies to perform clean up on exit
    // like cleaning up database connections
    protected async aboutToQuit() : Promise<void>
    {
    }

    ///////////////////////////////////////////////////////////////////////////////////
    public readJsonFile<T = any>( path : string, default_value: T ) : T
    {
        try
        {
            if( fs.existsSync( path ) )
                return JSON.parse( fs.readFileSync( path, "utf8") );

            this.log.error( "readJsonFile path not found", { path: path, cwd: process.cwd() } );
        }
        catch( err : any )
        {
            // file exists but contained malformed JSON (or could not be read) - fall back
            this.log.error( "readJsonFile parse failed", { path: path, err: err } );
        }

        return default_value;
    }

    ///////////////////////////////////////////////////////////////////////////////////
    // Loads the nearest package.json by walking up from the caller's directory. Subclasses
    // pass their own __dirname so resolution is relative to the concrete app's compiled
    // location (not this base file), and works whether called from bin/ or a nested folder:
    //
    //   this.pkg = this.loadPackageInfo( __dirname );
    //
    public loadPackageInfo( fromDir : string ) : Application.PackageInfo
    {
        const fallback : Application.PackageInfo = { name: 'unknown', version: '0.0.0' };

        let dir : string = fromDir;
        while( true )
        {
            const candidate : string = path.join( dir, 'package.json' );
            if( fs.existsSync( candidate ) )
                return this.readJsonFile<Application.PackageInfo>( candidate, fallback );

            const parent : string = path.dirname( dir );
            if( parent === dir ) break;     // reached the filesystem root
            dir = parent;
        }

        this.log.error( "loadPackageInfo: no package.json found", { fromDir: fromDir } );
        return fallback;
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////
    protected async config() : Promise<void>
    {
        await this.getConfig();
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////
    // initialize database connection or other states before everything else starts
    protected async init() : Promise<void>
    {
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////////////////
    protected async start() : Promise<void>
    {
    }

    /////////////////////////////////////////////////////////////////////////////////////////////
    public async run() : Promise<void>
    {
        try
        {
            this.log.info("RUN");
            await this.config();
            await this.init();
            await this.start();
        }
        catch( err : any )
        {
            // log a single consistent diagnostic, then re-throw so the caller decides recovery
            // (Job propagates to AWS; Service fails fast and exits). The base never swallows or
            // exits here, so it stays free of any process-lifecycle assumptions.
            this.log.error("run: bootstrap failed", err );
            throw err;
        }
    }

}

export namespace Application
{
    export const ID_DIVIDER : string = ':';

    // extended by inherited services
    export interface Config
    {
    }

    // a subset of package.json fields; the index signature keeps any other fields accessible
    export interface PackageInfo
    {
        name    : string;
        version : string;
        [key: string]: any;
    }
}

export default Application;
// eof
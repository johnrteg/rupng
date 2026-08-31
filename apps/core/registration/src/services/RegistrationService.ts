//
import { createHmac, timingSafeEqual } from "node:crypto";

import { Application, Service, Register, Dynamo, Sqs, Kafka, Secrets, Webhook } from "@repo/services";
import { Ports } from "@repo/cloud-manifest";
import { RegistrationConfig } from "@repo/api";
import type { Type } from "@repo/common";

import { RegistrationDomain } from "../domain/RegistrationDomain";

//
// RegistrationService — the registration domain's Service BASE (not deployed alone, registration-12.1). It
// holds the shared wiring both HTTP roles need: the Dynamo/SQS/Kafka/Secrets facades, the `Webhook` helper
// factory for the two provider streams, the AppConfig seed, and ONE {@link RegistrationDomain} built from
// those facades.
//
// Everything that is actually registration LOGIC — the state machine, the projection repo, the TCR/CV
// clients, the carrier factory, the status publish, the cost-estimate ledger — lives on `RegistrationDomain`
// rather than here, because the four Lambdas need exactly the same logic and cannot extend a `Service`. This
// class is therefore thin on purpose: it is the HTTP-side host for the domain, not a second copy of it.
// Endpoint impls reach the logic through {@link RegistrationService.domain}.
//
export class RegistrationService extends Service
{
    private _dynamo?  : Dynamo;
    private _sqs?     : Sqs;
    private _kafka?   : Kafka;
    private _secrets? : Secrets;
    private _domain?  : RegistrationDomain;

    ////////////////////////////////////////////////////////////////////////////////////////////
    constructor( role : RegistrationService.Role )
    {
        // super( serviceId, role, defaultLocalPort ) — env PORT overrides the default when set.
        super( Register.Service.REGISTRATION, role, RegistrationService.PORT[ role ] );

        // stamp the running version from package.json (walks up from bin/services at runtime)
        const pkg : Application.PackageInfo = this.loadPackageInfo( __dirname );
        this.setVersion( pkg.version );
        this.log.info( "version", { name: pkg.name, version: pkg.version } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** DynamoDB facade — the registration PROJECTION (TCR remains the source of truth). Lazy + cached. */
    public get dynamo() : Dynamo { return this._dynamo ??= new Dynamo( this.cloud ); }
    /** SQS facade — the webhook intake + submit + vetting work queues. Lazy + cached. */
    public get sqs() : Sqs { return this._sqs ??= new Sqs( this.cloud ); }
    /** Kafka facade — the published brand/campaign/number status + trust-score → MPS. Lazy + cached. */
    public get kafka() : Kafka { return this._kafka ??= new Kafka( this.cloud ); }
    /** Secrets facade — the TCR CSP, Campaign Verify, and per-carrier credentials. Lazy + cached. */
    public get secrets() : Secrets { return this._secrets ??= new Secrets( this.cloud ); }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** The shared domain object (registration-12.1). Built once from THIS role's own facades; the Job side
     *  builds its own from its own. Endpoint impls — which aren't `Service` subclasses and can't reach the
     *  protected `appConfig` — go through this accessor for every domain call. */
    public get domain() : RegistrationDomain
    {
        return this._domain ??= new RegistrationDomain( {
            dynamo: this.dynamo, sqs: this.sqs, kafka: this.kafka, secrets: this.secrets,
            appConfig: this.appConfig, log: this.log,
        } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /**
     * The `Webhook` helper (`packages/services/src/Webhook.ts`) configured for ONE provider stream's
     * signature scheme (registration-9.2). Built fresh per call rather than cached — the stream varies per
     * inbound request and the helper is cheap. `this.cloud` is `protected`, so the webhook endpoint impls
     * reach the queue plumbing through this method rather than touching the resolver directly.
     *
     * FAIL-CLOSED: the verifier resolves the stream's shared signing secret from the SAME credential the
     * client uses; if it can't be resolved the request is rejected, never waved through.
     */
    public webhookFor( stream : RegistrationDomain.WebhookStream ) : Webhook
    {
        return new Webhook( this.cloud, {
            auth: { verify: ( request : Webhook.Request ) : Promise<boolean> => this.verifyWebhook( stream, request ) },
            log:  this.log,
        } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /**
     * Verify one inbound provider callback. Both TCR and Campaign Verify sign with the Meta/Stripe-style
     * scheme — HMAC-SHA256 over the TRUE raw body, hex, in a provider-named header — so this reuses the same
     * primitive `Webhook.hmacSha256RawBody` implements, over the stream's own header name.
     *
     * It is implemented here rather than by calling the built-in because the signing secret has to be
     * resolved asynchronously (Secrets Manager) per request, and the built-in takes the secret up front.
     * Fails closed on every miss: no raw body captured, no configured secret, no header, or a length/constant-
     * time mismatch all return false.
     */
    public async verifyWebhook( stream : RegistrationDomain.WebhookStream, request : Webhook.Request ) : Promise<boolean>
    {
        // the raw bytes are mandatory — a re-serialized approximation of the body is NOT the signed payload
        if( request.rawBody === undefined ) { this.log.warn( "webhook rejected — no raw body captured", { stream } ); return false; }

        const secret : Type.Result<string | undefined> = await this.webhookSecret( stream );
        if( !secret.ok || secret.data === undefined || secret.data.length === 0 )
        {
            this.log.warn( "webhook rejected — no signing secret configured for this stream", { stream } );
            return false;
        }

        const headerName : string = RegistrationService.SIGNATURE_HEADER[ stream ];
        const header : string | undefined = request.headers[ headerName ] ?? request.headers[ headerName.toUpperCase() ];
        if( header === undefined || header.length === 0 ) { this.log.warn( "webhook rejected — no signature header", { stream, headerName } ); return false; }

        // strip the optional `sha256=` prefix so both bare-hex and prefixed conventions verify
        const provided : Buffer = Buffer.from( header.startsWith( "sha256=" ) ? header.slice( "sha256=".length ) : header, "hex" );
        const expected : Buffer = createHmac( "sha256", secret.data ).update( request.rawBody ).digest();
        if( expected.length !== provided.length ) return false;
        return timingSafeEqual( expected, provided );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Seed the runtime config on a fresh environment so the service (and the Console Config tab) have usable
     *  defaults from first boot. DEFAULT enables only the FAKE carrier, so a freshly-seeded environment can
     *  never reach a real carrier before an operator configures one. */
    protected override async init() : Promise<void>
    {
        await super.init();
        const seeded : Type.Result<RegistrationConfig.Config> = await this.appConfig.ensureSeeded( "config", "settings", RegistrationConfig.DEFAULT );
        if( seeded.ok ) this.log.info( "registration config ready" );
        else this.log.warn( "registration config seed failed — using DEFAULT until deployed", { error: seeded.error } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** The live runtime config, deep-filled from DEFAULT. Exposed for endpoint impls (GetRegistrationConfig);
     *  the domain object reads it independently for its own calls. */
    public registrationConfig() : Promise<RegistrationConfig.Config> { return this.domain.config(); }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Persist + deploy a new config version — the PUT-config write path. */
    public saveConfig( config : RegistrationConfig.Config ) : Promise<Type.Result<void>> { return this.domain.saveConfig( config ); }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // resolve the shared signing secret for one provider stream. Both credentials carry it on the same
    // conventional field, so one reader covers both rather than a branch per stream.
    private async webhookSecret( stream : RegistrationDomain.WebhookStream ) : Promise<Type.Result<string | undefined>>
    {
        const config : RegistrationConfig.Config = await this.registrationConfig();
        const secretRef : string | undefined = stream === RegistrationDomain.WebhookStream.TCR ? config.secretRef : config.cvSecretRef;
        if( secretRef === undefined || secretRef.length === 0 ) return { ok: true, data: undefined };

        const secret : Type.Result<RegistrationService.SigningCredential | undefined> = await this.secrets.getJson<RegistrationService.SigningCredential>( secretRef );
        if( !secret.ok ) return { ok: false, error: secret.error };
        return { ok: true, data: secret.data?.webhookSecret };
    }

    // the header each provider stream carries its HMAC in
    private static readonly SIGNATURE_HEADER : Record<RegistrationDomain.WebhookStream, string> =
    {
        [ RegistrationDomain.WebhookStream.TCR ]: "x-tcr-signature",
        [ RegistrationDomain.WebhookStream.CV ]:  "x-cv-signature",
    };
}

export namespace RegistrationService
{
    /** The concrete roles this service deploys as (registration-12.2/12.3). */
    export enum Role
    {
        MAIN    = "main",
        WEBHOOK = "webhook",
    }

    /** Each role's default local-dev port — the SAME constants the CloudManifest uses for `containerPort`. */
    export const PORT : Record<Role, number> =
    {
        [ Role.MAIN ]:    Ports.REGISTRATION.MAIN,
        [ Role.WEBHOOK ]: Ports.REGISTRATION.WEBHOOK,
    };

    /** The webhook-signing field carried on both provider credentials (`registration-tcr` /
     *  `registration-campaign-verify`). Absent → that stream's callbacks are rejected, by design. */
    export interface SigningCredential { webhookSecret? : string; }
}

export default RegistrationService;
// eof

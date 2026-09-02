//
import { randomUUID } from "node:crypto";

import { ScanCommand, type ScanCommandOutput } from "@aws-sdk/lib-dynamodb";

import { Registration, RegistrationConfig, Billing, PhoneNumber, Texting } from "@repo/api";
import { ObjectUtils, ResultUtils, type Type } from "@repo/common";
import { Events } from "@repo/system";
import type { AppConfig, Dynamo, Kafka, Secrets, Sqs, Trace } from "@repo/services";

import { CarrierFactory } from "../providers/CarrierFactory";
import { CarrierProvider, CarrierContext, CarrierPairingStatus, AvailableNumber, OrderedNumber } from "../providers/CarrierProvider";
import { CvClient } from "../providers/CvClient";
import { TcrClient } from "../providers/TcrClient";
import { RegistrationStateMachine } from "./RegistrationStateMachine";

//
// RegistrationDomain — ALL of the registration domain logic, in one place that is neither a `Service` nor a
// `Job` (registration-12.1/12.5). This is the deliberate structural choice for this service: the state-machine
// engine, the DynamoDB projection repo, the TCR/CV clients, the carrier factory, the status-publish and the
// cost-estimate ledger are needed IDENTICALLY by the HTTP roles (RegistrationMainService /
// RegistrationWebhookService) and by all four Lambdas (submit / webhook / poll / vetting).
//
// Rather than duplicating that logic across a Service base and a Job base — the shape marketplace uses, where
// `MarketplaceJob` re-declares `MarketplaceService`'s facades and the pipelines are separate modules — this
// service takes the facades as CONSTRUCTOR ARGS and both bases construct exactly one instance from their own
// lazy getters. There is therefore ONE implementation of "what does CAMPAIGN_DCA_COMPLETE mean", not two that
// can drift, and the on-demand check&sync endpoint and the poll sweep literally call the same
// {@link RegistrationDomain.reconcileOne}.
//
// EVERY method returns a `Type.Result` and never throws (CLAUDE.md's Results-over-throws rule). TCR is the
// SOURCE OF TRUTH (registration-5.1) — nothing here treats the local row as authoritative; a transition is
// either driven by a provider callback, by a reconciliation read, or by an explicitly-audited staff override.
//
export class RegistrationDomain
{
    /** The carrier (CNP) adapter registry — one instance per domain object, adapters themselves are stateless. */
    private readonly carriers : CarrierFactory = new CarrierFactory();

    ////////////////////////////////////////////////////////////////////////////////////////////
    /**
     * @param deps the owning Service's or Job's own facades. Passed in rather than constructed here so a
     *             Lambda and an ECS role each keep their own lazily-created, independently-cached clients.
     */
    constructor( private readonly deps : RegistrationDomain.Deps ) {}

    ////////////////////////////////////////////////////////////////////////////////////////////
    // ── Runtime config ────────────────────────────────────────────────────────────────────────

    /** The live runtime config (AppConfig `config/settings`), deep-filled from DEFAULT so an older/partial
     *  hosted row tolerates schema drift. Never fails — a config read miss falls back to DEFAULT, which seeds
     *  only the FAKE carrier and therefore cannot accidentally reach a real carrier. */
    public async config() : Promise<RegistrationConfig.Config>
    {
        const got : Type.Result<RegistrationConfig.Config | undefined> = await this.deps.appConfig.json<RegistrationConfig.Config>( "config", "settings" );
        this.deps.log.trace( "config read: config/settings", { found: got.ok && got.data !== undefined } );
        return got.ok && got.data ? ObjectUtils.withDefaults( got.data, RegistrationConfig.DEFAULT ) : RegistrationConfig.DEFAULT;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Persist a new config version + deploy it (AppConfig control plane) — the PUT-config write path. */
    public async saveConfig( config : RegistrationConfig.Config, environment : string = process.env.APPCONFIG_ENV ?? "default" ) : Promise<Type.Result<void>>
    {
        const profileId : Type.Result<string> = await this.deps.appConfig.profileId( "config", "settings" );
        if( !profileId.ok ) return ResultUtils.err( profileId.error );
        const environmentId : Type.Result<string> = await this.deps.appConfig.environmentId( "config", environment );
        if( !environmentId.ok ) return ResultUtils.err( environmentId.error );

        const version : Type.Result<number> = await this.deps.appConfig.createVersion( "config", profileId.data, JSON.stringify( config ) );
        if( !version.ok ) return ResultUtils.err( version.error );
        const deployed : Type.Result<number> = await this.deps.appConfig.deploy( "config", profileId.data, environmentId.data, version.data, { description: "registration config update" } );
        if( !deployed.ok ) return ResultUtils.err( deployed.error );
        return ResultUtils.ok( undefined );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // ── External clients (resolved per call from config + Secrets) ────────────────────────────

    /** Build a TCR client from the config's `secretRef`. Resolved per call rather than cached so a rotated
     *  credential (or a config edit that re-points `secretRef`) takes effect without a restart. */
    public async tcrClient( config : RegistrationConfig.Config ) : Promise<Type.Result<TcrClient>>
    {
        if( config.secretRef.length === 0 ) return ResultUtils.err( "TCR credential is not configured (RegistrationConfig.secretRef is empty)" );
        const secret : Type.Result<TcrClient.Credential | undefined> = await this.deps.secrets.getJson<TcrClient.Credential>( config.secretRef );
        if( !secret.ok ) return ResultUtils.err( `TCR credential read failed: ${ secret.error }` );
        if( secret.data === undefined ) return ResultUtils.err( `TCR credential ${ config.secretRef } is empty` );
        this.deps.log.trace( "secret resolved", { secretRef: config.secretRef } );
        return ResultUtils.ok( new TcrClient( secret.data ) );
    }

    /** Build a Campaign Verify client from the config's `cvSecretRef`. CV is OPTIONAL (only political brands
     *  need it), so an unconfigured `cvSecretRef` is a clear failed Result, not a crash. */
    public async cvClient( config : RegistrationConfig.Config ) : Promise<Type.Result<CvClient>>
    {
        if( config.cvSecretRef === undefined || config.cvSecretRef.length === 0 ) return ResultUtils.err( "Campaign Verify is not configured (RegistrationConfig.cvSecretRef is unset)" );
        const secret : Type.Result<CvClient.Credential | undefined> = await this.deps.secrets.getJson<CvClient.Credential>( config.cvSecretRef );
        if( !secret.ok ) return ResultUtils.err( `Campaign Verify credential read failed: ${ secret.error }` );
        if( secret.data === undefined ) return ResultUtils.err( `Campaign Verify credential ${ config.cvSecretRef } is empty` );
        return ResultUtils.ok( new CvClient( secret.data ) );
    }

    /** Resolve one carrier's adapter + a FRESH credential context. Returns a failed Result when the carrier
     *  isn't registered in the config (fail closed — never silently fall back to another carrier). */
    public async carrierFor( provider : Registration.CarrierProvider, config : RegistrationConfig.Config ) : Promise<Type.Result<RegistrationDomain.ResolvedCarrier>>
    {
        const entry : RegistrationConfig.ProviderEntry | undefined = config.providers[ provider ];
        if( entry === undefined || !entry.enabled ) return ResultUtils.err( `carrier provider ${ provider } is not enabled` );

        const adapter : CarrierProvider | undefined = this.carriers.get( provider );
        if( adapter === undefined ) return ResultUtils.err( `no adapter registered for carrier provider ${ provider }` );

        // the FAKE carrier has no credential to resolve — it never leaves the process
        const context : CarrierContext = { cspId: config.cspId };
        if( entry.secretRef === undefined ) return ResultUtils.ok( { adapter, context } );

        const secret : Type.Result<RegistrationDomain.CarrierCredential | undefined> = await this.deps.secrets.getJson<RegistrationDomain.CarrierCredential>( entry.secretRef );
        if( !secret.ok || secret.data === undefined ) return ResultUtils.ok( { adapter, context } );
        return ResultUtils.ok( { adapter, context: { ...context, ...secret.data } } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // ── Brand projection repo (registration-10.1) ─────────────────────────────────────────────

    /** One brand by our own projection key. */
    public async getBrand( accountId : string, brandId : string ) : Promise<Type.Result<Registration.Brand | undefined>>
    {
        this.deps.log.trace( "item read: registration_brand", { accountId, brandId } );
        return this.deps.dynamo.get<Registration.Brand>( "registration_brand", { accountId, brandId } );
    }

    /** Every brand on one account's partition (brand-per-account means this is normally 0 or 1 rows). */
    public async listBrands( accountId : string ) : Promise<Type.Result<Array<Registration.Brand>>>
    {
        this.deps.log.trace( "item query: registration_brand", { accountId } );
        return this.deps.dynamo.query<Registration.Brand>( "registration_brand", {
            KeyConditionExpression:    "accountId = :account",
            ExpressionAttributeValues: { ":account": accountId },
        } );
    }

    /** Resolve a brand from TCR's OWN id via the `byTcrId` GSI — the webhook/reconcile entry point, since an
     *  inbound callback carries no accountId. */
    public async brandByTcrId( tcrBrandId : string ) : Promise<Type.Result<Registration.Brand | undefined>>
    {
        const found : Type.Result<Array<Registration.Brand>> = await this.deps.dynamo.query<Registration.Brand>( "registration_brand", {
            IndexName:                 "byTcrId",
            KeyConditionExpression:    "tcrBrandId = :tcrId",
            ExpressionAttributeValues: { ":tcrId": tcrBrandId },
        } );
        if( !found.ok ) return ResultUtils.err( found.error );
        return ResultUtils.ok( found.data[ 0 ] );
    }

    /** EVERY brand across every account — the staff/S2S cross-account listing and the poll sweep's candidate
     *  set. A scan is correct here (there is no tenant to key by) and bounded by the projection's size, which
     *  is one row per registered account, not per message. */
    public async scanBrands() : Promise<Type.Result<Array<Registration.Brand>>>
    {
        return ResultUtils.from( async () : Promise<Array<Registration.Brand>> =>
        {
            const output : ScanCommandOutput = await this.deps.dynamo.client.send( new ScanCommand( { TableName: this.deps.dynamo.table( "registration_brand" ) } ) );
            return ( output.Items ?? [] ) as Array<Registration.Brand>;
        } );
    }

    /** Persist a brand row (create or full replace). */
    public async putBrand( brand : Registration.Brand ) : Promise<Type.Result<void>>
    {
        const wrote : Type.Result<void> = await this.deps.dynamo.put( "registration_brand", { ...brand } );
        if( !wrote.ok ) this.deps.log.warn( "brand write failed", { accountId: brand.accountId, brandId: brand.brandId, error: wrote.error } );
        else this.deps.log.trace( "item stored: registration_brand", { accountId: brand.accountId, brandId: brand.brandId, status: brand.status } );
        return wrote;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // ── Campaign projection repo ──────────────────────────────────────────────────────────────

    /** One campaign by our own projection key. */
    public async getCampaign( accountId : string, campaignId : string ) : Promise<Type.Result<Registration.Campaign | undefined>>
    {
        this.deps.log.trace( "item read: registration_campaign", { accountId, campaignId } );
        return this.deps.dynamo.get<Registration.Campaign>( "registration_campaign", { accountId, campaignId } );
    }

    /** Every campaign on one account's partition. */
    public async listCampaigns( accountId : string ) : Promise<Type.Result<Array<Registration.Campaign>>>
    {
        this.deps.log.trace( "item query: registration_campaign", { accountId } );
        return this.deps.dynamo.query<Registration.Campaign>( "registration_campaign", {
            KeyConditionExpression:    "accountId = :account",
            ExpressionAttributeValues: { ":account": accountId },
        } );
    }

    /** Every campaign under one brand, across accounts — the `byBrand` GSI (the vetting-status rollup). */
    public async campaignsByBrand( brandId : string ) : Promise<Type.Result<Array<Registration.Campaign>>>
    {
        return this.deps.dynamo.query<Registration.Campaign>( "registration_campaign", {
            IndexName:                 "byBrand",
            KeyConditionExpression:    "brandId = :brand",
            ExpressionAttributeValues: { ":brand": brandId },
        } );
    }

    /** Resolve a campaign from TCR's OWN id via the `byTcrId` GSI — the webhook/reconcile entry point. */
    public async campaignByTcrId( tcrCampaignId : string ) : Promise<Type.Result<Registration.Campaign | undefined>>
    {
        const found : Type.Result<Array<Registration.Campaign>> = await this.deps.dynamo.query<Registration.Campaign>( "registration_campaign", {
            IndexName:                 "byTcrId",
            KeyConditionExpression:    "tcrCampaignId = :tcrId",
            ExpressionAttributeValues: { ":tcrId": tcrCampaignId },
        } );
        if( !found.ok ) return ResultUtils.err( found.error );
        return ResultUtils.ok( found.data[ 0 ] );
    }

    /** EVERY campaign across every account — the staff/S2S listing and the poll sweep's candidate set. */
    public async scanCampaigns() : Promise<Type.Result<Array<Registration.Campaign>>>
    {
        return ResultUtils.from( async () : Promise<Array<Registration.Campaign>> =>
        {
            const output : ScanCommandOutput = await this.deps.dynamo.client.send( new ScanCommand( { TableName: this.deps.dynamo.table( "registration_campaign" ) } ) );
            return ( output.Items ?? [] ) as Array<Registration.Campaign>;
        } );
    }

    /** Persist a campaign row (create or full replace). */
    public async putCampaign( campaign : Registration.Campaign ) : Promise<Type.Result<void>>
    {
        const wrote : Type.Result<void> = await this.deps.dynamo.put( "registration_campaign", { ...campaign } );
        if( !wrote.ok ) this.deps.log.warn( "campaign write failed", { accountId: campaign.accountId, campaignId: campaign.campaignId, error: wrote.error } );
        else this.deps.log.trace( "item stored: registration_campaign", { accountId: campaign.accountId, campaignId: campaign.campaignId, status: campaign.status } );
        return wrote;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // ── Status publish (registration-7.1/7.2 — inline on state change, never a Streams CDC job) ─

    /** Publish a `registration.brand` lifecycle event (best-effort — a bus miss is logged, never fails the
     *  caller; the poll sweep would re-derive the same state anyway). */
    public async emitBrand( verb : Events.Verb, brand : Registration.Brand ) : Promise<void>
    {
        const envelope : Events.Envelope = Events.envelope( {
            object:    Events.Object.REGISTRATION_BRAND,
            verb,
            accountId: brand.accountId,
            target:    { type: "registration.brand", id: brand.brandId ?? brand.accountId },
            data:      brand,
        } );
        const published : Type.Result<void> = await this.deps.kafka.publishEvent( envelope );
        if( !published.ok ) this.deps.log.warn( "registration.brand event publish failed", { brandId: brand.brandId, verb, error: published.error } );
    }

    /** Publish a `registration.campaign` lifecycle event. THIS is the published interface texting gates
     *  sending on (`campaign-active`) and dispatch paces to (`mps`) — registration-7.1/7.2, SPECS.md gap #3.
     *  Neither consumer ever reads this service's tables. */
    public async emitCampaign( verb : Events.Verb, campaign : Registration.Campaign ) : Promise<void>
    {
        const envelope : Events.Envelope = Events.envelope( {
            object:    Events.Object.REGISTRATION_CAMPAIGN,
            verb,
            accountId: campaign.accountId,
            target:    { type: "registration.campaign", id: campaign.campaignId ?? campaign.brandId },
            data:      campaign,
        } );
        const published : Type.Result<void> = await this.deps.kafka.publishEvent( envelope );
        if( !published.ok ) this.deps.log.warn( "registration.campaign event publish failed", { campaignId: campaign.campaignId, verb, error: published.error } );
    }

    /** Publish a `registration.number` event for each number associated to (or released from) a campaign —
     *  texting's per-number sending gate (registration-4.1/7.1). */
    public async emitNumbers( verb : Events.Verb, campaign : Registration.Campaign, phoneNumbers : Array<string> ) : Promise<void>
    {
        for( const phoneNumber of phoneNumbers )
        {
            const envelope : Events.Envelope = Events.envelope( {
                object:    Events.Object.REGISTRATION_NUMBER,
                verb,
                accountId: campaign.accountId,
                target:    { type: "registration.number", id: phoneNumber },
                data:      { accountId: campaign.accountId, campaignId: campaign.campaignId, brandId: campaign.brandId, phoneNumber, status: campaign.status, mps: campaign.mps },
            } );
            const published : Type.Result<void> = await this.deps.kafka.publishEvent( envelope );
            if( !published.ok ) this.deps.log.warn( "registration.number event publish failed", { phoneNumber, verb, error: published.error } );
        }
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // ── Cost-estimate ledger (the billing STUB) ───────────────────────────────────────────────

    /**
     * Record what WOULD be billed at one of the four legacy TCR charge points. No billing engine exists in
     * this platform yet (the account service's billing endpoints are explicit skeletons), so this writes a
     * `Registration.CostEstimate` row and nothing else — deliberately reusing `Billing.Rate`/`Billing.Money`
     * so wiring a real charge later is a swap of THIS write site, not a new shape.
     *
     * The rate is resolved from the runtime config: a campaign's monthly fee from `useCaseMonthlyFee` (keyed
     * by use case), a vetting fee from `vettingFee` (keyed by EVP) falling back to `defaultVettingFee`, and
     * brand registration from the same default. An unpriced use case estimates ZERO rather than failing —
     * a missing price row must not block a registration.
     */
    public async estimateCost( input : RegistrationDomain.EstimateInput ) : Promise<Type.Result<Registration.CostEstimate>>
    {
        const config : RegistrationConfig.Config = await this.config();
        const quantity : number = input.quantity ?? 1;
        const unitAmount : Billing.Rate = RegistrationDomain.rateFor( config, input );

        // settle to whole cents — Rate is milli-cents (thousandths), Money is cents
        const amountMinor : number = Math.round( ( unitAmount.amountMilliCents * quantity ) / 1000 );
        const estimate : Registration.CostEstimate =
        {
            id:          randomUUID(),
            accountId:   input.accountId,
            brandId:     input.brandId,
            campaignId:  input.campaignId,
            kind:        input.kind,
            description: input.description,
            quantity,
            unitAmount,
            amount:      { amountMinor, currency: unitAmount.currency },
            estimatedAt: new Date().toISOString(),
        };

        const wrote : Type.Result<void> = await this.deps.dynamo.put( "registration_costestimate", { ...estimate } );
        if( !wrote.ok )
        {
            this.deps.log.warn( "cost estimate write failed", { accountId: input.accountId, kind: input.kind, error: wrote.error } );
            return ResultUtils.err( wrote.error );
        }
        this.deps.log.info( "cost.estimated", { accountId: input.accountId, kind: input.kind, quantity, amountMinor, currency: unitAmount.currency } );
        return ResultUtils.ok( estimate );
    }

    /** All cost-estimate rows on one account's partition — the S2S report read. */
    public async listCostEstimates( accountId : string ) : Promise<Type.Result<Array<Registration.CostEstimate>>>
    {
        return this.deps.dynamo.query<Registration.CostEstimate>( "registration_costestimate", {
            KeyConditionExpression:    "accountId = :account",
            ExpressionAttributeValues: { ":account": accountId },
        } );
    }

    /** EVERY cost-estimate row across accounts — the cross-account S2S report read. */
    public async scanCostEstimates() : Promise<Type.Result<Array<Registration.CostEstimate>>>
    {
        return ResultUtils.from( async () : Promise<Array<Registration.CostEstimate>> =>
        {
            const output : ScanCommandOutput = await this.deps.dynamo.client.send( new ScanCommand( { TableName: this.deps.dynamo.table( "registration_costestimate" ) } ) );
            return ( output.Items ?? [] ) as Array<Registration.CostEstimate>;
        } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // ── Brand lifecycle (registration-1.0 / 3.1) ──────────────────────────────────────────────

    /**
     * Create the account's brand in DRAFT (registration-1.1 — brand-per-account: at most one). Mints OUR
     * stable projection key up front; TCR's own id lands on `tcrBrandId` only once TCR accepts the
     * submission, so the DynamoDB sort key never changes underneath a row.
     */
    public async createBrand( accountId : string, fields : RegistrationDomain.BrandFields ) : Promise<Type.Result<Registration.Brand>>
    {
        // brand-per-account is enforced HERE, not in the schema — it's a cardinality rule about existing
        // state, which only the projection can answer
        const existing : Type.Result<Array<Registration.Brand>> = await this.listBrands( accountId );
        if( !existing.ok ) return ResultUtils.err( existing.error );
        if( existing.data.length > 0 ) return ResultUtils.err( "this account already has a brand (brand-per-account)" );

        const invalid : string | undefined = RegistrationDomain.validateBrandFields( fields );
        if( invalid !== undefined ) return ResultUtils.err( invalid );

        const now : string = new Date().toISOString();
        const brand : Registration.Brand =
        {
            ...fields,
            accountId,
            brandId:       randomUUID(),
            status:        Registration.BrandStatus.DRAFT,
            statusHistory: [ { status: Registration.BrandStatus.DRAFT, time: now } ],
            createdAt:     now,
            updatedAt:     now,
        };

        const wrote : Type.Result<void> = await this.putBrand( brand );
        if( !wrote.ok ) return ResultUtils.err( wrote.error );
        await this.emitBrand( Events.Verb.CREATED, brand );
        return ResultUtils.ok( brand );
    }

    /**
     * Apply an edit to a brand's user-submittable fields. Only legal while the brand hasn't been accepted by
     * TCR (DRAFT) or is being remediated after a rejection (FAILED / NEEDS_APPEAL / EXPIRED — registration-3.2);
     * editing an in-flight or approved brand would silently desynchronize the projection from TCR.
     */
    public async patchBrand( accountId : string, brandId : string, fields : Partial<RegistrationDomain.BrandFields> ) : Promise<Type.Result<Registration.Brand>>
    {
        const found : Type.Result<Registration.Brand | undefined> = await this.getBrand( accountId, brandId );
        if( !found.ok ) return ResultUtils.err( found.error );
        if( found.data === undefined ) return ResultUtils.err( "brand not found" );
        if( !RegistrationDomain.BRAND_EDITABLE.includes( found.data.status ) )
            return ResultUtils.err( `a brand in status "${ found.data.status }" cannot be edited` );

        const brand : Registration.Brand = { ...found.data, ...fields, updatedAt: new Date().toISOString() };
        const wrote : Type.Result<void> = await this.putBrand( brand );
        if( !wrote.ok ) return ResultUtils.err( wrote.error );
        await this.emitBrand( Events.Verb.UPDATED, brand );
        return ResultUtils.ok( brand );
    }

    /**
     * Submit a DRAFT brand to TCR (registration-2.0's brand half). Multi-step, so each step is narrated:
     * resolve the client, push the brand, record TCR's assigned id, move DRAFT → SUBMITTED (which schedules
     * the first reconciliation poll), and record the BRAND_REGISTRATION cost estimate. The real outcome
     * (approved / needs-appeal / failed) arrives later on a webhook or the poll sweep — never here.
     */
    public async submitBrand( accountId : string, brandId : string ) : Promise<Type.Result<Registration.Brand>>
    {
        const found : Type.Result<Registration.Brand | undefined> = await this.getBrand( accountId, brandId );
        if( !found.ok ) return ResultUtils.err( found.error );
        if( found.data === undefined ) return ResultUtils.err( "brand not found" );
        const brand : Registration.Brand = found.data;

        // guard the transition BEFORE the external call, so a double-submit can't create two TCR brands
        if( !RegistrationStateMachine.canTransitionBrand( brand.status, Registration.BrandStatus.SUBMITTED ) )
            return ResultUtils.err( `a brand in status "${ brand.status }" cannot be submitted` );

        const config : RegistrationConfig.Config = await this.config();
        const client : Type.Result<TcrClient> = await this.tcrClient( config );
        if( !client.ok ) return ResultUtils.err( client.error );

        // push to TCR — this is the point the registry, not us, becomes the source of truth for this brand
        const created : Type.Result<Record<string, unknown>> = await client.data.createBrand( RegistrationDomain.brandPayload( brand, config ) );
        if( !created.ok ) return ResultUtils.err( `TCR brand submission failed: ${ created.error }` );

        // record TCR's own id on its OWN field — our projection key is unchanged
        const tcrBrandId : string | undefined = TcrClient.readString( created.data, "brandId" );
        const stamped : Registration.Brand = { ...brand, tcrBrandId: tcrBrandId ?? brand.tcrBrandId };
        const wrote : Type.Result<void> = await this.putBrand( stamped );
        if( !wrote.ok ) return ResultUtils.err( wrote.error );

        const moved : Type.Result<Registration.Brand> = await this.transitionBrandStatus( accountId, brandId, Registration.BrandStatus.SUBMITTED, "submitted to TCR" );
        if( !moved.ok ) return moved;

        // the billing STUB — record the charge that WOULD apply at this legacy charge point
        const estimated : Type.Result<Registration.CostEstimate> = await this.estimateCost( {
            accountId, brandId, kind: Registration.CostEstimateKind.BRAND_REGISTRATION, description: "TCR brand registration",
        } );
        if( !estimated.ok ) this.deps.log.warn( "brand registration cost estimate not recorded", { accountId, brandId, error: estimated.error } );

        return moved;
    }

    /**
     * Move a brand to a new status: validate the edge against the state machine, append (never overwrite) the
     * audit entry (registration-9.3), reschedule or stop the poll sweep, persist, and publish. This is the
     * ONLY way a brand's status changes — webhooks, reconciliation and staff overrides all funnel through it,
     * which is what makes the audit trail complete by construction.
     */
    public async transitionBrandStatus( accountId : string, brandId : string, to : Registration.BrandStatus,
                                        reason? : string, overridden : boolean = false ) : Promise<Type.Result<Registration.Brand>>
    {
        const found : Type.Result<Registration.Brand | undefined> = await this.getBrand( accountId, brandId );
        if( !found.ok ) return ResultUtils.err( found.error );
        if( found.data === undefined ) return ResultUtils.err( "brand not found" );
        const current : Registration.Brand = found.data;

        // a staff override (registration-11.6) is the ONE path allowed to take an otherwise-illegal edge —
        // that is precisely what "break-glass" means, and it is why the reason is mandatory upstream
        if( !overridden && !RegistrationStateMachine.canTransitionBrand( current.status, to ) )
            return ResultUtils.err( `illegal brand transition ${ current.status } → ${ to }` );

        const now : string = new Date().toISOString();
        const config : RegistrationConfig.Config = await this.config();
        const terminal : boolean = RegistrationStateMachine.isBrandTerminal( to );
        const attempts : number = current.status === to ? ( current.pollAttempts ?? 0 ) + 1 : 0;

        const brand : Registration.Brand =
        {
            ...current,
            status:        to,
            statusHistory: [ ...current.statusHistory, { status: to, time: now, reason, overridden: overridden ? true : undefined } ],
            // a rejection reason is sticky until the next transition clears it — registration-3.2 surfaces it
            rejectionReason: to === Registration.BrandStatus.FAILED || to === Registration.BrandStatus.NEEDS_APPEAL ? reason : undefined,
            overridden:      overridden ? true : current.overridden,
            // stop polling on terminal (registration-5.3); otherwise back off from the attempt count
            nextPollAt:      terminal ? undefined : RegistrationStateMachine.nextPollAt( config.pollSweep, attempts ),
            pollAttempts:    terminal ? undefined : attempts,
            updatedAt:       now,
        };

        const wrote : Type.Result<void> = await this.putBrand( brand );
        if( !wrote.ok ) return ResultUtils.err( wrote.error );
        this.deps.log.info( "brand status changed", { accountId, brandId, from: current.status, to, overridden } );
        await this.emitBrand( Events.Verb.UPDATED, brand );
        return ResultUtils.ok( brand );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // ── Campaign lifecycle (registration-2.0 / 3.1 / 11.1) ────────────────────────────────────

    /** Create a campaign in DRAFT under an APPROVED brand. The brand gate is enforced here rather than at the
     *  endpoint because it's a statement about the projection, not about the request. */
    public async createCampaign( accountId : string, fields : RegistrationDomain.CampaignFields ) : Promise<Type.Result<Registration.Campaign>>
    {
        const brand : Type.Result<Registration.Brand | undefined> = await this.getBrand( accountId, fields.brandId );
        if( !brand.ok ) return ResultUtils.err( brand.error );
        if( brand.data === undefined ) return ResultUtils.err( "brand not found" );

        const invalid : string | undefined = RegistrationDomain.validateCampaignFields( fields );
        if( invalid !== undefined ) return ResultUtils.err( invalid );

        const now : string = new Date().toISOString();
        const campaign : Registration.Campaign =
        {
            ...fields,
            accountId,
            campaignId:    randomUUID(),
            subUsecases:   fields.subUsecases ?? [],
            phoneNumbers:  [],
            status:        Registration.CampaignStatus.DRAFT,
            statusHistory: [ { status: Registration.CampaignStatus.DRAFT, time: now } ],
            createdAt:     now,
            updatedAt:     now,
        };

        const wrote : Type.Result<void> = await this.putCampaign( campaign );
        if( !wrote.ok ) return ResultUtils.err( wrote.error );
        await this.emitCampaign( Events.Verb.CREATED, campaign );
        return ResultUtils.ok( campaign );
    }

    /** Apply an edit to a campaign's user-submittable fields — same status gate rationale as `patchBrand`. */
    public async patchCampaign( accountId : string, campaignId : string, fields : Partial<RegistrationDomain.CampaignFields> ) : Promise<Type.Result<Registration.Campaign>>
    {
        const found : Type.Result<Registration.Campaign | undefined> = await this.getCampaign( accountId, campaignId );
        if( !found.ok ) return ResultUtils.err( found.error );
        if( found.data === undefined ) return ResultUtils.err( "campaign not found" );
        if( !RegistrationDomain.CAMPAIGN_EDITABLE.includes( found.data.status ) )
            return ResultUtils.err( `a campaign in status "${ found.data.status }" cannot be edited` );

        if( fields.numberSelection !== undefined )
        {
            const invalid : string | undefined = RegistrationDomain.validateNumberSelection( fields.numberSelection );
            if( invalid !== undefined ) return ResultUtils.err( invalid );
        }

        const campaign : Registration.Campaign = { ...found.data, ...fields, updatedAt: new Date().toISOString() };
        const wrote : Type.Result<void> = await this.putCampaign( campaign );
        if( !wrote.ok ) return ResultUtils.err( wrote.error );
        await this.emitCampaign( Events.Verb.UPDATED, campaign );
        return ResultUtils.ok( campaign );
    }

    /**
     * Submit a DRAFT campaign to TCR (registration-11.1). REQUIRES the parent brand to be APPROVED — TCR
     * rejects a campaign under an unapproved brand, so failing fast here saves a doomed external round-trip
     * and gives the account a comprehensible error instead of a registry one.
     */
    public async submitCampaign( accountId : string, campaignId : string ) : Promise<Type.Result<Registration.Campaign>>
    {
        const found : Type.Result<Registration.Campaign | undefined> = await this.getCampaign( accountId, campaignId );
        if( !found.ok ) return ResultUtils.err( found.error );
        if( found.data === undefined ) return ResultUtils.err( "campaign not found" );
        const campaign : Registration.Campaign = found.data;

        if( !RegistrationStateMachine.canTransitionCampaign( campaign.status, Registration.CampaignStatus.SUBMITTED ) )
            return ResultUtils.err( `a campaign in status "${ campaign.status }" cannot be submitted` );

        // the brand gate — registration-1.2's "no A2P until approved", enforced at the campaign boundary
        const brand : Type.Result<Registration.Brand | undefined> = await this.getBrand( accountId, campaign.brandId );
        if( !brand.ok ) return ResultUtils.err( brand.error );
        if( brand.data === undefined ) return ResultUtils.err( "brand not found" );
        if( brand.data.status !== Registration.BrandStatus.APPROVED )
            return ResultUtils.err( `the brand must be APPROVED before a campaign can be submitted (it is "${ brand.data.status }")` );
        if( brand.data.tcrBrandId === undefined ) return ResultUtils.err( "the brand has no TCR id yet — reconcile it before submitting a campaign" );

        const config : RegistrationConfig.Config = await this.config();
        const client : Type.Result<TcrClient> = await this.tcrClient( config );
        if( !client.ok ) return ResultUtils.err( client.error );

        const created : Type.Result<Record<string, unknown>> = await client.data.createCampaign( RegistrationDomain.campaignPayload( campaign, brand.data, config ) );
        if( !created.ok ) return ResultUtils.err( `TCR campaign submission failed: ${ created.error }` );

        const tcrCampaignId : string | undefined = TcrClient.readString( created.data, "campaignId" );
        const stamped : Registration.Campaign = { ...campaign, tcrCampaignId: tcrCampaignId ?? campaign.tcrCampaignId };
        const wrote : Type.Result<void> = await this.putCampaign( stamped );
        if( !wrote.ok ) return ResultUtils.err( wrote.error );

        const moved : Type.Result<Registration.Campaign> = await this.transitionCampaignStatus( accountId, campaignId, Registration.CampaignStatus.SUBMITTED, "submitted to TCR" );
        if( !moved.ok ) return moved;

        // the billing STUB — the campaign-registration charge point
        const estimated : Type.Result<Registration.CostEstimate> = await this.estimateCost( {
            accountId, brandId: campaign.brandId, campaignId, usecase: campaign.usecase,
            kind: Registration.CostEstimateKind.CAMPAIGN_REGISTRATION, description: `TCR campaign registration (${ campaign.usecase })`,
        } );
        if( !estimated.ok ) this.deps.log.warn( "campaign registration cost estimate not recorded", { accountId, campaignId, error: estimated.error } );

        return moved;
    }

    /**
     * Move a campaign to a new status — the campaign twin of {@link transitionBrandStatus}, with one extra
     * responsibility: on entry to ACTIVE it resolves and stamps the published throughput
     * (registration-7.2's trust-score → MPS), so the ACTIVE event dispatch consumes already carries the
     * pacing limits rather than requiring a follow-up lookup.
     */
    public async transitionCampaignStatus( accountId : string, campaignId : string, to : Registration.CampaignStatus,
                                           reason? : string, overridden : boolean = false ) : Promise<Type.Result<Registration.Campaign>>
    {
        const found : Type.Result<Registration.Campaign | undefined> = await this.getCampaign( accountId, campaignId );
        if( !found.ok ) return ResultUtils.err( found.error );
        if( found.data === undefined ) return ResultUtils.err( "campaign not found" );
        const current : Registration.Campaign = found.data;

        if( !overridden && !RegistrationStateMachine.canTransitionCampaign( current.status, to ) )
            return ResultUtils.err( `illegal campaign transition ${ current.status } → ${ to }` );

        const now : string = new Date().toISOString();
        const config : RegistrationConfig.Config = await this.config();
        const terminal : boolean = RegistrationStateMachine.isCampaignTerminal( to );
        const attempts : number = current.status === to ? ( current.pollAttempts ?? 0 ) + 1 : 0;

        // registration-7.2 — resolve the throughput ONCE, at the moment the campaign goes live, from the
        // brand's trust score (the MNO metadata refines it later, on the next reconcile)
        const mps : Registration.Campaign[ "mps" ] = to === Registration.CampaignStatus.ACTIVE
            ? current.mps ?? await this.throughputFor( accountId, current.brandId )
            : current.mps;

        const campaign : Registration.Campaign =
        {
            ...current,
            status:        to,
            statusHistory: [ ...current.statusHistory, { status: to, time: now, reason, overridden: overridden ? true : undefined } ],
            rejectionReason: to === Registration.CampaignStatus.REJECTED || to === Registration.CampaignStatus.SUSPENDED ? reason : undefined,
            overridden:      overridden ? true : current.overridden,
            mps,
            nextPollAt:      terminal ? undefined : RegistrationStateMachine.nextPollAt( config.pollSweep, attempts ),
            pollAttempts:    terminal ? undefined : attempts,
            updatedAt:       now,
        };

        const wrote : Type.Result<void> = await this.putCampaign( campaign );
        if( !wrote.ok ) return ResultUtils.err( wrote.error );
        this.deps.log.info( "campaign status changed", { accountId, campaignId, from: current.status, to, overridden, mps } );

        await this.emitCampaign( Events.Verb.UPDATED, campaign );
        // an ACTIVE campaign's numbers become sendable — republish them so texting's per-number gate opens
        if( to === Registration.CampaignStatus.ACTIVE && campaign.phoneNumbers.length > 0 )
            await this.emitNumbers( Events.Verb.UPDATED, campaign, campaign.phoneNumbers );

        return ResultUtils.ok( campaign );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // ── Number association (registration-4.1) ─────────────────────────────────────────────────

    /**
     * Provision + associate carrier numbers to an approved campaign and carry it to NUMBER_ASSOCIATED. Steps:
     * resolve the carrier, cap the request at the configured per-campaign line limit, ask the carrier for
     * numbers, append them to the projection, publish a `registration.number` CREATED per line, and move the
     * status. A carrier that returns FEWER numbers than asked is a partial success, not a failure — the
     * campaign still associates what it got and a later reprovision tops it up.
     */
    public async provisionNumbers( accountId : string, campaignId : string, count : number,
                                   provider? : Registration.CarrierProvider, areaCode? : string ) : Promise<Type.Result<Registration.Campaign>>
    {
        const found : Type.Result<Registration.Campaign | undefined> = await this.getCampaign( accountId, campaignId );
        if( !found.ok ) return ResultUtils.err( found.error );
        if( found.data === undefined ) return ResultUtils.err( "campaign not found" );
        const campaign : Registration.Campaign = found.data;
        if( campaign.tcrCampaignId === undefined ) return ResultUtils.err( "the campaign has no TCR id yet — it cannot be provisioned" );

        const config : RegistrationConfig.Config = await this.config();

        // the legacy per-campaign line cap; TRIAL is exempt (it exists precisely to test with a few lines)
        const cap : number = campaign.usecase === Registration.UseCase.TRIAL ? count : Math.max( 0, config.maxLinesPerCampaign - campaign.phoneNumbers.length );
        const wanted : number = Math.min( count, cap );
        if( wanted <= 0 ) return ResultUtils.err( `the campaign is already at its line cap (${ config.maxLinesPerCampaign })` );

        const carrier : Type.Result<RegistrationDomain.ResolvedCarrier> = await this.carrierFor( provider ?? campaign.provider, config );
        if( !carrier.ok ) return ResultUtils.err( carrier.error );

        // the carrier must accept the campaign share before it will hand out numbers against it
        const shared : Type.Result<void> = await carrier.data.adapter.shareCampaign( campaign.tcrCampaignId, carrier.data.context );
        if( !shared.ok ) return ResultUtils.err( `carrier campaign share failed: ${ shared.error }` );

        const acquired : Type.Result<Array<string>> = await carrier.data.adapter.provisionNumbers(
            campaign.tcrCampaignId, wanted, carrier.data.context, areaCode ?? campaign.areaCode ?? config.defaultAreaCode );
        if( !acquired.ok ) return ResultUtils.err( `carrier number provisioning failed: ${ acquired.error }` );
        if( acquired.data.length === 0 ) return ResultUtils.err( "the carrier returned no numbers" );

        // append (never replace) — a reprovision tops a campaign up rather than churning its live lines
        const phoneNumbers : Array<string> = [ ...new Set( [ ...campaign.phoneNumbers, ...acquired.data ] ) ];
        const updated : Registration.Campaign = { ...campaign, phoneNumbers, provider: provider ?? campaign.provider, updatedAt: new Date().toISOString() };
        const wrote : Type.Result<void> = await this.putCampaign( updated );
        if( !wrote.ok ) return ResultUtils.err( wrote.error );

        this.deps.log.info( "campaign numbers associated", { accountId, campaignId, acquired: acquired.data.length, total: phoneNumbers.length } );
        await this.emitNumbers( Events.Verb.CREATED, updated, acquired.data );

        return this.transitionCampaignStatus( accountId, campaignId, Registration.CampaignStatus.NUMBER_ASSOCIATED, `${ acquired.data.length } number(s) associated` );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // ── Lifecycle operations (registration-11.x) ──────────────────────────────────────────────

    /** registration-11.2 — the reconciled brand + campaign vetting projection. Read-only; it never triggers a
     *  refresh (that's `refreshVetting`), so a support tool can call it freely. */
    public async vettingStatus( accountId : string, brandId : string ) : Promise<Type.Result<RegistrationDomain.VettingStatus>>
    {
        const found : Type.Result<Registration.Brand | undefined> = await this.getBrand( accountId, brandId );
        if( !found.ok ) return ResultUtils.err( found.error );
        if( found.data === undefined ) return ResultUtils.err( "brand not found" );
        const brand : Registration.Brand = found.data;

        const campaigns : Type.Result<Array<Registration.Campaign>> = await this.campaignsByBrand( brandId );
        if( !campaigns.ok ) return ResultUtils.err( campaigns.error );

        return ResultUtils.ok( {
            brandId,
            status:          brand.status,
            identityStatus:  brand.identityStatus,
            vettingProvider: brand.vettingProvider,
            vettingClass:    brand.vettingClass,
            vettingScore:    brand.vettingScore,
            cvStatus:        brand.cvStatus,
            campaigns:       campaigns.data.map( ( campaign : Registration.Campaign ) : RegistrationDomain.CampaignVettingState =>
                             ( { campaignId: campaign.campaignId ?? "", status: campaign.status, operationsStatus: campaign.operationsStatus } ) ),
        } );
    }

    /** registration-11.3 — queue an external-vetting refresh. ASYNC by construction: an EVP run takes minutes
     *  to days, so the endpoint returns 202 and `RegistrationVettingJob` does the work. */
    public async refreshVetting( accountId : string, brandId : string ) : Promise<Type.Result<string>>
    {
        const found : Type.Result<Registration.Brand | undefined> = await this.getBrand( accountId, brandId );
        if( !found.ok ) return ResultUtils.err( found.error );
        if( found.data === undefined ) return ResultUtils.err( "brand not found" );

        const jobId : string = randomUUID();
        const message : RegistrationDomain.VettingMessage = { jobId, accountId, brandId };
        const sent : Type.Result<void> = await this.deps.sqs.send( "registration-vetting", message );
        if( !sent.ok ) return ResultUtils.err( sent.error );
        this.deps.log.trace( "message enqueued (SQS registration-vetting)", { jobId, accountId, brandId } );
        return ResultUtils.ok( jobId );
    }

    /** registration-11.4 — apply the edited fields to a rejected brand/campaign, then queue the resubmit. The
     *  EDIT lands synchronously (so the account immediately sees what it corrected); the external resubmit is
     *  the async part. */
    public async resubmit( accountId : string, target : RegistrationDomain.EntityRef, fields : Record<string, unknown> ) : Promise<Type.Result<string>>
    {
        if( target.brandId !== undefined )
        {
            const patched : Type.Result<Registration.Brand> = await this.patchBrand( accountId, target.brandId, fields as Partial<RegistrationDomain.BrandFields> );
            if( !patched.ok ) return ResultUtils.err( patched.error );
        }
        else if( target.campaignId !== undefined )
        {
            const patched : Type.Result<Registration.Campaign> = await this.patchCampaign( accountId, target.campaignId, fields as Partial<RegistrationDomain.CampaignFields> );
            if( !patched.ok ) return ResultUtils.err( patched.error );
        }
        else return ResultUtils.err( "exactly one of brandId/campaignId is required" );

        return this.enqueueSubmit( { kind: RegistrationDomain.SubmitKind.RESUBMIT, accountId, ...target } );
    }

    /** registration-11.5 — queue a re-provision of a campaign's numbers (after a release, a provider switch,
     *  or a failed association). Async: it is one-or-more external carrier calls. */
    public async reprovision( accountId : string, campaignId : string, provider? : Registration.CarrierProvider, areaCode? : string ) : Promise<Type.Result<string>>
    {
        const found : Type.Result<Registration.Campaign | undefined> = await this.getCampaign( accountId, campaignId );
        if( !found.ok ) return ResultUtils.err( found.error );
        if( found.data === undefined ) return ResultUtils.err( "campaign not found" );

        return this.enqueueSubmit( { kind: RegistrationDomain.SubmitKind.REPROVISION, accountId, campaignId, provider, areaCode } );
    }

    /**
     * registration-11.6 — the audited staff break-glass override. It is the ONE path that may take an
     * otherwise-illegal state-machine edge, so: a non-empty reason is mandatory, `overridden: true` is set on
     * the entity AND on the appended history entry, and the override is explicitly NOT authoritative — the
     * next reconcile compares it to TCR and re-flags a contradiction (see {@link reconcileOne}).
     */
    public async override( accountId : string, target : RegistrationDomain.EntityRef,
                           status : Registration.BrandStatus | Registration.CampaignStatus, reason : string ) : Promise<Type.Result<RegistrationDomain.EntityResult>>
    {
        if( reason.trim().length === 0 ) return ResultUtils.err( "a reason is required for a status override" );

        if( target.brandId !== undefined )
        {
            const moved : Type.Result<Registration.Brand> = await this.transitionBrandStatus(
                accountId, target.brandId, status as Registration.BrandStatus, `override: ${ reason }`, true );
            if( !moved.ok ) return ResultUtils.err( moved.error );
            this.deps.log.warn( "registration status OVERRIDDEN (staff break-glass)", { accountId, brandId: target.brandId, status, reason } );
            return ResultUtils.ok( { brand: moved.data } );
        }

        if( target.campaignId !== undefined )
        {
            const moved : Type.Result<Registration.Campaign> = await this.transitionCampaignStatus(
                accountId, target.campaignId, status as Registration.CampaignStatus, `override: ${ reason }`, true );
            if( !moved.ok ) return ResultUtils.err( moved.error );
            this.deps.log.warn( "registration status OVERRIDDEN (staff break-glass)", { accountId, campaignId: target.campaignId, status, reason } );
            return ResultUtils.ok( { campaign: moved.data } );
        }

        return ResultUtils.err( "exactly one of brandId/campaignId is required" );
    }

    /**
     * registration-11.7 — prod a stuck in-flight registration. Re-pokes TCR out-of-band of the poll cadence
     * and (optionally) flags that the ACCOUNT should be nudged to finish KYC/remediation. Deliberately does
     * NOT change status: a nudge accelerates progress, it doesn't fabricate it.
     */
    public async nudge( accountId : string, target : RegistrationDomain.EntityRef, notifyAccount : boolean = false ) : Promise<Type.Result<boolean>>
    {
        const config : RegistrationConfig.Config = await this.config();
        const client : Type.Result<TcrClient> = await this.tcrClient( config );
        if( !client.ok ) return ResultUtils.err( client.error );

        // resolve which TCR entity to poke — the nudge is against TCR's id, not our projection key
        const resolved : Type.Result<RegistrationDomain.TcrTarget> = await this.resolveTcrTarget( accountId, target );
        if( !resolved.ok ) return ResultUtils.err( resolved.error );

        const poked : Type.Result<Record<string, unknown>> = await client.data.nudge( resolved.data.kind, resolved.data.tcrId );
        if( !poked.ok ) return ResultUtils.err( `TCR nudge failed: ${ poked.error }` );
        this.deps.log.info( "registration nudged at TCR", { accountId, kind: resolved.data.kind, tcrId: resolved.data.tcrId } );

        // TODO(registration-11.7): the account-facing half — an email/notification reminder to finish KYC.
        // Left as a logged intent rather than a stub call: there is no notification contract wired into this
        // service yet, and a silently-dropped "notification" would be worse than an explicit gap.
        if( notifyAccount ) this.deps.log.info( "account nudge requested (notification channel not yet wired)", { accountId, ...target } );

        return ResultUtils.ok( true );
    }

    /** registration-11.8 — on-demand force-reconcile. Literally the same call the poll sweep makes; the only
     *  difference is who triggered it. Kept as a one-line delegation so the two can never diverge. */
    public async checkSync( accountId : string, target : RegistrationDomain.EntityRef ) : Promise<Type.Result<RegistrationDomain.EntityResult>>
    {
        return this.reconcileOne( accountId, target );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // ── Reconciliation (registration-5.1/5.3) ─────────────────────────────────────────────────

    /**
     * Pull ONE entity's fresh state from TCR, diff it against the local projection, and apply any change
     * through the normal transition path. This is the heart of "the registry is the source of truth": it is
     * called by the poll sweep, by the check&sync endpoint, and after a nudge, and it is the ONLY place that
     * decides the projection was wrong.
     *
     * OVERRIDE HANDLING (registration-11.6): if the row was overridden and TCR now reports something else,
     * TCR wins and the divergence is logged loudly — an override is an audited human note, never a permanent
     * veto over the registry.
     */
    public async reconcileOne( accountId : string, target : RegistrationDomain.EntityRef ) : Promise<Type.Result<RegistrationDomain.EntityResult>>
    {
        const config : RegistrationConfig.Config = await this.config();
        const client : Type.Result<TcrClient> = await this.tcrClient( config );
        if( !client.ok ) return ResultUtils.err( client.error );

        if( target.brandId !== undefined ) return this.reconcileBrand( accountId, target.brandId, client.data );
        if( target.campaignId !== undefined ) return this.reconcileCampaign( accountId, target.campaignId, client.data );
        return ResultUtils.err( "exactly one of brandId/campaignId is required" );
    }

    // read TCR's view of a brand, map its identity status onto ours, and transition if it differs
    private async reconcileBrand( accountId : string, brandId : string, client : TcrClient ) : Promise<Type.Result<RegistrationDomain.EntityResult>>
    {
        const found : Type.Result<Registration.Brand | undefined> = await this.getBrand( accountId, brandId );
        if( !found.ok ) return ResultUtils.err( found.error );
        if( found.data === undefined ) return ResultUtils.err( "brand not found" );
        const brand : Registration.Brand = found.data;
        if( brand.tcrBrandId === undefined ) return ResultUtils.ok( { brand } );   // never submitted — nothing to reconcile against

        const remote : Type.Result<Record<string, unknown>> = await client.getBrand( brand.tcrBrandId );
        if( !remote.ok ) return ResultUtils.err( `TCR brand read failed: ${ remote.error }` );

        // mirror the vetting-derived fields unconditionally — they are TCR's to own, not ours to negotiate
        const identityStatus : string | undefined = TcrClient.readString( remote.data, "identityStatus" );
        const mirrored : Registration.Brand =
        {
            ...brand,
            identityStatus,
            vettingClass: TcrClient.readString( remote.data, "vettingClass" ) ?? brand.vettingClass,
            vettingScore: TcrClient.readNumber( remote.data, "vettingScore" ) ?? brand.vettingScore,
            updatedAt:    new Date().toISOString(),
        };
        const wrote : Type.Result<void> = await this.putBrand( mirrored );
        if( !wrote.ok ) return ResultUtils.err( wrote.error );

        const remoteStatus : Registration.BrandStatus | undefined = RegistrationDomain.brandStatusFromIdentity( identityStatus );
        if( remoteStatus === undefined || remoteStatus === brand.status ) return ResultUtils.ok( { brand: mirrored } );

        // TCR disagrees with us — TCR wins, and an override it contradicts is re-flagged, never honoured
        if( brand.overridden ) this.deps.log.warn( "override contradicted by TCR — re-flagging (TCR is the source of truth)", { accountId, brandId, overriddenTo: brand.status, tcrSays: remoteStatus } );
        const moved : Type.Result<Registration.Brand> = await this.transitionBrandStatus( accountId, brandId, remoteStatus, "reconciled from TCR", brand.overridden === true );
        if( !moved.ok ) return ResultUtils.err( moved.error );
        return ResultUtils.ok( { brand: moved.data } );
    }

    // read TCR's view of a campaign (status + per-MNO rollup) and transition if it differs
    private async reconcileCampaign( accountId : string, campaignId : string, client : TcrClient ) : Promise<Type.Result<RegistrationDomain.EntityResult>>
    {
        const found : Type.Result<Registration.Campaign | undefined> = await this.getCampaign( accountId, campaignId );
        if( !found.ok ) return ResultUtils.err( found.error );
        if( found.data === undefined ) return ResultUtils.err( "campaign not found" );
        const campaign : Registration.Campaign = found.data;
        if( campaign.tcrCampaignId === undefined ) return ResultUtils.ok( { campaign } );

        const remote : Type.Result<Record<string, unknown>> = await client.getCampaign( campaign.tcrCampaignId );
        if( !remote.ok ) return ResultUtils.err( `TCR campaign read failed: ${ remote.error }` );

        // the per-MNO rollup is a separate TCR call; a miss there is NOT fatal to the status reconcile
        const operations : Type.Result<Record<string, unknown>> = await client.getOperationStatus( campaign.tcrCampaignId );
        const operationsStatus : Registration.OperationsStatus | undefined = operations.ok
            ? RegistrationDomain.operationsStatusOf( operations.data )
            : campaign.operationsStatus;

        const mirrored : Registration.Campaign =
        {
            ...campaign,
            operationsStatus,
            mnoMetadata: operations.ok ? operations.data : campaign.mnoMetadata,
            updatedAt:   new Date().toISOString(),
        };
        const wrote : Type.Result<void> = await this.putCampaign( mirrored );
        if( !wrote.ok ) return ResultUtils.err( wrote.error );

        const remoteStatus : Registration.CampaignStatus | undefined = RegistrationDomain.campaignStatusFromRemote( remote.data );
        if( remoteStatus === undefined || remoteStatus === campaign.status ) return ResultUtils.ok( { campaign: mirrored } );

        if( campaign.overridden ) this.deps.log.warn( "override contradicted by TCR — re-flagging (TCR is the source of truth)", { accountId, campaignId, overriddenTo: campaign.status, tcrSays: remoteStatus } );
        const moved : Type.Result<Registration.Campaign> = await this.transitionCampaignStatus( accountId, campaignId, remoteStatus, "reconciled from TCR", campaign.overridden === true );
        if( !moved.ok ) return ResultUtils.err( moved.error );
        return ResultUtils.ok( { campaign: moved.data } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // ── Webhook processing (registration-5.2 — runs in the JOB, not the intake role) ──────────

    /**
     * Apply one verified TCR callback to the projection.
     *
     * EVENT-MAPPING CAVEAT: TCR's exact webhook payload/vocabulary isn't verifiable from inside this repo, so
     * the `TcrEvent` enum below encodes the documented event names as understood from the legacy integration
     * this service's requirements were mined from. The MAPPING (which event drives which transition) is the
     * part that matters and is spelled out one case per line; if a real payload turns out to use a different
     * literal, only the enum values change, not the state machine.
     *
     * IDEMPOTENT: SQS is at-least-once, so every branch either re-applies a self-transition (allowed, a no-op
     * re-confirmation) or is guarded by the state machine.
     */
    public async processTcrWebhook( payload : Record<string, unknown> ) : Promise<Type.Result<void>>
    {
        const event : string | undefined = TcrClient.readString( payload, "eventType" ) ?? TcrClient.readString( payload, "event" );
        if( event === undefined ) return ResultUtils.err( "TCR webhook carried no eventType" );

        // resolve the affected row from TCR's OWN ids (the callback has no accountId)
        const tcrBrandId : string | undefined = TcrClient.readString( payload, "brandId" );
        const tcrCampaignId : string | undefined = TcrClient.readString( payload, "campaignId" );
        const reason : string | undefined = TcrClient.readString( payload, "description" ) ?? TcrClient.readString( payload, "explanation" );

        switch( event as RegistrationDomain.TcrEvent )
        {
            // the brand leg — BRAND_ADD only CONFIRMS the submission TCR already accepted; the real verdict
            // arrives on BRAND_IDENTITY_STATUS_UPDATE
            case RegistrationDomain.TcrEvent.BRAND_ADD:
                return this.applyBrandEvent( tcrBrandId, Registration.BrandStatus.SUBMITTED, "TCR confirmed brand submission" );

            case RegistrationDomain.TcrEvent.BRAND_IDENTITY_STATUS_UPDATE:
            {
                const identity : string | undefined = TcrClient.readString( payload, "identityStatus" );
                const mapped : Registration.BrandStatus | undefined = RegistrationDomain.brandStatusFromIdentity( identity );
                if( mapped === undefined ) return ResultUtils.err( `unmapped TCR identityStatus "${ identity ?? "" }"` );
                return this.applyBrandEvent( tcrBrandId, mapped, reason ?? `TCR identity status: ${ identity ?? "" }` );
            }

            // the campaign leg — submission accepted, then the DCA share dance, then per-MNO completion
            case RegistrationDomain.TcrEvent.CAMPAIGN_ADD:
                return this.applyCampaignEvent( tcrCampaignId, Registration.CampaignStatus.SUBMITTED, "TCR confirmed campaign submission" );

            case RegistrationDomain.TcrEvent.CAMPAIGN_SHARE_ACCEPT:
                return this.applyCampaignEvent( tcrCampaignId, Registration.CampaignStatus.IN_REVIEW, "downstream connectivity partner accepted the share" );

            case RegistrationDomain.TcrEvent.CAMPAIGN_SHARE_DELETE:
                return this.applyCampaignEvent( tcrCampaignId, Registration.CampaignStatus.REJECTED, reason ?? "the downstream connectivity partner withdrew the share" );

            // APPROVED is where carrier provisioning kicks off — see applyDcaComplete
            case RegistrationDomain.TcrEvent.CAMPAIGN_DCA_COMPLETE:
                return this.applyDcaComplete( tcrCampaignId );

            case RegistrationDomain.TcrEvent.CAMPAIGN_BILLED:
                return this.applyCampaignBilled( tcrCampaignId );

            case RegistrationDomain.TcrEvent.CAMPAIGN_EXPIRED:
                return this.applyCampaignEvent( tcrCampaignId, Registration.CampaignStatus.EXPIRED, reason ?? "TCR reported the campaign expired" );

            case RegistrationDomain.TcrEvent.DCA_CAMPAIGN_OPERATION_SUSPENDED:
                return this.applyCampaignEvent( tcrCampaignId, Registration.CampaignStatus.SUSPENDED, reason ?? "a carrier suspended campaign operations" );

            default:
                // an unknown event is NOT an error — TCR adds events over time and a hard failure here would
                // dead-letter perfectly valid traffic. Log it so the gap is visible, then ack.
                this.deps.log.info( "TCR webhook ignored — unmapped event", { event } );
                return ResultUtils.ok( undefined );
        }
    }

    /**
     * Apply one verified Campaign Verify callback to the brand's vetting leg.
     *
     * Same mapping caveat as {@link processTcrWebhook}. CV drives the PIN sub-flow of `Registration.
     * BrandStatus` (PIN_SENT → PIN_INPUTTED → APPROVED) plus the only path that reaches `FAILED` — an EVP
     * scoring failure routes to NEEDS_APPEAL instead, per the enum's own documented rule.
     */
    public async processCvWebhook( payload : Record<string, unknown> ) : Promise<Type.Result<void>>
    {
        const status : string | undefined = TcrClient.readString( payload, "status" ) ?? TcrClient.readString( payload, "eventType" );
        const cvId : string | undefined = TcrClient.readString( payload, "cvId" ) ?? TcrClient.readString( payload, "verificationId" );
        if( status === undefined ) return ResultUtils.err( "Campaign Verify webhook carried no status" );
        if( cvId === undefined ) return ResultUtils.err( "Campaign Verify webhook carried no verification id" );

        // CV identifies the brand by ITS id, which we mirrored onto `Brand.cvId` when the verification opened
        const brand : Type.Result<Registration.Brand | undefined> = await this.brandByCvId( cvId );
        if( !brand.ok ) return ResultUtils.err( brand.error );
        if( brand.data === undefined ) { this.deps.log.warn( "Campaign Verify webhook for an unknown verification", { cvId } ); return ResultUtils.ok( undefined ); }

        // mirror CV's own status string before mapping — it's surfaced verbatim on the vetting-status read
        const mirrored : Registration.Brand = { ...brand.data, cvStatus: status, vettingProvider: Registration.VettingProvider.CV, updatedAt: new Date().toISOString() };
        const wrote : Type.Result<void> = await this.putBrand( mirrored );
        if( !wrote.ok ) return ResultUtils.err( wrote.error );

        const mapped : Registration.BrandStatus | undefined = RegistrationDomain.brandStatusFromCv( status );
        if( mapped === undefined ) { this.deps.log.info( "Campaign Verify webhook ignored — unmapped status", { status } ); return ResultUtils.ok( undefined ); }

        const moved : Type.Result<Registration.Brand> = await this.transitionBrandStatus(
            mirrored.accountId, mirrored.brandId as string, mapped, `Campaign Verify: ${ status }` );
        return moved.ok ? ResultUtils.ok( undefined ) : ResultUtils.err( moved.error );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // ── Submit-queue plumbing ─────────────────────────────────────────────────────────────────

    /** Drop a submit/resubmit/reprovision request onto the `registration-submit` queue. Every external,
     *  slow, retryable registration write goes through here rather than running in a request handler. */
    public async enqueueSubmit( message : RegistrationDomain.SubmitMessage ) : Promise<Type.Result<string>>
    {
        const jobId : string = message.jobId ?? randomUUID();
        const sent : Type.Result<void> = await this.deps.sqs.send( "registration-submit", { ...message, jobId } );
        if( !sent.ok ) return ResultUtils.err( sent.error );
        this.deps.log.trace( "message enqueued (SQS registration-submit)", { jobId, kind: message.kind, accountId: message.accountId } );
        return ResultUtils.ok( jobId );
    }

    /** WORKER: execute one queued submit/resubmit/reprovision. Idempotent by virtue of the state machine —
     *  a redelivered SUBMIT for an already-submitted entity fails its transition guard and is logged, not
     *  re-pushed to TCR. */
    public async processSubmit( message : RegistrationDomain.SubmitMessage ) : Promise<Type.Result<void>>
    {
        switch( message.kind )
        {
            case RegistrationDomain.SubmitKind.SUBMIT:
            case RegistrationDomain.SubmitKind.RESUBMIT:
            {
                if( message.brandId !== undefined )
                {
                    const done : Type.Result<Registration.Brand> = await this.submitBrand( message.accountId, message.brandId );
                    return done.ok ? ResultUtils.ok( undefined ) : ResultUtils.err( done.error );
                }
                if( message.campaignId !== undefined )
                {
                    const done : Type.Result<Registration.Campaign> = await this.submitCampaign( message.accountId, message.campaignId );
                    return done.ok ? ResultUtils.ok( undefined ) : ResultUtils.err( done.error );
                }
                return ResultUtils.err( "submit message names neither a brand nor a campaign" );
            }

            case RegistrationDomain.SubmitKind.REPROVISION:
            {
                if( message.campaignId === undefined ) return ResultUtils.err( "reprovision message names no campaign" );
                // top the campaign back up to at least one line; an explicit count wins when given
                const done : Type.Result<Registration.Campaign> = await this.provisionNumbers(
                    message.accountId, message.campaignId, message.count ?? 1, message.provider, message.areaCode );
                return done.ok ? ResultUtils.ok( undefined ) : ResultUtils.err( done.error );
            }

            default:
                return ResultUtils.err( `unknown submit kind "${ String( message.kind ) }"` );
        }
    }

    /** WORKER: execute one queued vetting refresh (registration-11.3) — order the EVP run at TCR (or open a
     *  Campaign Verify verification for a political brand), mirror the resulting score, and re-publish the
     *  trust-score → MPS if it moved materially. */
    public async processVetting( accountId : string, brandId : string ) : Promise<Type.Result<void>>
    {
        const found : Type.Result<Registration.Brand | undefined> = await this.getBrand( accountId, brandId );
        if( !found.ok ) return ResultUtils.err( found.error );
        if( found.data === undefined ) return ResultUtils.err( "brand not found" );
        const brand : Registration.Brand = found.data;
        if( brand.tcrBrandId === undefined ) return ResultUtils.err( "the brand has no TCR id yet — it cannot be vetted" );

        const config : RegistrationConfig.Config = await this.config();
        const previousScore : number | undefined = brand.vettingScore;

        // a POLITICAL brand vets through Campaign Verify (whose result is bridged into TCR); everything else
        // goes through TCR's own EVP partners
        const isPolitical : boolean = brand.vertical === Registration.Vertical.POLITICAL || brand.politicalType !== undefined;
        const provider : Registration.VettingProvider = isPolitical ? Registration.VettingProvider.CV : Registration.VettingProvider.AEGIS;

        const ordered : Type.Result<Record<string, unknown>> = isPolitical
            ? await this.orderCvVetting( brand, config )
            : await this.orderTcrVetting( brand, config, provider );
        if( !ordered.ok ) return ResultUtils.err( ordered.error );

        // mirror whatever the provider returned; a pending run simply carries no score yet
        const score : number | undefined = TcrClient.readNumber( ordered.data, "vettingScore" );
        const updated : Registration.Brand =
        {
            ...brand,
            vettingProvider: provider,
            vettingClass:    TcrClient.readString( ordered.data, "vettingClass" ) ?? brand.vettingClass,
            vettingScore:    score ?? brand.vettingScore,
            cvId:            isPolitical ? TcrClient.readString( ordered.data, "cvId" ) ?? brand.cvId : brand.cvId,
            updatedAt:       new Date().toISOString(),
        };
        const wrote : Type.Result<void> = await this.putBrand( updated );
        if( !wrote.ok ) return ResultUtils.err( wrote.error );
        await this.emitBrand( Events.Verb.UPDATED, updated );

        // the vetting charge point (billing STUB)
        const estimated : Type.Result<Registration.CostEstimate> = await this.estimateCost( {
            accountId, brandId, vettingProvider: provider,
            kind: Registration.CostEstimateKind.VETTING, description: `brand vetting (${ provider })`,
        } );
        if( !estimated.ok ) this.deps.log.warn( "vetting cost estimate not recorded", { accountId, brandId, error: estimated.error } );

        // registration-7.2 — a MATERIALLY different score changes allowed throughput, so re-publish every
        // campaign under this brand. "Materially" = the score crosses into a different MPS tier, not merely
        // any numeric change, so a one-point drift doesn't spam dispatch with re-pacing events.
        if( RegistrationDomain.tierOf( previousScore ) !== RegistrationDomain.tierOf( updated.vettingScore ) )
            await this.republishThroughput( updated );

        return ResultUtils.ok( undefined );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // ── Poll sweep support (registration-5.3) ─────────────────────────────────────────────────

    /** The in-flight brands whose `nextPollAt` is due — the sweep's candidate set. A row with no
     *  `nextPollAt` is either terminal or was never submitted; either way the sweep leaves it alone. */
    public async dueBrands( now : Date = new Date() ) : Promise<Type.Result<Array<Registration.Brand>>>
    {
        const all : Type.Result<Array<Registration.Brand>> = await this.scanBrands();
        if( !all.ok ) return all;
        const due : Array<Registration.Brand> = all.data
            .filter( ( brand : Registration.Brand ) : boolean => !RegistrationStateMachine.isBrandTerminal( brand.status ) )
            .filter( ( brand : Registration.Brand ) : boolean => brand.nextPollAt !== undefined && brand.nextPollAt <= now.toISOString() );
        return ResultUtils.ok( due );
    }

    /** The in-flight campaigns whose `nextPollAt` is due — the sweep's other candidate set. */
    public async dueCampaigns( now : Date = new Date() ) : Promise<Type.Result<Array<Registration.Campaign>>>
    {
        const all : Type.Result<Array<Registration.Campaign>> = await this.scanCampaigns();
        if( !all.ok ) return all;
        const due : Array<Registration.Campaign> = all.data
            .filter( ( campaign : Registration.Campaign ) : boolean => !RegistrationStateMachine.isCampaignTerminal( campaign.status ) )
            .filter( ( campaign : Registration.Campaign ) : boolean => campaign.nextPollAt !== undefined && campaign.nextPollAt <= now.toISOString() );
        return ResultUtils.ok( due );
    }

    /** Cross-check every ACTIVE campaign's numbers against the carrier's own pairing view — the drift check
     *  that catches a line silently falling off its campaign. Returns the numbers the carrier disowns. */
    public async detectNumberDrift( campaign : Registration.Campaign ) : Promise<Type.Result<Array<string>>>
    {
        const config : RegistrationConfig.Config = await this.config();
        const carrier : Type.Result<RegistrationDomain.ResolvedCarrier> = await this.carrierFor( campaign.provider, config );
        if( !carrier.ok ) return ResultUtils.err( carrier.error );

        const drifted : Array<string> = [];
        for( const phoneNumber of campaign.phoneNumbers )
        {
            const paired : Type.Result<CarrierPairingStatus> = await carrier.data.adapter.checkPairingStatus( phoneNumber, carrier.data.context );
            // a carrier we can't reach is NOT evidence of drift — skip it rather than reporting a false positive
            if( !paired.ok ) { this.deps.log.warn( "pairing check failed — treating as unknown, not drifted", { phoneNumber, error: paired.error } ); continue; }
            if( paired.data === CarrierPairingStatus.INVALID ) drifted.push( phoneNumber );
        }
        return ResultUtils.ok( drifted );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // ── Phone number acquisition (registration-4.x extension) ────────────────────────────────
    // Standalone search/order/release for LONG_CODE + TOLL_FREE, toll-free verification, and the short-code
    // application record. Distinct from `provisionNumbers`' campaign-embedded bulk array above — see
    // `PhoneNumber.ts`'s header for why a second, standalone entity exists alongside it.

    /** One owned number by our own id. */
    public async getNumber( accountId : string, id : string ) : Promise<Type.Result<PhoneNumber.PhoneNumber | undefined>>
    {
        return this.deps.dynamo.get<PhoneNumber.PhoneNumber>( "registration_number", { accountId, id } );
    }

    /** Every number on one account's partition. */
    public async listNumbers( accountId : string ) : Promise<Type.Result<Array<PhoneNumber.PhoneNumber>>>
    {
        return this.deps.dynamo.query<PhoneNumber.PhoneNumber>( "registration_number", {
            KeyConditionExpression: "accountId = :account", ExpressionAttributeValues: { ":account": accountId },
        } );
    }

    /** EVERY number across every account — the poll sweep's candidate set (mirrors `scanBrands`/`scanCampaigns`). */
    public async scanNumbers() : Promise<Type.Result<Array<PhoneNumber.PhoneNumber>>>
    {
        return ResultUtils.from( async () : Promise<Array<PhoneNumber.PhoneNumber>> =>
        {
            const output : ScanCommandOutput = await this.deps.dynamo.client.send( new ScanCommand( { TableName: this.deps.dynamo.table( "registration_number" ) } ) );
            return ( output.Items ?? [] ) as Array<PhoneNumber.PhoneNumber>;
        } );
    }

    /** Persist a number row (create or full replace). */
    public async putNumber( number : PhoneNumber.PhoneNumber ) : Promise<Type.Result<void>>
    {
        const wrote : Type.Result<void> = await this.deps.dynamo.put( "registration_number", { ...number } );
        if( !wrote.ok ) this.deps.log.warn( "number write failed", { accountId: number.accountId, id: number.id, error: wrote.error } );
        else this.deps.log.trace( "item stored: registration_number", { accountId: number.accountId, id: number.id, status: number.status } );
        return wrote;
    }

    /** Publish a `registration.number` event for a STANDALONE number row — a distinct data shape from
     *  `emitNumbers`' campaign-embedded rows above (see EVENTS.md); the future bridge into `Texting.NumberRecord`. */
    public async emitNumber( verb : Events.Verb, number : PhoneNumber.PhoneNumber ) : Promise<void>
    {
        const envelope : Events.Envelope = Events.envelope( {
            object: Events.Object.REGISTRATION_NUMBER, verb, accountId: number.accountId,
            target: { type: "registration.number", id: number.id }, data: number,
        } );
        const published : Type.Result<void> = await this.deps.kafka.publishEvent( envelope );
        if( !published.ok ) this.deps.log.warn( "registration.number event publish failed", { id: number.id, verb, error: published.error } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Search a carrier's available-number inventory (LONG_CODE/TOLL_FREE only) — read-only, nothing committed. */
    public async searchNumbers( numberType : Texting.NumberType, carrierProvider : Registration.CarrierProvider,
                                criteria : { areaCode? : string; contains? : string; limit? : number } ) : Promise<Type.Result<Array<AvailableNumber>>>
    {
        const config : RegistrationConfig.Config = await this.config();
        const carrier : Type.Result<RegistrationDomain.ResolvedCarrier> = await this.carrierFor( carrierProvider, config );
        if( !carrier.ok ) return ResultUtils.err( carrier.error );
        return carrier.data.adapter.searchAvailableNumbers( { type: numberType, ...criteria }, carrier.data.context );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Order ONE specific searched number. A LONG_CODE order REQUIRES an already-approved campaign to bind
     *  to (the carrier won't sell one without it); TOLL_FREE needs none (its own TFV is separate). The row is
     *  persisted (and a `registration.number` CREATED published) whether the carrier call succeeds OR fails —
     *  a FAILED row is real audit history, not noise. */
    public async orderNumber( accountId : string, number : Type.PhoneE164, numberType : Texting.NumberType,
                              carrierProvider : Registration.CarrierProvider, campaignId? : string ) : Promise<Type.Result<PhoneNumber.PhoneNumber>>
    {
        if( numberType === Texting.NumberType.LONG_CODE )
        {
            if( campaignId === undefined ) return ResultUtils.err( "a long-code order requires an approved campaignId" );
            const campaign : Type.Result<Registration.Campaign | undefined> = await this.getCampaign( accountId, campaignId );
            if( !campaign.ok ) return ResultUtils.err( campaign.error );
            if( campaign.data === undefined ) return ResultUtils.err( "campaign not found" );
            const approved : boolean = [ Registration.CampaignStatus.APPROVED, Registration.CampaignStatus.NUMBER_ASSOCIATED, Registration.CampaignStatus.ACTIVE ].includes( campaign.data.status );
            if( !approved ) return ResultUtils.err( "the campaign is not approved" );
        }

        const config : RegistrationConfig.Config = await this.config();
        const carrier : Type.Result<RegistrationDomain.ResolvedCarrier> = await this.carrierFor( carrierProvider, config );
        if( !carrier.ok ) return ResultUtils.err( carrier.error );

        const now : string = new Date().toISOString();
        const ordered : Type.Result<OrderedNumber> = await carrier.data.adapter.orderNumber( number, { type: numberType }, carrier.data.context );

        const row : PhoneNumber.PhoneNumber =
        {
            id: randomUUID(), accountId, number: ordered.ok ? ordered.data.number : undefined, numberType, carrier: carrierProvider,
            carrierOrderId: ordered.ok ? ordered.data.carrierOrderId : undefined,
            status: ordered.ok ? PhoneNumber.OrderStatus.ACTIVE : PhoneNumber.OrderStatus.FAILED,
            campaignId, failureReason: ordered.ok ? undefined : ordered.error,
            orderedAt: now, activatedAt: ordered.ok ? now : undefined,
        };
        const wrote : Type.Result<void> = await this.putNumber( row );
        if( !wrote.ok ) return ResultUtils.err( wrote.error );
        await this.emitNumber( Events.Verb.CREATED, row );

        if( !ordered.ok ) return ResultUtils.err( `carrier order failed: ${ ordered.error }` );
        return ResultUtils.ok( row );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Release an owned number back to the carrier — idempotent (an already-RELEASED row is a success, not
     *  an error). Reuses the ORIGINAL `CarrierProvider.releaseNumber` (still a scaffold on the real carriers —
     *  a pre-existing, separate gap; only `FakeCarrierAdapter` actually releases anything today). */
    public async releaseNumber( accountId : string, id : string ) : Promise<Type.Result<PhoneNumber.PhoneNumber>>
    {
        const found : Type.Result<PhoneNumber.PhoneNumber | undefined> = await this.getNumber( accountId, id );
        if( !found.ok ) return ResultUtils.err( found.error );
        if( found.data === undefined ) return ResultUtils.err( "number not found" );
        const number : PhoneNumber.PhoneNumber = found.data;
        if( number.status === PhoneNumber.OrderStatus.RELEASED ) return ResultUtils.ok( number );

        const config : RegistrationConfig.Config = await this.config();
        const carrier : Type.Result<RegistrationDomain.ResolvedCarrier> = await this.carrierFor( number.carrier, config );
        if( !carrier.ok ) return ResultUtils.err( carrier.error );

        if( number.number !== undefined )
        {
            const released : Type.Result<void> = await carrier.data.adapter.releaseNumber( number.number, carrier.data.context );
            if( !released.ok ) return ResultUtils.err( `carrier release failed: ${ released.error }` );
        }

        const updated : PhoneNumber.PhoneNumber = { ...number, status: PhoneNumber.OrderStatus.RELEASED, releasedAt: new Date().toISOString() };
        const wrote : Type.Result<void> = await this.putNumber( updated );
        if( !wrote.ok ) return ResultUtils.err( wrote.error );
        await this.emitNumber( Events.Verb.UPDATED, updated );
        return ResultUtils.ok( updated );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Submit toll-free verification for an owned TOLL_FREE number. Async by nature — this only reports
     *  whether the SUBMISSION reached the carrier; the real decision (VERIFIED/REJECTED) needs a carrier
     *  webhook (an unverified per-carrier payload shape today — see the adapters' own headers) or a staff
     *  correction. The poll sweep (`reconcileNumber`) only surfaces the row as still outstanding — a stated
     *  gap, not a silent one. */
    public async submitTollFreeVerification( accountId : string, id : string,
                                             details : Omit<PhoneNumber.TollFreeVerification, "status" | "submittedAt" | "decidedAt" | "rejectionReason"> ) : Promise<Type.Result<PhoneNumber.PhoneNumber>>
    {
        const found : Type.Result<PhoneNumber.PhoneNumber | undefined> = await this.getNumber( accountId, id );
        if( !found.ok ) return ResultUtils.err( found.error );
        if( found.data === undefined ) return ResultUtils.err( "number not found" );
        const number : PhoneNumber.PhoneNumber = found.data;
        if( number.numberType !== Texting.NumberType.TOLL_FREE ) return ResultUtils.err( "toll-free verification only applies to toll-free numbers" );
        if( number.number === undefined ) return ResultUtils.err( "the number is not yet active" );

        const config : RegistrationConfig.Config = await this.config();
        const carrier : Type.Result<RegistrationDomain.ResolvedCarrier> = await this.carrierFor( number.carrier, config );
        if( !carrier.ok ) return ResultUtils.err( carrier.error );

        const now : string = new Date().toISOString();
        const tollFreeVerification : PhoneNumber.TollFreeVerification = { ...details, status: PhoneNumber.TfvStatus.SUBMITTED, submittedAt: now };
        const submitted : Type.Result<void> = await carrier.data.adapter.submitTollFreeVerification( number.number, tollFreeVerification, carrier.data.context );
        if( !submitted.ok ) return ResultUtils.err( `carrier TFV submit failed: ${ submitted.error }` );

        const updated : PhoneNumber.PhoneNumber =
        {
            ...number, tollFreeVerification,
            nextPollAt: RegistrationStateMachine.nextPollAt( config.pollSweep, 0 ), pollAttempts: 0,
        };
        const wrote : Type.Result<void> = await this.putNumber( updated );
        if( !wrote.ok ) return ResultUtils.err( wrote.error );
        await this.emitNumber( Events.Verb.UPDATED, updated );
        return ResultUtils.ok( updated );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // ── Number poll sweep support (registration-4.x) ──────────────────────────────────────────

    /** Numbers with an in-flight TFV whose `nextPollAt` is due — the sweep's candidate set. */
    public async dueNumbers( now : Date = new Date() ) : Promise<Type.Result<Array<PhoneNumber.PhoneNumber>>>
    {
        const all : Type.Result<Array<PhoneNumber.PhoneNumber>> = await this.scanNumbers();
        if( !all.ok ) return all;
        const due : Array<PhoneNumber.PhoneNumber> = all.data
            .filter( ( number : PhoneNumber.PhoneNumber ) : boolean => number.nextPollAt !== undefined && number.nextPollAt <= now.toISOString() );
        return ResultUtils.ok( due );
    }

    /** Reconcile ONE in-flight number row. NO carrier adapter exposes a verified TFV status-check call today
     *  (see the adapters' headers) — this can't auto-resolve VERIFIED/REJECTED, so it backs off `nextPollAt`
     *  and logs the row as still outstanding rather than fabricating a decision. */
    public async reconcileNumber( accountId : string, id : string ) : Promise<Type.Result<void>>
    {
        const found : Type.Result<PhoneNumber.PhoneNumber | undefined> = await this.getNumber( accountId, id );
        if( !found.ok ) return ResultUtils.err( found.error );
        if( found.data === undefined ) return ResultUtils.err( "number not found" );
        const number : PhoneNumber.PhoneNumber = found.data;

        const config : RegistrationConfig.Config = await this.config();
        const attempts : number = ( number.pollAttempts ?? 0 ) + 1;
        const updated : PhoneNumber.PhoneNumber = { ...number, nextPollAt: RegistrationStateMachine.nextPollAt( config.pollSweep, attempts ), pollAttempts: attempts };
        const wrote : Type.Result<void> = await this.putNumber( updated );
        if( !wrote.ok ) return ResultUtils.err( wrote.error );
        this.deps.log.trace( "number TFV still outstanding — no carrier status-check available, backing off", { accountId, id, attempts } );
        return ResultUtils.ok( undefined );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // ── Short-code application (registration-4.x) ─────────────────────────────────────────────
    // No carrier exposes a self-serve short-code ORDER api (verified — see PhoneNumber.ts) — this is a
    // staff-progressed application record, not a carrier-driven state machine.

    /** One application by our own id. */
    public async getShortCodeApplication( accountId : string, id : string ) : Promise<Type.Result<PhoneNumber.ShortCodeApplication | undefined>>
    {
        return this.deps.dynamo.get<PhoneNumber.ShortCodeApplication>( "registration_shortcode", { accountId, id } );
    }

    /** Every application on one account's partition. */
    public async listShortCodeApplications( accountId : string ) : Promise<Type.Result<Array<PhoneNumber.ShortCodeApplication>>>
    {
        return this.deps.dynamo.query<PhoneNumber.ShortCodeApplication>( "registration_shortcode", {
            KeyConditionExpression: "accountId = :account", ExpressionAttributeValues: { ":account": accountId },
        } );
    }

    /** Persist an application row (create or full replace). */
    public async putShortCodeApplication( application : PhoneNumber.ShortCodeApplication ) : Promise<Type.Result<void>>
    {
        const wrote : Type.Result<void> = await this.deps.dynamo.put( "registration_shortcode", { ...application } );
        if( !wrote.ok ) this.deps.log.warn( "short-code application write failed", { accountId: application.accountId, id: application.id, error: wrote.error } );
        return wrote;
    }

    /** Publish a `registration.shortcode` lifecycle event. */
    public async emitShortCodeApplication( verb : Events.Verb, application : PhoneNumber.ShortCodeApplication ) : Promise<void>
    {
        const envelope : Events.Envelope = Events.envelope( {
            object: Events.Object.REGISTRATION_SHORTCODE, verb, accountId: application.accountId,
            target: { type: "registration.shortcode", id: application.id }, data: application,
        } );
        const published : Type.Result<void> = await this.deps.kafka.publishEvent( envelope );
        if( !published.ok ) this.deps.log.warn( "registration.shortcode event publish failed", { id: application.id, verb, error: published.error } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Submit a short-code request — lands SUBMITTED for staff to progress (`patchShortCodeApplication`);
     *  there is no carrier call to make here (see the class-level note above). */
    public async submitShortCodeApplication( accountId : string,
                                             fields : { preference : PhoneNumber.ShortCodePreference; vanityCode? : string; useCase : string; campaignId? : string } ) : Promise<Type.Result<PhoneNumber.ShortCodeApplication>>
    {
        if( fields.preference === PhoneNumber.ShortCodePreference.VANITY && !fields.vanityCode )
            return ResultUtils.err( "a vanityCode is required when preference is vanity" );

        const now : string = new Date().toISOString();
        const application : PhoneNumber.ShortCodeApplication =
        {
            id: randomUUID(), accountId, preference: fields.preference, vanityCode: fields.vanityCode,
            useCase: fields.useCase, campaignId: fields.campaignId, status: PhoneNumber.ShortCodeStatus.SUBMITTED, submittedAt: now,
        };
        const wrote : Type.Result<void> = await this.putShortCodeApplication( application );
        if( !wrote.ok ) return ResultUtils.err( wrote.error );
        await this.emitShortCodeApplication( Events.Verb.CREATED, application );
        return ResultUtils.ok( application );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Staff-progressed status update — the only way a short-code application moves once submitted (no
     *  carrier webhook exists). Sets `decidedAt` on entry to a terminal status (ACTIVE/REJECTED). */
    public async patchShortCodeApplication( accountId : string, id : string, status : PhoneNumber.ShortCodeStatus,
                                            shortCode? : string, staffNote? : string ) : Promise<Type.Result<PhoneNumber.ShortCodeApplication>>
    {
        const found : Type.Result<PhoneNumber.ShortCodeApplication | undefined> = await this.getShortCodeApplication( accountId, id );
        if( !found.ok ) return ResultUtils.err( found.error );
        if( found.data === undefined ) return ResultUtils.err( "short-code application not found" );

        const terminal : boolean = status === PhoneNumber.ShortCodeStatus.ACTIVE || status === PhoneNumber.ShortCodeStatus.REJECTED;
        const updated : PhoneNumber.ShortCodeApplication =
        {
            ...found.data, status, shortCode: shortCode ?? found.data.shortCode, staffNote: staffNote ?? found.data.staffNote,
            decidedAt: terminal ? new Date().toISOString() : found.data.decidedAt,
        };
        const wrote : Type.Result<void> = await this.putShortCodeApplication( updated );
        if( !wrote.ok ) return ResultUtils.err( wrote.error );
        await this.emitShortCodeApplication( Events.Verb.UPDATED, updated );
        return ResultUtils.ok( updated );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // ── Internals ─────────────────────────────────────────────────────────────────────────────

    // resolve a brand from Campaign Verify's own id (mirrored onto Brand.cvId when the verification opened).
    // A scan is acceptable here: CV callbacks are rare (political brands only) and the brand table is one row
    // per registered account — unlike TCR's callbacks, which get a dedicated GSI because they're the hot path.
    private async brandByCvId( cvId : string ) : Promise<Type.Result<Registration.Brand | undefined>>
    {
        const all : Type.Result<Array<Registration.Brand>> = await this.scanBrands();
        if( !all.ok ) return ResultUtils.err( all.error );
        return ResultUtils.ok( all.data.find( ( brand : Registration.Brand ) : boolean => brand.cvId === cvId ) );
    }

    // apply a TCR brand-scoped event: resolve the row from TCR's id, then transition (an illegal edge is
    // logged rather than failed — TCR may legitimately re-send an event we've already applied)
    private async applyBrandEvent( tcrBrandId : string | undefined, to : Registration.BrandStatus, reason : string ) : Promise<Type.Result<void>>
    {
        if( tcrBrandId === undefined ) return ResultUtils.err( "TCR brand event carried no brandId" );
        const found : Type.Result<Registration.Brand | undefined> = await this.brandByTcrId( tcrBrandId );
        if( !found.ok ) return ResultUtils.err( found.error );
        if( found.data === undefined ) { this.deps.log.warn( "TCR webhook for an unknown brand", { tcrBrandId } ); return ResultUtils.ok( undefined ); }

        const moved : Type.Result<Registration.Brand> = await this.transitionBrandStatus( found.data.accountId, found.data.brandId as string, to, reason );
        if( !moved.ok ) { this.deps.log.warn( "TCR brand event not applied", { tcrBrandId, to, error: moved.error } ); }
        return ResultUtils.ok( undefined );
    }

    // apply a TCR campaign-scoped event — the campaign twin of applyBrandEvent
    private async applyCampaignEvent( tcrCampaignId : string | undefined, to : Registration.CampaignStatus, reason : string ) : Promise<Type.Result<void>>
    {
        if( tcrCampaignId === undefined ) return ResultUtils.err( "TCR campaign event carried no campaignId" );
        const found : Type.Result<Registration.Campaign | undefined> = await this.campaignByTcrId( tcrCampaignId );
        if( !found.ok ) return ResultUtils.err( found.error );
        if( found.data === undefined ) { this.deps.log.warn( "TCR webhook for an unknown campaign", { tcrCampaignId } ); return ResultUtils.ok( undefined ); }

        const moved : Type.Result<Registration.Campaign> = await this.transitionCampaignStatus( found.data.accountId, found.data.campaignId as string, to, reason );
        if( !moved.ok ) { this.deps.log.warn( "TCR campaign event not applied", { tcrCampaignId, to, error: moved.error } ); }
        return ResultUtils.ok( undefined );
    }

    // CAMPAIGN_DCA_COMPLETE is the pivot event: the campaign is APPROVED at every MNO, which is the
    // precondition for carrier number provisioning (registration-4.1). Move to APPROVED, then immediately
    // queue the provisioning rather than doing it inline — it's one or more external carrier calls.
    private async applyDcaComplete( tcrCampaignId : string | undefined ) : Promise<Type.Result<void>>
    {
        if( tcrCampaignId === undefined ) return ResultUtils.err( "TCR DCA-complete event carried no campaignId" );
        const found : Type.Result<Registration.Campaign | undefined> = await this.campaignByTcrId( tcrCampaignId );
        if( !found.ok ) return ResultUtils.err( found.error );
        if( found.data === undefined ) { this.deps.log.warn( "TCR webhook for an unknown campaign", { tcrCampaignId } ); return ResultUtils.ok( undefined ); }
        const campaign : Registration.Campaign = found.data;

        const approved : Type.Result<Registration.Campaign> = await this.transitionCampaignStatus(
            campaign.accountId, campaign.campaignId as string, Registration.CampaignStatus.APPROVED, "all carriers completed DCA review" );
        if( !approved.ok ) { this.deps.log.warn( "DCA-complete not applied", { tcrCampaignId, error: approved.error } ); return ResultUtils.ok( undefined ); }

        // an already-numbered campaign (a re-delivered event) needs nothing further
        if( approved.data.phoneNumbers.length > 0 ) return ResultUtils.ok( undefined );

        const queued : Type.Result<string> = await this.enqueueSubmit( {
            kind: RegistrationDomain.SubmitKind.REPROVISION, accountId: campaign.accountId, campaignId: campaign.campaignId, count: 1,
        } );
        if( !queued.ok ) this.deps.log.warn( "number provisioning could not be queued", { tcrCampaignId, error: queued.error } );
        return ResultUtils.ok( undefined );
    }

    // CAMPAIGN_BILLED is TCR telling us the monthly use-case fee just applied — the fourth legacy charge
    // point. It doesn't move the state machine; it only writes a cost-estimate row.
    private async applyCampaignBilled( tcrCampaignId : string | undefined ) : Promise<Type.Result<void>>
    {
        if( tcrCampaignId === undefined ) return ResultUtils.err( "TCR billing event carried no campaignId" );
        const found : Type.Result<Registration.Campaign | undefined> = await this.campaignByTcrId( tcrCampaignId );
        if( !found.ok ) return ResultUtils.err( found.error );
        if( found.data === undefined ) { this.deps.log.warn( "TCR billing webhook for an unknown campaign", { tcrCampaignId } ); return ResultUtils.ok( undefined ); }
        const campaign : Registration.Campaign = found.data;

        const estimated : Type.Result<Registration.CostEstimate> = await this.estimateCost( {
            accountId: campaign.accountId, brandId: campaign.brandId, campaignId: campaign.campaignId, usecase: campaign.usecase,
            kind: Registration.CostEstimateKind.CAMPAIGN_MONTHLY, description: `TCR monthly campaign fee (${ campaign.usecase })`,
        } );
        return estimated.ok ? ResultUtils.ok( undefined ) : ResultUtils.err( estimated.error );
    }

    // order an EVP (Aegis/WMC) vetting run through TCR
    private async orderTcrVetting( brand : Registration.Brand, config : RegistrationConfig.Config, provider : Registration.VettingProvider ) : Promise<Type.Result<Record<string, unknown>>>
    {
        const client : Type.Result<TcrClient> = await this.tcrClient( config );
        if( !client.ok ) return ResultUtils.err( client.error );
        return client.data.requestVetting( brand.tcrBrandId as string, { evpId: provider, vettingClass: brand.vettingClass } );
    }

    // open (or re-read) a Campaign Verify verification for a political brand
    private async orderCvVetting( brand : Registration.Brand, config : RegistrationConfig.Config ) : Promise<Type.Result<Record<string, unknown>>>
    {
        const client : Type.Result<CvClient> = await this.cvClient( config );
        if( !client.ok ) return ResultUtils.err( client.error );
        if( brand.cvId !== undefined ) return client.data.getStatus( brand.cvId );
        return client.data.submitVerification( {
            entityName: brand.companyName ?? `${ brand.firstName ?? "" } ${ brand.lastName ?? "" }`.trim(),
            politicalType: brand.politicalType, email: brand.email, phone: brand.phone,
        } );
    }

    // re-publish every campaign under a brand whose trust score changed tier — registration-7.2's
    // "published interface, not a DB lookup"
    private async republishThroughput( brand : Registration.Brand ) : Promise<void>
    {
        const campaigns : Type.Result<Array<Registration.Campaign>> = await this.campaignsByBrand( brand.brandId as string );
        if( !campaigns.ok ) { this.deps.log.warn( "throughput republish skipped — campaign read failed", { brandId: brand.brandId, error: campaigns.error } ); return; }

        const mps : Registration.Campaign[ "mps" ] = RegistrationDomain.mpsFor( brand.vettingScore );
        for( const campaign of campaigns.data )
        {
            const updated : Registration.Campaign = { ...campaign, mps, updatedAt: new Date().toISOString() };
            const wrote : Type.Result<void> = await this.putCampaign( updated );
            if( !wrote.ok ) { this.deps.log.warn( "throughput republish write failed", { campaignId: campaign.campaignId, error: wrote.error } ); continue; }
            await this.emitCampaign( Events.Verb.UPDATED, updated );
        }
        this.deps.log.info( "trust-score → MPS republished", { brandId: brand.brandId, vettingScore: brand.vettingScore, campaigns: campaigns.data.length, mps } );
    }

    // the throughput a campaign should be published with, derived from its brand's trust score
    private async throughputFor( accountId : string, brandId : string ) : Promise<Registration.Campaign[ "mps" ]>
    {
        const found : Type.Result<Registration.Brand | undefined> = await this.getBrand( accountId, brandId );
        return RegistrationDomain.mpsFor( found.ok ? found.data?.vettingScore : undefined );
    }

    // resolve which TCR entity (and which TCR id) an operation targets
    private async resolveTcrTarget( accountId : string, target : RegistrationDomain.EntityRef ) : Promise<Type.Result<RegistrationDomain.TcrTarget>>
    {
        if( target.brandId !== undefined )
        {
            const found : Type.Result<Registration.Brand | undefined> = await this.getBrand( accountId, target.brandId );
            if( !found.ok ) return ResultUtils.err( found.error );
            if( found.data?.tcrBrandId === undefined ) return ResultUtils.err( "the brand has not been submitted to TCR yet" );
            return ResultUtils.ok( { kind: TcrClient.EntityKind.BRAND, tcrId: found.data.tcrBrandId } );
        }
        if( target.campaignId !== undefined )
        {
            const found : Type.Result<Registration.Campaign | undefined> = await this.getCampaign( accountId, target.campaignId );
            if( !found.ok ) return ResultUtils.err( found.error );
            if( found.data?.tcrCampaignId === undefined ) return ResultUtils.err( "the campaign has not been submitted to TCR yet" );
            return ResultUtils.ok( { kind: TcrClient.EntityKind.CAMPAIGN, tcrId: found.data.tcrCampaignId } );
        }
        return ResultUtils.err( "exactly one of brandId/campaignId is required" );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // ── Pure helpers ──────────────────────────────────────────────────────────────────────────

    /** Statuses in which a brand's user-submittable fields may still be edited (registration-3.2). */
    private static readonly BRAND_EDITABLE : ReadonlyArray<Registration.BrandStatus> =
        [ Registration.BrandStatus.DRAFT, Registration.BrandStatus.FAILED, Registration.BrandStatus.NEEDS_APPEAL, Registration.BrandStatus.EXPIRED ];

    /** Statuses in which a campaign's user-submittable fields may still be edited (registration-3.2). */
    private static readonly CAMPAIGN_EDITABLE : ReadonlyArray<Registration.CampaignStatus> =
        [ Registration.CampaignStatus.DRAFT, Registration.CampaignStatus.REJECTED, Registration.CampaignStatus.EXPIRED ];

    // entity-type-conditional KYC validation (registration-1.1) — the schema accepts every field as optional
    // because which ones are REQUIRED depends on entityType, which JSON Schema can't express cleanly
    private static validateBrandFields( fields : RegistrationDomain.BrandFields ) : string | undefined
    {
        if( fields.entityType === Registration.EntityType.SOLE_PROPRIETOR )
        {
            if( !fields.firstName || !fields.lastName ) return "a sole-proprietor brand requires firstName and lastName";
            return undefined;
        }
        if( !fields.companyName ) return `a ${ fields.entityType } brand requires companyName`;
        if( !fields.ein ) return `a ${ fields.entityType } brand requires an EIN`;
        if( fields.entityType === Registration.EntityType.PUBLIC_PROFIT && ( !fields.stockSymbol || !fields.stockExchange ) )
            return "a public-profit brand requires stockSymbol and stockExchange";
        if( fields.vertical === Registration.Vertical.POLITICAL && fields.politicalType === undefined )
            return "a political brand requires a politicalType";
        return undefined;
    }

    // use-case sub-usecase cardinality (TCR's own catalog rule — RegistrationConfig.USE_CASE_CATALOG)
    private static validateCampaignFields( fields : RegistrationDomain.CampaignFields ) : string | undefined
    {
        const meta : RegistrationConfig.UseCaseMeta | undefined = RegistrationConfig.USE_CASE_CATALOG[ fields.usecase ];
        if( meta === undefined ) return `unknown use case "${ fields.usecase }"`;
        const count : number = ( fields.subUsecases ?? [] ).length;
        if( count < meta.minSubUsecases ) return `use case "${ fields.usecase }" requires at least ${ meta.minSubUsecases } sub-use-cases`;
        if( count > meta.maxSubUsecases ) return `use case "${ fields.usecase }" allows at most ${ meta.maxSubUsecases } sub-use-cases`;
        return undefined;
    }

    // SINGLE needs the exact number to pin to; AREA_CODE needs the NPA to filter the group by. ALL needs
    // neither — the whole registered group is eligible.
    private static validateNumberSelection( selection : Texting.NumberSelection ) : string | undefined
    {
        if( selection.mode === Texting.NumberSelectionMode.SINGLE && !selection.number ) return "numberSelection.number is required when mode is single";
        if( selection.mode === Texting.NumberSelectionMode.AREA_CODE && !selection.areaCode ) return "numberSelection.areaCode is required when mode is area_code";
        return undefined;
    }

    // resolve the per-unit rate for one charge point from the config's fee tables. An unpriced use case
    // estimates ZERO — a missing price row is an operator omission, not a reason to block a registration.
    private static rateFor( config : RegistrationConfig.Config, input : RegistrationDomain.EstimateInput ) : Billing.Rate
    {
        if( input.kind === Registration.CostEstimateKind.VETTING )
            return ( input.vettingProvider ? config.vettingFee[ input.vettingProvider ] : undefined ) ?? config.defaultVettingFee;

        if( input.kind === Registration.CostEstimateKind.CAMPAIGN_MONTHLY || input.kind === Registration.CostEstimateKind.CAMPAIGN_REGISTRATION )
            return ( input.usecase ? config.useCaseMonthlyFee[ input.usecase ] : undefined ) ?? { amountMilliCents: 0, currency: config.defaultVettingFee.currency };

        // BRAND_REGISTRATION — TCR's flat brand fee isn't a per-use-case number, so it reuses the generic
        // fallback rate the config already carries rather than inventing a second knob
        return config.defaultVettingFee;
    }

    /** Map TCR's `identityStatus` vocabulary onto our brand pipeline. Returns undefined for a value we don't
     *  recognize, so an unmapped status is reported rather than silently swallowed. */
    private static brandStatusFromIdentity( identityStatus : string | undefined ) : Registration.BrandStatus | undefined
    {
        switch( ( identityStatus ?? "" ).toUpperCase() )
        {
            case "VERIFIED":            return Registration.BrandStatus.APPROVED;
            case "SELF_DECLARED":       return Registration.BrandStatus.APPROVED;
            case "PENDING":             return Registration.BrandStatus.IN_REVIEW;
            case "UNVERIFIED":          return Registration.BrandStatus.NEEDS_APPEAL;
            case "VETTED_VERIFIED":     return Registration.BrandStatus.APPROVED;
            default:                    return undefined;
        }
    }

    /** Map Campaign Verify's status vocabulary onto the brand pipeline's PIN sub-flow. CV is the ONLY path
     *  that reaches FAILED — an EVP scoring failure routes to NEEDS_APPEAL (see Registration.BrandStatus). */
    private static brandStatusFromCv( status : string ) : Registration.BrandStatus | undefined
    {
        switch( status.toUpperCase() )
        {
            case "REQUESTED":
            case "IN_REVIEW":     return Registration.BrandStatus.IN_REVIEW;
            case "PIN_SENT":      return Registration.BrandStatus.PIN_SENT;
            case "PIN_INPUTTED":  return Registration.BrandStatus.PIN_INPUTTED;
            case "APPROVED":
            case "VERIFIED":      return Registration.BrandStatus.APPROVED;
            case "REJECTED":      return Registration.BrandStatus.FAILED;
            default:              return undefined;
        }
    }

    // map TCR's campaign status field onto ours (the reconciliation read's half of the webhook mapping)
    private static campaignStatusFromRemote( body : Record<string, unknown> ) : Registration.CampaignStatus | undefined
    {
        const status : string = ( TcrClient.readString( body, "status" ) ?? "" ).toUpperCase();
        switch( status )
        {
            case "ACTIVE":     return Registration.CampaignStatus.ACTIVE;
            case "APPROVED":   return Registration.CampaignStatus.APPROVED;
            case "PENDING":    return Registration.CampaignStatus.PENDING_VETTING;
            case "REVIEW":     return Registration.CampaignStatus.IN_REVIEW;
            case "REJECTED":   return Registration.CampaignStatus.REJECTED;
            case "SUSPENDED":  return Registration.CampaignStatus.SUSPENDED;
            case "EXPIRED":    return Registration.CampaignStatus.EXPIRED;
            default:           return undefined;
        }
    }

    // roll the per-MNO metadata up into the two-valued operations status (INCOMPLETE unless every configured
    // MNO reports approved/registered — mirrors TCR's own `operationStatus` semantics)
    private static operationsStatusOf( body : Record<string, unknown> ) : Registration.OperationsStatus
    {
        const values : Array<unknown> = Object.values( body );
        if( values.length === 0 ) return Registration.OperationsStatus.INCOMPLETE;
        const allApproved : boolean = values.every( ( value : unknown ) : boolean => String( value ).toUpperCase() === "APPROVED" || String( value ).toUpperCase() === "REGISTERED" );
        return allApproved ? Registration.OperationsStatus.APPROVED : Registration.OperationsStatus.INCOMPLETE;
    }

    /**
     * Trust score → published throughput (registration-7.2). THIS IS A PLACEHOLDER LADDER, not carrier truth:
     * the authoritative per-MNO caps arrive on `Campaign.mnoMetadata` from TCR's `getMnoMetadata`, and the
     * reconcile mirrors them. Until a campaign has that metadata, dispatch still needs SOMETHING to pace to,
     * and an explicitly conservative tier is safer than publishing no limit at all (which dispatch would read
     * as unlimited). The tiers mirror the coarse 10DLC vetted/unvetted split.
     */
    private static mpsFor( vettingScore : number | undefined ) : Registration.Campaign[ "mps" ]
    {
        const tier : RegistrationDomain.Tier = RegistrationDomain.tierOf( vettingScore );
        switch( tier )
        {
            case RegistrationDomain.Tier.HIGH:   return { perMinute: 4_500, perHour: 270_000, perDay: 200_000 };
            case RegistrationDomain.Tier.MEDIUM: return { perMinute: 2_400, perHour: 144_000, perDay: 40_000 };
            case RegistrationDomain.Tier.LOW:    return { perMinute: 240, perHour: 14_400, perDay: 2_000 };
            default:                             return { perMinute: 60, perHour: 3_600, perDay: 75 };
        }
    }

    /** The MPS tier a trust score falls in — exported through the class so the "did the score move
     *  MATERIALLY" check and the MPS lookup agree on the boundaries by construction. */
    private static tierOf( vettingScore : number | undefined ) : RegistrationDomain.Tier
    {
        if( vettingScore === undefined ) return RegistrationDomain.Tier.UNVETTED;
        if( vettingScore >= 75 ) return RegistrationDomain.Tier.HIGH;
        if( vettingScore >= 50 ) return RegistrationDomain.Tier.MEDIUM;
        return RegistrationDomain.Tier.LOW;
    }

    // build TCR's brand-create payload from our projection. Loose by design (see TcrClient's header) — the
    // field NAMES are TCR's, the values are ours.
    private static brandPayload( brand : Registration.Brand, config : RegistrationConfig.Config ) : Record<string, unknown>
    {
        return {
            cspId: config.cspId, referenceId: brand.brandId, entityType: brand.entityType,
            firstName: brand.firstName, lastName: brand.lastName,
            displayName: brand.companyName, companyName: brand.companyName,
            ein: brand.ein, einIssuingCountry: brand.einIssuingCountry,
            stockSymbol: brand.stockSymbol, stockExchange: brand.stockExchange,
            email: brand.email, phone: brand.phone,
            street: brand.street, city: brand.city, state: brand.state, postalCode: brand.postalCode, country: brand.country,
            website: brand.website, vertical: brand.vertical, altBusinessId: brand.altBusinessId, altBusinessIdType: brand.altBusinessIdType,
        };
    }

    // build TCR's campaign-create payload from our projection (same looseness rationale as brandPayload)
    private static campaignPayload( campaign : Registration.Campaign, brand : Registration.Brand, config : RegistrationConfig.Config ) : Record<string, unknown>
    {
        return {
            brandId: brand.tcrBrandId, cspId: config.cspId, resellerId: config.resellerId, referenceId: campaign.campaignId,
            usecase: campaign.usecase, subUsecases: campaign.subUsecases,
            description: campaign.description, messageFlow: campaign.messageFlow,
            sample1: campaign.sample1, sample2: campaign.sample2, sample3: campaign.sample3, sample4: campaign.sample4, sample5: campaign.sample5,
            optinKeywords: campaign.optin.keywords.join( "," ), optinMessage: campaign.optin.message,
            helpKeywords: campaign.help.keywords.join( "," ), helpMessage: campaign.help.message,
            optoutKeywords: campaign.optout.keywords.join( "," ), optoutMessage: campaign.optout.message,
            subscriberOptin: campaign.subscriberOptin, subscriberOptout: campaign.subscriberOptout, subscriberHelp: campaign.subscriberHelp,
            embeddedLink: campaign.embeddedLink, embeddedPhone: campaign.embeddedPhone, numberPool: campaign.numberPool,
            ageGated: campaign.ageGated, directLending: campaign.directLending, affiliateMarketing: campaign.affiliateMarketing,
            autoRenewal: campaign.autoRenewal, privacyPolicyLink: campaign.privacyPolicyLink, termsAndConditionsLink: campaign.termsAndConditionsLink,
        };
    }
}

export namespace RegistrationDomain
{
    /** The facades the domain needs — supplied by whichever `Service` or `Job` owns this instance, so each
     *  runtime keeps its own lazily-created clients (registration-12.1). */
    export interface Deps
    {
        dynamo    : Dynamo;
        sqs       : Sqs;
        kafka     : Kafka;
        secrets   : Secrets;
        appConfig : AppConfig;
        log       : Trace;
    }

    /** A resolved carrier adapter + its freshly-read credential context. */
    export interface ResolvedCarrier { adapter : CarrierProvider; context : CarrierContext; }

    /** The union of every carrier secret's fields (see @repo/system's Providers catalog) — a given carrier
     *  populates the subset it uses. */
    export interface CarrierCredential { apiKey? : string; apiSecret? : string; accountId? : string; }

    /** The user-submittable subset of a brand (everything `PostRegistrationBrand.Body` carries). */
    export type BrandFields = Pick<Registration.Brand,
        "entityType" | "firstName" | "lastName" | "companyName" | "ein" | "einIssuingCountry" |
        "stockSymbol" | "stockExchange" | "email" | "phone" | "street" | "city" | "state" |
        "postalCode" | "country" | "website" | "vertical" | "politicalType" | "altBusinessId" | "altBusinessIdType">;

    /** The user-submittable subset of a campaign (everything `PostRegistrationCampaign.Body` carries). */
    export type CampaignFields = Pick<Registration.Campaign,
        "brandId" | "usecase" | "description" | "messageFlow" | "sample1" | "sample2" | "sample3" | "sample4" | "sample5" |
        "optin" | "help" | "optout" | "subscriberOptin" | "subscriberOptout" | "subscriberHelp" | "embeddedLink" |
        "embeddedPhone" | "numberPool" | "ageGated" | "directLending" | "affiliateMarketing" | "autoRenewal" |
        "privacyPolicyLink" | "termsAndConditionsLink" | "provider" | "areaCode" | "numberSelection"> & { subUsecases? : Array<Registration.UseCase> };

    /** "Which entity" — every lifecycle op takes exactly one of these. */
    export interface EntityRef { brandId? : string; campaignId? : string; }

    /** The entity an operation resolved to, plus TCR's own id for it. */
    export interface TcrTarget { kind : TcrClient.EntityKind; tcrId : string; }

    /** A lifecycle op's result — exactly one side is populated, matching the endpoint contracts' shape. */
    export interface EntityResult { brand? : Registration.Brand; campaign? : Registration.Campaign; }

    /** What kind of work a `registration-submit` message asks for — a closed set, never a raw string. */
    export enum SubmitKind
    {
        SUBMIT      = "submit",
        RESUBMIT    = "resubmit",
        REPROVISION = "reprovision",
    }

    /** One `registration-submit` queue message. */
    export interface SubmitMessage
    {
        kind        : SubmitKind;
        accountId   : string;
        jobId?      : string;
        brandId?    : string;
        campaignId? : string;
        count?      : number;                            // reprovision only — how many lines to acquire
        provider?   : Registration.CarrierProvider;      // reprovision only — switch carriers
        areaCode?   : string;                            // reprovision only
    }

    /** One `registration-vetting` queue message. */
    export interface VettingMessage { jobId : string; accountId : string; brandId : string; }

    /** The inputs {@link RegistrationDomain.estimateCost} needs to resolve a rate and write a ledger row. */
    export interface EstimateInput
    {
        accountId        : string;
        kind             : Registration.CostEstimateKind;
        description      : string;
        brandId?         : string;
        campaignId?      : string;
        quantity?        : number;
        usecase?         : Registration.UseCase;               // prices the campaign charge points
        vettingProvider? : Registration.VettingProvider;       // prices the vetting charge point
    }

    /** One campaign's reconciled per-carrier state, as surfaced on the vetting-status read. */
    export interface CampaignVettingState
    {
        campaignId        : string;
        status            : Registration.CampaignStatus;
        operationsStatus? : Registration.OperationsStatus;
    }

    /** The reconciled brand + campaign vetting projection (registration-11.2). */
    export interface VettingStatus
    {
        brandId          : string;
        status           : Registration.BrandStatus;
        identityStatus?  : string;
        vettingProvider? : Registration.VettingProvider;
        vettingClass?    : string;
        vettingScore?    : number;
        cvStatus?        : string;
        campaigns        : Array<CampaignVettingState>;
    }

    /** The coarse trust-score bands the placeholder MPS ladder is keyed on. */
    export enum Tier
    {
        UNVETTED = "unvetted",
        LOW      = "low",
        MEDIUM   = "medium",
        HIGH     = "high",
    }

    /** TCR's webhook event vocabulary, as understood from the legacy integration this service's requirements
     *  were mined from. See {@link RegistrationDomain.processTcrWebhook}'s mapping caveat — an unrecognized
     *  event is logged and acked, never dead-lettered. */
    export enum TcrEvent
    {
        BRAND_ADD                        = "BRAND_ADD",
        BRAND_IDENTITY_STATUS_UPDATE     = "BRAND_IDENTITY_STATUS_UPDATE",
        CAMPAIGN_ADD                     = "CAMPAIGN_ADD",
        CAMPAIGN_SHARE_ACCEPT            = "CAMPAIGN_SHARE_ACCEPT",
        CAMPAIGN_SHARE_DELETE            = "CAMPAIGN_SHARE_DELETE",
        CAMPAIGN_DCA_COMPLETE            = "CAMPAIGN_DCA_COMPLETE",
        CAMPAIGN_BILLED                  = "CAMPAIGN_BILLED",
        CAMPAIGN_EXPIRED                 = "CAMPAIGN_EXPIRED",
        DCA_CAMPAIGN_OPERATION_SUSPENDED = "DCA_CAMPAIGN_OPERATION_SUSPENDED",
    }

    /** Which provider stream a verified webhook came in on — picks the intake queue and the processor. */
    export enum WebhookStream
    {
        TCR = "tcr",
        CV  = "cv",
    }

    /** The SQS queue each webhook stream is parked on. */
    export const WEBHOOK_QUEUE : Record<WebhookStream, string> =
    {
        [ WebhookStream.TCR ]: "registration-webhook-tcr",
        [ WebhookStream.CV ]:  "registration-webhook-cv",
    };
}

export default RegistrationDomain;
// eof

//
import { Registration, PhoneNumber, Texting } from "@repo/api";
import type { Type } from "@repo/common";
import { Events } from "@repo/system";
import type { Dynamo, Kafka, Trace } from "@repo/services";

import { TextingService } from "../services/TextingService";

//
// RegistrationSyncConsumer — the registration→texting bridge (texting-4.6/4.10) this service was always
// documented to need but never had: registration OWNS provisioning (numbers, campaigns); texting only
// CONSUMES the resulting pool, via this Kafka sync, never a cross-service DB read (CLAUDE.md).
//
// Subscribes to `registration.number` (a standalone `PhoneNumber.PhoneNumber` row — search/order, not the
// legacy campaign-embedded bulk array) and `registration.campaign` (for `numberSelection`/`active`/`mps`).
// Upserts into texting's OWN `numbers`/`campaigns` tables, which `TextingService.resolveFromNumber` reads at
// send time. Started from `TextingMainService`'s constructor — same "skip quietly if Kafka isn't configured,
// WARN don't throw on a real outage" posture as `AuthMainService.startAvatarConsumer`.
//
export class RegistrationSyncConsumer
{
    ////////////////////////////////////////////////////////////////////////////////////////////
    constructor( private readonly deps : RegistrationSyncConsumer.Deps ) {}

    ////////////////////////////////////////////////////////////////////////////////////////////
    public async start() : Promise<void>
    {
        if( !this.deps.kafka.configured() )
        {
            this.deps.log.info( "texting-registration-sync consumer skipped — no Kafka brokers configured (dev)" );
            return;
        }

        try
        {
            await this.deps.kafka.subscribeEvents( "texting-registration-sync",
                [ Events.Object.REGISTRATION_NUMBER, Events.Object.REGISTRATION_CAMPAIGN ],
                ( event : Events.Envelope ) : Promise<void> => this.onEvent( event ) );
            this.deps.log.info( "texting-registration-sync consumer subscribed", { objects: [ Events.Object.REGISTRATION_NUMBER, Events.Object.REGISTRATION_CAMPAIGN ] } );
        }
        catch( error )
        {
            this.deps.log.warn( "texting-registration-sync consumer failed to start (bus unreachable?) — number routing stays on the placeholder until restart", { error: String( error ) } );
        }
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // dispatch by object — one consumer, two entity types (mirrors AppMainService's app-readmodel shape).
    private async onEvent( event : Events.Envelope ) : Promise<void>
    {
        if( event.object === Events.Object.REGISTRATION_NUMBER ) await this.onNumber( event );
        else if( event.object === Events.Object.REGISTRATION_CAMPAIGN ) await this.onCampaign( event );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // registration.number → texting's `numbers` table. Only a STANDALONE PhoneNumber row (search/order) —
    // the legacy campaign-embedded bulk-array event carries a different, untyped inline shape and is ignored
    // here (no `id` field to key off).
    private async onNumber( event : Events.Envelope ) : Promise<void>
    {
        const number : PhoneNumber.PhoneNumber = event.data as unknown as PhoneNumber.PhoneNumber;
        if( !number?.accountId || !number.id ) return;

        if( number.status === PhoneNumber.OrderStatus.FAILED ) return;   // nothing to consume — never acquired
        if( !number.number )
        {
            // PENDING with no E.164 yet — nothing texting can route to; wait for the next UPDATED once it confirms.
            if( number.status === PhoneNumber.OrderStatus.PENDING ) return;
        }

        const provider : Texting.Provider | undefined = RegistrationSyncConsumer.PROVIDER_MAP[ number.carrier ];
        if( provider === undefined )
        {
            this.deps.log.warn( "texting-registration-sync: unmapped carrier, skipping", { carrier: number.carrier, id: number.id } );
            return;
        }

        const status : Texting.NumberStatus = event.verb === Events.Verb.DELETED
            ? Texting.NumberStatus.RELEASED
            : RegistrationSyncConsumer.STATUS_MAP[ number.status ];

        const record : Texting.NumberRecord =
        {
            accountId: number.accountId, number: number.number as Type.PhoneE164, type: number.numberType,
            provider, status, tcr: { campaignId: number.campaignId },
            health: { state: Texting.NumberHealthState.OK },   // registration doesn't track bench state — texting owns it (texting-5.7)
        };
        const wrote : Type.Result<void> = await this.deps.dynamo.put( "numbers", { ...record } );
        if( !wrote.ok ) this.deps.log.warn( "texting-registration-sync: number upsert failed", { id: number.id, error: wrote.error } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // registration.campaign → texting's `campaigns` table — just the fields send-time routing needs.
    private async onCampaign( event : Events.Envelope ) : Promise<void>
    {
        const campaign : Registration.Campaign = event.data as unknown as Registration.Campaign;
        if( !campaign?.accountId || !campaign.campaignId ) return;

        const row : TextingService.CampaignRow =
        {
            accountId: campaign.accountId, campaignId: campaign.campaignId,
            active: campaign.status === Registration.CampaignStatus.ACTIVE,
            numberSelection: campaign.numberSelection, mps: campaign.mps,
        };
        const wrote : Type.Result<void> = await this.deps.dynamo.put( "campaigns", { ...row } );
        if( !wrote.ok ) this.deps.log.warn( "texting-registration-sync: campaign upsert failed", { campaignId: campaign.campaignId, error: wrote.error } );
    }

    // Registration.CarrierProvider's values are a SUBSET of Texting.Provider's (both use the same string for
    // fake/bandwidth/telnyx/vonage) — an explicit map, not a bare cast, so an unmapped future carrier is
    // caught (logged + skipped) rather than silently mis-typed.
    private static readonly PROVIDER_MAP : Record<Registration.CarrierProvider, Texting.Provider | undefined> =
    {
        [ Registration.CarrierProvider.FAKE ]:      Texting.Provider.FAKE,
        [ Registration.CarrierProvider.BANDWIDTH ]: Texting.Provider.BANDWIDTH,
        [ Registration.CarrierProvider.TELNYX ]:    Texting.Provider.TELNYX,
        [ Registration.CarrierProvider.VONAGE ]:    Texting.Provider.VONAGE,
    };

    private static readonly STATUS_MAP : Record<PhoneNumber.OrderStatus, Texting.NumberStatus> =
    {
        [ PhoneNumber.OrderStatus.PENDING ]:  Texting.NumberStatus.PENDING,
        [ PhoneNumber.OrderStatus.ACTIVE ]:   Texting.NumberStatus.ACTIVE,
        [ PhoneNumber.OrderStatus.RELEASED ]: Texting.NumberStatus.RELEASED,
        [ PhoneNumber.OrderStatus.FAILED ]:   Texting.NumberStatus.SUSPENDED,   // unreachable — filtered above
    };
}

export namespace RegistrationSyncConsumer
{
    export interface Deps { dynamo : Dynamo; kafka : Kafka; log : Trace; }
}

export default RegistrationSyncConsumer;
// eof

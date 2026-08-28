//
import { Marketplace } from "@repo/api";
import { Dynamo } from "@repo/services";
import { ObjectUtils, type Type } from "@repo/common";

//
// UsagePipeline — report usage deltas for the current period (marketplace-8.1), shared by
// `MarketplaceService` (the HTTP-facing PostInternalUsage endpoint) and `MarketplaceActionJob` (which
// meters its own outbound calls), so the increment+backfill steps live in exactly one place.
//
export namespace UsagePipeline
{
    export interface Deps { dynamo : Dynamo; }

    ///////////////////////////////////////////////////////////////////////////////////////////
    /**
     * Bump each present signal atomically via `Dynamo.increment`, then backfill identity fields
     * (`accountId`/`integrationId`/`period`/`meterKey`) and `lastUsedAt` on the row `increment` may
     * have just created bare (`ADD` initializes a missing item with only the incremented attribute +
     * key, not the rest of the required schema).
     */
    export async function report(
        deps : Deps, accountId : Type.UUID, integrationId : string, instanceId : string | undefined,
        deltas : Partial<Pick<Marketplace.UsageMeter, "calls" | "syncs" | "actions" | "records">>,
    ) : Promise<Type.Result<void>>
    {
        const period : string = new Date().toISOString().slice( 0, 7 );   // YYYY-MM
        const meterKey : string = Marketplace.usageMeterKey( integrationId, instanceId, period );

        for( const signal of [ "calls", "syncs", "actions", "records" ] as const )
        {
            const delta : number | undefined = deltas[ signal ];
            if( !delta ) continue;
            const incremented : Type.Result<number> = await deps.dynamo.increment( "usage_meters", { accountId, meterKey }, signal, delta );
            if( !incremented.ok ) return { ok: false, error: incremented.error };
        }

        const got : Type.Result<Marketplace.UsageMeter | undefined> = await deps.dynamo.get<Marketplace.UsageMeter>( "usage_meters", { accountId, meterKey } );
        if( !got.ok || !got.data ) return { ok: false, error: got.ok ? "usage meter not found after increment" : got.error };

        const filled : Marketplace.UsageMeter = ObjectUtils.withDefaults( got.data, Marketplace.USAGE_DEFAULT );
        return deps.dynamo.put( "usage_meters", { ...filled, accountId, integrationId, instanceId, period, meterKey, lastUsedAt: new Date().toISOString() } );
    }
}

export default UsagePipeline;

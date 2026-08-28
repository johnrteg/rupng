//
import { Marketplace } from "@repo/api";
import { Dynamo, Trace } from "@repo/services";
import { OAuthFactory, OAuth } from "@repo/oauth";
import type { Type } from "@repo/common";

//
// HealthPipeline — validates one installation's connection via the OAuth broker, shared by BOTH
// runtimes (`PostInstallationHealthCheckImpl`'s on-demand check and `MarketplaceHealthJob`'s periodic
// sweep) so the logic lives in exactly one place (mirrors social's SocialPipeline/InboundPipeline).
// A no-op for non-OAuth credential types (api_key/basic/webhook) — the broker doesn't cover those; see
// apps/core/marketplace/SPECS.md's credential-type table.
//
export namespace HealthPipeline
{
    export interface Deps { dynamo : Dynamo; log : Trace; }

    ///////////////////////////////////////////////////////////////////////////////////////////
    /** Check one installation now, write the updated health/status, and return the updated row.
     *  A currently-ACTIVE installation whose check fails moves to NEEDS_AUTH (prompting reauth); a
     *  currently-NEEDS_AUTH installation whose check succeeds moves back to ACTIVE. Any other status
     *  (CONFIGURED / PAUSED / REMOVED) is left alone — pointless to probe an installation not in use. */
    export async function checkInstallation( deps : Deps, installation : Marketplace.Installation ) : Promise<Marketplace.Installation>
    {
        if( installation.status !== Marketplace.InstallStatus.ACTIVE && installation.status !== Marketplace.InstallStatus.NEEDS_AUTH )
            return installation;

        const definition : Type.Result<Marketplace.IntegrationDefinition | undefined> = await deps.dynamo.get<Marketplace.IntegrationDefinition>( "catalog", { integrationId: installation.integrationId } );
        if( !definition.ok || !definition.data || definition.data.credentialType !== Marketplace.CredentialType.OAUTH )
            return installation;   // no catalog entry, or a credential type the broker doesn't cover — nothing to check

        const now : Type.ISODateTime = new Date().toISOString();
        const connection : Type.Result<OAuth.Connection> = await OAuthFactory.for( installation.integrationId ).getConnection( installation.integrationId, installation.installationId );

        const updated : Marketplace.Installation = connection.ok
            ? { ...installation, health: { state: Marketplace.HealthState.CONNECTED, checkedAt: now }, status: installation.status === Marketplace.InstallStatus.NEEDS_AUTH ? Marketplace.InstallStatus.ACTIVE : installation.status }
            : { ...installation, health: { state: Marketplace.HealthState.NEEDS_REAUTH, checkedAt: now, error: connection.error }, status: Marketplace.InstallStatus.NEEDS_AUTH };

        const wrote : Type.Result<void> = await deps.dynamo.put( "installations", { ...updated } );
        if( !wrote.ok ) { deps.log.warn( "health check: write failed", { installationId: installation.installationId, error: wrote.error } ); return installation; }

        return updated;
    }
}

export default HealthPipeline;

//
import { Context } from "aws-lambda";
import { ScanCommand, type ScanCommandOutput } from "@aws-sdk/lib-dynamodb";

import { Marketplace } from "@repo/api";
import { ResultUtils, type Type } from "@repo/common";

import MarketplaceJob from "./MarketplaceJob";
import { HealthPipeline } from "../pipeline/HealthPipeline";

//
// MarketplaceHealthJob — probes every ACTIVE / NEEDS_AUTH installation's connection (marketplace-9.1).
// A full table scan (installations is small relative to a periodic cadence); revisit if that stops
// being true. Runs the exact same HealthPipeline.checkInstallation the on-demand
// PostInstallationHealthCheck endpoint does.
//
export class MarketplaceHealthJob extends MarketplaceJob<unknown, void>
{
    /////////////////////////////////////////////////////////////////////
    constructor() { super( "marketplaceHealthJob" ); }

    /////////////////////////////////////////////////////////////////////
    public async handler( _event : unknown, _context : Context ) : Promise<void>
    {
        const deps : HealthPipeline.Deps = this.pipelineDeps();

        const scanned : Type.Result<Array<Marketplace.Installation>> = await ResultUtils.from( async () : Promise<Array<Marketplace.Installation>> =>
        {
            const result : ScanCommandOutput = await this.dynamo.client.send( new ScanCommand( { TableName: this.dynamo.table( "installations" ) } ) );
            return ( result.Items ?? [] ) as Array<Marketplace.Installation>;
        } );
        if( !scanned.ok ) { this.log.warn( "health sweep: installations scan failed", { error: scanned.error } ); return; }

        const due : Array<Marketplace.Installation> = scanned.data.filter( ( installation : Marketplace.Installation ) : boolean =>
            installation.status === Marketplace.InstallStatus.ACTIVE || installation.status === Marketplace.InstallStatus.NEEDS_AUTH );

        for( const installation of due )
        {
            const updated : Marketplace.Installation = await HealthPipeline.checkInstallation( deps, installation );
            if( updated.health.state !== Marketplace.HealthState.CONNECTED )
                this.log.warn( "health sweep: installation unhealthy", { installationId: installation.installationId, state: updated.health.state, error: updated.health.error } );
        }
    }
}

//
// Lambda entrypoint — manifest `jobs.marketplaceHealthJob`, handler "jobs/MarketplaceHealthJob.handler".
//
const job : MarketplaceHealthJob = new MarketplaceHealthJob();
export const handler = ( event : unknown, context : Context ) : Promise<void> => job.invoke( event, context );

export default MarketplaceHealthJob;
// eof

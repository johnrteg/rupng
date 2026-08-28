//
import { randomUUID } from "node:crypto";

import { PostInstallationEnable, Marketplace } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";
import { Events } from "@repo/services";
import MarketplaceService from "../services/MarketplaceService";

//
// Enable an integration — accept-to-enable, with the escalated cross-border ack required when the
// integration's catalog entry is US-jurisdiction (marketplace-2.7).
//
// SIMPLIFICATION: we can't yet determine whether the ACCOUNT is EU-resident (that lives in the
// account service, no client exists for it here) — so the cross-border ack is required for EVERY
// account enabling a US-jurisdiction integration, not just EU accounts. Conservative (errs toward
// requiring more disclosure, never less) until an account-service client narrows it to EU accounts only.
//
export class PostInstallationEnableImpl extends PostInstallationEnable
{
    private service : MarketplaceService;
    constructor( service : MarketplaceService ) { super(); this.service = service; }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId )   return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };
        const accountId : string | undefined = auth.accountId;
        if( !accountId )     return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "no acting account (X-Account)" } };
        const body : PostInstallationEnable.Body | null = this.body;
        if( !body?.integrationId || !body.config || !body.accept )
            return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "integrationId, config, and accept are required" } };
        if( !body.accept.subProcessorAck )
            return { status: NetworkUtils.Status.CONFLICT, data: { message: "sub-processor acknowledgment required to enable" } };

        const definition : Type.Result<Marketplace.IntegrationDefinition | undefined> = await this.service.dynamo.get<Marketplace.IntegrationDefinition>( "catalog", { integrationId: body.integrationId } );
        if( !definition.ok )   return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "catalog read failed" } };
        if( !definition.data ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "unknown integration" } };
        if( definition.data.dataJurisdiction === Marketplace.DataJurisdiction.US && !body.accept.crossBorderAck )
            return { status: NetworkUtils.Status.CONFLICT, data: { message: "cross-border data-transfer acceptance required for this integration" } };

        const installationId : Type.UUID = randomUUID();
        const now : Type.ISODateTime = new Date().toISOString();
        const installation : Marketplace.Installation =
        {
            installationId,
            accountId,
            integrationId: body.integrationId,
            instanceId:    body.instanceId,
            label:         body.label,
            status:        Marketplace.InstallStatus.CONFIGURED,
            config:        body.config,
            health:        { state: Marketplace.HealthState.ERROR },
            accepted:      { ...body.accept, at: now, by: auth.userId },
            installedBy:   auth.userId,
            installedAt:   now,
        };

        const wrote : Type.Result<void> = await this.service.dynamo.put( "installations", { ...installation } );
        if( !wrote.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "installation write failed" } };

        await this.service.appendAudit( installationId, Marketplace.InstallationAuditAction.ENABLE, auth.userId );
        await this.service.emitInstallationEvent( Events.Verb.CREATED, installation );

        return { status: NetworkUtils.Status.OK, data: installation };
    }
}

export default PostInstallationEnableImpl;

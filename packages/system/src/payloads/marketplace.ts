//
// Marketplace service payloads
//
import type { Type } from "@repo/common";

/** An installation — the `marketplace.integration` entity representation. */
export interface MarketplaceIntegration
{
    id:            Type.ID;   // installationId
    accountId:     Type.ID;
    integrationId: string;
    status:        string;
}

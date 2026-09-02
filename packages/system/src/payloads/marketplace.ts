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

/** A connector's normalized inbound event — the `marketplace.trigger_event` entity representation.
 *  Emitted by `MarketplaceConnectorJob` after `Connector.normalize`; the intended consumer is
 *  `workflow`'s trigger nodes (marketplace-4.5), not built yet — see that job's KNOWN GAP note. */
export interface MarketplaceTriggerEvent
{
    id:            Type.ID;   // externalId (the provider's own id for this event; the dedupe key)
    accountId:     Type.ID;
    installationId: Type.ID;
    integrationId: string;
    key:           string;   // catalog capability key, e.g. "order.created"
    occurredAt:    Type.ISODateTime;
}

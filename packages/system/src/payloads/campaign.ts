//
// Campaign service payloads
//
import type { Type } from "@repo/common";

/** A campaign — the `campaign.campaign` entity representation. */
export interface Campaign
{
    id:        Type.ID;
    accountId: Type.ID;
    name:      string;
    status:    string;
}

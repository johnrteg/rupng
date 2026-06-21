//
// Media service payloads
//
import type { Type } from "@repo/common";

/** A media asset — the `media.asset` entity representation. */
export interface MediaAsset
{
    id:          Type.ID;
    accountId:   Type.ID;
    url:         string;
    contentType: string;
    status:      string;
    bytes:       number;
}

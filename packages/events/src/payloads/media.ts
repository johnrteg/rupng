//
// Media service payloads — the canonical entity representations the media service emits on the bus
// (`Events.Of<Object.MEDIA_ASSET>.data`) AND returns from its GET endpoints. ONE shape, two uses → no
// drift. Pure types (only `@repo/common`). See the @repo/events README "Payload repository".
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

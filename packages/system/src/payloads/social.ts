//
// Social service payloads
//
import type { Type } from "@repo/common";

/** A connected social destination — the `social.account` entity representation. */
export interface SocialAccount
{
    id:        Type.ID;
    accountId: Type.ID;
    platform:  string;
    status:    string;
}

/** A social post — the `social.post` entity representation. */
export interface SocialPost
{
    id:          Type.ID;
    accountId:   Type.ID;
    status:      string;
    targetCount: number;
}

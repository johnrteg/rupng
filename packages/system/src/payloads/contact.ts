//
// Contact service payloads
//
import type { Type } from "@repo/common";

/** A contact — the `contact.contact` entity representation. */
export interface Contact
{
    id:        Type.ID;
    accountId: Type.ID;
    firstName?: string;
    lastName?:  string;
    status:    string;
}

/** A segment — the `contact.segment` entity representation. */
export interface Segment
{
    id:        Type.ID;
    accountId: Type.ID;
    name:      string;
    status:    string;
}

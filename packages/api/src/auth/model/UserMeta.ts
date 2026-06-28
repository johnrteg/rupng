//
import { Type } from "@repo/common";

//
// UserMeta — arbitrary per-user metadata the UI can stash + read back (preferences, dismissed hints,
// layout state, onboarding progress, …). A record is `{ id, type, object }`, scoped to the calling user.
// `type` is a category (e.g. "ui.layout", "onboarding"); `id` is the record id within the user (the
// server generates one on create when omitted). `object` is opaque JSON the UI owns.
// Stored auth-internal (DynamoDB), keyed by the user + type + id.
//
export namespace UserMeta
{
    export interface Entity
    {
        id     : Type.ID;       // record id within the user (server-generated when created without one)
        type   : string;        // category key, e.g. "ui.layout"
        object : Type.Json;     // opaque UI-owned payload
    }
}

export default UserMeta;

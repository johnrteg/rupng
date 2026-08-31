//
// Dispatch — the WIRE-level shape any `WorkQueue`-adopting service's admin ("Dispatch") view exposes, so
// Console can render ONE generic panel across every adopter instead of a bespoke UI per service. The governor
// itself (`packages/services/src/WorkQueue.ts`) computes these numbers (`WorkQueue.snapshot`); an adopting
// service's own endpoint (e.g. `GetVoiceDispatchState`) just serializes them over this shared contract. See
// `apps/core/voice/SPECS.md` gap #8 (the first adopter) and `packages/services/DISPATCH.md`.
//
export namespace Dispatch
{
    /** One account's live governed state — mirrors `WorkQueue.AccountState` over the wire. */
    export interface AccountState
    {
        accountId : string;
        pending   : number;                                              // jobs waiting on this queue
        inflight  : number;                                              // currently dispatched/processing
        windows   : { m1 : number; m5 : number; h1 : number; d1 : number };   // recent send-rate (summed bins)
        fairScore : number;                                              // current DRR virtual-finish time
        suspended : boolean;
    }

    /** A queue's aggregate snapshot — depth vs its low-water-mark, its resolved defaults, and the accounts
     *  currently active on it (bounded; `truncated` flags when more exist than were returned). */
    export interface QueueSnapshot
    {
        queue        : string;
        depth        : number;              // in-flight jobs vs...
        lowWaterMark : number;               // ...this ceiling (keeps the downstream queue shallow)
        batchSize    : number;
        leaseSeconds : number;
        accounts     : Array<AccountState>;
        truncated    : boolean;              // true if more active accounts exist than `accounts` lists
    }
}

export default Dispatch;
// eof

//
import { AsyncLocalStorage } from 'node:async_hooks';

//
// RequestContext — ambient per-request/per-event correlation, carried on an AsyncLocalStorage so it flows
// across awaits without threading a parameter through every call. The runtime enters a context at each entry
// point (an HTTP request in Service, a consumed SQS/Kafka message in a Consumer/Job) with the request's
// `transactionId`; everything that runs inside — including the shared `Trace` logger and the outbound facades
// (Kafka/SQS) — reads it via `RequestContext.get()`. That's what makes a single `transactionId` correlate a
// call end-to-end (console trace / CloudWatch Logs Insights / X-Ray annotation).
//
export class RequestContext
{
    private static readonly storage : AsyncLocalStorage<RequestContext.Store> = new AsyncLocalStorage<RequestContext.Store>();

    /** Run `fn` (and everything it awaits) inside `store` — the entry points wrap their handler in this. */
    public static run<T>( store : RequestContext.Store, fn : () => T ) : T
    {
        return RequestContext.storage.run( store, fn );
    }

    /** The current context, or undefined when not inside a request/event (e.g. startup, background loops). */
    public static get() : RequestContext.Store | undefined
    {
        return RequestContext.storage.getStore();
    }

    /** The current transaction id, if any — convenience for the outbound facades. */
    public static transactionId() : string | undefined
    {
        return RequestContext.storage.getStore()?.transactionId;
    }
}

export namespace RequestContext
{
    export interface Store
    {
        transactionId? : string;   // correlates all work (logs, downstream calls, events) for one request/event
    }
}

export default RequestContext;
// eof

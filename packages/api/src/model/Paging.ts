//
// Paging — the platform-wide convention for LIST responses. Every GET that returns a collection uses the
// same request knobs and the same `{ data, page }` envelope, so clients page uniformly:
//
//   Request  : ?count=<pageSize>&start=<token>       (both optional; count clamps to [1, MAX_COUNT])
//   Response : { records: Array<T>, page: { count, total, start?, next? } }
//
//   * count  — number of items ON THIS page (data.length).
//   * total  — total items across ALL pages (for "showing 50 of 1,240").
//   * start  — the token that produced THIS page (echoed; the "previous"/current cursor).
//   * next   — the token for the NEXT page; ABSENT when this is the last page (no more).
//
// The token is opaque to clients — pass `next` straight back as the following request's `start`. Today it's a
// simple offset (in-memory paging over a fetched set); it can become a real DynamoDB LastEvaluatedKey cursor
// later without changing the contract.
//
export namespace Paging
{
    /** Default page size when the caller doesn't pass `count`. */
    export const DEFAULT_COUNT : number = 50;
    /** Hard ceiling on a page size (a caller can't ask for the world in one call). */
    export const MAX_COUNT : number = 200;

    /** The paging knobs a list request accepts (mix into a Query). */
    export interface Request
    {
        count? : number;   // desired page size
        start? : string;   // opaque page token (echo a prior page's `next`)
    }

    /** The paging block returned on every list response. */
    export interface Page
    {
        count  : number;    // items on this page
        total  : number;    // total items across all pages
        start? : string;    // token for this page (the current/previous cursor)
        next?  : string;    // token for the next page — ABSENT when this is the last page
    }

    /** The standard list envelope. `records` (not `data`) holds the page's items — a list reads
     *  `reply.data.records`, which is clearer than `reply.data.data`. */
    export interface Result<T>
    {
        records : Array<T>;
        page    : Page;
    }

    /** Clamp a requested page size into `[1, MAX_COUNT]`, defaulting when unset. */
    export function clampCount( count? : number ) : number
    {
        if( count === undefined || !Number.isFinite( count ) || count < 1 ) return DEFAULT_COUNT;
        return Math.min( Math.floor( count ), MAX_COUNT );
    }

    /** Parse an offset token to a non-negative integer (0 when absent/garbage). */
    function offset( token? : string ) : number
    {
        const parsed : number = parseInt( token ?? "0", 10 );
        return Number.isFinite( parsed ) && parsed > 0 ? parsed : 0;
    }

    /**
     * Page an ALREADY-FETCHED array (in-memory paging). Slices `[start, start+count)`, computes `total` from
     * the full array, and emits a `next` token only when more remain. Use in a list impl after it has read +
     * filtered its rows (which the contact/campaign impls already do on a single partition).
     */
    export function paginate<T>( all : Array<T>, request : Request ) : Result<T>
    {
        const count : number = clampCount( request.count );
        const start : number = offset( request.start );
        const items : Array<T> = all.slice( start, start + count );
        const consumed : number = start + items.length;
        const next : string | undefined = consumed < all.length ? String( consumed ) : undefined;
        return { records: items, page: { count: items.length, total: all.length, start: request.start, next } };
    }
}

export default Paging;

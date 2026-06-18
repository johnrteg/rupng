//
// Abstract sizing — developers pick a power level on a 1..10 scale instead of memorizing
// AWS instance types. The /cloud build maps (cpu, memory) -> the concrete instance class /
// task size / capacity per resource (see cloud/lib/sizing.ts).
//
//   1  = smallest / cheapest        5-6 = mid                 10 = largest
//
export type Scale = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;

export interface Sizing
{
    cpu?    : Scale;        // compute power, 1..10
    memory? : Scale;        // memory, 1..10
    size?   : Scale;        // shorthand: applied to both cpu and memory when those aren't set
}

/** The effective cpu/memory scales after applying the `size` shorthand. */
export interface ResolvedScale
{
    cpu    : Scale;
    memory : Scale;
}

/** Resolve the effective (cpu, memory) scales from a Sizing, applying the `size` shorthand. */
export function scales( s : Sizing | undefined ) : ResolvedScale
{
    const fallback : Scale = s?.size ?? 3;
    return {
        cpu    : s?.cpu    ?? fallback,
        memory : s?.memory ?? fallback,
    };
}

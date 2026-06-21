//
// Typed key-attribute builders that BIND a DynamoDB `TableSpec`'s keys to the entity's TypeScript
// interface — so a key's NAME must be a real field of the entity and its `AttrType` must match that
// field's type. A rename or a wrong type is a COMPILE error, not a deploy-time surprise. (DynamoDB is
// schemaless beyond keys, so the entity interface is the full schema; only the KEY fields cross into
// the manifest — this is how they stay in sync.) See DYNAMODB.md.
//
import { AttrType, KeyAttr } from "./Resources";

/** The DynamoDB `AttrType` that corresponds to a TS field's type: string→S, number→N, binary→B. */
export type AttrTypeOf<V> =
    [ NonNullable<V> ] extends [ string ]     ? AttrType.STRING :
    [ NonNullable<V> ] extends [ number ]     ? AttrType.NUMBER :
    [ NonNullable<V> ] extends [ Uint8Array ] ? AttrType.BINARY :
    never;

/**
 * The key-attribute builder for entity `E` — the type of `keyOf<E>()`. It's a generic FUNCTION
 * (a call signature): `name` must be a field of `E`, `type` the `AttrType` matching that field.
 */
export interface KeyBuilder<E>
{
    <K extends Extract<keyof E, string>>( name : K, type : AttrTypeOf<E[ K ]> ) : KeyAttr;
}

/** The TTL-attribute builder for entity `E` — the type of `ttlOf<E>()`; `name` must be a numeric field. */
export interface TtlBuilder<E>
{
    <K extends Extract<keyof E, string>>( name : AttrTypeOf<E[ K ]> extends AttrType.NUMBER ? K : never ) : string;
}

/**
 * Builder for a key attribute of entity `E`. `name` must be a field of `E`; `type` must be the
 * `AttrType` matching that field's TS type. Use for `partitionKey` / `sortKey` and GSI keys:
 *
 * ```ts
 * const k : KeyBuilder<Notice> = keyOf<Notice>();
 * partitionKey: k( "accountId", AttrType.STRING ),   // ok
 * sortKey:      k( "noticeId",  AttrType.STRING ),
 * // k( "acountId", … )            → error: not a field of Notice
 * // k( "accountId", AttrType.NUMBER ) → error: accountId is a string (S), not N
 * ```
 */
export function keyOf<E>() : KeyBuilder<E>
{
    return <K extends Extract<keyof E, string>>( name : K, type : AttrTypeOf<E[ K ]> ) : KeyAttr =>
        ( { name, type } );
}

/**
 * The TTL attribute name for entity `E` — constrained to a **numeric** field (DynamoDB TTL is
 * epoch-seconds). `ttlOf<Notice>()("expiresAt")` compiles only if `Notice["expiresAt"]` is a number.
 */
export function ttlOf<E>() : TtlBuilder<E>
{
    return <K extends Extract<keyof E, string>>(
        name : AttrTypeOf<E[ K ]> extends AttrType.NUMBER ? K : never,
    ) : string => name;
}

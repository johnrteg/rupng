//
// ValueUtils — generic presence checks (null / undefined). Was part of the old Validator.
//
export default class ValueUtils
{
    /** True if `value` is `undefined`. */
    public static isUndefined( value : any ) : boolean { return value === undefined; }

    /** True if `value` is not `undefined`. */
    public static notUndefined( value : any ) : boolean { return value !== undefined; }

    /** True if `value` is `null`. */
    public static isNull( value : any ) : boolean { return value === null; }

    /** True if `value` is not `null`. */
    public static notNull( value : any ) : boolean { return value !== null; }

    public static isValid( value : any ) : boolean { return ValueUtils.notUndefined( value ) && ValueUtils.notNull( value ) }
}

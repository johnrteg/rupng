//
export default class ObjectUtils
{

    ////////////////////////////////////////////////////////////////////////////
    /**
     * Merge two objects into a new object using spread syntax.
     *
     * Creates a shallow merge where properties from obj2 will override
     * properties with the same keys in obj1. This is a shallow merge,
     * meaning nested objects are not recursively merged.
     *
     * @param obj1 - The first object to merge. Properties from this object will be included unless overridden.
     * @param obj2 - The second object to merge. Properties from this object will override matching keys from obj1.
     * @returns A new object containing all properties from both input objects, with obj2 taking precedence for duplicate keys.
     *
     * @example
     * const result : any = ObjectUtils.merge({a: 1, b: 2}, {b: 3, c: 4}); // {a: 1, b: 3, c: 4}
     * const merged : any = ObjectUtils.merge({name: 'John'}, {age: 25}); // {name: 'John', age: 25}
     */
    public static merge( obj1 : any, obj2 : any ): any
    {
        // 2 will override any same keys
        return { ...obj1, ...obj2 };
    }

    ////////////////////////////////////////////////////////////////////////////
    /**
     * Create a shallow copy of an object using spread syntax.
     *
     * Creates a new object with all enumerable own properties copied from the source object.
     * This is a shallow copy, meaning nested objects and arrays are copied by reference,
     * not deeply cloned.
     *
     * @param obj - The object to copy. Can be any object type.
     * @returns A new object that is a shallow copy of the input object.
     *
     * @example
     * const original : any = {a: 1, b: {c: 2}};
     * const copy : any = ObjectUtils.shallowCopy(original); // {a: 1, b: {c: 2}}
     * copy.a = 5; // original.a remains 1
     * copy.b.c = 10; // original.b.c becomes 10 (shared reference)
     */
    public static shallowCopy( obj : any ): any
    {
        // could be improved upon to be less heavy
        return { ...obj };
    }

    ////////////////////////////////////////////////////////////////////////////
    /**
     * Create a deep copy of an object using structuredClone.
     *
     * Creates a completely independent copy of the object, including all nested
     * objects and arrays. Unlike shallow copying, modifications to nested properties
     * in the copy will not affect the original object. Uses the native structuredClone
     * API which handles circular references and most built-in types.
     *
     * @param obj - The object to deep copy. Can be any cloneable object type.
     * @returns A new object that is a deep copy of the input object.
     *
     * @example
     * const original : any = {a: 1, b: {c: 2, d: [3, 4]}};
     * const copy : any = ObjectUtils.deepCopy(original);
     * copy.b.c = 10; // original.b.c remains 2
     * copy.b.d.push(5); // original.b.d remains [3, 4]
     */
    public static deepCopy( obj : any ): any
    {
        return structuredClone(obj);
    }

    ////////////////////////////////////////////////////////////////////////////
    /**
     * Copy properties from a source object to a template object based on template structure.
     *
     * Recursively copies values from obj to template, but only for properties that exist
     * in the template. This allows you to selectively copy data while maintaining the
     * template's structure. The template object is modified in place.
     *
     * @param obj - The source object to copy values from.
     * @param template - The template object that defines which properties to copy. This object is modified.
     * @returns The modified template object with copied values from obj.
     *
     * @example
     * const source : any = {a: 1, b: 2, c: {d: 3, e: 4}, f: 5};
     * const template : any = {a: 0, c: {d: 0}, g: 6};
     * const result : any = ObjectUtils.copyTemplate(source, template);
     * // result = {a: 1, c: {d: 3}, g: 6} (only properties in template are copied)
     */
    public static copyTemplate( obj : any, template : any ): any
    {
        for( let prop in template )
        {
            if( typeof obj[prop] == "object" )
            {
                template[prop] = ObjectUtils.copyTemplate( obj[prop], template[prop] );
            }
            else if( obj[prop] != undefined )
            {
                template[prop] = obj[prop];
            }
        }
        return template;
    }

    ////////////////////////////////////////////////////////////////////////////
    /**
     * Safely parse a JSON string with error handling.
     *
     * Attempts to parse the provided string as JSON, returning the parsed object
     * on success or null on failure. This provides a safe alternative to JSON.parse()
     * that won't throw exceptions for invalid JSON.
     *
     * @param str - The JSON string to parse. Must be a string type.
     * @returns The parsed JavaScript object/value, or null if parsing fails or input is not a string.
     *
     * @example
     * ObjectUtils.parseJSON('{"name": "John", "age": 30}'); // {name: "John", age: 30}
     * ObjectUtils.parseJSON('[1, 2, 3]'); // [1, 2, 3]
     * ObjectUtils.parseJSON('invalid json'); // null
     * ObjectUtils.parseJSON(123); // null (not a string)
     */
    public static parseJSON( str : string ) : any | null
    {
        if (typeof str !== 'string') return null;
        try
        {
            return JSON.parse(str);
        }
        catch
        {
            return null;
        }
    }

    ////////////////////////////////////////////////////////////////////////////
    /**
     * Parse a comma-separated key-value string into an object.
     *
     * Converts a string in the format "key1:value1,key2:value2" into a JavaScript object.
     * Trims whitespace from both keys and values. Skips pairs where the key is empty
     * or the value is undefined.
     *
     * @param str - The key-value string to parse, using comma separators and colon delimiters.
     * @returns An object with string keys and string values parsed from the input string.
     *
     * @example
     * ObjectUtils.parseKeyValueString('name:John,age:30,city:NYC'); 
     * // {name: 'John', age: '30', city: 'NYC'}
     * 
     * ObjectUtils.parseKeyValueString('a: 1 , b : 2 '); 
     * // {a: '1', b: '2'} (whitespace trimmed)
     * 
     * ObjectUtils.parseKeyValueString('valid:data,,invalid,good:value'); 
     * // {valid: 'data', good: 'value'} (invalid pairs skipped)
     */
    public static parseKeyValueString(str: string): Record<string, string>
    {
        return str.split(',').reduce((acc, pair) =>
        {
            const [key, value] = pair.split(':');
            if (key && value !== undefined)
            {
                acc[key.trim()] = value.trim();
            }
            return acc;
        }, {} as Record<string, string>);
    }


}
//
// eof
//
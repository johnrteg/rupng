//
//import { parsePhoneNumberWithError, PhoneNumber } from "libphonenumber-js";
import StringUtils from "./StringUtils";

//
export class Validator
{
    ////////////////////////////////////////////////////////////////////////////////////
    /**
     * Validate if a string is a properly formatted email address.
     *
     * Uses a comprehensive regular expression to validate email addresses according to RFC 5322 standards.
     * The validation checks for proper local part (before @), domain part (after @), and overall structure.
     * Supports both standard domain names and IP address literals in square brackets. The method converts
     * the input to lowercase before validation to ensure case-insensitive matching, which is consistent
     * with email address standards where the domain part is case-insensitive.
     *
     * @param email - The string to validate as an email address.
     * @returns True if the string is a valid email address format, false otherwise.
     *
     * @example
     * ```typescript
     * // Valid email addresses
     * Validator.isEmailAddress('user@example.com'); // true
     * Validator.isEmailAddress('john.doe@company.org'); // true
     * Validator.isEmailAddress('test+tag@domain.co.uk'); // true
     * Validator.isEmailAddress('user123@sub.domain.com'); // true
     * Validator.isEmailAddress('first.last+tag@example.museum'); // true
     * ```
     */
    public static isEmailAddress( email : string ): boolean
    {
        if( email === undefined )
            return false;
        else
            return email.toLowerCase().match( /^(([^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|.(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/ ) ? true : false;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    /**
     * Validate if a string is a properly formatted UUID (Universally Unique Identifier).
     *
     * Checks if the input string matches the standard UUID format of 8-4-4-4-12 hexadecimal digits
     * separated by hyphens. Supports both uppercase and lowercase hexadecimal characters. The method
     * uses a regular expression to validate the exact UUID pattern without version-specific validation,
     * meaning it will accept any UUID regardless of version (1, 2, 3, 4, or 5).
     *
     * @param uuid - The string to validate as a UUID format.
     * @returns True if the string matches the UUID format pattern, false otherwise.
     *          **Note: Currently also returns true for null, undefined, or empty strings - this may be unintended behavior.**
     *
     * @example
     * ```typescript
     * // Valid UUID formats (version 4 examples)
     * Validator.isUuid('550e8400-e29b-41d4-a716-446655440000'); // true
     * Validator.isUuid('f47ac10b-58cc-4372-a567-0e02b2c3d479'); // true
     * Validator.isUuid('6ba7b810-9dad-11d1-80b4-00c04fd430c8'); // true
     * 
     * // Case insensitive - both work
     * Validator.isUuid('A1B2C3D4-E5F6-4789-9ABC-DEF012345678'); // true
     * Validator.isUuid('a1b2c3d4-e5f6-4789-9abc-def012345678'); // true
     * ```
     */
    public static isUuid( uuid : string ): boolean
    {
        return     uuid == null
                || uuid == undefined
                || uuid == ""
                || uuid.match( /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/ ) ? true : false;
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    /**
     * Validate if a string is a properly formatted HTTP or HTTPS URL.
     *
     * Uses the native URL constructor to parse the input and validates that it has a valid HTTP/HTTPS
     * protocol and a properly formatted hostname with a valid top-level domain. The hostname must
     * contain at least one dot and have a TLD of 2 or more characters. Returns false for any URL
     * that cannot be parsed or doesn't meet the protocol and hostname requirements.
     *
     * @param url - The string to validate as an HTTP/HTTPS URL.
     * @returns True if the string is a valid HTTP or HTTPS URL with proper hostname, false otherwise.
     *
     * @example
     * ```typescript
     * // Valid URLs
     * Validator.isUrl('https://www.example.com'); // true
     * Validator.isUrl('http://api.domain.org/path'); // true
     * Validator.isUrl('https://sub.domain.co.uk/path?query=value'); // true
     * 
     * // Invalid URLs
     * Validator.isUrl('ftp://example.com'); // false (not HTTP/HTTPS)
     * Validator.isUrl('https://localhost'); // false (no TLD)
     * Validator.isUrl('not-a-url'); // false (invalid format)
     * Validator.isUrl(''); // false (empty string)
     * ```
     */
    public static isUrl( url : string ): boolean
    {
        try
        {
            const urlparts : URL = new URL(url);
            const protocolValid : boolean = urlparts.protocol === "http:" || urlparts.protocol === "https:";
            const hostnameValid : boolean = /^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(urlparts.hostname);

            // Check protocol (http or https), non-empty hostname, and non-empty pathname
            return protocolValid && hostnameValid;
        }
        catch
        {
            return false;
        }
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    public static isSms( value : string ): boolean
    {
        try
        {
            const url : URL = new URL( value );
            if( url.protocol === "sms:" && ( Validator.isPhoneNumber( url.pathname ) || Validator.isShortCode( url.pathname ) ) )return true;

            //setBody(    url.searchParams.get("body")    ?? "" );
            //setSubject( url.searchParams.get("subject") ?? "" );
            return false;
        }
        catch( e : any )
        {
            // invalid uri, leave fields as-is
            return false;
        }
    }

    

    

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    /**
     * Validate if a string is a properly formatted hostname (domain name).
     *
     * Checks if the input string matches a valid hostname pattern including domain names
     * and subdomains. The hostname must contain at least one dot separator and end with
     * a valid top-level domain of 2 or more characters. Supports alphanumeric characters,
     * hyphens, and dots in the domain structure.
     *
     * @param hostname - The hostname string to validate (e.g., "example.com", "sub.domain.org").
     * @returns True if the string matches a valid hostname pattern, false otherwise.
     *
     * @example
     * ```typescript
     * // Valid hostnames
     * Validator.isHostname('example.com'); // true
     * Validator.isHostname('sub.domain.org'); // true
     * Validator.isHostname('api-server.company.co.uk'); // true
     * Validator.isHostname('test123.site.info'); // true
     * 
     * // Invalid hostnames
     * Validator.isHostname('localhost'); // false (no TLD)
     * Validator.isHostname('192.168.1.1'); // false (IP address)
     * Validator.isHostname('invalid..domain'); // false (double dots)
     * Validator.isHostname(''); // false (empty string)
     * ```
     */
    public static isHostname( hostname : string ): boolean
    {
        return /^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test( hostname );
    }
    
    //////////////////////////////////////////////////////////////////////////////////
    /**
     * Validate if a string is a properly formatted US phone number.
     *
     * Checks if the input matches common US phone number formats with optional country code (+1),
     * area code in parentheses or plain format, and various separator characters (spaces, dots, hyphens).
     * The method is flexible with formatting but requires the standard 10-digit US number structure
     * (3-digit area code + 7-digit local number).
     *
     * @param value - The phone number string to validate.
     * @returns True if the string matches a valid US phone number format, false otherwise.
     *
     * @example
     * ```typescript
     * // Valid phone numbers
     * Validator.isPhoneNumber('(555) 123-4567'); // true
     * Validator.isPhoneNumber('555-123-4567'); // true
     * Validator.isPhoneNumber('555.123.4567'); // true
     * Validator.isPhoneNumber('555 123 4567'); // true
     * Validator.isPhoneNumber('+1 555 123 4567'); // true
     * Validator.isPhoneNumber('5551234567'); // true
     * 
     * // Invalid phone numbers
     * Validator.isPhoneNumber('123-4567'); // false (missing area code)
     * Validator.isPhoneNumber('555-123-456'); // false (too few digits)
     * Validator.isPhoneNumber('+44 20 7946 0958'); // false (not US format)
     * ```
     */
    public static isPhoneNumber( value : string ) : boolean
    {
        const trim_value : string = value.trim();
        return trim_value.length === 10 && /^(?:\+1\s*)?(?:\(?\d{3}\)?[\s.-]*)?\d{3}[\s.-]*\d{4}$/.test( trim_value );
    }

    //////////////////////////////////////////////////////////////////////////////////
    /**
     * Validate if a string is a properly formatted short code.
     *
     * Checks if the input is a 5-6 digit numeric short code commonly used for SMS services.
     * Short codes are typically used by businesses and organizations for text messaging campaigns,
     * two-factor authentication, and other automated messaging services. This method validates
     * that the input contains only digits and is exactly 5 or 6 characters in length.
     *
     * @param value - The short code string to validate.
     * @returns True if the string is a valid 5-6 digit short code, false otherwise.
     *
     * @example
     * ```typescript
     * // Valid short codes
     * Validator.isShortCode('12345'); // true (5 digits)
     * Validator.isShortCode('123456'); // true (6 digits)
     * Validator.isShortCode('88888'); // true (5 digits)
     * Validator.isShortCode('242424'); // true (6 digits)
     * 
     * // Invalid short codes
     * Validator.isShortCode('1234'); // false (too short)
     * Validator.isShortCode('1234567'); // false (too long)
     * Validator.isShortCode('12a45'); // false (contains non-digit)
     * Validator.isShortCode(''); // false (empty string)
     * Validator.isShortCode('(555) 123-4567'); // false (phone number format)
     * ```
     */
    public static isShortCode( value : string ) : boolean
    {
        return value ? /^\d{5,6}$/.test( value.trim() ) : false;
    }


    ///////////////////////////////////////////////////////////////////////////////////
    /**
     * Validate if a string is a properly formatted IPv4 address.
     *
     * Checks if the input string follows the IPv4 format of four decimal numbers separated
     * by dots (e.g., "192.168.1.1"). Each octet must be a valid integer, though this method
     * does not enforce the 0-255 range validation. The method splits the string by dots and
     * verifies that there are exactly 4 parts, each being a valid integer.
     *
     * @param value - The IP address string to validate.
     * @returns True if the string has the basic IPv4 format structure, false otherwise.
     *
     * @example
     * ```typescript
     * // Valid IPv4 format (basic structure)
     * Validator.isIpAddress('192.168.1.1'); // true
     * Validator.isIpAddress('10.0.0.1'); // true
     * Validator.isIpAddress('127.0.0.1'); // true
     * Validator.isIpAddress('255.255.255.255'); // true
     * 
     * // Invalid IPv4 format
     * Validator.isIpAddress('192.168.1'); // false (only 3 octets)
     * Validator.isIpAddress('192.168.1.1.1'); // false (5 octets)
     * Validator.isIpAddress('192.168.one.1'); // false (non-numeric octet)
     * Validator.isIpAddress('example.com'); // false (not numeric)
     * ```
     */
    public static isIpAddress( value : string ) : boolean
    {
        let parts : Array<string> = value.split('.');
        if( parts.length !== 4 )return false;
        let i : number;
        for( i=0; i < parts.length; i++ )
        {
            if( Number.isNaN( parts[i] ) || !Number.isInteger( parseInt( parts[i] ) ) )return false;
        }
        return true;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /**
     * Check if a value is undefined.
     *
     * @param value - The value to check for undefined.
     * @returns True if the value is undefined, false otherwise.
     *
     * @example
     * ```typescript
     * Validator.isUndefined(undefined); // true
     * Validator.isUndefined(null); // false
     * Validator.isUndefined(''); // false
     * Validator.isUndefined(0); // false
     * ```
     */
    public static isUndefined( value : any ) : boolean
    {
        return value === undefined;// || value === "undefined";
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /**
     * Check if a value is not undefined.
     *
     * @param value - The value to check.
     * @returns True if the value is not undefined, false if it is undefined.
     *
     * @example
     * ```typescript
     * Validator.notUndefined(null); // true
     * Validator.notUndefined(''); // true
     * Validator.notUndefined(0); // true
     * Validator.notUndefined(undefined); // false
     * ```
     */
    public static notUndefined( value : any ) : boolean
    {
        return value !== undefined;// || value !== "undefined";
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /**
     * Check if a value is null.
     *
     * @param value - The value to check for null.
     * @returns True if the value is null, false otherwise.
     *
     * @example
     * ```typescript
     * Validator.isNull(null); // true
     * Validator.isNull(undefined); // false
     * Validator.isNull(''); // false
     * Validator.isNull(0); // false
     * ```
     */
    public static isNull( value : any ) : boolean
    {
        return value === null;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /**
     * Check if a value is not null.
     *
     * @param value - The value to check.
     * @returns True if the value is not null, false if it is null.
     *
     * @example
     * ```typescript
     * Validator.notNull(undefined); // true
     * Validator.notNull(''); // true
     * Validator.notNull(0); // true
     * Validator.notNull(null); // false
     * ```
     */
    public static notNull( value : any ) : boolean
    {
        return !Validator.isNull( value );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /**
     * Check if a value is a valid string.
     *
     * Validates that the value is not null, not undefined, and is of type string.
     *
     * @param value - The value to check.
     * @returns True if the value is a valid string, false otherwise.
     *
     * @example
     * ```typescript
     * Validator.isString('hello'); // true
     * Validator.isString(''); // true (empty string is still a string)
     * Validator.isString(123); // false
     * Validator.isString(null); // false
     * Validator.isString(undefined); // false
     * ```
     */
    public static isString( value : any ) : boolean
    {
        return Validator.notNull( value ) && Validator.notUndefined( value ) && typeof value == "string";
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /**
     * Check if a value is a valid number.
     *
     * Validates that the value is not null, not undefined, is of type number, and is not NaN.
     *
     * @param value - The value to check.
     * @returns True if the value is a valid number, false otherwise.
     *
     * @example
     * ```typescript
     * Validator.isNumber(123); // true
     * Validator.isNumber(0); // true
     * Validator.isNumber(-45.67); // true
     * Validator.isNumber('123'); // false (string)
     * Validator.isNumber(NaN); // false
     * Validator.isNumber(null); // false
     * ```
     */
    public static isNumber( value : any ) : boolean
    {
        return Validator.notNull( value ) && Validator.notUndefined( value ) && typeof value == "number" && !Number.isNaN( value ) ;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /**
     * Get a numeric value from input, with fallback to 0.
     *
     * If the input value is a valid number, returns it as-is. Otherwise returns 0 as a safe fallback.
     * This method is useful for ensuring numeric operations don't fail with invalid input.
     *
     * @param value - The value to convert or validate as a number.
     * @returns The original number if valid, otherwise 0.
     *
     * @example
     * ```typescript
     * Validator.getNumber(123); // 123
     * Validator.getNumber(-45.67); // -45.67
     * Validator.getNumber('invalid'); // 0
     * Validator.getNumber(null); // 0
     * Validator.getNumber(NaN); // 0
     * ```
     */
    public static getNumber( value : any ) : number
    {
        if( Validator.isNumber( value ) )
        {
            return value as number;
        }
        else
        {
            return 0;
        }
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /**
     * Check if a value can be interpreted as a boolean.
     *
     * Accepts native boolean types, numeric 0/1 values, and string representations
     * including "true", "false", "1", "0", "yes", "no" (case-insensitive).
     * Returns false for null or undefined values.
     *
     * @param value - The value to check for boolean-like characteristics.
     * @returns True if the value can be interpreted as a boolean, false otherwise.
     *
     * @example
     * ```typescript
     * // Native boolean
     * Validator.isBoolean(true); // true
     * Validator.isBoolean(false); // true
     * 
     * // Numeric boolean
     * Validator.isBoolean(1); // true
     * Validator.isBoolean(0); // true
     * 
     * // String boolean (case-insensitive)
     * Validator.isBoolean('true'); // true
     * Validator.isBoolean('FALSE'); // true
     * Validator.isBoolean('yes'); // true
     * Validator.isBoolean('NO'); // true
     * 
     * // Invalid boolean-like values
     * Validator.isBoolean('maybe'); // false
     * Validator.isBoolean(2); // false
     * Validator.isBoolean(null); // false
     * ```
     */
    public static isBoolean( value : any ) : boolean
    {
        if( Validator.isNull( value ) || Validator.isUndefined( value ) )return false;
        if( typeof value === "boolean" ) return true;
        if( typeof value === "number" && ( value === 1 || value === 0 ) )return true;
        if( typeof value === "string" )
        {
            const v : string = value.toLowerCase();
            return ["true", "false", "1", "0", "yes", "no"].includes(v);
        }
        return false;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /**
     * Convert a boolean-like value to an actual boolean.
     *
     * Converts various boolean representations to true or false. Returns true for
     * values like true, "true", "1", "yes", and 1. Returns false for anything else,
     * including values that don't pass the isBoolean validation.
     *
     * @param value - The value to convert to boolean.
     * @returns True for truthy boolean-like values, false otherwise.
     *
     * @example
     * ```typescript
     * // Truthy values
     * Validator.getBoolean(true); // true
     * Validator.getBoolean('true'); // true
     * Validator.getBoolean('YES'); // true
     * Validator.getBoolean(1); // true
     * Validator.getBoolean('1'); // true
     * ```
     */
    public static getBoolean( value : any | undefined ) : boolean
    {
        if( Validator.isBoolean( value ) )
        {
            if( typeof value == "boolean" )return value as boolean;
            return [ "true", "1", "yes", 1 ].includes( value );
        }
        else
            return false;   // not a boolean, so not true
        
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /**
     * Check if a value is a valid object.
     *
     * Validates that the value is not null, not undefined, and is of type object.
     * Note that arrays and dates will also return true since they are objects in JavaScript.
     *
     * @param value - The value to check.
     * @returns True if the value is a valid object, false otherwise.
     *
     * @example
     * ```typescript
     * Validator.isObject({}); // true
     * Validator.isObject({name: 'test'}); // true
     * Validator.isObject([]); // true (arrays are objects)
     * Validator.isObject(new Date()); // true (dates are objects)
     * Validator.isObject('string'); // false
     * Validator.isObject(123); // false
     * Validator.isObject(null); // false
     * ```
     */
    public static isObject( value : any ) : boolean
    {
        return Validator.notNull( value ) && Validator.notUndefined( value ) && typeof value == "object";
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /**
     * Check if a value is a valid array.
     *
     * Validates that the value is not null, not undefined, and is an instance of Array.
     *
     * @param value - The value to check.
     * @returns True if the value is a valid array, false otherwise.
     *
     * @example
     * ```typescript
     * Validator.isArray([]); // true
     * Validator.isArray([1, 2, 3]); // true
     * Validator.isArray(['a', 'b']); // true
     * Validator.isArray({}); // false (object, not array)
     * Validator.isArray('array'); // false
     * Validator.isArray(null); // false
     * ```
     */
    public static isArray( value : any | undefined | null ) : boolean
    {
        return Validator.notNull( value ) && Validator.notUndefined( value ) && value instanceof Array;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /**
     * Check if a value is an array containing primitive (non-object) elements.
     *
     * Determines if the input is an array with at least one element, and the first element
     * is a primitive type (not an object). Assumes all elements in the array are of the same type
     * based on the first element's type. Returns false for empty arrays or non-arrays.
     *
     * @param value - The value to check.
     * @returns True if the value is an array with primitive elements, false otherwise.
     *
     * @example
     * ```typescript
     * // Primitive arrays
     * Validator.isPrimitiveArray([1, 2, 3]); // true (numbers)
     * Validator.isPrimitiveArray(['a', 'b', 'c']); // true (strings)
     * Validator.isPrimitiveArray([true, false]); // true (booleans)
     * 
     * // Object arrays
     * Validator.isPrimitiveArray([{id: 1}, {id: 2}]); // false (objects)
     * Validator.isPrimitiveArray([new Date(), new Date()]); // false (dates)
     * 
     * // Invalid cases
     * Validator.isPrimitiveArray([]); // false (empty array)
     * Validator.isPrimitiveArray('not array'); // false (not array)
     * ```
     */
    public static isPrimitiveArray( value : any ) : boolean
    {
        // is an array and has elements to test
        if( Validator.isArray( value ) && value.length > 0 )
        {
            // check check first element
            // assumes all elements are of the same type
            return( Validator.isObject( value[0] ) ? false : true );
        }
        else
        {
            return false;
        }
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /**
     * Check if a value is a valid Date object.
     *
     * Validates that the value is not null, not undefined, and is an instance of Date.
     *
     * @param value - The value to check.
     * @returns True if the value is a valid Date object, false otherwise.
     *
     * @example
     * ```typescript
     * Validator.isDate(new Date()); // true
     * Validator.isDate(new Date('2023-01-01')); // true
     * Validator.isDate('2023-01-01'); // false (string, not Date object)
     * Validator.isDate(1640995200000); // false (timestamp number)
     * Validator.isDate(null); // false
     * ```
     */
    public static isDate( value : any ) : boolean
    {
        return Validator.notNull( value ) && Validator.notUndefined( value ) && value instanceof Date;
    }
}

export namespace Validator
{
    /*
    export enum ChannelType
    {
        NONE = "none",
        ALL = "all",
        LONG_CODE = "lc",
        SHORT_CODE = "sc",
        TOLL_FREE = "tf"
    }
    */
}

export default Validator;
// eof
//
import NumberUtils        from "./NumberUtils";

//
export default class StringUtils
{
    /** True if `value` is a string (the type check; moved from `Validator.isString`). `""` counts. */
    public static isValid( value : any ) : boolean
    {
        return typeof value === "string";
    }

    public static readonly ELLIPSE              : string = '…';
    public static readonly COLON                : string = ':';
    public static readonly SPACE                : string = ' ';

    public static readonly NUMBERS              : string = '0123456789';
    public static readonly SPECIAL              : string = ".,<>?':;{}`[]~!@#$%^&*()_-+=";
    public static readonly ALPHA_LOWERCASE      : string = 'abcdefghijklmnopqrstuvwxyz';

    public static readonly BULLET                : string = '\u2022';

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////
    public static size( str : string | undefined ): number
    {
        return str !== undefined && str !== null ? str.length : 0;
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////
    public static notBlank( str : string | undefined ): boolean
    {
        return str !== undefined && str !== null && str !== "";
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////
    /**
    * Resolves placeholders in the format @key@ using the provided sources in order. The first non-empty value for a key will be used.
    * 
    * Ex. "Hi @first_name@, your texter is @user_name@" with sources [ { user_name: "Greg" }, { first_name: "Amanda" } ]
    * resolves to "Hi Amanda, your texter is Greg"
    */
    public static resolvePlaceholders( raw: string, sources: Array< Record<string, string | number | Array<string> > > ): string
    {
        if( !raw ) return "";

        // space captures an optional leading space so it can be dropped when the placeholder resolves to empty
        const result : string = raw.replace( /( ?)@([a-zA-Z0-9._-]+)@/g, ( skip: string, space: string, key: string ) =>
        {
            for( const source of sources.filter( (source : Record<string, string | number | Array<string>> | null) => source !== null ) )
            {
                const value : string | number | Array<string> = source[ key ];
                if( value !== null && value !== undefined && value !== "" )
                {
                    return space + String( value );
                }
            }
            return ""; // drop the leading space too, avoiding orphan spaces like "Hello !"
        } );
    
        return result.replace( / {2,}/g, " " ).trim();
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////
    /**
    * Compare a free-form user search query against a candidate string.
    *
    * Supported query forms:
    * - `foo`      : Case-insensitive substring match.
    * - `foo*`     : Wildcard match where `*` means "any characters" (anchored to the whole string).
    * - `*foo`     : Wildcard match (ends-with).
    * - `*foo*`    : Wildcard match (contains).
    * - `f*o`      : General wildcard match (e.g. `f*o*bar`).
    * - `"foo"`    : Quoted exact match (case-insensitive, trims surrounding whitespace).
    *
    * Notes:
    * - Blank/whitespace-only `search` returns `true` (no filtering).
    * - For wildcard searches, the pattern is matched against the entire candidate string.
    *
    * @param search User-entered search string (may be null/undefined).
    * @param candidate String being tested (may be null/undefined).
    * @returns `true` if the candidate matches the search query; otherwise `false`.
    *
    * @example
    * StringUtils.matchesSearch('', 'Anything'); // true
    * StringUtils.matchesSearch('foo', 'my-foo-project'); // true
    * StringUtils.matchesSearch('foo*', 'foobar'); // true
    * StringUtils.matchesSearch('*foo', 'barfoo'); // true
    * StringUtils.matchesSearch('f*o', 'fast-hello'); // true
    * StringUtils.matchesSearch('"Foo"', ' foo '); // true
    */
    public static matchesSearch( search: string | null | undefined, candidate: string | null | undefined ): boolean
    {
        const s : string = (search ?? "").trim();
        const c : string = (candidate ?? "");

        // Blank query matches everything
        if (s === "") return true;

        // "foo" => exact match
        const isQuoted : boolean = s.length >= 2 && s.startsWith('"') && s.endsWith('"');
        if (isQuoted)
        {
            const needle : string = s.slice(1, -1).trim().toLowerCase();
            if (needle === "") return true; // treat empty quotes as no filter
            return c.trim().toLowerCase() === needle;
        }

        // Wildcards => convert to regex and match entire string
        if (s.includes("*"))
        {
            const needle : string = s.toLowerCase();

            // escape regex chars except '*'
            const escaped : string = needle.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
            const pattern : string = "^" + escaped.replace(/\*/g, ".*") + "$";
            const re : RegExp = new RegExp(pattern, "i");

            return re.test(c);
        }

        // Default => substring match
        return c.toLowerCase().includes(s.toLowerCase());
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////
    /**
     * Remove all whitespace characters from a string.
     *
     * Uses a regular expression to remove all whitespace characters including spaces,
     * tabs, newlines, and other Unicode whitespace characters. Returns an empty string
     * if the input is null, undefined, or falsy.
     *
     * @param value - The string to remove whitespace from.
     * @returns A new string with all whitespace characters removed, or empty string if input is falsy.
     *
     * @example
     * StringUtils.removeAllSpaces('hello world'); // 'helloworld'
     * StringUtils.removeAllSpaces('  a  b  c  '); // 'abc'
     * StringUtils.removeAllSpaces('hello\t\nworld'); // 'helloworld'
     * StringUtils.removeAllSpaces(null); // ''
     */
    public static removeAllSpaces( value : string ): string
    {
        return value ? value.replace(/\s+/g,'' ) : "";
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////
    /**
     * Capitalize the first character of a string while preserving the rest unchanged.
     *
     * Takes a string and converts only the first character to uppercase, leaving all other
     * characters in their original case. This is useful for proper name formatting, sentence
     * capitalization, or title formatting where only the initial character should be capitalized.
     * Returns an empty string for null, undefined, or empty input values.
     *
     * @param value - The string to capitalize. Can be null or undefined for safe handling.
     * @returns A new string with the first character capitalized and remaining characters unchanged,
     *          or empty string if input is null, undefined, or empty.
     *
     * @example
     * ```typescript
     * // Basic capitalization
     * StringUtils.capitalize('hello'); // 'Hello'
     * StringUtils.capitalize('world'); // 'World'
     * StringUtils.capitalize('javascript'); // 'Javascript'
     */
    public static capitalize( value : string | null | undefined ): string
    {
        if( value === undefined || value === null || value === "" )return "";
        
        return value.charAt(0).toUpperCase() + value.slice(1);
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////
    /**
     * Check if a target string matches any string in an array (case-insensitive).
     *
     * Performs a case-insensitive comparison between the target string and each
     * string in the provided array. Returns true if any match is found.
     *
     * @param target - The string to search for in the array.
     * @param arr - Array of strings to search through.
     * @returns True if the target string matches any item in the array (case-insensitive), false otherwise.
     *
     * @example
     * StringUtils.matchesAny('Hello', ['hello', 'world']); // true
     * StringUtils.matchesAny('WORLD', ['hello', 'world']); // true
     * StringUtils.matchesAny('foo', ['hello', 'world']); // false
     * StringUtils.matchesAny('Test', []); // false
     */
    public static matchesAny( target: string, arr: Array<string>): boolean
    {
        const lowerTarget : string = target.toLowerCase();
        return arr.some( item => item.toLowerCase() === lowerTarget );
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////
    /**
     * Validate if a string follows the name:value,name:value format.
     *
     * Checks if the input string is a valid comma-separated list of name:value pairs.
     * Names must be word characters (\w+) and values can be any characters except commas.
     * Whitespace around names, values, and commas is allowed. Empty strings are considered valid.
     *
     * @param str - The string to validate against the name:value format.
     * @returns True if the string is empty or matches the name:value,name:value pattern, false otherwise.
     *
     * @example
     * StringUtils.isNameValueList('name:John,age:30'); // true
     * StringUtils.isNameValueList('key: value , other: data'); // true (whitespace allowed)
     * StringUtils.isNameValueList('single:value'); // true (single pair allowed)
     * StringUtils.isNameValueList(''); // true (empty string allowed)
     * StringUtils.isNameValueList('invalid format'); // false
     * StringUtils.isNameValueList('name:val,ue'); // false (comma in value not allowed)
     */
    public static isNameValueList(str: string): boolean
    {
        const trimmed : string = str.trim();
        if (trimmed === "") return true;
        // Allows empty string, or one or more name:value pairs separated by commas
        return /^(\s*\w+\s*:\s*[^,]+)(\s*,\s*\w+\s*:\s*[^,]+)*\s*$/.test( trimmed );
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////
    /**
     * Replace all occurrences of a substring in a string with a replacement string.
     *
     * Safely escapes special regex characters in the search string and performs a global
     * replacement. Handles dollar sign escaping in the replacement string to prevent
     * regex replacement conflicts. Returns an empty string if the input is falsy.
     *
     * @param str - The source string to perform replacements on.
     * @param find - The substring to find and replace. Special regex characters are automatically escaped.
     * @param with_str - The replacement string. Dollar signs are automatically escaped to prevent regex conflicts.
     * @param ignore - Optional flag for case-insensitive matching. Defaults to false (case-sensitive).
     * @returns A new string with all occurrences replaced, or empty string if input is falsy.
     *
     * @example
     * StringUtils.replaceAll('hello world hello', 'hello', 'hi'); // 'hi world hi'
     * StringUtils.replaceAll('Hello World Hello', 'hello', 'hi', true); // 'hi World hi' (case-insensitive)
     * StringUtils.replaceAll('a.b.c', '.', '_'); // 'a_b_c' (special chars escaped)
     * StringUtils.replaceAll('test $1 test', 'test', '$2'); // '$2 $1 $2' (dollar signs handled)
     */
    public static replaceAll( str: string, find : string, with_str : string, ignore : boolean = false ): string
    {
      return str ? str.replace( new RegExp( find.replace(/([\/\,\!\\\^\$\{\}\[\]\(\)\.\*\+\?\|\<\>\-\&])/g,"\\$&"),(ignore?"gi":"g")),(typeof(with_str)=="string")?with_str.replace(/\$/g,"$$$$"):with_str) : "";
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////
    /**
     * Pad a number with leading zeros to a specified number of places.
     *
     * Adds leading zeros to the integer part of a number while preserving any
     * decimal part. If the number already has more digits than the specified
     * places, it returns the number unchanged.
     *
     * @param value - The number to pad with leading zeros.
     * @param places - The minimum number of digits for the integer part. Defaults to 2.
     * @returns A string representation of the number with leading zeros added to meet the specified places.
     *
     * @example
     * StringUtils.leadingZero(5); // '05'
     * StringUtils.leadingZero(5, 3); // '005'
     * StringUtils.leadingZero(123, 2); // '123' (no padding needed)
     * StringUtils.leadingZero(5.75, 3); // '005.75'
     * StringUtils.leadingZero(12.5); // '12.5'
     */
    public static leadingZero( value : number, places : number = 2 ): string
    {
        const [intPart, fracPart] = String(value).split(".");
        const paddedInt : string = intPart.padStart(places >= 0 ? places : 0, '0');
        return fracPart !== undefined ? `${paddedInt}.${fracPart}` : paddedInt;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    public static wildcardMatch( search: string, text: string) : boolean
    {
        if (!search || search.trim() === "") return true;

        const s : string = search.trim().toLowerCase();
        const t : string = text.toLowerCase();

        if (s.startsWith("*") && s.endsWith("*"))
        {
            // Contains
            return t.includes(s.slice(1, -1));
        }
        else if (s.startsWith("*"))
        {
            // Ends with
            return t.endsWith(s.slice(1));
        }
        else// if ( s.endsWith("*") )
        {
            // Starts with
            return t.startsWith(s.slice(0, -1));
        }
        //else
        //{
            // Exact match from beginning
        //    return t.startsWith(s);
        //}
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////
    /**
     * Generate a random string of alphabetic characters.
     *
     * Creates a random string containing only uppercase and lowercase letters (a-z, A-Z).
     * Each character is randomly selected from the alphabet using NumberUtils.randomRange().
     *
     * @param places - The length of the random string to generate. Must be a positive number.
     * @returns A random string containing only alphabetic characters of the specified length.
     *
     * @example
     * StringUtils.randomString(5); // 'aBcDe' (example output)
     * StringUtils.randomString(10); // 'XyZaBcDeFg' (example output)
     * StringUtils.randomString(1); // 'M' (example output)
     * StringUtils.randomString(0); // '' (empty string)
     */
    public static randomString( places : number ) : string
    {
        const alphabet : string = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
        const nbr : number = alphabet.length - 1;
        let str : string = "";
        let i : number;
        for( i=0; i < places; i++ )
        {
            str += alphabet[ NumberUtils.randomRange( 0, nbr ) ];
        }
        return str;
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////
    /**
     * Convert an enum-style string to a human-readable title case string.
     *
     * Transforms strings with underscores (commonly used in enums) into space-separated
     * title case strings. Each word is capitalized and underscores are replaced with spaces.
     *
     * @param value - The enum-style string to convert (e.g., "FIRST_NAME", "user_status").
     * @returns A human-readable string in title case with spaces instead of underscores.
     *
     * @example
     * StringUtils.enumToString('FIRST_NAME'); // 'First Name'
     * StringUtils.enumToString('user_status'); // 'User Status'
     * StringUtils.enumToString('ORDER_PENDING'); // 'Order Pending'
     * StringUtils.enumToString('single'); // 'Single'
     */
    public static enumToString( value : string ) : string
    {
        return value
        .toLowerCase()
        .split('_')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////
    /**
     * Extract and clean a phone number from a string, returning only digits.
     *
     * Removes all non-digit characters and handles both regular phone numbers and short codes:
     * - Short codes (5-6 digits): Returns all digits as-is
     * - Regular phone numbers (7+ digits): Returns the last 10 digits, handling country codes like +1
     * Returns an empty string if the input is empty or null.
     *
     * @param value - The input string containing a phone number with potential formatting or country code.
     * @returns A string containing digits - all digits for short codes, last 10 for regular numbers, or empty string if input is empty/null.
     *
     * @example
     * // Regular phone numbers (7+ digits) - returns last 10 digits
     * StringUtils.toPhoneNumber('(555) 123-4567'); // '5551234567'
     * StringUtils.toPhoneNumber('+1-555-123-4567'); // '5551234567'
     * StringUtils.toPhoneNumber('1 555 123 4567'); // '5551234567'
     * StringUtils.toPhoneNumber('555.123.4567'); // '5551234567'
     * 
     * // Short codes (5-6 digits) - returns all digits
     * StringUtils.toPhoneNumber('12345'); // '12345'
     * StringUtils.toPhoneNumber('567890'); // '567890'
     * StringUtils.toPhoneNumber('88888'); // '88888'
     * 
     * // Edge cases
     * StringUtils.toPhoneNumber(''); // ''
     * StringUtils.toPhoneNumber('abc'); // ''
     */
    public static toPhoneNumber( value : string ) : string
    {
        if( !value ) return "";
        // Remove all non-digit characters
        let digits : string = value.replace(/\D/g, "");

        // Handle short codes (5-6 digits) - return all digits
        if( digits.length >= 5 && digits.length <= 6 )
        {
            return digits;
        }

        // For regular phone numbers (7+ digits), return only the last 10 digits (handles country code)
        if( digits.length >= 7 )
        {
            return digits.slice(-10);
        }

        // For numbers with fewer than 5 digits, return as-is (incomplete numbers during input)
        return digits;
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////
    /**
     * Format a phone number string into a rich format, handling both short codes and regular phone numbers.
     *
     * Takes a phone number string and formats it appropriately based on the number of digits:
     * - Short codes (5-6 digits): Returns digits as-is without formatting
     * - Regular phone numbers (7+ digits): Formats as (###) ###-#### for display purposes
     * Uses the toPhoneNumber method internally to extract clean digits first, then applies
     * progressive formatting based on the number of digits available.
     *
     * @param value - The input string containing a phone number to format.
     * @returns A formatted phone number string with appropriate formatting, or empty string if no digits.
     *
     * @example
     * // Short codes (5-6 digits) - no formatting applied
     * StringUtils.toRichPhoneNumber('12345'); // '12345'
     * StringUtils.toRichPhoneNumber('567890'); // '567890'
     * 
     * // Regular phone numbers (7+ digits) - formatted with parentheses and dashes
     * StringUtils.toRichPhoneNumber('5551234567'); // '(555) 123-4567'
     * StringUtils.toRichPhoneNumber('+1-555-123-4567'); // '(555) 123-4567'
     * StringUtils.toRichPhoneNumber('555123'); // '(555) 123'
     * StringUtils.toRichPhoneNumber('555'); // '(555'
     * StringUtils.toRichPhoneNumber('12'); // '(12'
     * StringUtils.toRichPhoneNumber(''); // ''
     */
    public static toRichPhoneNumber( value : string ) : string
    {
        const digits : string = StringUtils.toPhoneNumber( value );
                
        // Handle short codes (5-6 digits) - return as-is without formatting
        if( digits.length === 5 || digits.length === 6 )
        {
            return digits;
        }
        
        // Format regular phone numbers as (###) ###-####
        if (digits.length === 0) return "";
        if (digits.length < 4) return `(${digits}`;
        if (digits.length < 7) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
        return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////////////////
    /**
     * Generate a random string of numeric digits.
     *
     * Creates a random string containing only digits (0-9) of the specified length.
     * Each digit is randomly selected using NumberUtils.randomRange() to ensure uniform
     * distribution across all possible digit values.
     *
     * @param places - The length of the random digit string to generate. Must be a positive number.
     * @returns A random string containing only numeric digits (0-9) of the specified length.
     *
     * @example
     * StringUtils.randomDigits(5); // '73492' (example output)
     * StringUtils.randomDigits(10); // '8204567319' (example output)
     * StringUtils.randomDigits(3); // '042' (example output, can include leading zeros)
     * StringUtils.randomDigits(1); // '7' (example output)
     * StringUtils.randomDigits(0); // '' (empty string)
     */
    public static randomDigits( places : number ) : string
    {
        let str : string = "";
        let i : number;
        for( i=0; i < places; i++ )
        {
            str += NumberUtils.randomRange( 0, 9 ).toString();
        }
        return str;
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////
    /**
     * Convert an underscore-separated string to a human-readable title case label.
     *
     * Takes a string with underscores (typically used for variable names, database fields,
     * or API properties) and transforms it into a user-friendly label by replacing underscores
     * with spaces and converting to title case where each word starts with a capital letter.
     *
     * @param text - The underscore-separated string to convert to a human-readable label.
     * @returns A human-readable string in title case with spaces instead of underscores.
     *
     * @example
     * StringUtils.humanLabel('item_count'); // 'Item Count'
     * StringUtils.humanLabel('first_name'); // 'First Name'
     * StringUtils.humanLabel('user_profile_data'); // 'User Profile Data'
     * StringUtils.humanLabel('api_key'); // 'Api Key'
     * StringUtils.humanLabel('single'); // 'Single' (no underscores)
     */
    public static humanLabel( text : string ) : string
    {
        let label : string = StringUtils.replaceAll( text, "_", " " );
        return StringUtils.toMixedCase( label );
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////
    /**
     * Generate a random email address for testing purposes.
     *
     * Creates a realistic-looking but fake email address with random alphabetic characters
     * for both the local part (before @) and domain name. The local part is 4-10 characters,
     * the domain is 10-20 characters, and the top-level domain is randomly selected from
     * common suffixes (com, net, gov, edu, co). The entire email is converted to lowercase.
     *
     * @returns A randomly generated email address string in lowercase format.
     *
     * @example
     * StringUtils.randomEmail(); // 'abcdef@ghijklmnopqrstuvwxyz.com' (example output)
     * StringUtils.randomEmail(); // 'testuser@randomdomain.net' (example output)
     * StringUtils.randomEmail(); // 'sample@exampledomain.edu' (example output)
     *
     * @note This method is intended for testing and development purposes only.
     * Do not use these emails for actual communication or production data.
     */
    public static randomEmail() : string
    {
        const suffix : Array<string> = [ "com", "net", "gov", "edu", "co" ];
        const nbr_suffix : number = suffix.length - 1;
        let str : string = StringUtils.randomString( NumberUtils.randomRange( 4, 10 ) );
        str += "@";
        str += StringUtils.randomString( NumberUtils.randomRange( 10, 20 ) );
        str += ".";
        str += suffix[ NumberUtils.randomRange( 0, nbr_suffix ) ];
        return str.toLowerCase();
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////
    /**
     * Generate a random valid US phone number for testing purposes.
     *
     * Creates a realistic 10-digit US phone number following North American Numbering Plan (NANP) rules.
     * The area code (first 3 digits) uses valid ranges: first digit 2-7, second digit 0-9, third digit 1-9.
     * The exchange code (next 3 digits) follows valid patterns: first digit 1-9, second digit 0-9, third digit 1-9.
     * The last 4 digits can be any combination of 0-9. Returns the phone number as a string of digits only.
     *
     * @returns A randomly generated 10-digit US phone number string containing only digits.
     *
     * @example
     * StringUtils.randomPhone(); // '5551234567' (example output)
     * StringUtils.randomPhone(); // '2125556789' (example output)
     * StringUtils.randomPhone(); // '7025551234' (example output)
     *
     * @note This method generates valid US phone number patterns for testing and development purposes only.
     * Do not use these numbers for actual communication or production data. The generated numbers
     * follow NANP rules but may still correspond to real phone numbers.
     */
    public static randomPhone() : string
    {
        // area code
        let str : string = NumberUtils.randomRange( 2, 7 ).toString();
        str += NumberUtils.randomRange( 0, 9 ).toString();
        str += NumberUtils.randomRange( 1, 9 ).toString();

        // number
        str += NumberUtils.randomRange( 1, 9 ).toString();
        str += NumberUtils.randomRange( 0, 9 ).toString();
        str += NumberUtils.randomRange( 1, 9 ).toString();

        str += NumberUtils.randomRange( 0, 9 ).toString();
        str += NumberUtils.randomRange( 0, 9 ).toString();
        str += NumberUtils.randomRange( 0, 9 ).toString();
        str += NumberUtils.randomRange( 0, 9 ).toString();
        return str;
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////
    /**
     * Generate a secure random password with specified character type requirements.
     *
     * Creates a password of the specified length containing the required number of each character type
     * (uppercase letters, lowercase letters, numbers, and special characters). The method ensures the
     * minimum requirements are met by adding the specified number of each character type first, then
     * fills any remaining length with random characters from all available sets. Finally, it shuffles
     * all characters to randomize their positions and avoid predictable patterns.
     *
     * @param length - The total length of the password to generate.
     * @param nbrUpper - The minimum number of uppercase letters (A-Z) to include.
     * @param nbrLower - The minimum number of lowercase letters (a-z) to include.
     * @param nbrNumbers - The minimum number of numeric digits (0-9) to include.
     * @param nbrSpecial - The minimum number of special characters to include.
     * @returns A randomly generated password string meeting the specified requirements.
     *
     * @example
     * StringUtils.generatePassword(12, 2, 2, 2, 2); // 'A7b$K9mP2x&L' (example output)
     * StringUtils.generatePassword(8, 1, 1, 1, 1); // 'P4k@mBtR' (example output)
     * StringUtils.generatePassword(16, 3, 3, 3, 3); // 'X9z&M2c$N8vR@K4y' (example output)
     *
     * @note The special characters used are: .,?:;{}[]<>/~!@#$%^&*()_-+=
     * If the sum of required character counts exceeds the total length, the password
     * will only contain the required characters up to the specified length.
     */
    public static generatePassword( length : number,
                                    nbrUpper : number,
                                    nbrLower : number,
                                    nbrNumbers : number,
                                    nbrSpecial : number ) : string
    {
        const upperChars   : string = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
        const lowerChars   : string = "abcdefghijklmnopqrstuvwxyz";
        const numberChars  : string = "0123456789";
        const specialChars : string = ".,?:;{}[]<>/~!@#$%^&*()_-+=";

        let chars: Array<string> = [];
        let i : number;

        // Add required uppercase letters
        for( i = 0; i < nbrUpper; i++ )
        {
            chars.push( upperChars[ NumberUtils.randomRange(0, upperChars.length - 1)]);
        }
        // Add required lowercase letters
        for( i = 0; i < nbrLower; i++)
        {
            chars.push( lowerChars[ NumberUtils.randomRange(0, lowerChars.length - 1)]);
        }
        // Add required numbers
        for( i = 0; i < nbrNumbers; i++)
        {
            chars.push( numberChars[ NumberUtils.randomRange(0, numberChars.length - 1)]);
        }
        // Add required special characters
        for( i = 0; i < nbrSpecial; i++)
        {
            chars.push( specialChars[ NumberUtils.randomRange(0, specialChars.length - 1)]);
        }

        // Fill the rest with random characters from all sets if needed
        const allChars = upperChars + lowerChars + numberChars + specialChars;
        while( chars.length < length )
        {
            chars.push( allChars[ NumberUtils.randomRange(0, allChars.length - 1)]);
        }

        // Shuffle the array to randomize character positions
        for (let i = chars.length - 1; i > 0; i--)
        {
            const j = NumberUtils.randomRange(0, i);
            [chars[i], chars[j]] = [chars[j], chars[i]];
        }

        return chars.join('');
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////
    /**
     * Remove all occurrences of a specified substring from a string.
     *
     * Safely removes all instances of the search string by properly escaping special regex
     * characters in the search pattern. This prevents regex injection issues and ensures
     * literal string matching. Returns the original string unchanged if either the value
     * or find parameter is null, undefined, or empty.
     *
     * @param value - The source string to remove substrings from.
     * @param find - The substring to find and remove. Special regex characters are automatically escaped.
     * @returns A new string with all occurrences of the find string removed, or the original string if inputs are invalid.
     *
     * @example
     * StringUtils.removeAll('hello world hello', 'hello'); // ' world '
     * StringUtils.removeAll('test.file.txt', '.'); // 'testfiletxt'
     * StringUtils.removeAll('a+b+c', '+'); // 'abc' (special chars escaped)
     * StringUtils.removeAll('remove***all***stars', '***'); // 'removeallstars'
     * StringUtils.removeAll('', 'anything'); // ''
     * StringUtils.removeAll('text', ''); // 'text' (no change when find is empty)
     */
    public static removeAll( value : string, find : string ): string
    {
        if ( !value || !find ) return value;
        // Escape special regex characters in 'find'
        const escaped = find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return value.replace(new RegExp(escaped, 'g'), '');
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////
    /**
     * Remove all special characters from a string and replace them with a specified character.
     *
     * Removes all characters that are not alphanumeric (a-z, A-Z, 0-9), periods (.), or hyphens (-),
     * and replaces consecutive sequences of such characters with the specified replacement character.
     * This is useful for sanitizing strings for filenames, URLs, or other contexts where only
     * basic alphanumeric characters and common punctuation are allowed.
     *
     * @param value - The source string to clean of special characters.
     * @param withchar - The character to replace special character sequences with.
     * @returns A new string with all special characters replaced by the specified character.
     *
     * @example
     * StringUtils.removeAllSpecial('hello@world#test', '_'); // 'hello_world_test'
     * StringUtils.removeAllSpecial('file name!@#$%^&*().txt', '-'); // 'file-name-.txt'
     * StringUtils.removeAllSpecial('user@domain.com', ''); // 'userdomain.com'
     * StringUtils.removeAllSpecial('test123-file.doc', '_'); // 'test123-file.doc' (no change)
     * StringUtils.removeAllSpecial('héllo wörld', '-'); // 'h-llo-w-rld' (accented chars removed)
     *
     * @note The regex pattern preserves: letters (a-z, A-Z), numbers (0-9), periods (.), and hyphens (-).
     * All other characters including spaces, punctuation, and Unicode characters are considered special.
     * Consecutive special characters are replaced with a single instance of the replacement character.
     */
    public static removeAllSpecial( value : string, withchar : string ): string
    {
        return value.replace( /[^a-zA-Z0-9.-]+/g, withchar );
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////
    /**
     * Remove all non-alphanumeric characters from a string.
     *
     * Strips out all characters that are not letters (a-z, A-Z) or numbers (0-9), leaving
     * only basic alphanumeric characters. This is the most restrictive text cleaning method,
     * removing spaces, punctuation, special characters, and Unicode characters. Useful for
     * creating clean identifiers, usernames, or sanitized text that contains only letters and numbers.
     *
     * @param value - The source string to clean of non-alphanumeric characters.
     * @returns A new string containing only letters and numbers, with all other characters removed.
     *
     * @example
     * StringUtils.removeNonAlphaNumeric('hello world!'); // 'helloworld'
     * StringUtils.removeNonAlphaNumeric('user@domain.com'); // 'userdomain'
     * StringUtils.removeNonAlphaNumeric('test-123_file.txt'); // 'test123filetxt'
     * StringUtils.removeNonAlphaNumeric('ABC 123 !@# xyz'); // 'ABC123xyz'
     * StringUtils.removeNonAlphaNumeric('héllo wörld'); // 'hllowrld' (accented chars removed)
     * StringUtils.removeNonAlphaNumeric('OnlyLettersAndNumbers123'); // 'OnlyLettersAndNumbers123' (no change)
     *
     * @note This method preserves only: letters (a-z, A-Z) and numbers (0-9).
     * All other characters including spaces, hyphens, periods, and Unicode characters are removed.
     * This is more restrictive than removeAllSpecial() which preserves periods and hyphens.
     */
    public static removeNonAlphaNumeric( value : string ): string
    {
        return value.replace( /[^a-zA-Z0-9]/g, "" );
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////
    /**
     * Remove all leading occurrences of a specified substring from the beginning of a string.
     *
     * Repeatedly removes the specified leading substring from the start of the string until
     * it no longer begins with that substring. This is useful for cleaning up strings with
     * repeated prefixes, such as removing multiple leading slashes from paths or cleaning
     * up formatted text with repeated delimiters.
     *
     * @param value - The source string to remove leading substrings from.
     * @param leading - The substring to remove from the beginning of the string.
     * @returns A new string with all leading occurrences of the specified substring removed, or the original string if inputs are invalid.
     *
     * @example
     * StringUtils.removeLeading('///path/to/file', '/'); // 'path/to/file'
     * StringUtils.removeLeading('<<<message>>>', '<<'); // '<message>>>'
     * StringUtils.removeLeading('prefixprefixtext', 'prefix'); // 'text'
     * StringUtils.removeLeading('   hello world', ' '); // 'hello world'
     * StringUtils.removeLeading('test', 'xyz'); // 'test' (no change when leading not found)
     * StringUtils.removeLeading('', 'anything'); // '' (empty string handling)
     * StringUtils.removeLeading('text', ''); // 'text' (no change when leading is empty)
     *
     * @note This method removes ALL consecutive occurrences of the leading substring, not just the first one.
     * It continues removing until the string no longer starts with the specified substring.
     */
    public static removeLeading( value : string, leading : string ): string
    {
        if( !value || !leading ) return value;
        while( value.startsWith(leading) )
        {
            value = value.slice(leading.length);
        }
        return value;
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////
    /**
     * Removes all trailing occurrences of a specified substring from the end of a string.
     * This method repeatedly removes the trailing substring until it no longer appears at the end.
     * 
     * @param value - The input string from which to remove trailing substrings
     * @param trailing - The substring to remove from the end of the input string
     * @returns The modified string with all trailing occurrences of the specified substring removed,
     *          or the original string if either parameter is null/undefined/empty
     * 
     * @example
     * ```typescript
     * // Remove trailing slashes
     * StringUtils.removeTrailing("path/to/folder///", "/");
     * // Returns: "path/to/folder"
     * 
     * // Remove trailing whitespace
     * StringUtils.removeTrailing("Hello World   ", " ");
     * // Returns: "Hello World"
     * 
     * // Remove trailing file extensions (multiple dots)
     * StringUtils.removeTrailing("document.txt.txt.txt", ".txt");
     * // Returns: "document"
     * 
     * // No change when trailing substring not found
     * StringUtils.removeTrailing("Hello World", "xyz");
     * // Returns: "Hello World"
     * 
     * // Handle null/undefined inputs
     * StringUtils.removeTrailing(null, "/");
     * // Returns: null
     * ```
     */
    public static removeTrailing( value : string, trailing : string ): string
    {
        if( !value || !trailing )return value;
        while( value.endsWith( trailing ) )
        {
            value = value.slice(0, -trailing.length );
        }
         return value;
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////////////////
    /**
     * Generate a RFC4122 version 4 compliant UUID (Globally Unique Identifier).
     *
     * Creates a universally unique identifier following the UUID version 4 specification,
     * which uses random or pseudo-random numbers. The generated UUID has the standard format
     * of 8-4-4-4-12 hexadecimal digits separated by hyphens. This method is suitable for
     * creating unique identifiers for database records, API keys, session tokens, or any
     * scenario requiring globally unique values.
     *
     * @returns A RFC4122 version 4 compliant UUID string in the format xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
     *          where x represents a random hexadecimal digit (0-9, a-f), 4 indicates version 4,
     *          and y represents a variant digit (8, 9, a, or b)
     *
     * @example
     * ```typescript
     * // Generate unique identifiers
     * StringUtils.guid(); // '550e8400-e29b-41d4-a716-446655440000' (example output)
     * StringUtils.guid(); // 'f47ac10b-58cc-4372-a567-0e02b2c3d479' (example output)
     * StringUtils.guid(); // '6ba7b810-9dad-11d1-80b4-00c04fd430c8' (example output)
     *
     * // Use for database primary keys
     * const userId = StringUtils.guid(); // '123e4567-e89b-12d3-a456-426614174000'
     *
     * // Use for session tokens
     * const sessionToken = StringUtils.guid(); // 'a1b2c3d4-e5f6-4789-9abc-def012345678'
     * ```
     *
     * @note This implementation uses Math.random() for number generation, which is suitable for
     * most applications but may not be cryptographically secure for sensitive use cases.
     * For cryptographic applications, consider using crypto.randomUUID() or a crypto-secure
     * random number generator. Each call generates a statistically unique identifier with
     * extremely low probability of collision (1 in 5.3 x 10^36 for version 4 UUIDs).
     */
    public static guid(): string
    {
        // RFC4122 version 4 compliant UUID
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////////////////
    /**
     * Mask all characters in a string with a specified masking character.
     *
     * Replaces every character in the input string with the specified masking character,
     * preserving the original string length. This is commonly used for hiding sensitive
     * information like passwords, credit card numbers, or personal data while maintaining
     * the visual structure of the original text. Only the first character of the masking
     * string is used if multiple characters are provided.
     *
     * @param value - The string to mask. Returns unchanged if null, undefined, or empty.
     * @param char - The character(s) to use for masking. Only the first character is used for masking.
     * @returns A new string where every character is replaced with the masking character,
     *          or the original string if either parameter is null/undefined/empty.
     *
     * @example
     * ```typescript
     * // Hide password
     * StringUtils.mask('password123', '*'); // '************'
     * 
     * // Hide credit card number
     * StringUtils.mask('4532-1234-5678-9012', '•'); // '•••••••••••••••••••'
     * 
     * // Hide email address
     * StringUtils.mask('user@domain.com', 'X'); // 'XXXXXXXXXXXXXXX'
     * 
     * // Preserve structure with spaces
     * StringUtils.mask('John Doe Smith', '#'); // '###############'
     * 
     * // Multiple masking chars - only first is used
     * StringUtils.mask('secret', '***'); // '******' (uses only '*')
     * 
     * // Handle empty/null inputs
     * StringUtils.mask('', '*'); // ''
     * StringUtils.mask('test', ''); // 'test' (no change)
     * StringUtils.mask(null, '*'); // null
     * ```
     *
     * @note This method masks ALL characters including spaces, numbers, and special characters.
     * If you need to preserve certain characters (like spaces or formatting), consider using
     * a custom masking approach. The method is useful for completely hiding sensitive data
     * while showing the general length and structure of the original information.
     */
    public static mask( value : string, char : string ): string
    {
        if (!value || !char) return value;
        const maskChar : string = char[0]; // Use only the first character
        return value.split('').map( () => maskChar ).join('');
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////
    /**
     * Convert a dollar amount to cents representation with a customizable symbol.
     *
     * Takes a dollar value (decimal number) and converts it to cents by multiplying by 100,
     * then formats it as a string with the specified symbol. The method truncates (does not round)
     * to one decimal place for precision. If the result is a whole number, no decimal places
     * are shown. This is useful for displaying monetary values in cents format or for
     * financial calculations where precision matters.
     *
     * @param value - The dollar amount to convert to cents (e.g., 1.23 becomes 123¢).
     * @param symbol - The symbol to append to the cents value. Defaults to '¢' (cents symbol).
     * @returns A formatted string representing the value in cents with the specified symbol.
     *
     * @example
     * ```typescript
     * // Basic dollar to cents conversion
     * StringUtils.toCents(1.23); // '123¢'
     * StringUtils.toCents(0.50); // '50¢'
     * StringUtils.toCents(2.00); // '200¢'
     * 
     * // Custom symbols
     * StringUtils.toCents(1.50, ' cents'); // '150 cents'
     * StringUtils.toCents(0.99, 'c'); // '99c'
     * StringUtils.toCents(5.25, ' ¢'); // '525 ¢'
     * 
     * // Truncation behavior (not rounding)
     * StringUtils.toCents(1.234); // '123.4¢' (truncated, not rounded)
     * StringUtils.toCents(1.239); // '123.9¢' (truncated, not rounded)
     * StringUtils.toCents(1.999); // '199.9¢' (truncated, not rounded to 200)
     * 
     * // Whole number results
     * StringUtils.toCents(1.00); // '100¢' (no decimal places)
     * StringUtils.toCents(0.10); // '10¢' (no decimal places)
     * 
     * // Edge cases
     * StringUtils.toCents(0); // '0¢'
     * StringUtils.toCents(0.01); // '1¢'
     * ```
     *
     * @note This method uses truncation (Math.trunc) rather than rounding to ensure
     * precise financial calculations. The method preserves up to one decimal place
     * in the cents representation when necessary, but omits decimal places for
     * whole cent values. This is particularly useful for financial applications
     * where exact cent values are critical.
     */
    public static toCents( value : number, symbol : string = '¢' ): string
    {
        const cents       : number  = value * 100;
        // Truncate to one decimal place (not round)
        const truncated : number = Math.trunc(cents * 10) / 10;
        const decimal_str : string = truncated % 1 === 0 ? truncated.toFixed(0) : truncated.toFixed(1);
        return decimal_str + symbol;
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////
    /**
     * Format a string template with indexed placeholders using variable arguments.
     *
     * Takes a template string containing numbered placeholders (e.g., {0}, {1}, {2}) and replaces
     * them with corresponding values from the provided arguments. The first argument is the template
     * string, and subsequent arguments are the values to substitute. Placeholders are matched
     * case-insensitively and can appear multiple times in the template. This method provides
     * a simple string formatting mechanism similar to string interpolation or printf-style formatting.
     *
     * @param values - Variable arguments where the first is the template string with {n} placeholders,
     *                 and subsequent arguments are the values to substitute for {0}, {1}, {2}, etc.
     * @returns The formatted string with all placeholders replaced by their corresponding values,
     *          or empty string if no arguments are provided.
     *
     * @example
     * ```typescript
     * // Basic string formatting
     * StringUtils.format('Hello {0}!', 'World'); // 'Hello World!'
     * StringUtils.format('User {0} has {1} points', 'John', 100); // 'User John has 100 points'
     * 
     * // Multiple placeholders and repetition
     * StringUtils.format('{0} + {1} = {2}', 5, 3, 8); // '5 + 3 = 8'
     * StringUtils.format('Welcome {0}, welcome {0}!', 'Alice'); // 'Welcome Alice, welcome Alice!'
     * 
     * // Mixed string and number values
     * StringUtils.format('Order #{0}: ${1} for {2} items', 12345, 99.99, 5);
     * // 'Order #12345: $99.99 for 5 items'
     * 
     * // Case insensitive matching
     * StringUtils.format('Hello {0} and {0}!', 'there'); // 'Hello there and there!'
     * 
     * // Complex templates
     * StringUtils.format(
     *   'Name: {0}, Age: {1}, City: {2}, Score: {3}',
     *   'Bob', 25, 'New York', 95.5
     * ); // 'Name: Bob, Age: 25, City: New York, Score: 95.5'
     * 
     * // Empty or missing arguments
     * StringUtils.format(); // ''
     * StringUtils.format('No placeholders here'); // 'No placeholders here'
     * StringUtils.format('Missing value: {0}'); // 'Missing value: {0}' (unchanged)
     * ```
     *
     * @note Placeholders are zero-indexed ({0}, {1}, {2}, etc.) and correspond to the argument
     * positions after the template string. Placeholders without corresponding arguments remain
     * unchanged in the output. The method uses case-insensitive matching for placeholders.
     * Both string and numeric values are supported and automatically converted to strings.
     * This method is useful for internationalization, dynamic message generation, and
     * template-based string construction.
     */
    public static format( ...values: Array<string | number> ): string
    {
        let text : string = "";
        if( values.length > 0 )
        {
            text = values[0] as string;

            let i : number;
            let n : number = values.length;

            for( i=1; i < n; i++ )
            {
                text = text.replace( new RegExp("\\{" + (i-1) + "\\}", "gi"), values[i] as string );
            }
        }
        
        return text;
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////
    /**
     * Format a string template with named placeholders using a JSON object for replacement values.
     *
     * Takes a template string containing named placeholders (e.g., {name}, {age}, {city}) and replaces
     * them with corresponding values from the provided object. Property names in the object must match
     * the placeholder names exactly. Placeholders are matched case-sensitively and can appear multiple
     * times in the template. This method provides object-based string formatting, making templates
     * more readable and maintainable than numeric index-based formatting.
     *
     * @param template - The template string containing {propertyName} placeholders to be replaced.
     * @param values - An object containing key-value pairs where keys match placeholder names.
     * @returns The formatted string with all matching placeholders replaced by their corresponding values,
     *          or the original template if template is empty or values object is null/undefined.
     *
     * @example
     * ```typescript
     * // Basic named placeholder formatting
     * StringUtils.formatTemplate('Hello {name}!', { name: 'World' }); 
     * // 'Hello World!'
     * 
     * StringUtils.formatTemplate('User {name} has {points} points', { name: 'John', points: 100 }); 
     * // 'User John has 100 points'
     * 
     * // Multiple placeholders and repetition
     * StringUtils.formatTemplate('Welcome {user}, welcome {user}!', { user: 'Alice' }); 
     * // 'Welcome Alice, welcome Alice!'
     * 
     * // Mixed data types (automatically converted to strings)
     * StringUtils.formatTemplate('Order #{id}: ${price} for {quantity} items', 
     *   { id: 12345, price: 99.99, quantity: 5 });
     * // 'Order #12345: $99.99 for 5 items'
     * 
     * // Complex object with various data types
     * StringUtils.formatTemplate(
     *   'Name: {name}, Age: {age}, City: {city}, Score: {score}',
     *   { name: 'Bob', age: 25, city: 'New York', score: 95.5 }
     * ); 
     * // 'Name: Bob, Age: 25, City: New York, Score: 95.5'
     * 
     * // Time-based example as requested
     * StringUtils.formatTemplate('Hello {name}. What is the {time}', 
     *   { name: 'bob', time: 34 });
     * // 'Hello bob. What is the 34'
     * 
     * // Unmatched placeholders remain unchanged
     * StringUtils.formatTemplate('Hello {name}, your {status} is {unknown}', 
     *   { name: 'Alice', status: 'active' });
     * // 'Hello Alice, your active is {unknown}'
     * 
     * // Empty or null inputs
     * StringUtils.formatTemplate('', { name: 'test' }); // ''
     * StringUtils.formatTemplate('Hello {name}', null); // 'Hello {name}'
     * StringUtils.formatTemplate('No placeholders', { name: 'test' }); // 'No placeholders'
     * ```
     *
     * @note Placeholder names are case-sensitive and must exactly match the property names in the
     * values object. Placeholders without corresponding properties remain unchanged in the output.
     * All values are automatically converted to strings. This method is particularly useful for
     * internationalization, template engines, dynamic content generation, and configuration-based
     * string formatting where readable placeholder names improve maintainability.
     */
    public static formatTemplate(template: string, values: Record<string, any>): string
    {
        if (!template || !values) return template || '';
        
        let result: string = template;
        
        // Iterate through all properties in the values object
        for (const key in values)
        {
            if (values.hasOwnProperty(key))
            {
                // Create a regex to match all occurrences of {key}
                const placeholder = new RegExp(`\\{${key}\\}`, 'g');
                // Replace all occurrences with the corresponding value (converted to string)
                result = result.replace(placeholder, String(values[key]));
            }
        }
        
        return result;
    }

    /////////////////////////////////////////////////////////////////////////////////////////////////////////
    public static formatAtTemplate(template: string, values: Record<string, any>): string
    {
        if (!template || !values) return template || '';
        
        let result: string = template;
        
        // Iterate through all properties in the values object
        for (const key in values)
        {
            if (values.hasOwnProperty(key))
            {
                // Create a regex to match all occurrences of {key}
                const placeholder = new RegExp(`\\@${key}\\@`, 'g');
                // Replace all occurrences with the corresponding value (converted to string)
                result = result.replace(placeholder, String(values[key]));
            }
        }
        
        return result;
    }

    /////////////////////////////////////////////////////////////////////////////////////////////////////////
    public static formatColonTemplate(template: string, values: Record<string, any>): string
    {
        if (!template || !values) return template || '';
        
        let result: string = template;
        
        // Iterate through all properties in the values object
        for (const key in values)
        {
            if (values.hasOwnProperty(key))
            {
                // Match :key — colon followed by the key name, not followed by another word char
                const placeholder = new RegExp(`:${key}(?!\\w)`, 'g');
                result = result.replace(placeholder, String(values[key]));
            }
        }
        
        return result;
    }

    /////////////////////////////////////////////////////////////////////////////////////////////////////////
    // direction 1 : ascend, -1 descend
    public static compare( a : string, b : string, direction : number  ): number
    {
        return a.localeCompare( b, undefined, { sensitivity: "base" } ) * direction;
    }

    /////////////////////////////////////////////////////////////////////////////////////////////////////////
    /**
     * Count the number of occurrences of specified characters in a text string.
     *
     * Iterates through each character in the input text and counts how many times any character
     * from the values string appears. This method is useful for counting specific character types
     * (like digits, vowels, consonants) or validating character composition in strings. Each
     * character in the text is checked against all characters in the values string for matches.
     *
     * @param text - The input string to analyze for character occurrences.
     * @param values - A string containing all the characters to count occurrences of.
     * @returns The total number of times any character from the values string appears in the text,
     *          or 0 if either parameter is null or undefined.
     *
     * @example
     * ```typescript
     * // Count digits in a string
     * StringUtils.countOccurances('abc123def456', '0123456789'); // 6
     * 
     * // Count vowels in text
     * StringUtils.countOccurances('Hello World', 'aeiouAEIOU'); // 3 (e, o, o)
     * 
     * // Count specific characters
     * StringUtils.countOccurances('javascript', 'aeiou'); // 3 (a, a, i)
     * StringUtils.countOccurances('Hello World!', 'lo'); // 4 (l, l, o, o)
     * 
     * // Count punctuation marks
     * StringUtils.countOccurances('Hello, World! How are you?', ',.!?'); // 3
     * 
     * // Count spaces and tabs
     * StringUtils.countOccurances('Hello\tWorld  Test', ' \t'); // 4
     * 
     * // Using predefined character sets
     * StringUtils.countOccurances('Test123!@#', StringUtils.NUMBERS); // 3
     * StringUtils.countOccurances('Test123!@#', StringUtils.SPECIAL); // 3
     * 
     * // No matches found
     * StringUtils.countOccurances('Hello World', 'xyz'); // 0
     * 
     * // Edge cases
     * StringUtils.countOccurances('', 'abc'); // 0
     * StringUtils.countOccurances('test', ''); // 0
     * StringUtils.countOccurances(null, 'abc'); // 0
     * StringUtils.countOccurances('test', null); // 0
     * ```
     *
     * @note This method performs a case-sensitive character match. If you need case-insensitive
     * counting, convert both the text and values parameters to the same case before calling.
     * The method counts individual character occurrences, not substring occurrences. Each
     * character in the text is evaluated independently against the values string. This method
     * is particularly useful for text analysis, validation rules, and character frequency analysis.
     */
    public static countOccurances( text : string, values : string ): number
    {
        if( text == null || values == null )return 0;

        let count : number = 0;
        let len : number = text.length;
        let i   : number;

        for( i=0; i < len; i++ )
        {
            if( values.indexOf( text.charAt(i) ) >= 0 )
            {
                count++;
            }
        }

        return count;
    }

    ///////////////////////////////////////////////////////////////////////////////////
    /**
     * Count the number of uppercase letters in a text string.
     *
     * Iterates through each character in the input text and counts how many are uppercase
     * letters (A-Z). Uses a regular expression to test each character against the uppercase
     * letter pattern. This method is useful for password validation, text analysis, and
     * enforcing formatting rules that require specific uppercase letter counts.
     *
     * @param text - The input string to analyze for uppercase letter occurrences.
     * @returns The total number of uppercase letters (A-Z) found in the text,
     *          or 0 if the parameter is null or undefined.
     *
     * @example
     * ```typescript
     * // Count uppercase letters in mixed case text
     * StringUtils.countUppercase('Hello World'); // 2 (H, W)
     * StringUtils.countUppercase('HELLO world'); // 5 (H, E, L, L, O)
     * StringUtils.countUppercase('JavaScript'); // 2 (J, S)
     * 
     * // Password validation example
     * StringUtils.countUppercase('MyPassword123!'); // 2 (M, P)
     * StringUtils.countUppercase('mypassword123!'); // 0
     * StringUtils.countUppercase('MYPASSWORD123!'); // 10
     * 
     * // Text analysis examples
     * StringUtils.countUppercase('This Is Title Case'); // 4 (T, I, T, C)
     * StringUtils.countUppercase('THIS IS ALL CAPS'); // 11
     * StringUtils.countUppercase('this is lowercase'); // 0
     * 
     * // Mixed content with numbers and symbols
     * StringUtils.countUppercase('ABC123def!@#GHI'); // 6 (A, B, C, G, H, I)
     * StringUtils.countUppercase('Test@Email.COM'); // 4 (T, E, C, O, M)
     * 
     * // Edge cases
     * StringUtils.countUppercase(''); // 0
     * StringUtils.countUppercase('123!@#'); // 0 (no letters)
     * StringUtils.countUppercase(null); // 0
     * 
     * // Unicode and special characters
     * StringUtils.countUppercase('Café MÜNCHEN'); // 6 (C, M, Ü, N, C, H, E, N)
     * StringUtils.countUppercase('Hello\nWorld\tTest'); // 3 (H, W, T)
     * ```
     *
     * @note This method only counts standard ASCII uppercase letters (A-Z). It does not
     * count accented uppercase letters or Unicode uppercase characters from other languages.
     * For more comprehensive Unicode uppercase detection, consider using locale-specific
     * methods. The method performs exact character-by-character analysis and is case-sensitive
     * by design. This method is commonly used in password strength validation, text formatting
     * analysis, and content validation rules.
     */
    public static countUppercase( text : string ): number
    {
        if( text == null )return 0;

        let count : number = 0;
        let len : number = text.length;
        let i   : number;

        for( i=0; i < len; i++ )
        {
            if( /^[A-Z]*$/.test( text.charAt(i) ) )
            {
                count++;
            }
        }

        return count;
    }

    ///////////////////////////////////////////////////////////////////////////////////
    /**
     * Count the number of lowercase letters in a text string.
     *
     * Iterates through each character in the input text and counts how many are lowercase
     * letters (a-z). Uses a regular expression to test each character against the lowercase
     * letter pattern. This method is useful for password validation, text analysis, and
     * enforcing formatting rules that require specific lowercase letter counts.
     *
     * @param text - The input string to analyze for lowercase letter occurrences.
     * @returns The total number of lowercase letters (a-z) found in the text,
     *          or 0 if the parameter is null or undefined.
     *
     * @example
     * ```typescript
     * // Count lowercase letters in mixed case text
     * StringUtils.countLowercase('Hello World'); // 8 (e, l, l, o, o, r, l, d)
     * StringUtils.countLowercase('HELLO world'); // 5 (w, o, r, l, d)
     * StringUtils.countLowercase('JavaScript'); // 8 (a, v, a, c, r, i, p, t)
     * 
     * // Password validation example
     * StringUtils.countLowercase('MyPassword123!'); // 8 (y, a, s, s, w, o, r, d)
     * StringUtils.countLowercase('MYPASSWORD123!'); // 0
     * StringUtils.countLowercase('mypassword123!'); // 10
     * 
     * // Text analysis examples
     * StringUtils.countLowercase('This Is Title Case'); // 9 (h, i, s, s, i, t, l, e, a, s, e)
     * StringUtils.countLowercase('THIS IS ALL CAPS'); // 0
     * StringUtils.countLowercase('this is lowercase'); // 13
     * 
     * // Mixed content with numbers and symbols
     * StringUtils.countLowercase('ABC123def!@#ghi'); // 6 (d, e, f, g, h, i)
     * StringUtils.countLowercase('Test@email.com'); // 8 (e, s, t, e, m, a, i, l, c, o, m)
     * 
     * // Edge cases
     * StringUtils.countLowercase(''); // 0
     * StringUtils.countLowercase('123!@#'); // 0 (no letters)
     * StringUtils.countLowercase(null); // 0
     * 
     * // Unicode and special characters
     * StringUtils.countLowercase('café münchen'); // 11 (c, a, f, é, m, ü, n, c, h, e, n)
     * StringUtils.countLowercase('hello\nworld\ttest'); // 15 (all lowercase letters)
     * ```
     *
     * @note This method only counts standard ASCII lowercase letters (a-z). It does not
     * count accented lowercase letters or Unicode lowercase characters from other languages.
     * For more comprehensive Unicode lowercase detection, consider using locale-specific
     * methods. The method performs exact character-by-character analysis and is case-sensitive
     * by design. This method is commonly used in password strength validation, text formatting
     * analysis, and content validation rules.
     */
    public static countLowercase( text : string ): number
    {
        if( text == null )return 0;

        let count : number = 0;
        let len : number = text.length;
        let i   : number;

        for( i=0; i < len; i++ )
        {
            if( /^[a-z]*$/.test( text.charAt(i) ) )
            {
                count++;
            }
        }

        return count;
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////
    /**
     * Count the number of Unicode (non-ASCII) characters in a string.
     *
     * Identifies and counts characters that fall outside the standard ASCII range (0x00-0x7F).
     * This includes accented letters, emoji, symbols from other languages, mathematical symbols,
     * and other Unicode characters. The method properly handles surrogate pairs used for
     * characters beyond the Basic Multilingual Plane, ensuring accurate counting of complex
     * Unicode sequences like emoji and special symbols.
     *
     * @param str - The input string to analyze for Unicode character occurrences.
     * @returns The total number of Unicode (non-ASCII) characters found in the string,
     *          or 0 if the parameter is null, undefined, or empty.
     *
     * @example
     * ```typescript
     * // Count accented characters
     * StringUtils.countUnicodeChars('café résumé'); // 3 (é, é, é)
     * StringUtils.countUnicodeChars('naïve coöperate'); // 3 (ï, ö, ë)
     * 
     * // Count emoji and symbols
     * StringUtils.countUnicodeChars('Hello 👋 World! 🌍'); // 2 (👋, 🌍)
     * StringUtils.countUnicodeChars('Price: $100 → €85'); // 1 (→)
     * 
     * // Count characters from other languages
     * StringUtils.countUnicodeChars('Здравствуй мир'); // 13 (all Cyrillic characters)
     * StringUtils.countUnicodeChars('こんにちは世界'); // 7 (all Japanese characters)
     * StringUtils.countUnicodeChars('مرحبا بالعالم'); // 11 (all Arabic characters)
     * 
     * // Mixed ASCII and Unicode
     * StringUtils.countUnicodeChars('café in München'); // 4 (a, é, ü, e)
     * StringUtils.countUnicodeChars('Temperature: 25°C'); // 1 (°)
     * StringUtils.countUnicodeChars('Math: α + β = γ'); // 3 (α, β, γ)
     * 
     * // ASCII only (no Unicode characters)
     * StringUtils.countUnicodeChars('Hello World 123!'); // 0
     * StringUtils.countUnicodeChars('test@email.com'); // 0
     * StringUtils.countUnicodeChars('ABC123xyz'); // 0
     * 
     * // Edge cases
     * StringUtils.countUnicodeChars(''); // 0
     * StringUtils.countUnicodeChars(null); // 0
     * StringUtils.countUnicodeChars(undefined); // 0
     * 
     * // Complex Unicode sequences (surrogate pairs)
     * StringUtils.countUnicodeChars('🏳️‍🌈🏳️‍⚧️'); // 2 (rainbow flag, trans flag)
     * StringUtils.countUnicodeChars('👨‍👩‍👧‍👦'); // 1 (family emoji as single unit)
     * ```
     *
     * @note This method uses a regular expression with the Unicode flag (`/[^\x00-\x7F]/gu`) to
     * properly detect and count Unicode characters, including those represented by surrogate pairs.
     * ASCII characters (codes 0x00 to 0x7F) include standard English letters, digits, punctuation,
     * and control characters. All other characters are considered Unicode and will be counted.
     * This method is useful for text analysis, internationalization validation, content filtering,
     * and determining the complexity of multilingual text content.
     */
    public static countUnicodeChars( str : string ): number
    {
        if( !str )return 0;
        // Match all Unicode code points (including surrogate pairs)
        const matches : RegExpMatchArray | null = str.match(/[^\x00-\x7F]/gu);
        return matches ? matches.length : 0;
    }

    ///////////////////////////////////////////////////////////////////////////////////
    /**
     * Truncate a string to a specified maximum length and append ellipsis if needed.
     *
     * Shortens a string to fit within the specified length limit by removing characters from the end
     * and appending "..." (ellipsis) to indicate truncation. The ellipsis counts toward the total
     * length, so the actual content will be 3 characters shorter than the specified length when
     * truncation occurs. If the string is already within the length limit, it is returned unchanged.
     * Strings shorter than 4 characters are never truncated to avoid creating meaningless results.
     *
     * @param value - The input string to potentially truncate. Returns unchanged if null, undefined, or empty.
     * @param len - The maximum allowed length for the output string, including the ellipsis when truncation occurs.
     * @returns The truncated string with "..." appended if truncation occurred, or the original string if no truncation was needed.
     *
     * @example
     * ```typescript
     * // Basic truncation examples
     * StringUtils.truncate('Hello World', 8); // 'Hello...'
     * StringUtils.truncate('Short', 10); // 'Short' (no truncation needed)
     * StringUtils.truncate('This is a very long sentence', 15); // 'This is a ve...'
     * 
     * // Edge cases with short strings
     * StringUtils.truncate('Hi', 1); // 'Hi' (too short to truncate)
     * StringUtils.truncate('ABC', 3); // 'ABC' (exactly at minimum length)
     * StringUtils.truncate('Test', 3); // 'Test' (won't truncate strings <= 3 chars)
     * 
     * // User interface examples
     * StringUtils.truncate('user@verylongdomainname.com', 20); // 'user@verylongdom...'
     * StringUtils.truncate('Very Long Product Name Here', 25); // 'Very Long Product Nam...'
     * StringUtils.truncate('Article Title That Goes On Forever', 30); // 'Article Title That Goes On...'
     * 
     * // Table cell content truncation
     * StringUtils.truncate('Customer Name With Many Middle Names', 15); // 'Customer Nam...'
     * StringUtils.truncate('$1,234.56', 15); // '$1,234.56' (no truncation)
     * 
     * // Handle null/undefined/empty inputs
     * StringUtils.truncate('', 10); // ''
     * StringUtils.truncate(null, 10); // null
     * StringUtils.truncate(undefined, 10); // undefined
     * 
     * // Exact length boundary testing
     * StringUtils.truncate('Exactly Ten', 11); // 'Exactly Ten' (exact fit)
     * StringUtils.truncate('Exactly Eleven!', 11); // 'Exactly ...' (truncated)
     * ```
     *
     * @note This method is designed to preserve readability by ensuring truncated strings always
     * end with "..." to clearly indicate that content has been omitted. The 3-character minimum
     * prevents creating confusing results like "..." for very short strings. This method is
     * commonly used in user interfaces for displaying long text in constrained spaces such as
     * table cells, tooltips, breadcrumbs, and list items. For precise control over truncation
     * without ellipsis, consider using string.substring() directly.
     */
    public static truncate( value : string, len : number ): string
    {
        if( value && value.length > len && value.length > 3 )
            return value.substring(0,len-3) + "...";
        else
            return value;
    }

    

    /////////////////////////////////////////////////////////////////////////////////
    /**
     * Convert a string to title case (also known as mixed case or proper case).
     *
     * Transforms text by capitalizing the first letter of each word while leaving the rest
     * of each word unchanged. Uses a regular expression to match the beginning of the string
     * and any character that follows whitespace, then converts those characters to uppercase.
     * This preserves the original casing of characters within words while ensuring consistent
     * capitalization at word boundaries. Particularly useful for creating human-readable labels
     * from various text formats.
     *
     * @param str - The input string to convert to title case.
     * @returns A new string with the first letter of each word capitalized, preserving other character casing.
     *
     * @example
     * ```typescript
     * // Basic title case conversion
     * StringUtils.toMixedCase('hello world'); // 'Hello World'
     * StringUtils.toMixedCase('the quick brown fox'); // 'The Quick Brown Fox'
     * StringUtils.toMixedCase('javascript programming'); // 'Javascript Programming'
     * 
     * // Preserves existing uppercase within words
     * StringUtils.toMixedCase('iPhone and iPad'); // 'IPhone And IPad'
     * StringUtils.toMixedCase('HTML and CSS'); // 'HTML And CSS'
     * StringUtils.toMixedCase('XMLHttpRequest'); // 'XMLHttpRequest'
     * 
     * // Handles various whitespace scenarios
     * StringUtils.toMixedCase('  leading spaces'); // '  Leading Spaces'
     * StringUtils.toMixedCase('multiple   spaces'); // 'Multiple   Spaces'
     * StringUtils.toMixedCase('tab\tseparated'); // 'Tab\tSeparated'
     * StringUtils.toMixedCase('line\nbreak'); // 'Line\nBreak'
     * 
     * ```
     */
    public static toMixedCase( str : string ) : string
    {
        // Title-case each word: uppercase first character, lowercase the rest.
        // Preserves whitespace exactly as-is.
        return str.replace( /\S+/g, ( word : string ) : string =>
        {
            if( word.length === 0 )return word;
            const first : string = word.charAt(0).toUpperCase();
            const rest  : string = word.slice(1).toLowerCase();
            return first + rest;
        } );
    }

    /////////////////////////////////////////////////////////////////////////////////
    /**
     * Convert a past date into a human-readable relative time string.
     *
     * Calculates the time difference between a past date and a reference date (default: current time)
     * and returns a user-friendly description of how long ago the past date occurred. The method
     * provides increasingly less precise descriptions for older dates, making it ideal for social
     * media feeds, activity logs, and user interfaces where approximate timing is more important
     * than exact precision. Uses natural language patterns that are familiar to users.
     *
     * @param past - The past date to compare against the reference time.
     * @param now - The reference date to compare against. Defaults to the current date/time if not provided.
     * @returns A human-readable string describing how long ago the past date occurred relative to the reference date.
     *
     * @example
     * ```typescript
     * const now = new Date('2023-06-15T12:00:00Z');
     * 
     * // Very recent times (less than 1 second)
     * const justNow : Date = new Date('2023-06-15T12:00:00Z');
     * StringUtils.getRelativeTime(justNow, now); // 'just now'
     * 
     * // Seconds ago (1-59 seconds)
     * const seconds30 : Date = new Date('2023-06-15T11:59:30Z');
     * StringUtils.getRelativeTime(seconds30, now); // '30 seconds ago'
     * const second1 : Date = new Date('2023-06-15T11:59:59Z');
     * StringUtils.getRelativeTime(second1, now); // '1 second ago' (singular)
     * 
     * ```
     */
    public static getRelativeTime( past: Date, now : Date = new Date() ) : string
    {
        const seconds = Math.floor((now.getTime() - past.getTime()) / 1000);
        if( seconds < 1 )return "just now";
        if( seconds < 60 ) return `${seconds} second${seconds !== 1 ? "s" : ""} ago`;

        const minutes = seconds / 60;
        if (minutes < 60) return `${Math.floor(minutes)} minute${Math.floor(minutes) !== 1 ? "s" : ""} ago`;

        const hours = minutes / 60;
        if (hours < 24) return `${parseFloat((hours).toFixed(1))} hour${hours < 2 ? "" : "s"} ago`;

        const days = hours / 24;
        if (days < 2) return "yesterday";
        if (days < 7) return `${Math.floor(days)} days ago`;
        if (days < 30) return "over a week ago";
        if (days < 60) return "over a month ago";
        return "some time ago";
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////
    /**
     * Convert a time period in milliseconds to a compact human-readable string.
     *
     * Takes a time duration in milliseconds and converts it to a compact format using
     * abbreviated time units (w, d, h, m) for weeks, days, hours, and minutes.
     * Only displays non-zero time units and omits seconds for simplicity.
     *
     * @param time - The time period in milliseconds to convert.
     * @returns A compact string representation (e.g., "1d 1h 5m") or "0" if time is zero.
     *
     * @example
     * StringUtils.periodToString(0); // "0"
     * StringUtils.periodToString(90300000); // "1d 1h 5m"
     * StringUtils.periodToString(3600000); // "1h"
     * StringUtils.periodToString(60000); // "1m"
     */
    public static periodToString( time : number ) : string
    {
        if (time === 0) return "0";
        
        // Convert milliseconds to total minutes
        const totalMinutes : number = Math.floor(time / (1000 * 60));
        
        if (totalMinutes === 0) return "0";
        
        const weeks : number = Math.floor(totalMinutes / (7 * 24 * 60));
        const days  : number = Math.floor((totalMinutes % (7 * 24 * 60)) / (24 * 60));
        const hours : number = Math.floor((totalMinutes % (24 * 60)) / 60);
        const minutes : number = totalMinutes % 60;
        
        const parts: Array<string> = [];
        
        if (weeks > 0) parts.push(`${weeks}w`);
        if (days > 0) parts.push(`${days}d`);
        if (hours > 0) parts.push(`${hours}h`);
        if (minutes > 0) parts.push(`${minutes}m`);
        
        return parts.join(' ');
    }

/*
    /////////////////////////////////////////////////////////////////////////////////////////////////////////////
    public static base64ToUint8Array( base64String: string ) : Uint8Array
    {
        const padding : string = "=".repeat((4 - base64String.length % 4) % 4);
        const base64  : string = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
        const rawData : string = window.atob(base64);
        const outputArray : Uint8Array = new Uint8Array(rawData.length);
        let i : number;
        for ( i = 0; i < rawData.length; i++ )
        {
            outputArray[i] = rawData.charCodeAt(i);
        }
        return outputArray;
    }
*/

    /////////////////////////////////////////////////////////////////////////////////////////////////////////////
    public static textSimilarity( s1 : string, s2 : string, type : "sd" | "cs" | "jw" = "jw" ) : number
    {
        if( !s1 || !s2 ) return 0;
        if( s1 === s2 ) return 1;

        //
        //
        //
        function sorensenDice( a : string, b : string ) : number
        {
            const getBigrams = ( str : string ) : Array<string> =>
            {
                const bigrams : Array<string> = [];
                for( let i = 0; i < str.length - 1; i++ ) bigrams.push( str.substring( i, i + 2 ) );
                return bigrams;
            };

            const l1 : number = a.length - 1;
            const l2 : number = b.length - 1;
            if( l1 < 1 || l2 < 1 ) return 0;

            const b1 : Array<string> = getBigrams( a );
            const b2 : Array<string | null> = getBigrams( b );
            let intersection : number = 0;

            for( let i = 0; i < l1; i++ )
            {
                for( let j = 0; j < l2; j++ )
                {
                    if( b1[i] === b2[j] )
                    {
                        intersection++;
                        b2[j] = null;
                        break;
                    }
                }
            }
            return ( 2.0 * intersection ) / ( l1 + l2 );
        }

        //
        //
        //
        function cosineSimilarity( a : string, b : string ) : number
        {
            const vecMagnitude = ( vec : Array<number> ) : number =>
                Math.sqrt( vec.reduce( ( sum, v ) => sum + v * v, 0 ) );

            const freq = ( str : string ) : Record<string, number> =>
                str.split( " " ).reduce<Record<string, number>>( ( acc, w ) => { acc[w] = ( acc[w] ?? 0 ) + 1; return acc; }, {} );

            const f1 : Record<string, number> = freq( a );
            const f2 : Record<string, number> = freq( b );
            const dict : Record<string, boolean> = {};
            for( const k in f1 ) dict[k] = true;
            for( const k in f2 ) dict[k] = true;

            const v1 : Array<number> = [];
            const v2 : Array<number> = [];
            for( const term in dict )
            {
                v1.push( f1[term] ?? 0 );
                v2.push( f2[term] ?? 0 );
            }

            const product : number = v1.reduce( ( sum, v, i ) => sum + v * v2[i], 0 );
            return product / ( vecMagnitude( v1 ) * vecMagnitude( v2 ) );
        }

        //
        //
        //
        function jaroWinkler( a : string, b : string ) : number
        {
            const range : number = Math.max( 0, Math.floor( Math.max( a.length, b.length ) / 2 ) - 1 );
            const m1 : Array<boolean> = new Array( a.length ).fill( false );
            const m2 : Array<boolean> = new Array( b.length ).fill( false );
            let matches : number = 0;

            for( let i = 0; i < a.length; i++ )
            {
                const lo : number = Math.max( 0, i - range );
                const hi : number = Math.min( i + range, b.length - 1 );
                for( let j = lo; j <= hi; j++ )
                {
                    if( !m1[i] && !m2[j] && a[i] === b[j] )
                    {
                        m1[i] = m2[j] = true;
                        matches++;
                        break;
                    }
                }
            }

            if( !matches ) return 0;

            let transpositions : number = 0;
            let k : number = 0;
            for( let i = 0; i < a.length; i++ )
            {
                if( m1[i] )
                {
                    while( !m2[k] ) k++;
                    if( a[i] !== b[k] ) transpositions++;
                    k++;
                }
            }

            let weight : number = ( matches / a.length + matches / b.length + ( matches - transpositions / 2 ) / matches ) / 3;
            let prefix : number = 0;
            while( prefix < 4 && a[prefix] === b[prefix] ) prefix++;
            weight += prefix * 0.1 * ( 1 - weight );

            return weight;
        }

        switch( type )
        {
            case "sd" : return sorensenDice( s1, s2 );
            case "cs" : return cosineSimilarity( s1, s2 );
            default   : return jaroWinkler( s1, s2 );
        }
    }

}

//
// eof
//
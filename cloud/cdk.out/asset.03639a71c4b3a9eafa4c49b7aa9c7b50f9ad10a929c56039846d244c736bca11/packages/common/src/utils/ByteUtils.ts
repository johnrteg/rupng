//
// ByteUtils — byte-size unit constants + formatting. Bytes measure files, payloads, storage, and
// transfer — not just memory — so this is domain-neutral. (Was the byte half of SysConstants/MemoryUtils.)
//
export default class ByteUtils
{
    /** Binary (1024-based) size units, in bytes. */
    public static readonly KB : number = 1024;
    public static readonly MB : number = ByteUtils.KB * 1024;
    public static readonly GB : number = ByteUtils.MB * 1024;
    public static readonly TB : number = ByteUtils.GB * 1024;

    //////////////////////////////////////////////////////////////////////////////////
    /**
     * Convert a file size in bytes to a human-readable string with appropriate units.
     *
     * Converts a numeric byte value into a formatted string using binary units (1024-based)
     * with appropriate suffixes (B, KB, MB, GB, TB). The method automatically selects the
     * most appropriate unit to display a readable number (typically between 1-1023) and
     * formats the result with a specified number of decimal places. Uses standard binary
     * prefixes where 1 KB = 1024 bytes, following common file system conventions.
     *
     * @param size - The file size in bytes to convert. Must be a non-negative number.
     * @param digits - The number of decimal places to display in the formatted output. Defaults to 1.
     * @returns A formatted string representing the file size with appropriate units (B, KB, MB, GB, TB).
     *
     * @example
     * ```typescript
     * // Basic file size conversions
     * ByteUtils.toString(0); // '0 B'
     * ByteUtils.toString(512); // '512.0 B'
     * ByteUtils.toString(1024); // '1.0 KB'
     * ByteUtils.toString(1536); // '1.5 KB'
     * 
     * // Various file sizes with default 1 decimal place
     * ByteUtils.toString(2048); // '2.0 KB'
     * ByteUtils.toString(1048576); // '1.0 MB' (1024² bytes)
     * ByteUtils.toString(1073741824); // '1.0 GB' (1024³ bytes)
     * ByteUtils.toString(1099511627776); // '1.0 TB' (1024⁴ bytes)
     * 
     * // Custom decimal precision
     * ByteUtils.toString(1536, 0); // '2 KB' (no decimals, rounded)
     * ByteUtils.toString(1536, 2); // '1.50 KB' (2 decimal places)
     * ByteUtils.toString(1536, 3); // '1.500 KB' (3 decimal places)
     * 
     * ```
     *
     * @note This method uses binary (base-1024) units following the traditional computing convention
     * where 1 KB = 1024 bytes, 1 MB = 1024² bytes, etc. This differs from decimal (base-1000) units
     * sometimes used in marketing where 1 KB = 1000 bytes. The method handles sizes up to terabytes
     * (TB) and will display very large files in TB units. For files larger than the TB range, the
     * result may not be as meaningful. The decimal formatting uses toFixed() which rounds the result
     * to the specified number of decimal places. This method is commonly used in file managers,
     * upload progress indicators, and storage analytics displays.
     */
    public static toString( size : number, digits : number = 1 ) : string
    {
        if( size == 0 )return "0 B";

        let i     : number = Math.floor( Math.log( size ) / Math.log( 1024 ) );
        let fsize : number = ( size / Math.pow( ByteUtils.KB , i ) );
        return fsize.toFixed( digits ) + ' ' + ['B', 'KB', 'MB', 'GB', 'TB'][i];
    }
}

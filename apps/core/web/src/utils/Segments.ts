//

import { StringUtils } from "@repo/common";


export default class Segments
{
    private static SINGLE_SEGMENT   : number = 70;
    private static MULTIPART        : number = 67;

    // Full GSM-7 character set
    private static GSM7 = `\\\n @£$¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞ^{}[~]|€ÆæßÉ!"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà`;
    private static GSM7_SPECIAL = new Set(['\n', '[', ']', '\\', '^', '{', '}', '|', '€', '~']);

    private static GSM7_SEGMENTS = [160, 306, 459, 612, 765, 918, 1071, 1224, 1377, 1530, 1683, 1836, 1989, 2142, 2295, 2448, 2601, 2754, 2907, 3060];
    private static UCS2_SEGMENTS = [70, 134, 201, 268, 335, 402, 469, 536, 603, 670, 737, 804, 871, 938, 1005, 1072, 1139, 1206, 1273, 1340, 1407, 1474, 1541, 1608, 1675, 1742, 1809, 1876, 1943, 2010];

    ////////////////////////////////////////////////////////////////////////////////////////////////
    constructor()
    {
    }

    /**
     * Determines the encoding (GSM-7 or UCS-2) and calculates the encoded length.
     * If any character is not in GSM-7, switches to UCS-2 and counts each character as 1.
     * For GSM-7, special characters count as 2, others as 1.
     */
    private getEncodingAndLength( text : string ) : { encoding: Segments.Encoding, length: number }
    {
        let encoding: Segments.Encoding = 'GSM-7';
        let length = 0;

        for (const char of text) {
            if (Segments.GSM7_SPECIAL.has(char)) {
                length += 2; // Special characters count as 2
            } else if (Segments.GSM7.includes(char)) {
                length += 1; // Regular GSM-7 characters count as 1
            } else {
                encoding = 'UCS-2'; // If we find a character not in GSM-7, switch to UCS-2
                break;
            }
        }

        if (encoding === 'UCS-2') {
            length = text.length; // For UCS-2, each character counts as 1
        }

        return { encoding, length };
    }

    ////////////////////////////////////////////////////////////////////////////
    /**
        * Calculate the number of segments required to send a text message based on its length and encoding.
        *
        * This method determines the encoding of the text (GSM-7 or UCS-2) and calculates the number of segments needed
        * to send the message. It uses predefined segment limits for both encodings to determine how many segments are required.
        *
        * @param text - The text message to evaluate. The length and encoding of this text will determine the number of segments.
        * @returns The number of segments required to send the text message. Returns 0 if the text is null or empty.
        *
        * @example
        * segments.bin('Hello'); // returns 1 (GSM-7, length 5)
        * segments.bin('こんにちは'); // returns 1 (UCS-2, length 5)
        * segments.bin('A'.repeat(160)); // returns 1 (GSM-7, length 160)
        * segments.bin('A'.repeat(161)); // returns 2 (GSM-7, length 161)
    */
    public bin(text: string): number {
        if (!text) return 0;
        const { encoding, length } = this.getEncodingAndLength(text);
        const segments = encoding === 'GSM-7' ? Segments.GSM7_SEGMENTS : Segments.UCS2_SEGMENTS;
        for (let i = 0; i < segments.length; i++) {
            if (length <= segments[i]) return i + 1;
        }
        return segments.length;
    }

    ////////////////////////////////////////////////////////////////////////////
    /**
     * Calculate the number of segments based only on length, using UCS-2 rules.
     * (Legacy method, not encoding-aware.)
     */
    public binByLength( len : number ): number
    {
        // SMS-style segmentation (UCS-2):
        // 1 segment up to SINGLE_SEGMENT chars (inclusive),
        // then MULTIPART chars per additional segment.
        if( len <= 0 )
            return 0;

        if( len <= Segments.SINGLE_SEGMENT )
            return 1;

        return 1 + Math.ceil( ( len - Segments.SINGLE_SEGMENT ) / Segments.MULTIPART );
    }

    ////////////////////////////////////////////////////////////////////////////
    /**
     * Get the label of the segment that a text string belongs to based on its length.
     *
     * Uses the bin() method to determine which segment the text belongs to, then returns
     * the corresponding segment label. This provides a human-readable category name for
     * the text based on its character length.
     *
     * @param text - The text string to categorize. Length will be used to determine the appropriate segment.
     * @returns The label of the segment the text belongs to, or "n/a" if text is null/undefined or no matching segment found.
     *
     * @example
     * // Assuming segments: [{label: "Short", upper: 5}, {label: "Medium", upper: 20}]
     * segments.in('hi');         // "Short" (length 2 fits in first segment)
     * segments.in('hello world'); // "Medium" (length 11 fits in second segment)  
     * segments.in('very long text that exceeds all bounds'); // "n/a" (no matching segment)
     * segments.in(null);         // "n/a"
     */
    public in( text : string ): string
    {
        if( text === undefined || text === null )
            return "n/a";
        else
            return StringUtils.format( "Segment {0}", this.bin( text ) );
    }

}

export namespace Segments
{
    export interface Segment
    {
        label : string;
        upper : number;
    }

    export type Encoding = 'GSM-7' | 'UCS-2';
}

//
// eof
//
export default class ColorUtils
{

    //////////////////////////////////////////////////////////////////////////////////////
    /**
     * Convert a color string to hexadecimal format.
     *
     * Accepts CSS color strings in rgb(), rgba(), or existing hex format and converts them
     * to hex notation. For rgba colors with alpha transparency, returns an 8-character hex
     * value including the alpha channel. Returns black (#000000) for invalid inputs.
     *
     * @param color - The color string to convert. Can be in rgb(), rgba(), or hex format.
     * @returns A hex color string (e.g., "#ff0000" or "#ff0000ff" with alpha).
     */
    public static toHex( color : string ): string
    {
        if( color === undefined || color === null || color === "" )return "#000000";

        const trimmed : string = color.trim();
        if( trimmed === "" )return "#000000";
        if( trimmed.charAt(0) === "#" )return trimmed;

        const match : RegExpMatchArray | null = trimmed.match(/^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*([0-9.]+))?\s*\)$/i);
        if( !match ) return "#000000";

        const clampByte = (n: number) => Math.max(0, Math.min(255, n));
        const hex2 = (n: number) => clampByte(n).toString(16).padStart(2, "0");

        const r : number = Number.parseInt(match[1], 10);
        const g : number = Number.parseInt(match[2], 10);
        const b : number = Number.parseInt(match[3], 10);

        // Alpha in CSS rgba() is 0..1 (typically), but tolerate 0..255 as well.
        let aByte : number = 255;
        if( match[4] !== undefined )
        {
            const aRaw = Number.parseFloat(match[4]);
            aByte = aRaw <= 1 ? Math.round(aRaw * 255) : Math.round(aRaw);
        }

        const rgbHex : string = `${hex2(r)}${hex2(g)}${hex2(b)}`;
        return aByte < 255 ? `#${rgbHex}${hex2(aByte)}` : `#${rgbHex}`;
    }


}

//
// eof
//
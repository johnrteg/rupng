//
import QRCode from "qrcode";

//
// QrRenderer — thin wrapper over the `qrcode` library (links-3.1). One mint, one glyph source: SMS/
// email embed the short URL directly; print renders the SAME URL as a QR glyph via this renderer —
// print does NOT use a provider's built-in QR (per SPECS.md).
//
export class QrRenderer
{
    // print DPI target — 300 DPI is standard print-quality; qrcode's `scale` is module-pixel size,
    // not literal DPI, so this is tuned for a crisp glyph at typical postcard/letter print sizes.
    private static readonly PRINT_SCALE : number = 10;

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Render `url` as a PNG QR glyph at print DPI, base64-encoded. */
    public static async renderPng( url : string ) : Promise<string>
    {
        const buffer : Buffer = await QRCode.toBuffer( url, { type: "png", scale: QrRenderer.PRINT_SCALE, margin: 2 } );
        return buffer.toString( "base64" );
    }
}

export default QrRenderer;
// eof

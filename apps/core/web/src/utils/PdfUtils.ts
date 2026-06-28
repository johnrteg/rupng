//
import AppModel from "@model/AppModel";

//
// PdfUtils — client-side HTML → PDF download. Uses html2pdf.js (jsPDF + html2canvas), imported
// lazily so the ~1MB PDF stack only loads when a user actually downloads something. Renders into a
// clean, print-friendly off-screen container (not whatever on-screen element is clipped/scrolled).
//
export class PdfUtils
{
    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Fetch an HTML document by URL and download it as a PDF. Filename defaults to the basename. */
    public static async downloadUrlAsPdf( src : string, fileName? : string ) : Promise<void>
    {
        try
        {
            const response : Response = await fetch( src );
            const html     : string   = await response.text();
            await PdfUtils.downloadHtmlAsPdf( html, fileName ?? PdfUtils.defaultName( src ) );
        }
        catch( err )
        {
            AppModel.instance().log.warn( "PdfUtils.downloadUrlAsPdf failed", err );
        }
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Convert an HTML string to a PDF and trigger a download. */
    public static async downloadHtmlAsPdf( html : string, fileName : string = "document.pdf" ) : Promise<void>
    {
        try
        {
            const html2pdf = ( await import( "html2pdf.js" ) ).default;

            const container : HTMLDivElement = document.createElement( "div" );
            container.innerHTML        = html;
            container.style.width      = "700px";
            container.style.padding    = "16px";
            container.style.color      = "#000";
            container.style.background = "#fff";
            container.style.fontFamily = "Arial, Helvetica, sans-serif";
            container.style.fontSize   = "12px";
            container.style.lineHeight = "1.5";

            await html2pdf()
                .set( {
                    filename:    fileName,
                    margin:      [ 12, 12, 12, 12 ],
                    image:       { type: "jpeg", quality: 0.98 },
                    html2canvas: { scale: 2, useCORS: true, backgroundColor: "#ffffff" },
                    jsPDF:       { unit: "mm", format: "a4", orientation: "portrait" }
                } )
                .from( container )
                .save();
        }
        catch( err )
        {
            AppModel.instance().log.warn( "PdfUtils.downloadHtmlAsPdf failed", err );
        }
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** "/legal/terms.html" → "terms.pdf" */
    private static defaultName( src : string ) : string
    {
        const base : string = src.split( "/" ).pop() ?? "document";
        return base.replace( /\.html?$/i, "" ) + ".pdf";
    }
}

export default PdfUtils;

// eof

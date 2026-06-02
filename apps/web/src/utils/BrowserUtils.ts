//
import { useMediaQuery, useTheme } from '@mui/material';
import { StringUtils, Network } from '@repo/common';
import { RestfulService } from '@repo/endpoint';

export default class BrowserUtils
{

    ///////////////////////////////////////////////////////////////////////////////////////////////////////
    /**
     * Copy the given text to the system clipboard.
     *
     * @param text - The string to write to the clipboard.
     * @returns A Promise that resolves to true if the copy succeeded, false on failure.
     *
     * @example
     * await BrowserUtils.copyToClipboard('https://example.com');
     */
    public static async copyToClipboard( text : string ): Promise<boolean>
    {
        try
        {
            await navigator.clipboard.writeText(text);
            return true;
        }
        catch( e )
        {
            return false;
        }
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////
    public static windowWidth(): number
    {
        return window.innerWidth;
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////
    /**
     * Determine whether the current browser is running on macOS.
     *
     * Uses the navigator.userAgent string to detect macOS by checking for the presence
     * of 'mac' in the user agent. This includes macOS, Mac OS X, and other Apple desktop platforms.
     *
     * @returns {boolean} True if running on macOS/Mac OS X, false otherwise.
     *
     * @example
     * if (BrowserUtils.isMac()) {
     *     // Show Cmd+C instead of Ctrl+C
     *     showShortcut('⌘C');
     * }
     */
    public static isMac(): boolean
    {
        return navigator.userAgent.toLowerCase().includes('mac');
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////
    /**
     * Determine whether the current browser is running on Windows or other non-macOS platforms.
     *
     * This is a convenience method that returns the inverse of isMac(). Returns true for
     * Windows, Linux, and any other non-macOS operating systems.
     *
     * @returns {boolean} True if running on Windows or any non-macOS platform, false if running on macOS.
     *
     * @example
     * if (BrowserUtils.isWindows()) {
     *     // Show Ctrl+C instead of Cmd+C
     *     showShortcut('Ctrl+C');
     * }
     */
    public static isWindows(): boolean
    {
        return !BrowserUtils.isMac();
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////
    /**
     * Return the timezone offset in minutes relative to UTC.
     *
     * This is the negated value of Date.prototype.getTimezoneOffset() so that
     * positive values indicate local time is ahead of UTC and negative values
     * indicate local time is behind UTC.
     *
     * @returns The timezone offset in minutes (e.g. -480 for UTC-8, 60 for UTC+1).
     *
     * @example
     * const offset = BrowserUtils.tzOffset(); // e.g. -300
     */
    public static tzOffset(): number
    {
        return -new Date().getTimezoneOffset();
    }

    ////////////////////////////////////////////////////////////////////////////////////////////////////////////
    /**
     * Open the given URL in a new browser tab/window if it appears to be an absolute URL.
     *
     * @param url - The URL to open. Should include a protocol (e.g. "https://example.com") or otherwise contain Network.PROTOCOL_SEPARATOR (typically "://").
     *                Empty strings or relative URLs will be ignored.
     *
     * @example
     * BrowserUtils.open('https://example.com');
     */
    public static open( url : string ): void
    {
        if( url !== "" && url.indexOf( Network.PROTOCOL_SEPARATOR ) > 0 )window.open( url, "_blank" );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////////////////////
    public static mailto( email : string, subject? : string ): void
    {
        let link : string = StringUtils.format( "mailto:{0}", email );
        if( subject !== undefined )link += StringUtils.format( "?subject={0}", subject );
        window.open( link, "_blank" );
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////////////////
    /**
     * Whether the current viewport matches the "mobile" breakpoint.
     *
     * This uses the theme's "tablet" breakpoint as the threshold: returns true when
     * the viewport width is below the tablet breakpoint (i.e. considered mobile).
     *
     * @returns {boolean} True when current screen width is less than the theme's tablet breakpoint.
     *
     * @example
     * if (BrowserUtils.isMobile) { ... }
     */
    public static get isMobile() : boolean
    {
        // is mobile if current screen width is < tablet threshold
        return useMediaQuery( useTheme().breakpoints.down('tablet') );
    }
    
    //////////////////////////////////////////////////////////////////////////////////////////////////////////////
   /**
     * Whether the current viewport matches the "tablet" breakpoint.
     *
     * Uses the theme's breakpoint utilities; returns true when the viewport width
     * matches the tablet breakpoint (i.e. considered tablet).
     *
     * @returns {boolean} True when the current screen width matches the tablet breakpoint.
     *
     * @example
     * if (BrowserUtils.isTablet) { ...}
     */
    public static get isTablet() : boolean
    {
        // is tablet if current screen width is > desktop threshold
        return useMediaQuery( useTheme().breakpoints.up('tablet') );
    }
    
    //////////////////////////////////////////////////////////////////////////////////////////////////////////////
     /**
     * Whether the current viewport matches the "desktop" breakpoint.
     *
     * Uses the theme's breakpoint utilities; returns true when the viewport width
     * is greater than or equal to the desktop breakpoint.
     *
     * @returns {boolean} True when the current screen width is at or above the desktop breakpoint.
     *
     * @example
     * if (BrowserUtils.isDesktop) { ... }
     */
    public static get isDesktop() : boolean
    {
        //console.log( theme.breakpoints );
        // is desktop if current screen width is > tablet threshold
        return useMediaQuery( useTheme().breakpoints.up('tablet') );
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////////////////
    //  when below this width
    public static get isNarrow() : boolean
    {
        //console.log( theme.breakpoints );
        // is desktop if current screen width is > tablet threshold
        return useMediaQuery( useTheme().breakpoints.down('tablet') );
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////////////////
    /**
     * Whether the current viewport is in portrait orientation.
     *
     * Returns true when the viewport height is greater than the width.
     *
     * @returns {boolean} True when the viewport is portrait (height > width).
     *
     * @example
     * if (BrowserUtils.isPortrait) { ... }
     */
    public static get isPortrait() : boolean
    {
        return window.innerWidth < window.innerHeight;;
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////////////////
    /**
     * Whether the current viewport is in landscape orientation.
     *
     * Returns true when the viewport width is greater than the height.
     *
     * @returns {boolean} True when the viewport is landscape (width > height).
     *
     * @example
     * if (BrowserUtils.isLandscape) { ... }
     */
    public static get isLandscape() : boolean
    {
        return !BrowserUtils.isPortrait
    }

    /////////////////////////////////////////////////////////////////////////////////////////////////////////////
    /**
     * Play a short audio file at the given volume.
     *
     * @param path - URL or relative path to the audio file to play. Should point to a valid audio resource (e.g. .mp3, .ogg).
     * @param volume - Playback volume from 0.0 (muted) to 1.0 (maximum). Values outside this range will be clamped.
     *
     * @example
     * BrowserUtils.playSound('/sounds/notify.mp3', 0.5);
     */
    public static playSound( path : string, volume : number ) : void
    {
        const audio : HTMLAudioElement = new Audio( path ); // Adjust path as needed
        audio.volume = Math.max( 0, Math.min( volume, 1 )); // 0-1
        audio.play();
    }

    /////////////////////////////////////////////////////////////////////////////////////////////////////////////
    /**
     * Read a File object as UTF-8 text.
     *
     * @param file - The File to read (e.g. from an <input type="file">). Must be a valid File instance.
     * @returns A Promise that resolves with the file contents as a string, or rejects with the FileReader error.
     *
     * @example
     * const contents : string = await BrowserUtils.readFile(fileInput.files[0]);
     */
    public static async readFile( file : File ) : Promise<string>
    {
        return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = (e) => {
                    const contents : string = e.target?.result as string;
                    resolve(contents);
                };
                reader.onerror = (e) => {
                    reject(e);
                };
                reader.readAsText(file);
            });
    }

    /////////////////////////////////////////////////////////////////////////////////////////////////////////////
    /**
     * Clean an HTML string by removing document-level tags, scripts/styles, comments,
     * inline style/class attributes and other extraneous fragments, normalize whitespace
     * and convert newlines to <br>.
     *
     * This function accepts either a full HTML document or an HTML fragment. It strips
     * DOCTYPE, <html>, <head>, <body>, <script>, <style>, <link>, <meta>, <title>,
     * comments, inline style/class attributes and certain Apple/conversion artefacts,
     * then replaces newline characters with <br> and collapses repeated whitespace.
     *
     * @param html - The HTML string to clean (full document or fragment).
     * @returns A cleaned HTML string suitable for simple display or further processing.
     *
     * @example
     * // returns 'Hello<br>World'
     * BrowserUtils.cleanHtml('<!DOCTYPE html><html><body><p>Hello\nWorld</p><script>malicious()</script></body></html>');
     */
    public static cleanHtml( html : string ) : string
    {
        // Remove DOCTYPE, <html>, </html>, <head>, </head>, <header>, </header>, and <body> tags
        html = html.replace(/<!DOCTYPE[^>]*>/gi, '');
        html = html.replace(/<\/?html[^>]*>/gi, '');
        html = html.replace(/<\/?head[^>]*>/gi, '');
        html = html.replace(/<\/?header[^>]*>/gi, '');
        html = html.replace(/<\/?body[^>]*>/gi, '');

        // Remove Apple-converted-space spans
        html = html.replace(/<span class="Apple-converted-space">.*?<\/span>/g, ' ');

        // Remove all <p> and <span> wrappers but keep their content
        html = html.replace(/<\/?p[^>]*>/g, '');
        html = html.replace(/<\/?span[^>]*>/g, '');

        // Remove <script> tags and their content
        html = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');

        // Remove <style> tags and their content
        html = html.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');

        // Remove <link> tags
        html = html.replace(/<link[^>]*>/gi, '');

        // Replace \n with <br/>
        html = html.replace(/\n/g, '<br>');

        // Remove <meta> tags
        html = html.replace(/<meta[^>]*>/gi, '');

        html = html.replace(/```[^>]*>/gi, ''); // ``` sequences remove
        html = html.replace(/`[^>]*>/gi, '"');  // since ` backquotes to regular quotes

        // Remove <title> tags
        html = html.replace(/<title[^>]*>.*?<\/title>/gi, '');
        html = html.replace(/<title[^>]*>/gi, '');

        // Remove HTML comments
        html = html.replace(/<!--[\s\S]*?-->/g, '');

        // Remove inline style and class attributes
        html = html.replace(/\s*style="[^"]*"/gi, '');
        html = html.replace(/\s*class="[^"]*"/gi, '');

        // Decode HTML entities for < and >
        html = html.replace(/&lt;/g, '<').replace(/&gt;/g, '>');

        // Remove extra whitespace
        html = html.replace(/\s{2,}/g, ' ').trim();

        return html;
    }

    /////////////////////////////////////////////////////////////////////////////////////////////////////////////
    /**
     * Parse an HTML string and return the cleaned body HTML.
     *
     * @param html - The HTML string to parse. Can be a full document (including <head>) or a fragment.
     *               This uses DOMParser to build a Document and returns the document.body.innerHTML
     *               with head-level tags removed via BrowserUtils.removeHeadTags().
     * @returns The trimmed body HTML string with head/meta/title removed; empty string if no body content.
     *
     * @example
     * const body = BrowserUtils.parseHtmlBody('<!doctype html><html><head><title>t</title></head><body><p>Hello</p></body></html>');
     * // body === '<p>Hello</p>'
     */
    public static parseHtmlBody( html : string ) : string
    {
        const parser : DOMParser = new DOMParser();
        const doc : Document = parser.parseFromString( html, "text/html" );
        return BrowserUtils.removeHeadTags( doc.body.innerHTML.trim() );
    }

    /////////////////////////////////////////////////////////////////////////////////////////////////////////////
    /**
     * Remove head-level tags from an HTML fragment.
     *
     * Strips <meta> tags and any <title>...</title> (or stray <title> tags) from the provided HTML
     * string and returns the trimmed result. Intended for cleaning up DOMParser-produced body HTML.
     *
     * @param html - HTML string that may contain head-level tags (meta/title). The input is not mutated.
     * @returns The HTML string with head-level tags removed and trimmed.
     *
     * @example
     * // returns '<p>Hello</p>'
     * BrowserUtils.removeHeadTags('<meta name="x"><title>t</title><p>Hello</p>');
     */
    public static removeHeadTags(html: string): string
    {
        // Remove <meta ...>, <title ...>, and <title>...</title>
        html = html.replace(/<meta[^>]*>/gi, '');
        html = html.replace(/<title[^>]*>.*?<\/title>/gi, '');
        html = html.replace(/<title[^>]*>/gi, ''); // In case of self-closing or empty title
        return html.trim();
    }

    /////////////////////////////////////////////////////////////////////////////////////////////////////////////
    /**
     * Return whether the given text appears to contain HTML tags.
     *
     * @param text - Input string to test. If null/undefined or not a string the function returns false.
     *               Can be a full HTML fragment or plain text.
     * @returns True when the input contains common HTML elements/tags (e.g. <p>, <div>, <a>, <img>, <br>, <h1>-<h6>).
     *
     * @example
     * BrowserUtils.isHtml('<p>Hello</p>'); // true
     * BrowserUtils.isHtml('Just plain text'); // false
     */
    public static isHtml( text: string ): boolean
    {
        if( !text || typeof text !== "string" )return false;
        // Check for common HTML tags, e.g., <p>, <div>, <span>, <br>, <img>, <a>, <table>
        return /<\s*(p|div|span|br|img|a|table|h[1-6])\b[^>]*>/i.test(text);
    }

    /////////////////////////////////////////////////////////////////////////////////////////////////////////////
    public static stripParagraph( html : string ) : string
    {
        if( !html || typeof html !== "string" )return "";

        let s : string = html.trim();

        // Remove ONLY a single outer <p ...> ... </p> wrapper
        // (keep inner content intact; ignore other <p> tags not at the boundaries)
        s = s.replace(/^<p\b[^>]*>/i, '');
        s = s.replace(/<\/p>$/i, '');

        return s.trim();
    }

    /////////////////////////////////////////////////////////////////////////////////////////////////////////////
    /**
     * Strip HTML tags and return plain text from an HTML string.
     *
     * @param html - HTML string or fragment to strip. If the value is empty or not a string the function returns an empty string.
     * @returns The plain text content extracted from the HTML (uses a DOM element's textContent/innerText to decode entities).
     *
     * @example
     * BrowserUtils.stripHtml('<p>Hello <b>World</b></p>'); // 'Hello World'
     */
    public static stripHtml( html : string ) : string
    {
        const div : HTMLDivElement = document.createElement('div');
        div.innerHTML = html;
        return div.textContent || div.innerText || "";
    }

    /////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    /**
     * Convert plain text into simple HTML.
     *
     * - Wraps content in <p>...</p>
     * - Treats newlines as paragraph breaks
     * - Escapes HTML special characters to avoid injecting markup
     */
    public static toHtml( text : string ) : string
    {
        if( !text || typeof text !== 'string' )return "";

        // If it's already HTML, leave it alone.
        if( BrowserUtils.isHtml( text ) )return text;

        const escapeHtml = (s: string): string =>
            s
                .replace(/&/g, "&amp;")
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;")
                .replace(/\"/g, "&quot;")
                .replace(/'/g, "&#39;");

        const lines : Array<string> = text
            .replace(/\r\n/g, "\n")
            .replace(/\r/g, "\n")
            .split(/\n/);

        // Convert blank lines into paragraph breaks as well.
        const paras : Array<string> = lines
            .map( l => escapeHtml( (l ?? "").trimEnd() ) )
            .join("\n")
            .split(/\n{2,}/)
            .map( p => p.trim() )
            .filter( p => p !== "" );

        if( paras.length === 0 )return "";

        return paras.map( p => `<p>${ p.replace(/\n/g, "<br>") }</p>` ).join("");
    }


    /////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    /**
     * Convert an HTML fragment into plain text while preserving visible line breaks.
     *
     * Intended for SMS/plain-text contexts where the editor may produce <p>, <div>, <br>, <li>, etc.
     *
     * Rules:
     * - <br> => '\n'
     * - block-ish tags (<p>, <div>, headers, list items, etc.) => separated by '\n'
     * - Remaining tags are stripped via DOM textContent (so entities decode properly)
     */
    public static toPlainText( html : string ) : string
    {
        if( !html || typeof html !== 'string' )return "";
        if( !BrowserUtils.isHtml( html ) )return html;

        // Expand <a href="url">label</a> → "label url" (preserving the URL as plain text).
        // Only expand when the href differs from the link text, to avoid duplication.
        html = html.replace( /<a\b[^>]*\bhref\s*=\s*["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi,
            ( _match : string, href : string, inner : string ) =>
            {
                // Strip any nested tags from the inner label to get plain text
                const label : string = inner.replace( /<[^>]*>/g, '' ).trim();
                return label && label !== href ? `${ label } ${ href }` : href;
            } );

        // Normalize common line-break producers first.
        let normalized : string = html
            .replace( /<\s*br\s*\/?>/gi, "\n" )
            .replace( /<\s*\/\s*(p|div|h[1-6]|blockquote|pre|tr)\s*>/gi, "\n" )
            .replace( /<\s*(p|div|h[1-6]|blockquote|pre|tr)\b[^>]*>/gi, "\n" )
            .replace( /<\s*li\b[^>]*>/gi, "\n• " )
            .replace( /<\s*\/\s*li\s*>/gi, "" );

        // Strip the remaining tags but keep decoded entities.
        normalized = BrowserUtils.stripHtml( normalized );

        // Cleanup: collapse excessive whitespace/newlines introduced by markup.
        normalized = normalized
            .replace(/\r\n/g, "\n")
            .replace(/[\t\f\v]+/g, " ")
            .replace(/\u00A0/g, " ")
            .replace(/[ ]{2,}/g, " ")
            .replace(/\n{3,}/g, "\n\n")
            .trim();

        return normalized;
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////
    public static normalizeHtml( input : string ) : string
    {
        if( !input ) return "";

        // If DOMParser isn't available for some reason, fall back to a basic regex transform.
        if( typeof window === 'undefined' || typeof window.DOMParser === 'undefined' )
        {
            return input
                .replaceAll( /\swidth\s*=\s*"[^"]*"/gi, '' )
                .replaceAll( /\sheight\s*=\s*"[^"]*"/gi, '' )
                .replaceAll( /<img\b([^>]*?)>/gi, ( m : string, attrs : string ) =>
                {
                    // ensure style width:100%; height:auto
                    if( /\sstyle\s*=\s*"/i.test( attrs ) )
                    {
                        return `<img${attrs.replace(/\sstyle\s*=\s*"([^"]*)"/i, ( _m, s ) => ` style="${s};width:100%;height:auto;"` )}>`;
                    }
                    return `<img${attrs} style="width:100%;height:auto;">`;
                } );
        }

        try
        {
            const parser : DOMParser = new DOMParser();
            const doc : Document = parser.parseFromString( input, 'text/html' );

            const images : NodeListOf<HTMLImageElement> = doc.querySelectorAll( 'img' );
            images.forEach( ( img : HTMLImageElement ) =>
            {
                img.removeAttribute( 'width' );
                img.removeAttribute( 'height' );

                // preserve any existing inline styles but force responsive sizing
                // use style attribute over properties to avoid losing existing style text
                const existingStyle : string = img.getAttribute( 'style' ) || '';
                const styleParts : Array<string> = existingStyle
                    .split(';')
                    .map( s => s.trim() )
                    .filter( Boolean )
                    // remove width/height directives so ours win
                    .filter( s => !s.toLowerCase().startsWith('width:') && !s.toLowerCase().startsWith('height:') );

                styleParts.push( 'width: 100%' );
                styleParts.push( 'height: auto' );

                img.setAttribute( 'style', styleParts.join('; ') + ';' );
            } );

            return doc.body.innerHTML;
        }
        catch( err )
        {
            console.warn( 'HelpDrawer::normalizeHelpHtml failed; using raw HTML', err );
            return input;
        }
    }

    /////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    // Convert inner paragraph tags to newlines so nested <p>...</p> renders as multi-line plain text.
    public static htmlParagraphsToNewlines( html : string ) : string
    {
        // Replace closing/opening p boundaries and standalone closing p with newlines, then strip remaining tags.
        const normalized : string = html
            .replace( /<\s*\/\s*p\s*>\s*<\s*p[^>]*>/gi, "\n" )
            .replace( /<\s*p[^>]*>/gi, "\n" )
            .replace( /<\s*\/\s*p\s*>/gi, "\n" );

        // Collapse multiple newlines produced by malformed/nested p.
        return normalized.replace( /\n{2,}/g, "\n" ).trim();
    }

    /////////////////////////////////////////////////////////////////////////////////////////////////////////////
    /**
     * Determine whether two File objects represent the same file.
     *
     * Compares name, size and MIME type. If either argument is null the function
     * returns true only when both are null (strict equality).
     *
     * @param file1 - First File object or null.
     * @param file2 - Second File object or null.
     * @returns True if both are the same File (name, size and type match) or both null; otherwise false.
     *
     * @example
     * const same = BrowserUtils.isSameFile(fileA, fileB);
     */
    public static isSameFile( file1 : File | null, file2 : File | null ) : boolean
    {
        if ( !file1 || !file2 )return file1 === file2;
        return (
            file1.name === file2.name &&
            file1.size === file2.size &&
            file1.type === file2.type
        );
    }

    /////////////////////////////////////////////////////////////////////////////////////////////////////////////
    /**
     * Determine whether two arrays of File objects are different.
     *
     * Compares array lengths and then compares corresponding File entries.
     * Comparison is order-sensitive — files must appear in the same order to be
     * considered the same. Uses BrowserUtils.isSameFile to compare individual files.
     *
     * @param a - First array of File objects to compare.
     * @param b - Second array of File objects to compare against.
     * @returns True if the arrays differ (different length or any corresponding File differs); false if arrays are equal.
     *
     * @example
     * // returns true if filesA and filesB are different
     * const different = BrowserUtils.filesAreDifferent(filesA, filesB);
     */
    public static filesAreDifferent( a: Array<File>, b: Array<File>): boolean
    {
        if( a.length !== b.length )return true;

        for (let i = 0; i < a.length; i++)
        {
            if( BrowserUtils.isSameFile( a[i], b[i] ) )
            {
                return true;
            }
        }
        return false;
    }

    /////////////////////////////////////////////////////////////////////////////////////////////////////////////
    /**
     * Determine whether two arrays of File objects are the same.
     *
     * Compares array lengths and then compares corresponding File entries for name, size, and type.
     * Comparison is order-sensitive — files must appear in the same order to be
     * considered the same. Returns true only if both arrays are null/undefined or if all files match.
     *
     * @param a - First array of File objects to compare. Can be null or undefined.
     * @param b - Second array of File objects to compare against. Can be null or undefined.
     * @returns True if the arrays are identical (same length and all corresponding Files have matching name, size, and type); false if arrays differ.
     *
     * @example
     * const same = BrowserUtils.filesAreSame(filesA, filesB);
     */
    public static filesAreSame( a: Array<File>, b: Array<File>): boolean
    {
        if ( !a || !b ) return a === b;
        if (a.length !== b.length) return false;

        for (let i = 0; i < a.length; i++)
        {
            if (a[i].name !== b[i].name || a[i].size !== b[i].size || a[i].type !== b[i].type ) return false;
        }
        return true;
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////////////////
    /**
     * Download a file from a URL and save it to the user's device.
     *
     * Fetches the file from the provided URL, creates a blob, and triggers a download
     * using a temporary anchor element. The filename is extracted from the URL or can
     * be overridden with a custom name.
     *
     * @param url - The URL of the file to download. Must be a valid URL accessible via fetch with CORS support.
     * @param override_file_name - Optional custom filename for the downloaded file. If null, the filename will be extracted from the URL and sanitized.
     * @returns A Promise that resolves when the download is initiated.
     *
     * @example
     * await BrowserUtils.download('https://example.com/document.pdf');
     * await BrowserUtils.download('https://example.com/file.zip', 'my-custom-name.zip');
     */
    public static async download( url : string, override_file_name : string | null = null ) : Promise<void>
    {
        let response : Response;
        try
        {
            response = await fetch( url, { mode: 'cors' });
        }
        catch( e )
        {
            // CORS or network error — fall back to opening the URL directly in a new tab
            window.open( url, "_blank" );
            return;
        }
        const blob      : Blob = await response.blob();
        const blobUrl   : string = URL.createObjectURL( blob );

        // Extract filename from URL, ignoring query parameters
        let file_name : string = url;

        // removing any triling parameters
        if( url.indexOf( "?" ) > 0 )
        {
            file_name = url.split( "?" )[0];
        }
        //console.log(  "1. ", url, file_name, file_name.indexOf( '/' ) );
        // get last part of url
        if( file_name.indexOf( '/' ) >= 0 )
        {
            const fname_split : Array<string> = file_name.split( "/" );
            //console.log(  "2. ", fname_split );
            if( fname_split.length > 0 )
            {
                file_name = fname_split[ fname_split.length - 1 ];
            }
            
        }


        const link : HTMLAnchorElement = document.createElement('a');
        link.href = blobUrl;
        link.download = override_file_name ? override_file_name : StringUtils.removeNonAlphaNumeric( file_name );
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        URL.revokeObjectURL(blobUrl);
    }

    ///////////////////////////////////////////////////////////////////////////////////////////
    public static escapeCsvValue( value: string | number | null | undefined ): string
    {
        const str : string = String( value || '' );
        // Escape double quotes by doubling them, then wrap in quotes
        return `"${str.replace(/"/g, '""')}"`;
    }


    //////////////////////////////////////////////////////////////////////////////////////////////////////////////
    /**
     * Download raw data as a file to the user's device.
     *
     * Creates a blob from the provided data and MIME type, then triggers a download
     * using a temporary anchor element. The filename is sanitized to remove invalid characters.
     *
     * @param data - The raw string data to download. Can be text, JSON, CSV, or other string-based content.
     * @param mime - The MIME type for the file (e.g. Network.MimeType.TEXT_PLAIN, Network.MimeType.APPLICATION_JSON).
     * @param default_name - The default filename for the download. Invalid characters will be replaced with underscores.
     * @returns A Promise that resolves when the download is initiated.
     *
     * @example
     * await BrowserUtils.downloadRaw('Hello World', Network.MimeType.TEXT_PLAIN, 'hello.txt');
     * await BrowserUtils.downloadRaw(JSON.stringify(data), Network.MimeType.APPLICATION_JSON, 'data.json');
     */
    public static async downloadRaw(    data : string, // | ArrayBuffer | Uint8Array,
                                        mime : Network.MimeType,
                                        default_name : string ) : Promise<void>
    {
        let blob : Blob = new Blob([ data as string ], { type: mime });
        let url : string = URL.createObjectURL( blob );
        let link : HTMLAnchorElement = document.createElement('a');
        link.href = url;
        link.download = default_name.replace(/[^a-zA-Z0-9.-]/g, "_");

        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        URL.revokeObjectURL( url );
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////////////////
    /**
     * Determine whether a URL points to an image file.
     *
     * Checks if the provided URL is a valid HTTP/HTTPS URL ending with a common
     * image file extension (jpg, jpeg, png). Returns false for null URLs or URLs
     * that don't match the expected pattern.
     *
     * @param url - The URL string to test, or null. Can be any string value.
     * @returns True if the URL is a valid HTTP/HTTPS image URL with jpg, jpeg, or png extension; false otherwise.
     *
     * @example
     * BrowserUtils.isImageUrl('https://example.com/photo.jpg'); // true
     * BrowserUtils.isImageUrl('https://example.com/photo.png'); // true
     * BrowserUtils.isImageUrl('https://example.com/document.pdf'); // false
     * BrowserUtils.isImageUrl(null); // false
     */
    public static isImageUrl( url: string | null ) : boolean
    {
        if( url === null )
            return false;
        else
            return /^https?:\/\/.+\.(jpg|jpeg|png)$/i.test(url);
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////////////////
    public static async validImageUrl( url: string | null ) : Promise<boolean>
    {
        if( url !== null && BrowserUtils.isImageUrl( url ) )
        {
            const api : RestfulService = new RestfulService( "" );
            const response : RestfulService.Reply = await api.head( url, { dummy : Date.now() } );
            return response.ok;
        }
        else
        {
            return false;
        }
    }

    /////////////////////////////////////////////////////////////////////////////////////////////////////////////
    public static async sleep( ms : number ) : Promise<void>
    {
        await new Promise<void>( resolve => setTimeout( resolve, ms ) );
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////////////////
    /**
     * Convert a string to a Uint8Array.
     *
     * Each character in the string is converted to its character code and masked to 8 bits (0xFF)
     * to ensure it fits within a single byte. This is useful for binary data operations or when
     * interfacing with APIs that require byte arrays.
     *
     * @param str - The string to convert to a Uint8Array. Each character will be converted to its char code.
     * @returns A Uint8Array where each element represents one character from the input string as a byte value (0-255).
     *
     * @example
     * const bytes = BrowserUtils.stringToUint8Array('Hello'); // Uint8Array [72, 101, 108, 108, 111]
     * const data = BrowserUtils.stringToUint8Array('ABC'); // Uint8Array [65, 66, 67]
     */
    public static stringToUint8Array(str: string): Uint8Array
    {
        const arr = new Uint8Array( str.length) ;
        for ( let i = 0; i < str.length; i++ )
        {
            arr[i] = str.charCodeAt(i) & 0xFF;
        }
        return arr;
    }

   

}
//
// eof
//
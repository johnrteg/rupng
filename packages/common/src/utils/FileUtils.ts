//
//
//
export class FileUtils
{

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    public static isImageMime( mime : string ) : boolean
    {
        return /^image\//i.test( mime );
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    public static isVideoMime( mime : string ) : boolean
    {
        return /^video\//i.test( mime );
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    public static isVCardMime( mime : string ) : boolean
    {
        return mime === "text/vcard";
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    public static parseMime( path : string ) : string
    {
        const ext : string = path.split('?')[0].split('.').pop()?.toLowerCase() ?? "";
        switch( ext )
        {
            // image
            case "jpg":
            case "jpeg"     : return "image/jpeg";
            case "png"      : return "image/png";
            case "gif"      : return "image/gif";
            case "bmp"      : return "image/bmp";
            case "webp"     : return "image/webp";
            case "svg"      : return "image/svg+xml";
            case "tif":
            case "tiff"     : return "image/tiff";

            // video
            case "mp4"      : return FileUtils.Mime.VIDEO_MP4;
            case "mov"      : return FileUtils.Mime.VIDEO_MOV;
            case "avi"      : return FileUtils.Mime.VIDEO_AVI;
            case "wmv"      : return FileUtils.Mime.VIDEO_WMV;
            case "flv"      : return FileUtils.Mime.VIDEO_FLV;
            case "webm"     : return FileUtils.Mime.VIDEO_WEBM;
            case "mkv"      : return "video/x-matroska";
            case "m4v"      : return "video/x-m4v";
            case "3gp"      : return "video/3gpp";
            case "mpeg":
            case "mpg"      : return FileUtils.Mime.VIDEO_MPEG;

            // audio
            case "mp3"      : return "audio/mpeg";
            case "wav"      : return "audio/wav";
            case "ogg"      : return "audio/ogg";
            case "aac"      : return "audio/aac";

            // document
            case "pdf"      : return "application/pdf";
            case "vcf"      : return "text/vcard";

            default         : return "";
        }
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    /**
     * Validate if a URL points to an image file based on its file extension.
     *
     * Checks if the URL ends with a common image file extension, performing a case-insensitive
     * match against supported image formats. Strips query parameters before checking the extension
     * to handle URLs with query strings. Supports JPEG, PNG, GIF, BMP, WebP, SVG, and TIFF formats.
     *
     * @param url - The URL string to check for image file extension.
     * @returns True if the URL ends with a recognized image file extension, false otherwise.
     *
     * @example
     * ```typescript
     * // Valid image URLs
     * Validator.isImageUrl('https://example.com/photo.jpg'); // true
     * Validator.isImageUrl('image.PNG'); // true (case insensitive)
     * Validator.isImageUrl('avatar.gif'); // true
     * Validator.isImageUrl('logo.svg'); // true
     * Validator.isImageUrl('photo.jpeg?v=123'); // true (ignores query params)
     * 
     * ```
     */
    public static isImageUrl( url : string ): boolean
    {
        // Check for common image file extensions (case-insensitive)
        return /\.(jpe?g|png|gif|bmp|webp|svg|tiff?)$/i.test(url.split('?')[0]);
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    /**
     * Validate if a URL points to a video file based on its file extension.
     *
     * Checks if the URL ends with a common video file extension, performing a case-insensitive
     * match against supported video formats. Strips query parameters before checking the extension
     * to handle URLs with query strings. Supports MP4, MOV, AVI, WMV, FLV, WebM, MKV, M4V, 3GP,
     * MPEG, and MPG formats.
     *
     * @param url - The URL string to check for video file extension.
     * @returns True if the URL ends with a recognized video file extension, false otherwise.
     *
     * @example
     * ```typescript
     * // Valid video URLs
     * Validator.isVideoUrl('https://example.com/video.mp4'); // true
     * Validator.isVideoUrl('movie.MOV'); // true (case insensitive)
     * Validator.isVideoUrl('clip.avi'); // true
     * Validator.isVideoUrl('stream.webm?quality=hd'); // true (ignores query params)
     * 
     * // Invalid video URLs
     * Validator.isVideoUrl('document.pdf'); // false
     * Validator.isVideoUrl('image.jpg'); // false
     * Validator.isVideoUrl('https://example.com/'); // false (no extension)
     * ```
     */
    public static isVideoUrl( url : string ): boolean
    {
        // Check for common video file extensions (case-insensitive)
        return /\.(mp4|mov|avi|wmv|flv|webm|mkv|m4v|3gp|mpeg|mpg)$/i.test(url.split('?')[0]);
    }

}

export namespace FileUtils
{
    export const UNKNONW_FILE_SIZE : number = 9999;

    export enum Mime
    {
        VIDEO_MP4 = "video/mp4",
        VIDEO_MOV = "video/quicktime",
        VIDEO_AVI = "video/x-msvideo",
        VIDEO_WMV = "video/x-ms-wmv",
        VIDEO_FLV = "video/x-flv",
        VIDEO_WEBM = "video/webm",
        VIDEO_MPEG = "video/mpeg"
    }
    export interface File
    {
        path : string;
        mime : string;
        size : number;
    }
}

export default FileUtils;

//
// eof
//
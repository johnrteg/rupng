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
            case "jpeg"     : return FileUtils.Mime.IMAGE_JPEG;
            case "png"      : return FileUtils.Mime.IMAGE_PNG;
            case "gif"      : return FileUtils.Mime.IMAGE_GIF;
            case "bmp"      : return FileUtils.Mime.IMAGE_BMP;
            case "webp"     : return FileUtils.Mime.IMAGE_WEBP;
            case "svg"      : return FileUtils.Mime.IMAGE_SVG;
            case "tif":
            case "tiff"     : return FileUtils.Mime.IMAGE_TIFF;
            case "avif"     : return FileUtils.Mime.IMAGE_AVIF;

            // video
            case "mp4"      : return FileUtils.Mime.VIDEO_MP4;
            case "mov"      : return FileUtils.Mime.VIDEO_MOV;
            case "avi"      : return FileUtils.Mime.VIDEO_AVI;
            case "wmv"      : return FileUtils.Mime.VIDEO_WMV;
            case "flv"      : return FileUtils.Mime.VIDEO_FLV;
            case "webm"     : return FileUtils.Mime.VIDEO_WEBM;
            case "mkv"      : return FileUtils.Mime.VIDEO_MKV;
            case "m4v"      : return FileUtils.Mime.VIDEO_M4V;
            case "3gp"      : return FileUtils.Mime.VIDEO_3GP;
            case "mpeg":
            case "mpg"      : return FileUtils.Mime.VIDEO_MPEG;

            // audio
            case "mp3"      : return FileUtils.Mime.AUDIO_MPEG;
            case "wav"      : return FileUtils.Mime.AUDIO_WAV;
            case "ogg"      : return FileUtils.Mime.AUDIO_OGG;
            case "aac"      : return FileUtils.Mime.AUDIO_AAC;
            case "m4a"      : return FileUtils.Mime.AUDIO_M4A;
            case "opus"     : return FileUtils.Mime.AUDIO_OPUS;

            // document
            case "pdf"      : return FileUtils.Mime.PDF;
            case "vcf"      : return FileUtils.Mime.VCARD;

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

    /** The central mime-type vocabulary — the single source for mime literals across the platform (never
     *  hand-write `"image/png"` etc.; use a member here). Grouped by family. */
    export enum Mime
    {
        // image
        IMAGE_JPEG = "image/jpeg",
        IMAGE_PNG  = "image/png",
        IMAGE_GIF  = "image/gif",
        IMAGE_BMP  = "image/bmp",
        IMAGE_WEBP = "image/webp",
        IMAGE_SVG  = "image/svg+xml",
        IMAGE_TIFF = "image/tiff",
        IMAGE_AVIF = "image/avif",

        // video
        VIDEO_MP4  = "video/mp4",
        VIDEO_MOV  = "video/quicktime",
        VIDEO_AVI  = "video/x-msvideo",
        VIDEO_WMV  = "video/x-ms-wmv",
        VIDEO_FLV  = "video/x-flv",
        VIDEO_WEBM = "video/webm",
        VIDEO_MPEG = "video/mpeg",
        VIDEO_MKV  = "video/x-matroska",
        VIDEO_M4V  = "video/x-m4v",
        VIDEO_3GP  = "video/3gpp",

        // audio
        AUDIO_MPEG = "audio/mpeg",
        AUDIO_WAV  = "audio/wav",
        AUDIO_OGG  = "audio/ogg",
        AUDIO_AAC  = "audio/aac",
        AUDIO_OPUS = "audio/opus",
        AUDIO_WEBM = "audio/webm",
        AUDIO_M4A  = "audio/mp4",
        AUDIO_PCM  = "audio/pcm",

        // application / document / text
        PDF          = "application/pdf",
        JSON         = "application/json",
        ZIP          = "application/zip",
        OCTET_STREAM = "application/octet-stream",
        VCARD        = "text/vcard",
        TEXT_PLAIN   = "text/plain",
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
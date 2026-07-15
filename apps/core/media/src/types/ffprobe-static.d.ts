// ffprobe-static has no bundled types — it exports the path to the platform's static ffprobe binary.
declare module "ffprobe-static"
{
    export const path : string;
    export const version : string;
}

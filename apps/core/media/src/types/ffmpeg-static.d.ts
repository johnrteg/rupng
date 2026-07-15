// ffmpeg-static has no bundled types — its default export is the path to the platform's static ffmpeg binary.
declare module "ffmpeg-static"
{
    const path : string | null;
    export default path;
}

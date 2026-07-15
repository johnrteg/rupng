//
import MediaService from "./MediaService";

//
// STUDIO role — the /media/studio/* creation & editing surface (media-21, STUB). A media role (like BROWSE)
// so it scales independently, but shares the media plane (S3 + DDB + the AiFactory + the async Jobs). It will
// host the SVG/asset editor's server side: compose/edit into new Media.Assets (source.origin = generated /
// edited), reusing the same pipeline + Downloads. No endpoints yet — this scaffolds the role so it deploys
// and routes; contracts land as the Studio is built out.
//
export class MediaStudioService extends MediaService
{
    /////////////////////////////////////////////////////////////////////
    constructor() { super( MediaService.Role.STUDIO ); }

    /////////////////////////////////////////////////////////////////////
    /** Register the Studio endpoints. Stub for now — inherits /health + /version; Studio contracts land here. */
    protected override async registerEndpoints() : Promise<void>
    {
        await super.registerEndpoints();   // keeps /health + /version
        // TODO(media-21): register Studio endpoints (compose / edit / export) as they're built.
    }
}

export default MediaStudioService;

//
import { GetVariantSpecs, Media, MediaConfig } from '@repo/api';
import { NetworkUtils } from '@repo/common';
import { RestfulEndpoint } from '@repo/endpoint';
import MediaService from '../services/MediaService';

//
// Return the configured variant profiles from AppConfig (`variants.profiles`): the generic "display" profile
// plus any named platform profiles owned by their consumer (e.g. the social service seeds "instagram" / "x").
// A consumer fetches these, then requests processing per profile. Falls back to the model's baked defaults if
// config is unavailable, so this endpoint always returns a usable set.
//
export class GetVariantSpecsImpl extends GetVariantSpecs
{
    private service : MediaService;
    constructor( service : MediaService ) { super(); this.service = service; }

    ///////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        this.service.log.trace( "execute: GetVariantSpecsImpl", { userId: auth.userId } );
        if( !auth.userId ) return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };

        const config : MediaConfig.Config = await this.service.mediaConfig();
        const profiles : Record<string, Array<Media.VariantSpec>> =
            Object.keys( config.variants.profiles ).length > 0
                ? config.variants.profiles
                : { display: [ ...Media.DISPLAY_VARIANTS ] };
        return { status: NetworkUtils.Status.OK, data: { profiles } };
    }
}

export default GetVariantSpecsImpl;

//
import { GetDensities, MediaConfig } from '@repo/api';
import { NetworkUtils } from '@repo/common';
import { RestfulEndpoint } from '@repo/endpoint';
import MediaService from '../services/MediaService';

//
// List the configured image density targets (media-4) — maps the service's MediaConfig `densities` to the
// selectable {key,label,dpi} the UI density picker offers.
//
export class GetDensitiesImpl extends GetDensities
{
    private service : MediaService;
    constructor( service : MediaService ) { super(); this.service = service; }

    ///////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        this.service.log.trace( "execute: GetDensitiesImpl", { userId: auth.userId } );
        if( !auth.userId ) return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };

        const config : MediaConfig.Config = await this.service.mediaConfig();
        const densities : Array<GetDensities.Density> = Object.entries( config.densities ?? {} )
            .map( ( [ key, target ] : [ string, MediaConfig.DensityTarget ] ) : GetDensities.Density => ( { key, label: target.label, dpi: target.dpi } ) );
        return { status: NetworkUtils.Status.OK, data: { densities } };
    }
}

export default GetDensitiesImpl;

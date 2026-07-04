//
import { Application, Trace, Register } from "@repo/services";

import MediaService from "./services/MediaService";
import MediaMainService from "./services/MediaMainService";
import MediaBrowseService from "./services/MediaBrowseService";
import MediaStudioService from "./services/MediaStudioService";

//
// role from the environment: MAIN (the /media/* API + local pipeline drain) or BROWSE (the /media/browse/*
// asset marketplace). scan/process run as Jobs or are drained by MAIN locally.
//
const role : string = process.env.SERVICE_ROLE ?? MediaService.Role.MAIN;

const services : Record<string, () => MediaService> =
{
    [ MediaService.Role.MAIN ]   : () => new MediaMainService(),
    [ MediaService.Role.BROWSE ] : () => new MediaBrowseService(),
    [ MediaService.Role.STUDIO ] : () => new MediaStudioService(),
};

const factory : (() => MediaService) | undefined = services[ role ];

if( factory !== undefined )
{
    factory().run();
}
else
{
    const log : Trace = new Trace( [ Register.Service.MEDIA, 'index' ].join( Application.ID_DIVIDER ), "" );
    log.error( `Unknown ROLE: ${role}` );
    process.exit( 1 );
}

// eof

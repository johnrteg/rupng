//

import { Application, Service } from "@repo/services";

//
// common auth server base
//
export class AuthService extends Service
{
    // name/version of this app, read from apps/auth/package.json at startup
    protected pkg : Application.PackageInfo;

    ///////////////////////////////////////////////////////////////////////////////////////
    constructor( role : AuthService.Role )
    {
        super( [ AuthService.ID, role ].join(Application.ID_DIVIDER) );

        // __dirname resolves to apps/auth/bin/services at runtime; loadPackageInfo walks up
        // to the nearest package.json (apps/auth/package.json)
        this.pkg = this.loadPackageInfo( __dirname );
        this.log.info( "version", { name: this.pkg.name, version: this.pkg.version } );
    }

    ///////////////////////////////////////////////////////////////////////////////////////
    protected async init() : Promise<void>
    {
        super.init();
    }
}

export namespace AuthService
{
    export const ID : string = "auth";

    export enum Role
    {
        READER = "reader",
        WRITER = "writer"
    }
}

export default AuthService;
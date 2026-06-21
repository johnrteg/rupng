//

import { Application, Service, Ports, Register } from "@repo/services";

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
        // identity = Register.Service.AUTH (+ role → "auth:reader"); default to this role's port in the AUTH
        // block for local dev; a deploy's env PORT overrides it
        super( Register.Service.AUTH, role, AuthService.PORT[ role ] );

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
    export enum Role
    {
        READER = "reader",
        WRITER = "writer"
    }

    // role → its absolute port in the AUTH block. The numbers live ONLY in @repo/services Ports;
    // any manifest containerPort references the SAME constants, so the two can never drift.
    export const PORT : Record<Role, number> =
    {
        [ Role.READER ] : Ports.AUTH.READER,
        [ Role.WRITER ] : Ports.AUTH.WRITER,
    };
}

export default AuthService;
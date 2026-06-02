//

import { Application, Service } from "@repo/services";

//
// common auth server base
//
export class AuthService extends Service
{
    ///////////////////////////////////////////////////////////////////////////////////////
    constructor( role : AuthService.Role )
    {
        super( [ AuthService.ID, role ].join(Application.ID_DIVIDER) );
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
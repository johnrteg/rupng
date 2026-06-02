//
import { Application, Service } from '@repo/services';

//
// common dispatch server base
//
export class DispatchService extends Service
{
    /////////////////////////////////////////////////////////////////////
    constructor( role : DispatchService.Role )
    {
        super( [ DispatchService.ID, role ].join(Application.ID_DIVIDER) );
    }
}

export namespace DispatchService
{
    export const ID : string = "dispatch";
    export enum Role
    {
        MAIN = "main",
    }
}

export default DispatchService;
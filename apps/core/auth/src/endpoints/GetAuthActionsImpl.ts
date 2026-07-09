//
import { GetAuthActions, AuthAction } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";
import AuthService from "../services/AuthService";

//
// List pending actions app-wide (INTERNAL) for the Console — by status (default PENDING), optionally narrowed to
// a type. Expired-but-unswept rows are surfaced as EXPIRED.
//
export class GetAuthActionsImpl extends GetAuthActions
{
    private service : AuthService;
    constructor( service : AuthService ) { super(); this.service = service; }

    ///////////////////////////////////////////////////////////////////////////////////////////
    public async execute( _auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        const status : AuthAction.Status = ( this.query?.status as AuthAction.Status ) ?? AuthAction.Status.PENDING;
        const listed : Type.Result<Array<AuthAction.Entity>> = await this.service.actions.list( status );
        if( !listed.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "could not list actions" } };

        const nowSec : number = Math.floor( Date.now() / 1000 );
        const typeFilter : AuthAction.Type | undefined = this.query?.type;
        const records : Array<AuthAction.Entity> = listed.data
            .filter( ( row : AuthAction.Entity ) : boolean => !typeFilter || row.type === typeFilter )
            .map( ( row : AuthAction.Entity ) : AuthAction.Entity => ( row.status === AuthAction.Status.PENDING && row.expiresAt < nowSec ? { ...row, status: AuthAction.Status.EXPIRED } : row ) );
        return { status: NetworkUtils.Status.OK, data: { records } };
    }
}

export default GetAuthActionsImpl;

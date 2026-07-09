//
import { GetAuthAction, AuthAction } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";
import AuthService from "../services/AuthService";

//
// Validate + describe a pending action for a landing page (anonymous, token-gated). Returns the public-safe view
// with an EFFECTIVE status (a still-PENDING row past its expiry reads EXPIRED even before the TTL sweep).
//
export class GetAuthActionImpl extends GetAuthAction
{
    private service : AuthService;
    constructor( service : AuthService ) { super(); this.service = service; }

    ///////////////////////////////////////////////////////////////////////////////////////////
    public async execute( _auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        const token : string = this.query?.token ?? "";
        const got : Type.Result<AuthAction.Entity | undefined> = await this.service.actions.get( token );
        if( !got.ok )       return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "could not read the action" } };
        if( !got.data )     return { status: NetworkUtils.Status.NOT_FOUND, data: { message: "action not found" } };

        const entity : AuthAction.Entity = got.data;
        const nowSec : number = Math.floor( Date.now() / 1000 );
        const status : AuthAction.Status = ( entity.status === AuthAction.Status.PENDING && entity.expiresAt < nowSec ) ? AuthAction.Status.EXPIRED : entity.status;
        const view : AuthAction.PublicView = { type: entity.type, status, target: entity.target, expiresAt: entity.expiresAt };
        return { status: NetworkUtils.Status.OK, data: { action: view } };
    }
}

export default GetAuthActionImpl;

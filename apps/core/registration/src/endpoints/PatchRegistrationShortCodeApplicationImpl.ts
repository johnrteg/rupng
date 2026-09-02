//
import { PatchRegistrationShortCodeApplication, PhoneNumber } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";

import RegistrationService from "../services/RegistrationService";

//
// Staff-progressed short-code application status update (registration-4.x) — ROOT only, since no carrier
// webhook exists to drive this (mirrors PostRegistrationOverrideImpl's staff break-glass gate + acting-account
// convention: the target account comes from `auth.accountId`, the X-Account header a staff caller sets).
//
export class PatchRegistrationShortCodeApplicationImpl extends PatchRegistrationShortCodeApplication
{
    private service : RegistrationService;
    constructor( service : RegistrationService ) { super(); this.service = service; }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId ) return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };
        if( !auth.accountId ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "an acting account (X-Account) is required" } };

        const body : PatchRegistrationShortCodeApplication.Body | null = this.body;
        if( !body ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "an update body is required" } };

        const updated : Type.Result<PhoneNumber.ShortCodeApplication> = await this.service.domain.patchShortCodeApplication(
            auth.accountId, this.query.id, body.status, body.shortCode, body.staffNote );
        if( !updated.ok )
        {
            const notFound : boolean = updated.error.includes( "not found" );
            return { status: notFound ? NetworkUtils.Status.NOT_FOUND : NetworkUtils.Status.BAD_REQUEST, data: { message: updated.error } };
        }
        return { status: NetworkUtils.Status.OK, data: updated.data };
    }
}

export default PatchRegistrationShortCodeApplicationImpl;
// eof

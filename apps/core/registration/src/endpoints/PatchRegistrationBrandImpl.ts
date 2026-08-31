//
import { PatchRegistrationBrand, Registration } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";

import RegistrationService from "../services/RegistrationService";
import { RegistrationDomain } from "../domain/RegistrationDomain";

//
// Partially update a brand's user-submittable fields (registration-1.0/3.2). WHICH statuses permit an edit is
// the domain's call, not the contract's — editing an in-flight or approved brand would silently desynchronize
// the projection from TCR, so the domain rejects it and that rejection surfaces here as a 400.
//
export class PatchRegistrationBrandImpl extends PatchRegistrationBrand
{
    private service : RegistrationService;
    constructor( service : RegistrationService ) { super(); this.service = service; }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId || !auth.accountId ) return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };

        const body : PatchRegistrationBrand.Body | null = this.body;
        if( !body ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "an update body is required" } };

        // 404 before 400 — a caller editing a brand that doesn't exist should hear that, not a validation note
        const existing : Type.Result<Registration.Brand | undefined> = await this.service.domain.getBrand( auth.accountId, this.query.brandId );
        if( !existing.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "could not read the brand" } };
        if( existing.data === undefined ) return { status: NetworkUtils.Status.NOT_FOUND, data: { message: "brand not found" } };

        const fields : Partial<RegistrationDomain.BrandFields> = {
            entityType: body.entityType, firstName: body.firstName, lastName: body.lastName,
            companyName: body.companyName, ein: body.ein, einIssuingCountry: body.einIssuingCountry,
            stockSymbol: body.stockSymbol, stockExchange: body.stockExchange,
            email: body.email, phone: body.phone, street: body.street, city: body.city, state: body.state,
            postalCode: body.postalCode, country: body.country, website: body.website, vertical: body.vertical,
            politicalType: body.politicalType, altBusinessId: body.altBusinessId, altBusinessIdType: body.altBusinessIdType,
        };

        const patched : Type.Result<Registration.Brand> = await this.service.domain.patchBrand( auth.accountId, this.query.brandId, fields );
        if( !patched.ok ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: patched.error } };
        return { status: NetworkUtils.Status.OK, data: patched.data };
    }
}

export default PatchRegistrationBrandImpl;
// eof

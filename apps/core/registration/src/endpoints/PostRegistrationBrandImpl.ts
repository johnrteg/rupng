//
import { PostRegistrationBrand, Registration } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";

import RegistrationService from "../services/RegistrationService";
import { RegistrationDomain } from "../domain/RegistrationDomain";

//
// Create the caller's account brand (registration-1.0/1.1 — brand-per-account). The row lands in DRAFT and
// the push to TCR is ENQUEUED, never done inline: a registry submission is an external call well past a
// request's budget (CLAUDE.md's ~500ms rule), and the contract's own doc says "a later submit flow
// (registration-2.0's job) pushes it to TCR". The 201 body is therefore the DRAFT projection.
//
export class PostRegistrationBrandImpl extends PostRegistrationBrand
{
    private service : RegistrationService;
    constructor( service : RegistrationService ) { super(); this.service = service; }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId || !auth.accountId ) return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };

        const body : PostRegistrationBrand.Body | null = this.body;
        if( !body ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "a brand body is required" } };

        // create the DRAFT projection — entity-type-conditional KYC validation happens in the domain, since
        // which fields are required depends on `entityType` (JSON Schema can't express that cleanly)
        const created : Type.Result<Registration.Brand> = await this.service.domain.createBrand( auth.accountId, {
            entityType: body.entityType, firstName: body.firstName, lastName: body.lastName,
            companyName: body.companyName, ein: body.ein, einIssuingCountry: body.einIssuingCountry,
            stockSymbol: body.stockSymbol, stockExchange: body.stockExchange,
            email: body.email, phone: body.phone, street: body.street, city: body.city, state: body.state,
            postalCode: body.postalCode, country: body.country, website: body.website, vertical: body.vertical,
            politicalType: body.politicalType, altBusinessId: body.altBusinessId, altBusinessIdType: body.altBusinessIdType,
        } );
        if( !created.ok ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: created.error } };

        // queue the TCR submission — a failure to enqueue is logged by the domain but must not lose the DRAFT
        // the account just created, so the response still succeeds and the brand can be resubmitted
        const queued : Type.Result<string> = await this.service.domain.enqueueSubmit( {
            kind: RegistrationDomain.SubmitKind.SUBMIT, accountId: auth.accountId, brandId: created.data.brandId,
        } );
        if( !queued.ok ) return { status: NetworkUtils.Status.OK, data: created.data };

        return { status: NetworkUtils.Status.OK, data: created.data };
    }
}

export default PostRegistrationBrandImpl;
// eof

//
import { DeleteEmailTemplate, EmailTemplate } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";
import EmailService from "../services/EmailService";

//
// Archive a template (soft — status → ARCHIVED; history retained). A PUBLISHED template is the active one for
// its case and can't be archived directly (409) — publish another first. Emits email.template updated.
//
export class DeleteEmailTemplateImpl extends DeleteEmailTemplate
{
    private service : EmailService;
    constructor( service : EmailService ) { super(); this.service = service; }

    ///////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId )    return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };
        if( !auth.accountId ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "no acting account (X-Account)" } };

        const id : string = this.query?.id ?? "";

        // load from the account partition, else the SYSTEM partition
        const own : Type.Result<EmailTemplate.Entity | undefined> = await this.service.getTemplate( auth.accountId, id );
        let template : EmailTemplate.Entity | undefined = own.ok ? own.data : undefined;
        if( template === undefined )
        {
            const system : Type.Result<EmailTemplate.Entity | undefined> = await this.service.getTemplate( EmailService.SYSTEM_ACCOUNT, id );
            template = system.ok ? system.data : undefined;
        }
        if( template === undefined ) return { status: NetworkUtils.Status.NOT_FOUND, data: { message: "template not found" } };

        // can't archive the active published template — publish a replacement first
        if( template.status === EmailTemplate.Status.PUBLISHED ) return { status: NetworkUtils.Status.CONFLICT, data: { message: "can't archive the active published template for a case" } };

        template.status = EmailTemplate.Status.ARCHIVED;
        template.audit = { ...template.audit, modifiedBy: auth.userId, modifiedAt: new Date().toISOString() };
        const wrote : Type.Result<void> = await this.service.putTemplate( template );
        if( !wrote.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "could not archive the template" } };
        void this.service.templateUpdated( template, auth.userId );

        return { status: NetworkUtils.Status.OK, data: { archived: true } };
    }
}

export default DeleteEmailTemplateImpl;

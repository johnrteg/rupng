//
import { PatchEmailTemplate, EmailTemplate } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";
import EmailService from "../services/EmailService";

//
// Update a template's name / subject / block doc / notification case (email-2.1). Bumps version, keeps status,
// recompiles MJML + HTML when the doc changed, persists, and emits email.template updated.
//
export class PatchEmailTemplateImpl extends PatchEmailTemplate
{
    private service : EmailService;
    constructor( service : EmailService ) { super(); this.service = service; }

    ///////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId )    return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };
        if( !auth.accountId ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "no acting account (X-Account)" } };

        const id : string = this.query?.id ?? "";
        const body : PatchEmailTemplate.Body | null = this.body;
        if( !body ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "nothing to update" } };

        // load from the account partition, else the SYSTEM partition
        const own : Type.Result<EmailTemplate.Entity | undefined> = await this.service.getTemplate( auth.accountId, id );
        let template : EmailTemplate.Entity | undefined = own.ok ? own.data : undefined;
        if( template === undefined )
        {
            const system : Type.Result<EmailTemplate.Entity | undefined> = await this.service.getTemplate( EmailService.SYSTEM_ACCOUNT, id );
            template = system.ok ? system.data : undefined;
        }
        if( template === undefined ) return { status: NetworkUtils.Status.NOT_FOUND, data: { message: "template not found" } };

        // apply the changes, bump version, recompile when the doc changed
        if( body.name !== undefined )             template.name = body.name.trim();
        if( body.subject !== undefined )          template.subject = body.subject;
        if( body.notificationType !== undefined ) template.notificationType = ( body.notificationType as string ) === "" ? undefined : body.notificationType;
        if( body.doc !== undefined )
        {
            template.doc = body.doc;
            const compiled : { mjml : string; html : string } = await this.service.compile( body.doc );
            template.mjml = compiled.mjml;
            template.html = compiled.html;
        }
        template.version += 1;
        template.audit = { ...template.audit, modifiedBy: auth.userId, modifiedAt: new Date().toISOString() };

        const wrote : Type.Result<void> = await this.service.putTemplate( template );
        if( !wrote.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "could not update the template" } };
        void this.service.templateUpdated( template, auth.userId );

        return { status: NetworkUtils.Status.OK, data: template };
    }
}

export default PatchEmailTemplateImpl;

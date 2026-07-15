//
import { PostEmailTemplatePublish, EmailTemplate } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";
import EmailService from "../services/EmailService";

//
// Publish a template (email-2.1/2.7) — recompile MJML/HTML, set status PUBLISHED, and make it the active one
// for its (partition, notificationType) case. A case may have MANY templates but only ONE published, so the
// previously-published one is returned to DRAFT (not archived) — it stays a candidate you can re-publish.
//
export class PostEmailTemplatePublishImpl extends PostEmailTemplatePublish
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

        const partition : string = template.accountId ?? EmailService.SYSTEM_ACCOUNT;

        // return the currently-published template for this case (if any + different) to DRAFT — one published
        // per case, but the demoted one stays a draft candidate (not archived)
        if( template.notificationType !== undefined )
        {
            const active : EmailTemplate.Entity | undefined = await this.service.publishedTemplateFor( partition, template.notificationType );
            if( active !== undefined && active.id !== template.id )
            {
                active.status = EmailTemplate.Status.DRAFT;
                active.audit = { ...active.audit, modifiedBy: auth.userId, modifiedAt: new Date().toISOString() };
                const demoted : Type.Result<void> = await this.service.putTemplate( active );
                if( !demoted.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "could not demote the active template" } };
                void this.service.templateUpdated( active, auth.userId );
            }
        }

        // recompile + publish (bump version, stamp published audit)
        const compiled : { mjml : string; html : string } = await this.service.compile( template.doc );
        const now : string = new Date().toISOString();
        template.mjml = compiled.mjml;
        template.html = compiled.html;
        template.status = EmailTemplate.Status.PUBLISHED;
        template.version += 1;
        template.audit = { ...template.audit, modifiedBy: auth.userId, modifiedAt: now, publishedBy: auth.userId, publishedAt: now };

        const wrote : Type.Result<void> = await this.service.putTemplate( template );
        if( !wrote.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "could not publish the template" } };
        void this.service.templateUpdated( template, auth.userId );

        return { status: NetworkUtils.Status.OK, data: template };
    }
}

export default PostEmailTemplatePublishImpl;

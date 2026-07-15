//
import { PostEmailTemplateRevert, EmailTemplate } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";
import EmailService from "../services/EmailService";

//
// Restore an earlier template version (email-2.7) — read version N's immutable snapshot, copy its doc + subject
// into a NEW current version (bump + recompile), and return the template to DRAFT for review. History is never
// destroyed (the restore is itself a new version).
//
export class PostEmailTemplateRevertImpl extends PostEmailTemplateRevert
{
    private service : EmailService;
    constructor( service : EmailService ) { super(); this.service = service; }

    ///////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId )    return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };
        if( !auth.accountId ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "no acting account (X-Account)" } };

        const id : string = this.query?.id ?? "";
        const version : number | undefined = this.body?.version;
        if( version === undefined ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "version is required" } };

        // load the current template (account partition, else SYSTEM)
        const own : Type.Result<EmailTemplate.Entity | undefined> = await this.service.getTemplate( auth.accountId, id );
        let template : EmailTemplate.Entity | undefined = own.ok ? own.data : undefined;
        if( template === undefined )
        {
            const system : Type.Result<EmailTemplate.Entity | undefined> = await this.service.getTemplate( EmailService.SYSTEM_ACCOUNT, id );
            template = system.ok ? system.data : undefined;
        }
        if( template === undefined ) return { status: NetworkUtils.Status.NOT_FOUND, data: { message: "template not found" } };

        const partition : string = template.accountId ?? EmailService.SYSTEM_ACCOUNT;

        // read the target version's snapshot
        const body : Type.Result<EmailTemplate.VersionBody | undefined> = await this.service.getTemplateVersionBody( partition, id, version );
        if( !body.ok )                return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "could not read the version" } };
        if( body.data === undefined ) return { status: NetworkUtils.Status.NOT_FOUND, data: { message: "version not found" } };

        // recompile the restored doc, write it as a NEW current version, and drop back to DRAFT for review
        const compiled : { mjml : string; html : string } = await this.service.compile( body.data.doc );
        const now : string = new Date().toISOString();
        template.doc = body.data.doc;
        if( body.data.subject !== undefined ) template.subject = body.data.subject;   // older snapshots may omit it
        template.mjml = compiled.mjml;
        template.html = compiled.html;
        template.status = EmailTemplate.Status.DRAFT;
        template.version += 1;
        template.audit = { ...template.audit, modifiedBy: auth.userId, modifiedAt: now };

        const wrote : Type.Result<void> = await this.service.putTemplate( template );
        if( !wrote.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "could not restore the version" } };
        void this.service.templateUpdated( template, auth.userId );

        return { status: NetworkUtils.Status.OK, data: { template } };
    }
}

export default PostEmailTemplateRevertImpl;

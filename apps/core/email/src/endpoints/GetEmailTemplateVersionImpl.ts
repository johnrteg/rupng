//
import { GetEmailTemplateVersion, EmailTemplate } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";
import EmailService from "../services/EmailService";

//
// Read an earlier VERSION of a template (email-2.7) — resolves the template's partition, then returns that
// version's immutable S3 body snapshot (doc + subject + compiled HTML) for the history dialog's preview/restore.
//
export class GetEmailTemplateVersionImpl extends GetEmailTemplateVersion
{
    private service : EmailService;
    constructor( service : EmailService ) { super(); this.service = service; }

    ///////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId )    return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };
        if( !auth.accountId ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "no acting account (X-Account)" } };

        const id : string = this.query?.id ?? "";
        const version : number = Number( this.query?.version ?? "" );
        if( Number.isNaN( version ) ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "invalid version" } };

        // resolve the template's partition (account partition, else the SYSTEM partition)
        const own : Type.Result<EmailTemplate.Entity | undefined> = await this.service.getTemplate( auth.accountId, id );
        let template : EmailTemplate.Entity | undefined = own.ok ? own.data : undefined;
        if( template === undefined )
        {
            const system : Type.Result<EmailTemplate.Entity | undefined> = await this.service.getTemplate( EmailService.SYSTEM_ACCOUNT, id );
            template = system.ok ? system.data : undefined;
        }
        if( template === undefined ) return { status: NetworkUtils.Status.NOT_FOUND, data: { message: "template not found" } };

        // read the immutable body snapshot for this version
        const partition : string = template.accountId ?? EmailService.SYSTEM_ACCOUNT;
        const body : Type.Result<EmailTemplate.VersionBody | undefined> = await this.service.getTemplateVersionBody( partition, id, version );
        if( !body.ok )              return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "could not read the version" } };
        if( body.data === undefined ) return { status: NetworkUtils.Status.NOT_FOUND, data: { message: "version not found" } };

        return { status: NetworkUtils.Status.OK, data: { body: body.data } };
    }
}

export default GetEmailTemplateVersionImpl;

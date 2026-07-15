//
import { PostEmailTemplatePreview, EmailTemplate } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";
import EmailService from "../services/EmailService";
import { MjmlRenderer } from "../render/MjmlRenderer";

//
// Preview a template (email-2.2) — compile the block doc → HTML and substitute the sample merge data into the
// subject + body (no send). The editor's live preview.
//
export class PostEmailTemplatePreviewImpl extends PostEmailTemplatePreview
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

        // compile (fall back to a fresh compile if the stored html is missing) + merge sample data
        const mergeData : Record<string, unknown> = this.body?.mergeData ?? {};
        const html : string = template.html ?? ( await this.service.compile( template.doc ) ).html;
        return {
            status: NetworkUtils.Status.OK,
            data: { subject: MjmlRenderer.merge( template.subject, mergeData ), html: MjmlRenderer.merge( html, mergeData ) },
        };
    }
}

export default PostEmailTemplatePreviewImpl;

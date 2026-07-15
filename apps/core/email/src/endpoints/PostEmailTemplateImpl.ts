//
import { randomUUID } from "node:crypto";

import { PostEmailTemplate, EmailTemplate } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";
import EmailService from "../services/EmailService";

//
// Create a DRAFT template (email-2.1). Server mints id / version(1) / status(DRAFT) / audit, compiles the block
// doc → MJML + HTML, persists (DDB + S3 snapshot), and emits email.template created. SYSTEM-scope templates
// land in the reserved system partition (ROOT-intended); ACCOUNT-scope under the acting account.
//
export class PostEmailTemplateImpl extends PostEmailTemplate
{
    private service : EmailService;
    constructor( service : EmailService ) { super(); this.service = service; }

    ///////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId ) return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };

        const body : PostEmailTemplate.Body | null = this.body;
        if( !body || !body.name || !body.scope || !body.doc ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "name, scope and doc are required" } };

        // ACCOUNT templates need an acting account; SYSTEM templates live in the reserved system partition
        const accountId : string | undefined = body.scope === EmailTemplate.Scope.SYSTEM ? undefined : auth.accountId;
        if( body.scope !== EmailTemplate.Scope.SYSTEM && !accountId ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "no acting account (X-Account)" } };

        // compile the block doc → MJML + HTML
        const compiled : { mjml : string; html : string } = await this.service.compile( body.doc );
        const now : string = new Date().toISOString();
        const entity : EmailTemplate.Entity =
        {
            id:               randomUUID(),
            accountId,
            scope:            body.scope,
            campaignId:       body.campaignId,
            notificationType: body.notificationType,
            name:             body.name.trim(),
            status:           EmailTemplate.Status.DRAFT,
            version:          1,
            subject:          body.subject ?? "",
            doc:              body.doc,
            mjml:             compiled.mjml,
            html:             compiled.html,
            audit:            { createdBy: auth.userId, createdAt: now, modifiedBy: auth.userId, modifiedAt: now },
        };

        const wrote : Type.Result<void> = await this.service.putTemplate( entity );
        if( !wrote.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "could not create the template" } };
        void this.service.templateCreated( entity, auth.userId );

        return { status: NetworkUtils.Status.OK, data: entity };
    }
}

export default PostEmailTemplateImpl;

//
import { PostEmailPreview } from "@repo/api";
import { NetworkUtils } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";
import EmailService from "../services/EmailService";
import { MjmlRenderer } from "../render/MjmlRenderer";

//
// Preview an UNSAVED doc (email-2.6) — compile the block doc → HTML and substitute the sample merge data. The
// editor's document-mode live preview (no stored template).
//
export class PostEmailPreviewImpl extends PostEmailPreview
{
    private service : EmailService;
    constructor( service : EmailService ) { super(); this.service = service; }

    ///////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId ) return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };

        const body : PostEmailPreview.Body | null = this.body;
        if( !body || !body.doc ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "doc is required" } };

        // compile the block doc + merge the sample data into the subject + html
        const compiled : MjmlRenderer.Compiled = await this.service.compile( body.doc );
        const mergeData : Record<string, unknown> = body.mergeData ?? {};
        return {
            status: NetworkUtils.Status.OK,
            data: { subject: MjmlRenderer.merge( body.subject ?? "", mergeData ), html: MjmlRenderer.merge( compiled.html, mergeData ) },
        };
    }
}

export default PostEmailPreviewImpl;

//
import { RestfulEndpoint, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { Contact } from "./model/Contact";

//
// S2S: land tag adds/removes + custom-field values onto a contact — no user session/RBAC (INTERNAL
// audience). First consumer: survey's SurveyResponseJob, landing an NPS/CSAT/CES score + follow-up tags on
// scoring (survey-4.2) without a cross-service DB read. Mirrors PatchContactImpl's merge + segment-refresh +
// best-effort emit, just without the `auth.userId` requirement — the caller passes `accountId` explicitly.
//
export class PostInternalContactUpdate extends RestfulEndpoint< {}, PostInternalContactUpdate.Body, PostInternalContactUpdate.Response >
{
    public readonly uri      : string = PostInternalContactUpdate.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : undefined = undefined;   // S2S (INTERNAL audience) — no RBAC role
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.INTERNAL;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "updateInternalContact",
        summary:     "Land tags/custom-field values on a contact (S2S)",
        description: "Merges tag adds/removes and custom-field values onto a contact, e.g. a survey score.",
        tags:        [ "Contact" ],
    };

    constructor( body? : PostInternalContactUpdate.Body ) { super( {}, body ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null
    {
        return {
            type: "object", additionalProperties: false, required: [ "accountId", "contactId" ],
            properties:
            {
                accountId:        { type: "string" },
                contactId:        { type: "string" },
                addTags:          { type: "array", items: { type: "object" } },
                removeTagValues:  { type: "array", items: { type: "string" } },
                setCustomFields:  { type: "object" },
            },
        };
    }
}

export namespace PostInternalContactUpdate
{
    export const URI : string = apiPath( "contact", 1, "/internal/contacts/:contactId" );

    export interface Body
    {
        accountId:        string;
        contactId:        string;
        addTags?:         Array<Contact.Tag>;
        removeTagValues?: Array<string>;
        setCustomFields?: Contact.CustomFieldValues;
    }
    export interface Response extends Contact.Entity {}

    export enum Error
    {
        BAD_REQUEST           = NetworkUtils.Status.BAD_REQUEST,
        NOT_FOUND             = NetworkUtils.Status.NOT_FOUND,
        INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR,
    }
}

export default PostInternalContactUpdate;
// eof

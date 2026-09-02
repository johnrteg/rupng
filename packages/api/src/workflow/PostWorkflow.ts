//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { Workflow } from "./model/Workflow";

//
// Create a workflow definition (draft). Server assigns id / accountId / status (DRAFT) / version (0) /
// ownerId / timestamps, and seeds the starter graph (start -> end) when the caller supplies no nodes.
//
export class PostWorkflow extends RestfulEndpoint< {}, PostWorkflow.Body, PostWorkflow.Response >
{
    public readonly uri      : string = PostWorkflow.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.PUBLIC;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "createWorkflow",
        summary:     "Create a workflow definition",
        description: "Creates a workflow definition in draft state under the acting account.",
        tags:        [ "Workflow" ],
    };

    constructor( body? : PostWorkflow.Body ) { super( {}, body ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null
    {
        return {
            type: "object", additionalProperties: true, required: [ "name" ],
            properties: {
                name:     { type: "string", minLength: 1 },
                triggers: { type: "array" },
                nodes:    { type: "array" },
                edges:    { type: "array" },
            },
        };
    }
    public getResponseSchema(): RestfulEndpoint.Schema | null
    {
        return { type: "object", description: "The created workflow definition (draft).", properties: {
            id:     { type: "string", description: "New definition id." },
            name:   { type: "string", description: "Display name." },
            status: { type: "string", description: "Lifecycle state (draft)." },
        } };
    }
}

export namespace PostWorkflow
{
    export const URI : string = apiPath( "workflow", 1, "/definitions" );

    export interface Body extends RestfulEndpoint.AuthRequest, Workflow.CreateWorkflow {}
    export interface Response extends Workflow.Entity {}

    export enum Error
    {
        BAD_REQUEST           = NetworkUtils.Status.BAD_REQUEST,
        UNAUTHORIZED          = NetworkUtils.Status.UNAUTHORIZED,
        INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR,
    }
}

export default PostWorkflow;

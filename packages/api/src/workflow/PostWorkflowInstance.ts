//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { WorkflowInstance } from "./model/WorkflowInstance";

//
// Manually/API-start an instance of a PUBLISHED workflow definition for a subject. Enqueues the first
// advance immediately (see apps/core/workflow/src/jobs/WorkflowStepJob.ts).
//
export class PostWorkflowInstance extends RestfulEndpoint< {}, PostWorkflowInstance.Body, PostWorkflowInstance.Response >
{
    public readonly uri      : string = PostWorkflowInstance.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "startWorkflowInstance",
        summary:     "Manually start a workflow instance",
        description: "Starts a new instance of a published workflow definition for a subject.",
        tags:        [ "Workflow" ],
        errors:      { 404: "No such workflow in this account", 409: "Workflow is not published" },
    };

    constructor( body? : PostWorkflowInstance.Body ) { super( {}, body ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null
    {
        return {
            type: "object", additionalProperties: false, required: [ "definitionId", "subject" ],
            properties: {
                definitionId: { type: "string" },
                subject:      { type: "string" },
                context:      { type: "object" },
            },
        };
    }
}

export namespace PostWorkflowInstance
{
    export const URI : string = apiPath( "workflow", 1, "/instances" );

    export interface Body extends RestfulEndpoint.AuthRequest
    {
        definitionId: string;
        subject:      string;
        context?:     Record<string, unknown>;
    }
    export interface Response extends WorkflowInstance.Entity {}

    export enum Error
    {
        BAD_REQUEST           = NetworkUtils.Status.BAD_REQUEST,
        UNAUTHORIZED          = NetworkUtils.Status.UNAUTHORIZED,
        NOT_FOUND             = NetworkUtils.Status.NOT_FOUND,
        CONFLICT              = NetworkUtils.Status.CONFLICT,
        INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR,
    }
}

export default PostWorkflowInstance;

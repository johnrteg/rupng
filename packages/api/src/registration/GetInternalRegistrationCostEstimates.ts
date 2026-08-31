//
import { RestfulEndpoint, apiPath } from "@repo/endpoint";
import { NetworkUtils, type Type } from "@repo/common";
import { Registration } from "./model/Registration";
import { Paging } from "../model/Paging";

//
// S2S: list Registration.CostEstimate rows in a date range, optionally filtered by accountId/kind (paged —
// `{ records, page }` envelope). INTERNAL audience. Backs the `registration_cost_estimates` report (mirrors
// GetInternalContacts's pattern) — the estimate ledger is a stub (no billing engine exists yet), so this is
// what a report renders as "what would be billed", never an actual charge.
//
export class GetInternalRegistrationCostEstimates extends RestfulEndpoint< GetInternalRegistrationCostEstimates.Query, undefined, GetInternalRegistrationCostEstimates.Response >
{
    public readonly uri      : string = GetInternalRegistrationCostEstimates.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.GET;
    public readonly access   : undefined = undefined;   // S2S (INTERNAL audience) — no RBAC role
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.INTERNAL;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "listInternalRegistrationCostEstimates",
        summary:     "List cost estimates (S2S)",
        description: "Lists cost-estimate ledger rows in a date range, optionally filtered by accountId/kind (paged — ?count/?start; returns { records, page }).",
        tags:        [ "Registration" ],
    };

    constructor( query? : GetInternalRegistrationCostEstimates.Query ) { super( query ?? {} ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null
    {
        return {
            type: "object", additionalProperties: false,
            properties: {
                accountId:      { type: "string" },
                kind:           { type: "string", enum: Object.values( Registration.CostEstimateKind ) },
                estimatedStart: { type: "string" },
                estimatedEnd:   { type: "string" },
                count:          { type: "number" },
                start:          { type: "string" },
            },
        };
    }
    public getBodySchema(): RestfulEndpoint.Schema | null { return null; }
}

export namespace GetInternalRegistrationCostEstimates
{
    export const URI : string = apiPath( "registration", 1, "/internal/cost-estimates" );

    export interface Query extends Paging.Request
    {
        accountId?      : string;
        kind?           : Registration.CostEstimateKind;
        estimatedStart? : Type.ISODateTime;   // CostEstimate.estimatedAt >= this
        estimatedEnd?   : Type.ISODateTime;   // CostEstimate.estimatedAt <= this
    }

    export interface Response extends Paging.Result<Registration.CostEstimate> {}

    export enum Error
    {
        BAD_REQUEST           = NetworkUtils.Status.BAD_REQUEST,
        INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR,
    }
}

export default GetInternalRegistrationCostEstimates;
// eof

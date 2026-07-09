//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";

//
// Cancel + delete a BLAST (email-1.9) — stops a scheduled or in-progress blast (status → CANCELLED); the batch
// worker halts the fan-out at the next recipient check. A CANCELLED blast will not resume. Already-sent
// messages are not recalled (they're on the wire); this stops the remainder.
//
export class DeleteEmailBlast extends RestfulEndpoint< DeleteEmailBlast.Query, undefined, DeleteEmailBlast.Response >
{
    public readonly uri      : string = DeleteEmailBlast.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.DELETE;
    public readonly access   : Access.Role = Access.AccountRole.SENDER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "cancelEmailBlast",
        summary:     "Cancel an email blast",
        description: "Cancels a scheduled/in-progress blast (stops the remaining fan-out; sent messages are not recalled).",
        tags:        [ "Email" ],
    };

    constructor( id? : string ) { super( { id: id ?? "" } ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return [ { field: "id", location: RestfulEndpoint.AttrLocation.URI, required: true } ]; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null { return null; }
}

export namespace DeleteEmailBlast
{
    export const URI : string = apiPath( "email", 1, "/blasts/:id" );
    export interface Query { id : string; }
    export interface Response { cancelled : boolean; }
    export enum Error
    {
        UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED,
        NOT_FOUND    = NetworkUtils.Status.NOT_FOUND,
    }
}

export default DeleteEmailBlast;
// eof

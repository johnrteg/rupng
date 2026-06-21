
import { NetworkUtils } from '@repo/common';
import { RestfulEndpoint } from '../RestfulEndpoint';
import Access from '../Access';

export class getSampleEndpoint extends RestfulEndpoint<getSampleEndpoint.Query,undefined>
{
    // required implementations from RestfulEndpoint
    public readonly uri     : string = '/sample/:id';
    public readonly method  : NetworkUtils.Method = NetworkUtils.Method.GET;
    public readonly access  : Access.Role | undefined = Access.AccountRole.USER;
    public readonly timeout : number | undefined = undefined;

    ///////////////////////////////////////////////////////////////////////////
    constructor( query : getSampleEndpoint.Query )
    {
        super( query, undefined );
    }

    ///////////////////////////////////////////////////////////////////////////
    public getMappings(): Array<RestfulEndpoint.FieldMap>
    {
        return [ { field : "id", location: RestfulEndpoint.AttrLocation.URI, required: true } ];
    }

    ///////////////////////////////////////////////////////////////////////////
    public getQuerySchema(): RestfulEndpoint.SchemaFor<getSampleEndpoint.Query> | null
    {
        return {
            type: 'object',
            properties: {
                id: { type: 'string' }
            },
            required: ['id'],
            additionalProperties: false
        };
    }

    ///////////////////////////////////////////////////////////////////////////
    public getBodySchema(): RestfulEndpoint.Schema | null
    {
        // this endpoint has no body
        return null;
    }
}


export namespace getSampleEndpoint
{
    export interface Query
    {
        id : string;
    }

    // no body

    export interface Response
    {
        ok : boolean;
    }
}

export default getSampleEndpoint;
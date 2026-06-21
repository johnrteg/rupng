
import { NetworkUtils } from '@repo/common';
import { RestfulEndpoint } from '../RestfulEndpoint';
import Access from '../Access';

export class postSampleEndpoint extends RestfulEndpoint<postSampleEndpoint.Query,postSampleEndpoint.Body>
{
    // required implementations from RestfulEndpoint
    public readonly uri     : string = '/sample/:id';
    public readonly method  : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access  : Access.Role | undefined = Access.AccountRole.USER;
    public readonly timeout : number | undefined = undefined;

    ///////////////////////////////////////////////////////////////////////////
    constructor( query : postSampleEndpoint.Query, body : postSampleEndpoint.Body )
    {
        super( query, body );
    }

    ///////////////////////////////////////////////////////////////////////////
    public getMappings(): Array<RestfulEndpoint.FieldMap>
    {
        return [ { field : "id", location: RestfulEndpoint.AttrLocation.URI, required: true } ];
    }

    ///////////////////////////////////////////////////////////////////////////
    public getQuerySchema(): RestfulEndpoint.SchemaFor<postSampleEndpoint.Query> | null
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
    public getBodySchema(): RestfulEndpoint.SchemaFor<postSampleEndpoint.Body> | null
    {
        return {
            type: 'object',
            properties: {
                id: { type: 'string' },
                color: { type: 'string' },
                link: {
                    type: 'object',
                    properties: {
                        id: { type: 'string' },
                        url: { type: 'string' }
                    },
                    required: ['id', 'url'],
                    additionalProperties: false
                }
            },
            required: ['id', 'color', 'link'],
            additionalProperties: false
        };
    }
}


export namespace postSampleEndpoint
{
    export interface Query
    {
        id : string;
    }

    // no body
    export interface Body
    {
        id : string;
        color : string;
        link : { id : string, url : string};
    }

    export interface Response
    {
        ok : boolean;
    }
}

export default postSampleEndpoint;
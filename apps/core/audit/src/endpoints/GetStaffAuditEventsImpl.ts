//
import { GetStaffAuditEvents, Audit as AuditWire, Paging } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";
import { Events } from "@repo/system";
import { ScanCommand } from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";

import AuditQueryService from "../services/AuditQueryService";
import { Audit } from "../AuditModel";
import { toEventView, matchesFilter } from "./AuditView";

//
// Cross-tenant audit trail view for staff/auditors (audit-5.1). Unlike `GetAuditEventsImpl`, `accountId`
// is NOT pinned — an omitted `accountId` spans every tenant (a full-table Scan; see the SCALE NOTE on
// `AuditRetentionJob` — same tradeoff, acceptable for an infrequent staff/auditor query, revisit with a
// GSI if this becomes a hot path). A supplied `accountId` narrows to one tenant via the cheaper Query.
// Reading is itself audited (audit-5.2) — with the REAL staff actor recorded, not "the system".
//
export class GetStaffAuditEventsImpl extends GetStaffAuditEvents
{
    private service : AuditQueryService;
    constructor( service : AuditQueryService ) { super(); this.service = service; }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId ) return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };

        const query : GetStaffAuditEvents.Query = this.query ?? {};
        const rows : Array<Audit.StoredEvent> = query.accountId
            ? await this.byAccount( query.accountId )
            : await this.acrossAccounts();

        const filtered : Array<Audit.StoredEvent> = rows
            .filter( ( row : Audit.StoredEvent ) : boolean => matchesFilter( row, query ) )
            .sort( ( a : Audit.StoredEvent, b : Audit.StoredEvent ) : number => b.seq - a.seq );

        const paged : Paging.Result<AuditWire.EventView> = Paging.paginate( filtered.map( toEventView ), query );

        await this.service.audit( {
            action:      Events.actionOf( Events.Object.AUDIT_EVENT, Events.Verb.ACCESSED ),
            accountId:   query.accountId ?? "cross-tenant",
            target:      { type: "audit_trail", id: query.accountId ?? "*" },
            actorUserId: auth.userId,
            context:     { count: paged.records.length, crossTenant: !query.accountId },
        } );

        return { status: NetworkUtils.Status.OK, data: paged };
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    private async byAccount( accountId : Type.ID ) : Promise<Array<Audit.StoredEvent>>
    {
        const found : Type.Result<Array<Audit.StoredEvent>> = await this.service.dynamo.query<Audit.StoredEvent>( "events", {
            KeyConditionExpression:    "accountId = :a AND begins_with(sk, :evt)",
            ExpressionAttributeValues: { ":a": accountId, ":evt": "EVT#" },
        } );
        return found.ok ? found.data : [];
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    private async acrossAccounts() : Promise<Array<Audit.StoredEvent>>
    {
        const rows : Array<Audit.StoredEvent> = [];
        let exclusiveStartKey : Record<string, any> | undefined;
        do
        {
            const page = await this.service.dynamo.client.send( new ScanCommand( {
                TableName: this.service.dynamo.table( "events" ),
                FilterExpression: "begins_with(sk, :evt)",
                ExpressionAttributeValues: { ":evt": { S: "EVT#" } },
                ExclusiveStartKey: exclusiveStartKey,
            } ) );
            exclusiveStartKey = page.LastEvaluatedKey;
            for( const raw of page.Items ?? [] ) rows.push( unmarshall( raw ) as Audit.StoredEvent );
        }
        while( exclusiveStartKey );
        return rows;
    }
}

export default GetStaffAuditEventsImpl;

import { ListTablesCommand, DescribeTableCommand } from "@aws-sdk/client-dynamodb";
import { ScanCommand, PutCommand, DeleteCommand } from "@aws-sdk/lib-dynamodb";

import { dynamoClient, dynamoDocClient, awsErr, isReadOnly } from "./aws";
import type { DynamoKeySchema, DynamoSaveResult, DynamoScanResult, DynamoTable } from "../shared/types";

//
// DynamoDB browser/editor for the Data tab — available to every service (the table dropdown is empty
// when a service owns none). Tables are physically named `<env>-<service>-table-<key>` (cloud-manifest
// `physicalName`), so a service's tables are the ones whose name contains `-<service>-table-`.
//
// Targets LocalStack or real AWS via the shared aws.ts client. Real AWS is READ-ONLY here (writes are
// refused) — same guard as the Config tab.
//

const SCAN_PAGE : number = 50;   // items per scan page

///////////////////////////////////////////////////////////////////////////////////////////////////
/** The tables owned by a service (by physical-name convention), newest key order. */
export async function dynamoTables( service : string ) : Promise<{ tables : Array<DynamoTable>; error? : string }>
{
    try
    {
        // collect every table name across all pages
        const names : Array<string> = [];
        let startTableName : string | undefined;
        do
        {
            const page = await dynamoClient().send( new ListTablesCommand( { ExclusiveStartTableName: startTableName, Limit: 100 } ) );
            names.push( ...( page.TableNames ?? [] ) );
            startTableName = page.LastEvaluatedTableName;
        }
        while ( startTableName );

        // keep only this service's tables and derive the key suffix from the physical name
        const marker : string = `-${service}-table-`;
        const tables : Array<DynamoTable> = names
            .filter( ( name : string ) => name.includes( marker ) )
            .map( ( name : string ) => ( { name, key: name.slice( name.indexOf( marker ) + marker.length ) } ) );
        tables.sort( ( first, second ) => first.key.localeCompare( second.key ) );
        return { tables };
    }
    catch ( err )
    {
        return { tables: [], error: awsErr( err ) };
    }
}

///////////////////////////////////////////////////////////////////////////////////////////////////
/** A table's key schema (PK + optional SK names) — needed to build delete keys + label the editor. */
export async function dynamoTableInfo( table : string ) : Promise<{ keySchema? : DynamoKeySchema; error? : string }>
{
    try
    {
        const described = await dynamoClient().send( new DescribeTableCommand( { TableName: table } ) );
        const keySchema = described.Table?.KeySchema ?? [];
        // HASH = partition key (required), RANGE = sort key (optional)
        const partitionKey : string = keySchema.find( ( element ) => element.KeyType === "HASH" )?.AttributeName ?? "";
        const sortKey : string | undefined = keySchema.find( ( element ) => element.KeyType === "RANGE" )?.AttributeName;
        return { keySchema: { partitionKey, sortKey } };
    }
    catch ( err )
    {
        return { error: awsErr( err ) };
    }
}

///////////////////////////////////////////////////////////////////////////////////////////////////
/** Scan a page of items (plain JS via the document client). Pass `startKey` (the prior `lastKey`) to page. */
export async function dynamoScan( table : string, startKey? : Record<string, unknown> ) : Promise<DynamoScanResult>
{
    try
    {
        const scanned = await dynamoDocClient().send( new ScanCommand( { TableName: table, Limit: SCAN_PAGE, ExclusiveStartKey: startKey } ) );
        // lastKey is the cursor for the next page (undefined once the scan is exhausted)
        return { items: ( scanned.Items ?? [] ) as Array<Record<string, unknown>>, lastKey: scanned.LastEvaluatedKey };
    }
    catch ( err )
    {
        return { items: [], error: awsErr( err ) };
    }
}

///////////////////////////////////////////////////////////////////////////////////////////////////
/** Put (create/replace) an item. */
export async function dynamoPut( table : string, item : Record<string, unknown> ) : Promise<DynamoSaveResult>
{
    if ( isReadOnly() ) return readOnly();
    try
    {
        await dynamoDocClient().send( new PutCommand( { TableName: table, Item: item } ) );
        return { ok: true };
    }
    catch ( err )
    {
        return { ok: false, error: awsErr( err ) };
    }
}

///////////////////////////////////////////////////////////////////////////////////////////////////
/** Delete an item by its key (`{ <pk>: …, <sk>?: … }`). */
export async function dynamoDelete( table : string, key : Record<string, unknown> ) : Promise<DynamoSaveResult>
{
    if ( isReadOnly() ) return readOnly();
    try
    {
        await dynamoDocClient().send( new DeleteCommand( { TableName: table, Key: key } ) );
        return { ok: true };
    }
    catch ( err )
    {
        return { ok: false, error: awsErr( err ) };
    }
}

/** The refusal result returned for any mutation while pointed at a real AWS account. */
function readOnly() : DynamoSaveResult
{
    return { ok: false, error: "Read-only on a real AWS account — switch the target to LocalStack to edit." };
}

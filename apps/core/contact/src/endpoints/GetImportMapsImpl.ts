//
import { GetImportMaps, ImportMap, Paging } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";
import ContactService from "../services/ContactService";

//
// List the maps visible to the account: its OWN maps (its partition) PLUS the platform SYSTEM catalog (the
// reserved `system` partition), merged into one page. Default hides archived + deleted; `status` / `target` /
// `scope` narrow the list. Sorted by name for a stable manager listing.
//
export class GetImportMapsImpl extends GetImportMaps
{
    private service : ContactService;
    constructor( service : ContactService ) { super(); this.service = service; }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId )   return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };
        const accountId : string | undefined = auth.accountId;
        if( !accountId )     return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "no acting account (X-Account)" } };

        const query : GetImportMaps.Query = this.query ?? {};

        // read the account's own maps and the platform system catalog (skip a partition when scope excludes it)
        const wantAccount : boolean = query.scope !== ImportMap.Scope.SYSTEM;
        const wantSystem  : boolean = query.scope !== ImportMap.Scope.ACCOUNT;
        const own : Type.Result<Array<ImportMap.Entity>> = wantAccount
            ? await this.service.dynamo.query<ImportMap.Entity>( "import_maps", { KeyConditionExpression: "accountId = :a", ExpressionAttributeValues: { ":a": accountId } } )
            : { ok: true, data: [] };
        if( !own.ok )    return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "maps read failed" } };
        const sys : Type.Result<Array<ImportMap.Entity>> = wantSystem
            ? await this.service.dynamo.query<ImportMap.Entity>( "import_maps", { KeyConditionExpression: "accountId = :a", ExpressionAttributeValues: { ":a": ImportMap.SYSTEM_ACCOUNT } } )
            : { ok: true, data: [] };
        if( !sys.ok )    return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "system maps read failed" } };

        // merge, apply status/target filters (default hides archived + deleted), then sort by name
        const merged : Array<ImportMap.Entity> = [ ...own.data, ...sys.data ]
            .filter( ( map : ImportMap.Entity ) : boolean => query.status ? map.status === query.status : ( map.status !== ImportMap.Status.ARCHIVED && map.status !== ImportMap.Status.DELETED ) )
            .filter( ( map : ImportMap.Entity ) : boolean => query.target ? map.target === query.target : true )
            .sort( ( first : ImportMap.Entity, second : ImportMap.Entity ) : number => first.name.localeCompare( second.name ) );

        const paged : Paging.Result<ImportMap.Entity> = Paging.paginate( merged, query );
        return { status: NetworkUtils.Status.OK, data: paged };
    }
}

export default GetImportMapsImpl;

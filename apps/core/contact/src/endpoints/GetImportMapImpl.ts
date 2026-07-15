//
import { GetImportMap, ImportMap } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";
import ContactService from "../services/ContactService";

//
// Fetch one map by id — the account's own map first, then the platform SYSTEM catalog. 404 when it's neither
// (an account can't see another account's maps).
//
export class GetImportMapImpl extends GetImportMap
{
    private service : ContactService;
    constructor( service : ContactService ) { super(); this.service = service; }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId )   return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };
        const accountId : string | undefined = auth.accountId;
        if( !accountId )     return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "no acting account (X-Account)" } };
        const id : string = this.query?.id ?? "";
        if( !id )            return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "id required" } };

        // try the account's own partition, then fall back to the system catalog
        const own : Type.Result<ImportMap.Entity | undefined> = await this.service.dynamo.get<ImportMap.Entity>( "import_maps", { accountId, mapId: id } );
        if( !own.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "map read failed" } };
        if( own.data ) return { status: NetworkUtils.Status.OK, data: own.data };

        const sys : Type.Result<ImportMap.Entity | undefined> = await this.service.dynamo.get<ImportMap.Entity>( "import_maps", { accountId: ImportMap.SYSTEM_ACCOUNT, mapId: id } );
        if( !sys.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "map read failed" } };
        if( sys.data ) return { status: NetworkUtils.Status.OK, data: sys.data };

        return { status: NetworkUtils.Status.NOT_FOUND, data: { message: "map not found" } };
    }
}

export default GetImportMapImpl;

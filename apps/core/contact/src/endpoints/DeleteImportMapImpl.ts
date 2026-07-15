//
import { DeleteImportMap, ImportMap } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";
import ContactService from "../services/ContactService";

//
// Delete an account import map — SOFT delete (status → DELETED): recoverable by an app admin, purged by a cron
// after a TTL, so past import jobs / audit that reference it keep resolving. Only the account's OWN maps: a
// SYSTEM map returns 403; an unknown id returns 404.
//
export class DeleteImportMapImpl extends DeleteImportMap
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

        const got : Type.Result<ImportMap.Entity | undefined> = await this.service.dynamo.get<ImportMap.Entity>( "import_maps", { accountId, mapId: id } );
        if( !got.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "map read failed" } };
        if( !got.data )
        {
            // not the account's — a system map can't be deleted (403); otherwise it doesn't exist (404)
            const sys : Type.Result<ImportMap.Entity | undefined> = await this.service.dynamo.get<ImportMap.Entity>( "import_maps", { accountId: ImportMap.SYSTEM_ACCOUNT, mapId: id } );
            if( sys.ok && sys.data ) return { status: NetworkUtils.Status.FORBIDDEN, data: { message: "System maps cannot be deleted." } };
            return { status: NetworkUtils.Status.NOT_FOUND, data: { message: "map not found" } };
        }

        // soft-delete: flip status to DELETED (recoverable; a cron purges DELETED after a TTL)
        const now : Type.ISODateTime = new Date().toISOString();
        const deleted : ImportMap.Entity = { ...got.data, status: ImportMap.Status.DELETED, audit: { ...got.data.audit, modifiedAt: now, modifiedBy: auth.userId } };
        const wrote : Type.Result<void> = await this.service.dynamo.put( "import_maps", { ...deleted, mapId: id } );
        if( !wrote.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "map delete failed" } };

        return { status: NetworkUtils.Status.OK, data: { id, deleted: true } };
    }
}

export default DeleteImportMapImpl;

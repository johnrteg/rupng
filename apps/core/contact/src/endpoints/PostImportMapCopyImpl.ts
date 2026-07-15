//
import { randomUUID } from "node:crypto";

import { PostImportMapCopy, ImportMap } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";
import ContactService from "../services/ContactService";

//
// Copy a visible map (a SYSTEM catalog map or one of the account's own) into the account as a new, editable
// ACCOUNT map. The clone gets a fresh id, `scope = account`, `status = active`, `version = 1`, and records
// `sourceMapId` (the origin); the original is untouched. 404 when the source isn't visible to the account.
//
export class PostImportMapCopyImpl extends PostImportMapCopy
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

        // resolve the source: the account's own map first, then the system catalog
        const own : Type.Result<ImportMap.Entity | undefined> = await this.service.dynamo.get<ImportMap.Entity>( "import_maps", { accountId, mapId: id } );
        if( !own.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "map read failed" } };
        let source : ImportMap.Entity | undefined = own.data;
        if( !source )
        {
            const sys : Type.Result<ImportMap.Entity | undefined> = await this.service.dynamo.get<ImportMap.Entity>( "import_maps", { accountId: ImportMap.SYSTEM_ACCOUNT, mapId: id } );
            if( !sys.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "map read failed" } };
            source = sys.data;
        }
        if( !source ) return { status: NetworkUtils.Status.NOT_FOUND, data: { message: "map not found" } };

        // clone into the account's space — new identity, ACCOUNT scope, sourceMapId records the origin
        const now : Type.ISODateTime = new Date().toISOString();
        const copyId : Type.UUID = randomUUID();
        const copy : ImportMap.Entity =
        {
            ...source,
            id:          copyId,
            accountId,
            scope:       ImportMap.Scope.ACCOUNT,
            name:        this.body?.name ?? `${ source.name } (copy)`,
            sourceMapId: source.id,
            version:     1,
            status:      ImportMap.Status.ACTIVE,
            audit:       { createdAt: now, createdBy: auth.userId, modifiedAt: now, modifiedBy: auth.userId },
        };

        const wrote : Type.Result<void> = await this.service.dynamo.put( "import_maps", { ...copy, mapId: copyId } );
        if( !wrote.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "map copy write failed" } };

        return { status: NetworkUtils.Status.OK, data: copy };
    }
}

export default PostImportMapCopyImpl;

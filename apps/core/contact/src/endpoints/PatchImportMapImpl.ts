//
import { PatchImportMap, ImportMap } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";
import ContactService from "../services/ContactService";

//
// Edit an account import map — merge the provided fields, bump `version`, stamp audit. Only the account's OWN
// maps are editable: a SYSTEM map (found only in the system partition) returns 403 (copy it first); an unknown
// id returns 404. Identity (id/accountId/scope) is immutable here.
//
export class PatchImportMapImpl extends PatchImportMap
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
            // not in the account's partition — is it a (read-only) system map? then 403; otherwise 404
            const sys : Type.Result<ImportMap.Entity | undefined> = await this.service.dynamo.get<ImportMap.Entity>( "import_maps", { accountId: ImportMap.SYSTEM_ACCOUNT, mapId: id } );
            if( sys.ok && sys.data ) return { status: NetworkUtils.Status.FORBIDDEN, data: { message: "System maps are read-only — copy the map to edit it." } };
            return { status: NetworkUtils.Status.NOT_FOUND, data: { message: "map not found" } };
        }

        const body : PatchImportMap.Body = this.body ?? {};
        const now : Type.ISODateTime = new Date().toISOString();
        // merge only the provided fields; bump version; keep identity + scope; stamp audit
        const updated : ImportMap.Entity =
        {
            ...got.data,
            name:          body.name          ?? got.data.name,
            description:   body.description   ?? got.data.description,
            target:        body.target        ?? got.data.target,
            sourceFormat:  body.sourceFormat  ?? got.data.sourceFormat,
            parse:         body.parse         ?? got.data.parse,
            mappings:      body.mappings      ?? got.data.mappings,
            dedupe:        body.dedupe        ?? got.data.dedupe,
            defaultTags:   body.defaultTags   ?? got.data.defaultTags,
            sampleHeaders: body.sampleHeaders ?? got.data.sampleHeaders,
            status:        body.status        ?? got.data.status,
            version:       ( got.data.version ?? 1 ) + 1,
            audit:         { ...got.data.audit, modifiedAt: now, modifiedBy: auth.userId },
        };

        const wrote : Type.Result<void> = await this.service.dynamo.put( "import_maps", { ...updated, mapId: id } );
        if( !wrote.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "map write failed" } };

        return { status: NetworkUtils.Status.OK, data: updated };
    }
}

export default PatchImportMapImpl;

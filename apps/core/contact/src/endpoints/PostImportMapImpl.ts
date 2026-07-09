//
import { randomUUID } from "node:crypto";

import { PostImportMap, ImportMap } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";
import ContactService from "../services/ContactService";

//
// Create an account import map. Server assigns id / accountId / scope (ACCOUNT) / status (ACTIVE) / version (1)
// / audit; the stored row mirrors id into the `mapId` sort-key. System maps are seeded by the platform, never
// created here.
//
export class PostImportMapImpl extends PostImportMap
{
    private service : ContactService;
    constructor( service : ContactService ) { super(); this.service = service; }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId )   return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };
        const accountId : string | undefined = auth.accountId;
        if( !accountId )     return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "no acting account (X-Account)" } };
        if( !this.body?.name || !this.body?.target || !this.body?.sourceFormat )
            return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "name, target and sourceFormat required" } };

        const now : Type.ISODateTime = new Date().toISOString();
        const id : Type.UUID = randomUUID();
        const map : ImportMap.Entity =
        {
            id, accountId,
            scope:         ImportMap.Scope.ACCOUNT,
            name:          this.body.name,
            description:   this.body.description,
            target:        this.body.target,
            sourceFormat:  this.body.sourceFormat,
            parse:         this.body.parse,
            mappings:      this.body.mappings ?? [],
            dedupe:        this.body.dedupe,
            defaultTags:   this.body.defaultTags,
            sampleHeaders: this.body.sampleHeaders,
            version:       1,
            status:        ImportMap.Status.ACTIVE,
            audit:         { createdAt: now, createdBy: auth.userId, modifiedAt: now, modifiedBy: auth.userId },
        };

        const wrote : Type.Result<void> = await this.service.dynamo.put( "import_maps", { ...map, mapId: id } );
        if( !wrote.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "map write failed" } };

        return { status: NetworkUtils.Status.OK, data: map };
    }
}

export default PostImportMapImpl;

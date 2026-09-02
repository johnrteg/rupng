//
import AuditService from "./AuditService";

import GetAuditEventsImpl from "../endpoints/GetAuditEventsImpl";
import GetAuditEventImpl from "../endpoints/GetAuditEventImpl";
import GetStaffAuditEventsImpl from "../endpoints/GetStaffAuditEventsImpl";
import PostAuditExportImpl from "../endpoints/PostAuditExportImpl";
import PostAuditLegalHoldImpl from "../endpoints/PostAuditLegalHoldImpl";
import GetAuditConfigImpl from "../endpoints/GetAuditConfigImpl";
import PutAuditConfigImpl from "../endpoints/PutAuditConfigImpl";

//
// MAIN role — the /audit/* API. READ + ADMIN ONLY (audit-7.2): tenant + staff/auditor query, export,
// legal-hold place/release, config, health. There is deliberately NO event-write endpoint — events
// arrive only via the platform audit SQS queue, consumed by `AuditSinkJob` (see jobs/).
//
export class AuditQueryService extends AuditService
{
    ////////////////////////////////////////////////////////////////////////////////////////////
    constructor()
    {
        super( AuditService.Role.MAIN );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Register the audit endpoint impls (after the inherited /health + /version). */
    protected override async registerEndpoints() : Promise<void>
    {
        await super.registerEndpoints();
        this.register( new GetAuditEventsImpl( this ) );
        this.register( new GetAuditEventImpl( this ) );
        this.register( new GetStaffAuditEventsImpl( this ) );
        this.register( new PostAuditExportImpl( this ) );
        this.register( new PostAuditLegalHoldImpl( this ) );
        this.register( new GetAuditConfigImpl( this ) );
        this.register( new PutAuditConfigImpl( this ) );
    }
}

export default AuditQueryService;
// eof

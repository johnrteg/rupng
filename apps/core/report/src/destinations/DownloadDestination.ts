//
import type { Type } from "@repo/common";

import { Destination } from "./Destination";

//
// DownloadDestination — the DEFAULT destination (report-7.3): the artifact is simply available for download
// in the dashboard (via `GetReportSubmissionDownload`'s presigned GET); there is nothing further to do here.
//
export class DownloadDestination implements Destination
{
    ////////////////////////////////////////////////////////////////////////////////////////////
    public async deliver( _ctx : Destination.DeliverContext ) : Promise<Type.Result<void>>
    {
        return { ok: true, data: undefined };
    }
}

export default DownloadDestination;
// eof

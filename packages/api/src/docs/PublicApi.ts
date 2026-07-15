//
import { RestfulEndpoint } from "@repo/endpoint";

// Every PUBLIC (published developer-API) endpoint contract. Add a contract here when its `audience` is
// PUBLIC — this is the ONE list the OpenAPI document is generated from (mirrors how the CDK gateway list is
// curated). Only PUBLIC ones are emitted; a stray non-PUBLIC entry is filtered out by toOpenApi.
//
// NOTE: GetVersion is intentionally NOT listed — its bare `/version` URI isn't service-prefixed, so through
// the edge/proxy it resolves to whatever answers the root path (the webproxy in dev), not a routable public
// API. It stays edge-reachable for the deploy console; a published entry must be service-prefix-routed.
import GetOpenApi from "../app/GetOpenApi";
import GetAssets from "../media/GetAssets";
import GetAsset from "../media/GetAsset";

// auth
import GetAccounts from '../auth/GetAccounts';
import PostSubAccount from '../account/PostSubAccount';

// contact
import GetContacts from '../contact/GetContacts';
import GetContact from '../contact/GetContact';
import PostContact from '../contact/PostContact';
import GetSegments from '../contact/GetSegments';
import PostSegment from '../contact/PostSegment';

// campaign
import GetCampaigns from '../campaign/GetCampaigns';
import GetCampaign from '../campaign/GetCampaign';
import PostCampaign from '../campaign/PostCampaign';

// email (published send + template reads)
import PostEmailSend from '../email/PostEmailSend';
import PostEmailBatch from '../email/PostEmailBatch';
import GetEmailTemplates from '../email/GetEmailTemplates';
import GetEmailTemplate from '../email/GetEmailTemplate';

//
// PublicApi — the single registry + generator entrypoint for the published developer API. The in-app docs
// (Scalar), the static `openapi.json` (readme.io sync), and any SDK generation all read the SAME OpenAPI 3.1
// document built here from the endpoint contracts — so nothing can drift from the code the server runs.
//
// To publish an endpoint: set its `audience = PUBLIC`, give it `docs` (summary/tags) + a `getResponseSchema()`,
// and add its class to ENDPOINTS below. The self-documentation test fails the build if a PUBLIC endpoint is
// missing docs or a response schema.
//
export namespace PublicApi
{
    /** Default document metadata (title/version/description). The live endpoint overrides `version` with the
     *  running service version so the spec tracks releases. */
    export const INFO : RestfulEndpoint.OpenApi.Info =
    {
        title:       "RumbleUp API",
        version:     "1.0.0",
        description: "The RumbleUp developer API. Authenticate with a developer API key: `Authorization: Bearer rup_<keyId>.<secret>` (create one under Settings → API).",
    };

    /** The curated set of published endpoint instances. Constructed parameterless (same contract the CDK
     *  gateway generator relies on). */
    export function endpoints() : Array<RestfulEndpoint>
    {
        return [
            new GetOpenApi(),

            // auth

            // media
            new GetAssets(),
            new GetAsset(),

            // account
            new GetAccounts(),
            new PostSubAccount(),

            // contact (basic CRM surface)
            new GetContacts(),
            new GetContact(),
            new PostContact(),
            new GetSegments(),
            new PostSegment(),

            // campaign
            new GetCampaigns(),
            new GetCampaign(),
            new PostCampaign(),

            // email (send + batch/blast + template reads)
            new PostEmailSend(),
            new PostEmailBatch(),
            new GetEmailTemplates(),
            new GetEmailTemplate(),
        ];
    }

    /** Build the OpenAPI 3.1 document for the published API. Pass `info` to override title/version/description
     *  (e.g. the live endpoint injects the running version). */
    export function document( info? : Partial<RestfulEndpoint.OpenApi.Info> ) : RestfulEndpoint.OpenApi.Document
    {
        return RestfulEndpoint.toOpenApi( endpoints(), { ...INFO, ...( info ?? {} ) } );
    }
}

export default PublicApi;

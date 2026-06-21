//
// Cognito facade — user-pool admin/auth ops, keyed by cloud-manifest LOGICAL user-pool keys.
//
import { CognitoIdentityProviderClient, AdminGetUserCommand } from "@aws-sdk/client-cognito-identity-provider";
import type { AdminGetUserCommandOutput } from "@aws-sdk/client-cognito-identity-provider";
import type { CloudResolver, ResourceKey } from "@repo/cloud-manifest";
import { ResultUtils } from "@repo/common";
import type { Type } from "@repo/common";
import { ClientUtils } from "./ClientUtils";

/**
 * Cognito facade — over `@aws-sdk/client-cognito-identity-provider`, addressed by cloud-manifest
 * LOGICAL user-pool keys (e.g. `"users"`).
 *
 * Kept intentionally **thin**: the full auth surface (sign-in / refresh, the TOTP MFA enroll
 * flow `AssociateSoftwareToken` → `VerifySoftwareToken` → `SetUserMFAPreference`, group
 * management) lives in the **auth** service and is driven through `.client`. This facade just
 * resolves the pool id and wraps a couple of common admin reads.
 */
export class Cognito
{
    private _client? : CognitoIdentityProviderClient;

    ////////////////////////////////////////////////////////////////////////////////
    /** @param cloud the owning service's resolver — maps logical user-pool keys to pool ids. */
    constructor( private readonly cloud : CloudResolver ) {}

    ////////////////////////////////////////////////////////////////////////////////
    /** The raw `CognitoIdentityProviderClient` — escape hatch (the bulk of auth flows). Lazy + cached. */
    get client() : CognitoIdentityProviderClient { return this._client ??= ClientUtils.createClient( CognitoIdentityProviderClient ); }

    ////////////////////////////////////////////////////////////////////////////////
    /** Resolve a cloud-manifest logical user-pool key (e.g. `"users"`) to its physical pool id. */
    poolId( key : ResourceKey ) : string { return this.cloud.userPoolId( key ); }

    ////////////////////////////////////////////////////////////////////////////////
    /** Fetch a user's attributes, status, and MFA settings (admin, server-side). */
    getUser( poolKey : ResourceKey, username : string ) : Promise<Type.Result<AdminGetUserCommandOutput>>
    {
        return ResultUtils.from( () => this.client.send( new AdminGetUserCommand( { UserPoolId: this.poolId( poolKey ), Username: username } ) ) );
    }
}

//
// Key resolution — provider API keys are never in code/env in plaintext. A KeyProvider turns a
// stored *reference* into the plaintext key at call time. The default assumes keys are in KMS:
// the reference is a base64 KMS ciphertext, decrypted on demand.
//
import { KMSClient, DecryptCommand } from "@aws-sdk/client-kms";
import type { DecryptCommandOutput } from "@aws-sdk/client-kms";
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import type { GetSecretValueCommandOutput } from "@aws-sdk/client-secrets-manager";

/** Resolves a stored key reference to its plaintext value. */
export interface KeyProvider
{
    /** @param ref an opaque key reference (KMS ciphertext, env var name, secret arn, …). */
    resolve( ref : string ) : Promise<string>;
}

///////////////////////////////////////////////////////////////////////////////////////////////////////
/**
 * Decrypts a **KMS-encrypted** API key. The `ref` is the base64-encoded KMS ciphertext blob; the
 * key id/policy is embedded in the ciphertext, so no key id is needed here. Result is cached by the
 * adapter, so this runs once per client. (Keys are in KMS — the assumption for this package.)
 */
export class KmsKeyProvider implements KeyProvider
{
    /** The KMS client used for Decrypt. */
    private readonly client : KMSClient;

    ///////////////////////////////////////////////////////////////////////////////////////////////////////
    /** @param region AWS region for KMS (defaults to `AWS_REGION`, else `us-east-1`). */
    constructor( region : string = process.env.AWS_REGION ?? "us-east-1" )
    {
        this.client = new KMSClient( { region } );
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////
    /**
     * Decrypt a base64 KMS ciphertext to the plaintext key.
     * @param ciphertextB64 base64-encoded KMS ciphertext blob.
     * @throws if KMS returns no plaintext.
     */
    async resolve( ciphertextB64 : string ) : Promise<string>
    {
        const out : DecryptCommandOutput = await this.client.send(
            new DecryptCommand( { CiphertextBlob: Buffer.from( ciphertextB64, "base64" ) } ) );
        if( out.Plaintext === undefined ) throw new Error( "KmsKeyProvider: KMS Decrypt returned no plaintext" );
        return Buffer.from( out.Plaintext ).toString( "utf8" );
    }
}

///////////////////////////////////////////////////////////////////////////////////////////////////////
/**
 * Resolves a key held in **AWS Secrets Manager** — the platform AI provider keys (media-17). The `ref` is
 * either the name of an environment variable holding the secret's ARN/id (the platform convention: the CDK
 * injects `SECRET_<KEY>` into every service), or a secret ARN/name directly. The value is fetched once
 * (the adapter caches it) and returned as-is. LocalStack works via the SDK's `AWS_ENDPOINT_URL`.
 */
export class SecretsKeyProvider implements KeyProvider
{
    /** The Secrets Manager client used for GetSecretValue. */
    private readonly client : SecretsManagerClient;

    ///////////////////////////////////////////////////////////////////////////////////////////////////////
    /** @param region AWS region (defaults to `AWS_REGION`, else `us-east-1`). */
    constructor( region : string = process.env.AWS_REGION ?? "us-east-1" )
    {
        this.client = new SecretsManagerClient( { region } );
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////
    /**
     * Resolve a secret to its plaintext value. If `ref` names a set environment variable, that variable's
     * value (the ARN/id) is used as the secret id; otherwise `ref` is treated as the id/ARN directly.
     * @param ref an env var name holding the secret ARN/id, or a secret ARN/name.
     * @throws if the secret has no string value.
     */
    async resolve( ref : string ) : Promise<string>
    {
        const secretId : string = process.env[ ref ] ?? ref;
        const out : GetSecretValueCommandOutput = await this.client.send( new GetSecretValueCommand( { SecretId: secretId } ) );
        if( out.SecretString === undefined ) throw new Error( `SecretsKeyProvider: secret '${secretId}' has no string value` );
        return out.SecretString;
    }
}

/** Dev/local fallback: the `ref` names an environment variable holding the plaintext key. */
export class EnvKeyProvider implements KeyProvider
{
    ///////////////////////////////////////////////////////////////////////////////////////////////////////
    /**
     * Read the plaintext key from an environment variable.
     * @param envVar the name of the env var holding the key.
     * @throws if the env var is unset/empty.
     */
    async resolve( envVar : string ) : Promise<string>
    {
        const value : string | undefined = process.env[ envVar ];
        if( value === undefined || value === "" ) throw new Error( `EnvKeyProvider: env var '${envVar}' not set` );
        return value;
    }
}

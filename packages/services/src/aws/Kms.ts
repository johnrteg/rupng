//
// KMS facade — encrypt/decrypt + envelope data keys, keyed by cloud-spec LOGICAL key keys.
//
import { KMSClient, EncryptCommand, DecryptCommand, GenerateDataKeyCommand } from "@aws-sdk/client-kms";
import type { EncryptCommandOutput, DecryptCommandOutput, GenerateDataKeyCommandOutput } from "@aws-sdk/client-kms";
import type { CloudResolver, ResourceKey } from "@repo/cloud-spec";
import { ClientUtils } from "./ClientUtils";

/**
 * KMS facade — encryption over `@aws-sdk/client-kms`, addressed by cloud-spec LOGICAL key keys
 * (e.g. `"data"`) rather than key ARNs.
 *
 * **When to use which:**
 * - **`encrypt`/`decrypt` directly** — only for *small* blobs (≤ 4 KB): a secret, token, or
 *   password. Each call is a network round-trip and KMS hard-rejects plaintext over 4 KB.
 * - **`dataKey` (envelope encryption)** — for everything larger (files, records, big JSON):
 *   encrypt locally with the data key, store the encrypted key beside the data. One KMS call,
 *   no size limit.
 *
 * Reach through `.client` for the rest (re-encrypt, signing, grants, key rotation, …).
 */
export class Kms
{
    private _client? : KMSClient;

    /** @param cloud the owning service's resolver — maps logical key keys to KMS key ARNs. */
    constructor( private readonly cloud : CloudResolver ) {}

    /** The raw `KMSClient` — escape hatch (re-encrypt, sign/verify, grants, …). Lazy + cached. */
    get client() : KMSClient { return this._client ??= ClientUtils.createClient( KMSClient ); }

    /** Resolve a cloud-spec logical key key (e.g. `"data"`) to its physical KMS key ARN. */
    keyArn( key : ResourceKey ) : string { return this.cloud.kmsKeyArn( key ); }

    /**
     * Encrypt a **small** blob (≤ 4 KB) directly under the named CMK — good for a secret/token.
     * For larger payloads use {@link dataKey}; this is a per-call round-trip and KMS rejects
     * plaintext over 4 KB.
     * @param keyKey    logical key key.
     * @param plaintext bytes to encrypt.
     * @returns the ciphertext (store/transmit as-is; the key id is embedded in it).
     */
    async encrypt( keyKey : ResourceKey, plaintext : Uint8Array ) : Promise<Uint8Array>
    {
        const result : EncryptCommandOutput = await this.client.send( new EncryptCommand( { KeyId: this.keyArn( keyKey ), Plaintext: plaintext } ) );
        return result.CiphertextBlob as Uint8Array;
    }

    /**
     * Decrypt ciphertext produced by {@link encrypt} (or {@link dataKey}'s encrypted key). No key
     * reference is needed — KMS reads the key id embedded in the ciphertext and picks the CMK.
     * @param ciphertext the bytes returned by a prior encrypt (the key id is embedded in them).
     * @returns the recovered plaintext bytes.
     */
    async decrypt( ciphertext : Uint8Array ) : Promise<Uint8Array>
    {
        const result : DecryptCommandOutput = await this.client.send( new DecryptCommand( { CiphertextBlob: ciphertext } ) );
        return result.Plaintext as Uint8Array;
    }

    /**
     * **Envelope encryption.** Generate a one-time data key: use the returned `plaintext` key to
     * encrypt your payload locally (e.g. AES-GCM), persist the `encrypted` key alongside the
     * data, then drop the plaintext key from memory. To read later, {@link decrypt} the stored
     * encrypted key and re-derive. This is how you encrypt large data with KMS — no 4 KB limit,
     * one network call regardless of payload size.
     * @param keyKey  logical key key.
     * @param keySpec data-key size — see {@link Kms.KeySpec} (default `AES_256`).
     * @returns `{ plaintext, encrypted }` — the usable key and the storable, KMS-wrapped key.
     */
    async dataKey( keyKey : ResourceKey, keySpec : Kms.KeySpec = Kms.KeySpec.AES_256 ) : Promise<{ plaintext : Uint8Array; encrypted : Uint8Array }>
    {
        const result : GenerateDataKeyCommandOutput = await this.client.send( new GenerateDataKeyCommand( { KeyId: this.keyArn( keyKey ), KeySpec: keySpec } ) );
        return { plaintext: result.Plaintext as Uint8Array, encrypted: result.CiphertextBlob as Uint8Array };
    }
}

export namespace Kms
{
    /**
     * Data-key size for {@link Kms.dataKey}.
     * - **`AES_256`** — 256-bit; the **default and recommended** choice. Strongest, with no
     *   meaningful cost difference. Use unless you have a specific reason not to.
     * - **`AES_128`** — 128-bit; smaller and marginally faster, still strong — but rarely worth
     *   choosing over 256. Pick only to interoperate with an existing scheme that mandates 128-bit.
     */
    export enum KeySpec
    {
        AES_256 = "AES_256",
        AES_128 = "AES_128",
    }
}

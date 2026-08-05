//
// put-secrets.mjs — load the local dev API keys from .env.local into LocalStack Secrets Manager, into the
// SAME secret names the CDK provisions (platform-shared AI keys + media Browse provider keys). Run AFTER
// `cdklocal deploy platform-local media-local` (the secrets must exist). No awslocal/aws-cli needed — uses
// the repo's bundled @aws-sdk/client-secrets-manager against the LocalStack endpoint.
//
//   node cloud/local/put-secrets.mjs
//
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { SecretsManagerClient, PutSecretValueCommand } from "@aws-sdk/client-secrets-manager";

const ROOT = join( dirname( fileURLToPath( import.meta.url ) ), "..", ".." );

// parse .env.local (KEY=VALUE lines; ignore comments/blanks)
function loadEnvLocal()
{
    const text = readFileSync( join( ROOT, ".env.local" ), "utf8" );
    const env = {};
    for( const line of text.split( "\n" ) )
    {
        const trimmed = line.trim();
        if( !trimmed || trimmed.startsWith( "#" ) ) continue;
        const eq = trimmed.indexOf( "=" );
        if( eq < 0 ) continue;
        env[ trimmed.slice( 0, eq ).trim() ] = trimmed.slice( eq + 1 ).trim();
    }
    return env;
}

const env = loadEnvLocal();

// secret physical name -> the string value to store (skip any whose source key is missing/empty)
const unsplash = env.UNSPLASH_ACCESS_KEY
    ? JSON.stringify( { appId: env.UNSPLASH_APP_ID ?? "", accessKey: env.UNSPLASH_ACCESS_KEY, secretKey: env.UNSPLASH_SECRET_KEY ?? "" } )
    : undefined;

const secrets = {
    "local-platform-secret-ai-openai":    env.OPENAI_API_KEY,
    "local-platform-secret-ai-fish":      env.FISH_AUDIO_KEY,
    "local-platform-secret-ai-gemini":    env.GEMINI_KEY,
    "local-media-secret-browse-pexels":   env.PEXELS_API_KEY,
    "local-media-secret-browse-unsplash": unsplash,
    "local-email-secret-email-mailgun":   env.MAILGUN_API_KEY,
    // ai-anthropic / ai-elevenlabs / magnific / other email-* providers: no key in .env.local yet — set later.
};

const client = new SecretsManagerClient( {
    region: "us-east-1",
    endpoint: process.env.AWS_ENDPOINT_URL ?? "http://localhost:4566",
    credentials: { accessKeyId: "test", secretAccessKey: "test" },
} );

let ok = 0, skipped = 0, failed = 0;
for( const [ secretId, value ] of Object.entries( secrets ) )
{
    if( !value ) { console.log( `SKIP  ${secretId} (no value in .env.local)` ); skipped++; continue; }
    try
    {
        await client.send( new PutSecretValueCommand( { SecretId: secretId, SecretString: value } ) );
        console.log( `OK    ${secretId} (${value.length} chars)` );
        ok++;
    }
    catch( error )
    {
        console.log( `FAIL  ${secretId} — ${error.name}: ${error.message}` );
        failed++;
    }
}
console.log( `\n${ok} stored, ${skipped} skipped, ${failed} failed` );
process.exit( failed ? 1 : 0 );

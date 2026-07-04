import { DescribeStacksCommand } from "@aws-sdk/client-cloudformation";

import { TargetKind } from "../shared/types";
import { awsErr, cfnClient, getTarget } from "./aws";

//
// The deployed web app's URL — read from the service stack's `WebsiteUrl*` CloudFormation output
// (emitted by the CDK for a PUBLIC_CDN static site). The console deploys via cdklocal (env=local),
// so the stack is `<service>-local`; we also check `<service>-dev` for a real-AWS deploy.
//

/** LocalStack has no trusted TLS — force http so the deployed URL actually loads (handles stale https outputs). */
function localUrl( url : string ) : string
{
    return getTarget().kind === TargetKind.LOCALSTACK ? url.replace( /^https:\/\//, "http://" ) : url;
}

/** Resolve the deployed web app's URL by reading the `WebsiteUrl*` output of its CloudFormation stack. */
export async function webAppUrl( service : string ) : Promise<{ url? : string; error? : string }>
{
    const candidates : Array<string> = [ `${service}-local`, `${service}-dev` ];
    try
    {
        for ( const name of candidates )
        {
            try
            {
                const out = await cfnClient().send( new DescribeStacksCommand( { StackName: name } ) );
                const outputs = out.Stacks?.[ 0 ]?.Outputs ?? [];
                const hit = outputs.find( ( output ) => ( output.OutputKey ?? "" ).startsWith( "WebsiteUrl" ) );
                if ( hit?.OutputValue ) return { url: localUrl( hit.OutputValue ) };
            }
            catch { /* stack not found — try the next candidate */ }
        }
        return {};   // deployed nothing yet (or no static-site output)
    }
    catch ( err ) { return { error: awsErr( err ) }; }
}

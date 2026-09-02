//
import { Connector } from "./Connector";
import { ShopifyConnector } from "./ShopifyConnector";

//
// ConnectorFactory — resolves the native `Connector` for an integration id, mirroring social's
// `AdapterFactory`. New integrations are ADDITIVE (marketplace-5.3) — register the connector here, no
// call-site changes. An unregistered integration simply has no inbound webhook intake / bespoke
// outbound support yet; its OAuth connect + generic action proxy still work via `OAuthFactory` /
// `MarketplaceActionJob`.
//
export class ConnectorFactory
{
    private static readonly registry : Map<string, Connector> = new Map<string, Connector>( [
        [ ShopifyConnector.INTEGRATION_ID, new ShopifyConnector() ],
    ] );

    /** The connector for an integration id, or `undefined` if none is registered yet. */
    public static for( integrationId : string ) : Connector | undefined { return ConnectorFactory.registry.get( integrationId ); }
}

export default ConnectorFactory;
// eof

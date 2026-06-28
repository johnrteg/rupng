//
import { Events } from "@repo/system";

import AppService from './AppService';

//
// authed BFF — UI aggregation (/app/views/*), the full feature-flag set, notices CRUD/admin,
// support glue (ticket / page-share), and ops. Adds no authority of its own. (SPECS app-11.2)
//
// Consumes the upstream entity events the UI cares about — account.account (and auth.user) — the tail
// of the event-driven sign-up chain. For now it logs receipt (read-model/cache warming lands with the
// aggregation layer); the wiring proves the publisher→subscriber path end-to-end.
//
export class AppMainService extends AppService
{
    /////////////////////////////////////////////////////////////////////
    constructor()
    {
        super( AppService.Role.MAIN );
    }

    /////////////////////////////////////////////////////////////////////
    protected async init() : Promise<void>
    {
        super.init();
        await this.startEventConsumer();
    }

    /////////////////////////////////////////////////////////////////////
    // Best-effort: a Kafka outage must not stop the BFF from serving — log and carry on.
    private async startEventConsumer() : Promise<void>
    {
        try
        {
            await this.kafka.subscribeEvents( "app-readmodel", [ Events.Object.ACCOUNT_ACCOUNT, Events.Object.AUTH_USER ], async ( event ) =>
            {
                this.log.info( "app consumed event", { action: event.action, accountId: event.accountId, targetId: event.target.id } );
                // TODO: warm the UI read model / cache from event.data once the aggregation layer lands.
            } );
            this.log.info( "app-readmodel consumer subscribed", { topics: [ Events.Object.ACCOUNT_ACCOUNT, Events.Object.AUTH_USER ] } );
        }
        catch( error )
        {
            this.log.warn( "app-readmodel consumer failed to start (bus unreachable?)", { error: String( error ) } );
        }
    }
}

export default AppMainService;

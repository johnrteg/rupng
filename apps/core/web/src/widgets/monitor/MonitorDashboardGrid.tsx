import AppModel from "@model/AppModel";
//
import React from "react";
import { JSX } from "react";

import { Box, CircularProgress, Stack, Typography } from "@mui/material";
import Grid from "@mui/material/Grid";

import { GetMonitorWidgets, MonitorConfig } from "@repo/api";
import { RestfulService } from "@repo/endpoint";

import { MonitorWidgetTile } from "./tiles/MonitorWidgetTile";

//
// MonitorDashboardGrid — loads the configured widget list once, then renders one self-polling
// MonitorWidgetTile per widget. Widget CRUD lives in the ops Console's Config editor (ROOT-only,
// AppConfig-backed) — this page is the SUPPORT-level READ view.
//
export function MonitorDashboardGrid() : JSX.Element
{
    const appmodel : AppModel = AppModel.instance();

    const [ widgets, setWidgets ] = React.useState< Array<MonitorConfig.WidgetConfig> >( [] );
    const [ loading, setLoading ] = React.useState< boolean >( true );

    React.useEffect( componentLoaded, [] );

    function componentLoaded() : void { void load(); }

    async function load() : Promise<void>
    {
        const reply : RestfulService.Reply<GetMonitorWidgets.Response> = await appmodel.server.fetch( new GetMonitorWidgets() );
        if( reply.ok && reply.data ) setWidgets( reply.data.widgets );
        setLoading( false );
    }

    if( loading )
        return <Stack direction="row" spacing={1} sx={{ alignItems: "center", p: 2 }}><CircularProgress size={18} /><Typography variant="body2" sx={{ color: "text.secondary" }}>{"Loading…"}</Typography></Stack>;

    if( widgets.length === 0 )
        return <Box sx={{ p: 2 }}><Typography variant="body2" sx={{ color: "text.secondary" }}>{"No widgets configured yet — add one in the ops Console under Config → monitor."}</Typography></Box>;

    return (
        <Box sx={{ p: 2 }}>
            <Grid container spacing={2}>
                { widgets.map( ( widget : MonitorConfig.WidgetConfig ) : JSX.Element => (
                    <Grid key={widget.id} size={{ mobile: 12, tablet: 6, desktop: 3 }}>
                        <MonitorWidgetTile widget={widget} />
                    </Grid>
                ) ) }
            </Grid>
        </Box>
    );
}

export default MonitorDashboardGrid;

import AppModel from "@model/AppModel";
//
import React from "react";
import { JSX } from "react";

import { Box, Card, CardContent, CircularProgress, Stack, Typography } from "@mui/material";

import { GetMonitorWidgetData, MonitorConfig, MonitorWidgetStatus } from "@repo/api";
import { RestfulService } from "@repo/endpoint";

import { MonitorModel } from "../MonitorModel";

//
// MonitorWidgetTile — one dashboard stat tile: polls its own widget's live status at the
// configured `refreshIntervalSec` and renders the primary value + a threshold-derived status
// color, plus the small detail fields. Self-contained (one tile, one poll loop) so a slow/failed
// widget never blocks its siblings.
//
export function MonitorWidgetTile( props : MonitorWidgetTile.Props ) : JSX.Element
{
    const appmodel : AppModel = AppModel.instance();

    const [ data, setData ]       = React.useState< MonitorWidgetStatus.Data | undefined >( undefined );
    const [ loading, setLoading ] = React.useState< boolean >( true );

    React.useEffect( componentLoaded, [ props.widget.id, props.widget.refreshIntervalSec ] );

    // start this tile's own poll loop on mount (and whenever its widget id/interval changes); stop it on unmount
    function componentLoaded() : () => void
    {
        void load();
        const intervalMs : number = Math.max( 5, props.widget.refreshIntervalSec ) * 1000;
        const timer : ReturnType<typeof setInterval> = setInterval( () : void => { void load(); }, intervalMs );
        return () : void => clearInterval( timer );
    }

    async function load() : Promise<void>
    {
        const reply : RestfulService.Reply<GetMonitorWidgetData.Response> = await appmodel.server.fetch( new GetMonitorWidgetData( props.widget.id ) );
        if( reply.ok && reply.data ) setData( reply.data );
        setLoading( false );
    }

    const level : MonitorWidgetStatus.Level | undefined = data?.level;
    const typeLabel : string = MonitorModel.TYPE_META[ props.widget.type ].label;

    return (
        <Card variant="outlined" sx={{ minWidth: 220 }}>
            <CardContent>
                <Stack spacing={0.5}>
                    <Typography variant="caption" sx={{ color: "text.disabled" }}>{typeLabel}</Typography>
                    <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>{props.widget.label || props.widget.target}</Typography>

                    { loading
                        ? <Stack direction="row" spacing={1} sx={{ alignItems: "center", py: 1 }}><CircularProgress size={16} /><Typography variant="body2" sx={{ color: "text.secondary" }}>{"Loading…"}</Typography></Stack>
                        : data === undefined
                            ? <Typography variant="body2" sx={{ color: "error.main" }}>{"No data"}</Typography>
                            : <Box>
                                <Typography variant="h4" sx={{ color: MonitorModel.paletteFor( level ) }}>
                                    {data.primaryValue ?? "—"}
                                </Typography>
                                { data.primaryLabel && <Typography variant="caption" sx={{ color: "text.secondary" }}>{data.primaryLabel}</Typography> }
                                { data.error && <Typography variant="caption" sx={{ color: "error.main", display: "block" }}>{data.error}</Typography> }
                                { Object.entries( data.details ).map( ( [ key, value ] ) : JSX.Element => (
                                    <Typography key={key} variant="caption" sx={{ color: "text.secondary", display: "block" }}>{key}: {value}</Typography>
                                ) ) }
                              </Box> }
                </Stack>
            </CardContent>
        </Card>
    );
}

export namespace MonitorWidgetTile
{
    export interface Props
    {
        widget : MonitorConfig.WidgetConfig;
    }
}

export default MonitorWidgetTile;

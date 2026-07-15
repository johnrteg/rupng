import { useEffect, useState } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import Chip from "@mui/material/Chip";
import Tooltip from "@mui/material/Tooltip";
import CircularProgress from "@mui/material/CircularProgress";
import Divider from "@mui/material/Divider";
import BoltIcon from "@mui/icons-material/Bolt";
import RefreshIcon from "@mui/icons-material/Refresh";
import RocketLaunchIcon from "@mui/icons-material/RocketLaunch";

import type { InvokeResult, JobInfo, LambdaFn } from "../../shared/types";
import { api } from "../api";
import { useTarget } from "../targetStore";
import { MONO } from "../theme";

//
// Minimal Jobs/Lambda panel: lists the service's jobs (from src/jobs/*.ts), shows which are deployed
// to LocalStack, and lets you Invoke one with a JSON payload (since jobs are queue/event-driven,
// manual invoke is the test path). Deploy reuses the service's cdklocal deploy (deploys all its
// Lambdas) via the pipeline's Deploy stage.
//
/** Lists a service's declared Lambda jobs, shows which are deployed to LocalStack, and invokes one with a JSON payload. */
export function JobsPanel( { service } : { service : string } )
{
    const [ jobs, setJobs ]         = useState<Array<JobInfo>>( [] );
    const [ fns, setFns ]           = useState<Array<LambdaFn>>( [] );
    const [ fnError, setFnError ]   = useState<string | undefined>();
    const [ selectedFn, setFn ]     = useState<string>( "" );
    const [ payload, setPayload ]   = useState<string>( "{}" );
    const [ result, setResult ]     = useState<InvokeResult | null>( null );
    const [ busy, setBusy ]         = useState<"list" | "invoke" | null>( null );

    const readOnly : boolean = useTarget().readOnly;   // no Lambda invoke against a real AWS account

    useEffect( () =>
    {
        setResult( null );
        void api.jobsList( service ).then( setJobs );
        void refreshDeployed();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [ service ] );

    /** Re-query the Lambdas deployed to LocalStack for this service; default the selection to the first one. */
    const refreshDeployed = async () : Promise<void> =>
    {
        setBusy( "list" );
        try
        {
            const { functions, error } = await api.lambdaList( service );
            setFns( functions );
            setFnError( error );
            if ( functions.length > 0 ) setFn( ( current ) => current || functions[ 0 ].name );
        }
        finally { setBusy( null ); }
    };

    /** Invoke the selected Lambda with the current JSON payload and capture the result. */
    const invoke = async () : Promise<void> =>
    {
        if ( !selectedFn ) return;
        setBusy( "invoke" );
        try { setResult( await api.lambdaInvoke( selectedFn, payload ) ); }
        finally { setBusy( null ); }
    };

    if ( jobs.length === 0 )
    {
        return (
            <Box sx={{ p: 2 }}>
                <Typography variant="caption" sx={{ color: "text.disabled" }}>
                    No Lambda jobs found in apps/core/{service}/src/jobs.
                </Typography>
            </Box>
        );
    }

    return (
        <Box sx={{ p: 1.5, overflow: "auto", height: "100%" }}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}>
                <BoltIcon fontSize="small" sx={{ color: "primary.main" }} />
                <Typography variant="subtitle2" sx={{ fontWeight: 700, flexGrow: 1 }}>Jobs ({jobs.length})</Typography>
                <Tooltip title="Re-query Lambdas deployed to LocalStack">
                    <Button size="small" variant="outlined" startIcon={busy === "list" ? <CircularProgress size={13} /> : <RefreshIcon fontSize="small" />} onClick={() => void refreshDeployed()}>
                        Deployed
                    </Button>
                </Tooltip>
            </Box>

            {/* declared jobs */}
            {jobs.map( ( job ) =>
            {
                // a declared job counts as deployed if any LocalStack function name contains its name
                const deployed : LambdaFn | undefined = fns.find( ( fn ) => fn.name.toLowerCase().includes( job.name.toLowerCase() ) );
                return (
                    <Box key={job.name} sx={{ display: "flex", alignItems: "center", gap: 1, py: 0.5 }}>
                        <Chip
                            label={deployed ? "deployed" : "not deployed"}
                            color={deployed ? "success" : "default"}
                            variant={deployed ? "filled" : "outlined"}
                            sx={{ minWidth: 96 }}
                        />
                        <Box sx={{ minWidth: 0 }}>
                            <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>{job.name}</Typography>
                            <Typography variant="caption" sx={{ color: "text.disabled", fontFamily: MONO }} noWrap>{job.handler}</Typography>
                        </Box>
                    </Box>
                );
            } )}

            <Typography variant="caption" sx={{ display: "block", mt: 0.5, color: "text.disabled" }}>
                Deploy these via the <b>Deploy</b> stage with the <b>cdklocal</b> target (it deploys the service's Lambdas).
            </Typography>

            <Divider sx={{ my: 1.5 }} />

            {/* invoke */}
            <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>Invoke (LocalStack)</Typography>

            {fnError
                ? <Typography variant="caption" sx={{ color: "warning.main" }}>{fnError}</Typography>
                : fns.length === 0
                    ? <Typography variant="caption" sx={{ color: "text.disabled" }}>No deployed functions match "{service}". Deploy first, then "Deployed".</Typography>
                    : (
                        <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
                            <Select size="small" value={selectedFn} onChange={( e ) => setFn( e.target.value )} sx={{ fontFamily: MONO, fontSize: 12 }}>
                                {fns.map( ( fn ) => <MenuItem key={fn.name} value={fn.name} sx={{ fontFamily: MONO, fontSize: 12 }}>{fn.name}</MenuItem> )}
                            </Select>
                            <TextField
                                size="small"
                                label="JSON payload"
                                value={payload}
                                onChange={( e ) => setPayload( e.target.value )}
                                multiline
                                minRows={3}
                                slotProps={{ htmlInput: { style: { fontFamily: MONO, fontSize: 12 } } }}
                            />
                            {readOnly && (
                                <Typography variant="caption" sx={{ color: "warning.main" }}>
                                    Invoke is disabled while targeting a real AWS account (read-only).
                                </Typography>
                            )}
                            <Button
                                variant="contained"
                                startIcon={busy === "invoke" ? <CircularProgress size={14} color="inherit" /> : <RocketLaunchIcon />}
                                disabled={busy !== null || !selectedFn || readOnly}
                                onClick={() => void invoke()}
                            >
                                Invoke
                            </Button>
                        </Box>
                    )}

            {/* result */}
            {result && (
                <Box sx={{ mt: 1.5, p: 1, border: "1px solid", borderColor: result.ok ? "success.main" : "error.main", borderRadius: 1.5 }}>
                    <Box sx={{ display: "flex", gap: 1, alignItems: "center", mb: 0.5 }}>
                        <Chip size="small" color={result.ok ? "success" : "error"} label={result.error ? "error" : `status ${result.statusCode ?? "?"}`} />
                        {result.functionError && <Chip size="small" color="error" variant="outlined" label={result.functionError} />}
                    </Box>
                    {result.error && <Typography variant="caption" sx={{ color: "error.main" }}>{result.error}</Typography>}
                    {result.payload !== undefined && (
                        <>
                            <Typography variant="caption" sx={{ color: "text.disabled" }}>response</Typography>
                            <Box component="pre" sx={{ m: 0, fontFamily: MONO, fontSize: 11.5, color: "text.secondary", whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: 160, overflow: "auto" }}>
                                {JSON.stringify( result.payload, null, 2 )}
                            </Box>
                        </>
                    )}
                    {result.logTail && (
                        <>
                            <Typography variant="caption" sx={{ color: "text.disabled" }}>log tail</Typography>
                            <Box component="pre" sx={{ m: 0, fontFamily: MONO, fontSize: 11, color: "#8b949e", whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: 160, overflow: "auto" }}>
                                {result.logTail}
                            </Box>
                        </>
                    )}
                </Box>
            )}
        </Box>
    );
}

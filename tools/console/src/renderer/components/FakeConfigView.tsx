import { useEffect, useState, type JSX } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import Chip from "@mui/material/Chip";
import Divider from "@mui/material/Divider";
import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";
import Slider from "@mui/material/Slider";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import SaveIcon from "@mui/icons-material/Save";
import RefreshIcon from "@mui/icons-material/Refresh";

import type { FakeEmailConfig, FakePctKnob, FakeEngagementKnob } from "../../shared/types";
import { api } from "../api";
import { MONO } from "../theme";

//
// FakeConfigView — the Fake → Email Config. A friendly form over the fake ESP's behavior "knobs": each is a
// checkbox (enable) + a slider with a numeric entry (dual-thumb for min/max ranges) + a one-line tip. Reads
// from + saves to the running fake-email service. Seeded ALL-OFF (full delivery, no notifications).
//

/** The delivery-percentage knobs (identical shape) + their copy. */
type PctKey = "hardBounce" | "softBounce" | "complaint" | "deferred" | "invalid";
const PCT_KNOBS : Array<{ key : PctKey; label : string; tip : string }> =
[
    { key: "hardBounce", label: "Hard bounce",       tip: "Permanent bounce → the address is suppressed. Percent of recipients affected." },
    { key: "softBounce", label: "Soft bounce",       tip: "Temporary/retryable bounce (mailbox issue). Percent of recipients." },
    { key: "complaint",  label: "Complaint",         tip: "Recipient marks it spam → suppressed. Percent of recipients (keep < 0.3% in reality)." },
    { key: "deferred",   label: "Deferred",          tip: "Greylisted / delayed delivery. Percent of recipients." },
    { key: "invalid",    label: "Invalid recipient", tip: "Rejected at send time (per-recipient 4xx). Percent of recipients." },
];

/** The engagement knobs (percent + a delay window) + their copy. */
type EngKey = "open" | "click" | "unsubscribe";
const ENG_KNOBS : Array<{ key : EngKey; label : string; tip : string }> =
[
    { key: "open",        label: "Opens",        tip: "Simulate a recipient opening the email, some seconds after delivery." },
    { key: "click",       label: "Clicks",       tip: "Simulate a link/CTA click (implies an open) after delivery." },
    { key: "unsubscribe", label: "Unsubscribes", tip: "Simulate a one-click unsubscribe after delivery (feeds the opt-out loop)." },
];

const BOUNCE_CATEGORIES : Array<string> = [ "mailbox-full", "no-such-user", "blocked", "content" ];

export function FakeConfigView()
{
    const [ config, setConfig ] = useState<FakeEmailConfig | null>( null );
    const [ original, setOriginal ] = useState<string>( "" );
    const [ status, setStatus ] = useState<{ ok : boolean; message : string } | null>( null );
    const [ loading, setLoading ] = useState<boolean>( true );

    /** Load the current behavior config from the fake service. */
    async function load() : Promise<void>
    {
        setLoading( true );
        const result = await api.fakeConfigGet();
        if ( result.ok && result.config )
        {
            const loaded : FakeEmailConfig = result.config as FakeEmailConfig;
            setConfig( loaded );
            setOriginal( JSON.stringify( loaded ) );
            setStatus( null );
        }
        else setStatus( { ok: false, message: `${result.error ?? "no config"} — is the fake-email service running?` } );
        setLoading( false );
    }

    /** Save the edited config back to the fake service. */
    async function save() : Promise<void>
    {
        if ( !config ) return;
        const result = await api.fakeConfigSave( config );
        if ( result.ok ) { setOriginal( JSON.stringify( config ) ); setStatus( { ok: true, message: "saved" } ); }
        else setStatus( { ok: false, message: result.error ?? "save failed" } );
    }

    useEffect( () => { void load(); }, [] );

    /** Replace one top-level knob immutably (functional update to avoid stale closures). */
    function replace<K extends keyof FakeEmailConfig>( key : K, value : FakeEmailConfig[ K ] ) : void
    {
        setConfig( ( prev ) => ( prev ? { ...prev, [ key ]: value } : prev ) );
    }

    /** Clamp a numeric entry into range (blank/NaN → the min). */
    function clamp( value : number, min : number, max : number ) : number
    {
        if ( Number.isNaN( value ) ) return min;
        return Math.min( max, Math.max( min, value ) );
    }

    const dirty : boolean = config !== null && JSON.stringify( config ) !== original;

    // ── small render helpers (close over config/replace) ──────────────────────────────────────────

    /** A knob header: the enable checkbox + label + one-line tip. */
    function knobHead( label : string, tip : string, enabled : boolean, onToggle : ( on : boolean ) => void ) : JSX.Element
    {
        return (
            <Box sx={{ display: "flex", alignItems: "flex-start", gap: 0.5 }}>
                <Checkbox size="small" checked={enabled} onChange={( event ) => onToggle( event.target.checked )} sx={{ mt: -0.5 }} />
                <Box sx={{ minWidth: 0 }}>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>{label}</Typography>
                    <Typography variant="caption" sx={{ color: "text.secondary" }}>{tip}</Typography>
                </Box>
            </Box>
        );
    }

    /** A single-value slider + numeric entry (disabled until the knob is enabled). */
    function numberControl( enabled : boolean, value : number, min : number, max : number, step : number, unit : string, onChange : ( value : number ) => void ) : JSX.Element
    {
        return (
            <Box sx={{ display: "flex", alignItems: "center", gap: 2, pl: 5, pr: 1, pb: 1, opacity: enabled ? 1 : 0.45 }}>
                <Slider size="small" disabled={!enabled} value={value} min={min} max={max} step={step} valueLabelDisplay="auto"
                        onChange={( _event : Event, next : number | Array<number> ) => onChange( Array.isArray( next ) ? next[ 0 ] : next )} sx={{ maxWidth: 240 }} />
                <TextField size="small" type="number" disabled={!enabled} value={value}
                           onChange={( event ) => onChange( clamp( Number( event.target.value ), min, max ) )} sx={{ width: 96 }} />
                <Typography variant="caption" sx={{ color: "text.disabled", fontFamily: MONO }}>{unit}</Typography>
            </Box>
        );
    }

    /** A dual-thumb range slider + two numeric entries (min/max). */
    function rangeControl( enabled : boolean, lo : number, hi : number, min : number, max : number, step : number, unit : string, onChange : ( lo : number, hi : number ) => void ) : JSX.Element
    {
        return (
            <Box sx={{ display: "flex", alignItems: "center", gap: 2, pl: 5, pr: 1, pb: 1, opacity: enabled ? 1 : 0.45 }}>
                <Slider size="small" disabled={!enabled} value={[ lo, hi ]} min={min} max={max} step={step} valueLabelDisplay="auto"
                        onChange={( _event : Event, next : number | Array<number> ) => { const pair : Array<number> = Array.isArray( next ) ? next : [ next, next ]; onChange( pair[ 0 ], pair[ 1 ] ); }} sx={{ maxWidth: 240 }} />
                <TextField size="small" type="number" disabled={!enabled} value={lo} onChange={( event ) => onChange( clamp( Number( event.target.value ), min, hi ), hi )} sx={{ width: 80 }} />
                <Typography variant="caption" sx={{ color: "text.disabled" }}>–</Typography>
                <TextField size="small" type="number" disabled={!enabled} value={hi} onChange={( event ) => onChange( lo, clamp( Number( event.target.value ), lo, max ) )} sx={{ width: 80 }} />
                <Typography variant="caption" sx={{ color: "text.disabled", fontFamily: MONO }}>{unit}</Typography>
            </Box>
        );
    }

    /** A section divider + heading. */
    function section( title : string ) : JSX.Element
    {
        return <Divider textAlign="left" sx={{ mt: 1, "&::before": { width: "1%" } }}><Typography variant="overline" sx={{ color: "text.secondary" }}>{title}</Typography></Divider>;
    }

    /** One delivery-percentage knob row. */
    function pctRow( key : PctKey, label : string, tip : string ) : JSX.Element
    {
        const knob : FakePctKnob = ( config as FakeEmailConfig )[ key ];
        return (
            <Box key={key}>
                {knobHead( label, tip, knob.enabled, ( on ) => replace( key, { ...knob, enabled: on } ) )}
                {numberControl( knob.enabled, knob.percent, 0, 100, 1, "%", ( value ) => replace( key, { ...knob, percent: value } ) )}
            </Box>
        );
    }

    /** One engagement knob row (percent + delay window). */
    function engRow( key : EngKey, label : string, tip : string ) : JSX.Element
    {
        const knob : FakeEngagementKnob = ( config as FakeEmailConfig )[ key ];
        return (
            <Box key={key}>
                {knobHead( label, tip, knob.enabled, ( on ) => replace( key, { ...knob, enabled: on } ) )}
                {numberControl( knob.enabled, knob.percent, 0, 100, 1, "%", ( value ) => replace( key, { ...knob, percent: value } ) )}
                {rangeControl( knob.enabled, knob.delayMinSec, knob.delayMaxSec, 0, 3600, 5, "sec after send", ( lo, hi ) => replace( key, { ...knob, delayMinSec: lo, delayMaxSec: hi } ) )}
            </Box>
        );
    }

    return (
        <Box sx={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>

            {/* toolbar */}
            <Box sx={{ display: "flex", alignItems: "center", gap: 1, px: 1.5, py: 1, borderBottom: "1px solid", borderColor: "divider", flexWrap: "wrap" }}>
                <Typography variant="subtitle2" sx={{ fontFamily: MONO }}>Fake ESP — behavior</Typography>
                {dirty && <Chip size="small" color="warning" variant="outlined" label="unsaved" sx={{ fontFamily: MONO }} />}
                {status && <Chip size="small" color={status.ok ? "success" : "error"} variant="outlined" label={status.message} sx={{ fontFamily: MONO }} />}
                <Box sx={{ flexGrow: 1 }} />
                <Button size="small" variant="outlined" startIcon={<RefreshIcon fontSize="small" />} onClick={() => void load()}>Reload</Button>
                <Button size="small" variant="contained" startIcon={<SaveIcon fontSize="small" />} disabled={!dirty || loading} onClick={() => void save()}>Save</Button>
            </Box>

            {/* service-down hint */}
            {!config && status && !status.ok && (
                <Box sx={{ p: 2 }}>
                    <Typography variant="body2" sx={{ color: "warning.main" }}>{status.message}</Typography>
                    <Typography variant="caption" sx={{ color: "text.disabled" }}>Start the fake-email service (port 9100) from the Develop tab.</Typography>
                </Box>
            )}

            {/* form */}
            {config && (
                <Box sx={{ flexGrow: 1, minHeight: 0, overflow: "auto", px: 1.5, py: 1 }}>
                    <Typography variant="caption" sx={{ color: "text.disabled", display: "block", mb: 1 }}>
                        Each knob is independent. Enable one to simulate that condition; set a bounce/complaint to 100% to force it on a small test send. All off = clean pass-through (full delivery, no notifications).
                    </Typography>

                    {section( "Connection" )}
                    <Box>
                        {knobHead( "Rate limit", "Reject over N sends/minute per account with 429 (tests backoff/retry).", config.rateLimit.enabled, ( on ) => replace( "rateLimit", { ...config.rateLimit, enabled: on } ) )}
                        {numberControl( config.rateLimit.enabled, config.rateLimit.perMinute, 1, 1000, 1, "per minute", ( value ) => replace( "rateLimit", { ...config.rateLimit, perMinute: value } ) )}
                    </Box>
                    <Box>
                        {knobHead( "Timeout (hang)", "Hold the response this long to exceed the client timeout (tests timeout handling).", config.timeout.enabled, ( on ) => replace( "timeout", { ...config.timeout, enabled: on } ) )}
                        {numberControl( config.timeout.enabled, config.timeout.seconds, 1, 120, 1, "seconds", ( value ) => replace( "timeout", { ...config.timeout, seconds: value } ) )}
                    </Box>
                    <Box>
                        {knobHead( "Unavailable", "Return 503 for every send (tests failover + DLQ). No parameter.", config.unavailable.enabled, ( on ) => replace( "unavailable", { enabled: on } ) )}
                    </Box>
                    <Box>
                        {knobHead( "Latency", "Add realistic response jitter in a range on every send (not a hang).", config.latency.enabled, ( on ) => replace( "latency", { ...config.latency, enabled: on } ) )}
                        {rangeControl( config.latency.enabled, config.latency.minMs, config.latency.maxMs, 0, 5000, 10, "ms", ( lo, hi ) => replace( "latency", { ...config.latency, minMs: lo, maxMs: hi } ) )}
                    </Box>

                    {section( "Delivery outcomes (per recipient)" )}
                    {PCT_KNOBS.map( ( knob ) => pctRow( knob.key, knob.label, knob.tip ) )}
                    <Box sx={{ display: "flex", alignItems: "center", gap: 2, pl: 5, py: 1 }}>
                        <Box sx={{ minWidth: 0 }}>
                            <Typography variant="body2" sx={{ fontWeight: 600 }}>Bounce category</Typography>
                            <Typography variant="caption" sx={{ color: "text.secondary" }}>The reason a bounce reports (unless forced by a magic address).</Typography>
                        </Box>
                        <Select size="small" value={config.bounceCategory} onChange={( event ) => replace( "bounceCategory", String( event.target.value ) )} sx={{ minWidth: 160 }}>
                            {BOUNCE_CATEGORIES.map( ( category ) => <MenuItem key={category} value={category} sx={{ fontFamily: MONO }}>{category}</MenuItem> )}
                        </Select>
                    </Box>

                    {section( "Validation limits" )}
                    <Box>
                        {knobHead( "Enforce limits", "Reject an oversize body (413) or too many recipients (400).", config.limits.enabled, ( on ) => replace( "limits", { ...config.limits, enabled: on } ) )}
                        {numberControl( config.limits.enabled, config.limits.maxSizeBytes, 0, 26214400, 1024, "max bytes", ( value ) => replace( "limits", { ...config.limits, maxSizeBytes: value } ) )}
                        {numberControl( config.limits.enabled, config.limits.maxRecipients, 1, 10000, 1, "max recipients", ( value ) => replace( "limits", { ...config.limits, maxRecipients: value } ) )}
                    </Box>

                    {section( "Engagement (per delivered recipient)" )}
                    {ENG_KNOBS.map( ( knob ) => engRow( knob.key, knob.label, knob.tip ) )}
                    <Typography variant="caption" sx={{ color: "text.disabled", display: "block", pl: 5 }}>Engagement events fire via webhooks — dispatch is not wired yet, so these are recorded but not yet delivered.</Typography>

                    {section( "Storage & webhook" )}
                    <Box>
                        <Box sx={{ pl: 5, pt: 0.5 }}>
                            <Typography variant="body2" sx={{ fontWeight: 600 }}>Store messages</Typography>
                            <Typography variant="caption" sx={{ color: "text.secondary" }}>Inbox retention: how long a captured message is kept, and the max kept.</Typography>
                        </Box>
                        {numberControl( true, config.ttlSeconds, 60, 604800, 60, "TTL seconds", ( value ) => replace( "ttlSeconds", value ) )}
                        {numberControl( true, config.maxMessages, 10, 100000, 10, "max messages", ( value ) => replace( "maxMessages", value ) )}
                    </Box>
                    <Box>
                        {knobHead( "Webhooks", "Post delivery/bounce/complaint callbacks to the URL below (dispatch not wired yet).", config.webhookEnabled, ( on ) => replace( "webhookEnabled", on ) )}
                        <Box sx={{ pl: 5, pr: 1, pb: 1, opacity: config.webhookEnabled ? 1 : 0.45 }}>
                            <TextField size="small" fullWidth disabled={!config.webhookEnabled} value={config.webhookUrl}
                                       onChange={( event ) => replace( "webhookUrl", event.target.value )} sx={{ maxWidth: 480, "& input": { fontFamily: MONO, fontSize: 12 } }} />
                        </Box>
                    </Box>
                </Box>
            )}
        </Box>
    );
}

export default FakeConfigView;

import { GetBootstrap } from "@repo/api";
import { ConfigSection } from "../configEditor/ConfigSection";
import { RangeNumberField } from "../configEditor/RangeNumberField";

/** Client session UX timing — how long the client waits before it treats the session as idle, and how
 *  often it polls a session heartbeat. The AUTHORITATIVE idle policy is server-side (auth's `Tokens`
 *  section); this only drives the client's own UX countdown/polling. */
export function SessionSection( props : SessionSection.Props )
{
    /** Patch one field of the session config, preserving the rest. */
    function set( patch : Partial<GetBootstrap.SessionConfig> ) : void
    {
        props.onChange( { ...props.value, ...patch } );
    }

    return (
        <ConfigSection title="Session (client UX)" hint="Client-side idle/heartbeat timing — server-side idle policy lives in auth.">
            <RangeNumberField
                label="Idle timeout (sec)" value={props.value.idleTimeout} min={1} disabled={props.readOnly}
                onChange={( value : number ) : void => set( { idleTimeout: value } )}
            />
            <RangeNumberField
                label="Heartbeat interval (sec)" value={props.value.heartbeatInterval} min={1} disabled={props.readOnly}
                onChange={( value : number ) : void => set( { heartbeatInterval: value } )}
            />
        </ConfigSection>
    );
}

export namespace SessionSection
{
    export interface Props
    {
        value    : GetBootstrap.SessionConfig;
        onChange : ( value : GetBootstrap.SessionConfig ) => void;
        readOnly : boolean;
    }
}

export default SessionSection;

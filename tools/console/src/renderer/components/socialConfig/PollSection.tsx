import { SocialConfig } from "@repo/api";
import { ConfigSection } from "../configEditor/ConfigSection";
import { RangeNumberField } from "../configEditor/RangeNumberField";

/** Poll cadence for pull-only platforms (X / TikTok / LinkedIn) + the on-demand Refresh cooldown. */
export function PollSection( props : PollSection.Props )
{
    return (
        <ConfigSection title="Polling" hint="How often pull-only platforms are polled, and the on-demand Refresh button's cooldown.">
            <RangeNumberField
                label="Poll cadence (seconds)" value={props.poll.cadenceSeconds} min={60} disabled={props.readOnly}
                onChange={( value : number ) : void => props.onPollChange( { ...props.poll, cadenceSeconds: value } )}
            />
            <RangeNumberField
                label="Poll lookback window (seconds)" value={props.poll.windowSeconds} min={60} disabled={props.readOnly}
                onChange={( value : number ) : void => props.onPollChange( { ...props.poll, windowSeconds: value } )}
            />
            <RangeNumberField
                label="Refresh cooldown (seconds)" help="Minimum gap between on-demand Refresh presses." value={props.refresh.cooldownSeconds} min={0} disabled={props.readOnly}
                onChange={( value : number ) : void => props.onRefreshChange( { ...props.refresh, cooldownSeconds: value } )}
            />
        </ConfigSection>
    );
}

export namespace PollSection
{
    export interface Props
    {
        poll           : SocialConfig.Poll;
        refresh        : SocialConfig.Refresh;
        onPollChange    : ( value : SocialConfig.Poll ) => void;
        onRefreshChange : ( value : SocialConfig.Refresh ) => void;
        readOnly       : boolean;
    }
}

export default PollSection;

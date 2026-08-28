import { SocialAccount } from "@repo/api";
import { ConfigSection } from "../configEditor/ConfigSection";
import { RangeNumberField } from "../configEditor/RangeNumberField";

/** Per-network connected-profile quota — how many destinations an account may connect on each
 *  platform, enforced by `POST /social/connections` (409 over the limit). One field per platform in
 *  the closed `SocialAccount.Platform` enum, so a new platform gets a row here automatically. */
export function QuotaSection( props : QuotaSection.Props )
{
    /** Patch one platform's quota, preserving the rest. */
    function set( platform : SocialAccount.Platform, value : number ) : void
    {
        props.onChange( { ...props.value, [ platform ]: value } );
    }

    return (
        <ConfigSection title="Connected-profile quota" hint="Max connected destinations per network, per account.">
            {Object.values( SocialAccount.Platform ).map( ( platform : SocialAccount.Platform ) => (
                <RangeNumberField
                    key={platform} label={platform} value={props.value[ platform ] ?? 0} min={0} disabled={props.readOnly}
                    onChange={( value : number ) : void => set( platform, value )}
                />
            ) )}
        </ConfigSection>
    );
}

export namespace QuotaSection
{
    export interface Props
    {
        value    : Partial<Record<SocialAccount.Platform, number>>;
        onChange : ( value : Partial<Record<SocialAccount.Platform, number>> ) => void;
        readOnly : boolean;
    }
}

export default QuotaSection;

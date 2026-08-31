import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import TextField from "@mui/material/TextField";
import Switch from "@mui/material/Switch";
import { Registration, Billing } from "@repo/api";
import { ConfigSection } from "../configEditor/ConfigSection";
import { RangeNumberField } from "../configEditor/RangeNumberField";

//
// FeeTablesSection — the use-case monthly fee table, the EVP vetting-fee table, and the generic vetting-fee
// fallback (registration-2.0 / registration-11.3). Every `Billing.Rate` is stored in MILLI-CENTS (thousandths
// of a cent — see @repo/api's `Type.MilliCents` + Billing.ts); this section round-trips dollars for display
// only, converting at the edges so the underlying config always stays in milli-cents.
//

/** Milli-cents per whole dollar — derived from RegistrationConfig.DEFAULT's own worked examples (e.g.
 *  `amountMilliCents: 1_000_000` documented as "$10.00", i.e. 100,000 milli-cents per dollar). */
const MILLI_CENTS_PER_DOLLAR : number = 100_000;

/** A `Billing.Rate.amountMilliCents` value, rendered as dollars for the editor. */
function milliCentsToDollars( milliCents : number ) : number
{
    return milliCents / MILLI_CENTS_PER_DOLLAR;
}

/** A dollar amount typed into the editor, converted back to `Billing.Rate.amountMilliCents`. */
function dollarsToMilliCents( dollars : number ) : number
{
    return Math.round( dollars * MILLI_CENTS_PER_DOLLAR );
}

/** A single optional-fee row for one enum key (use case or vetting provider) — a toggle to enable/disable the
 *  override, and (when enabled) a dollar amount. Disabling removes the key from the partial record entirely
 *  (falling back to `defaultVettingFee` or "no fee" at read time, per the entity's own semantics). */
function FeeRow( props : FeeRow.Props )
{
    const enabled : boolean = props.rate !== undefined;

    /** Toggle this row's override on/off — turning it on seeds a $0.00 USD rate to edit from. */
    function onToggle( checked : boolean ) : void
    {
        props.onChange( checked ? { amountMilliCents: 0, currency: "USD" } : undefined );
    }

    /** Update the dollar amount, preserving the row's currency. */
    function onAmountChange( dollars : number ) : void
    {
        props.onChange( { amountMilliCents: dollarsToMilliCents( dollars ), currency: props.rate?.currency ?? "USD" } );
    }

    return (
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 2, flexWrap: "wrap" }}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                <Switch size="small" checked={enabled} disabled={props.readOnly} onChange={( event : React.ChangeEvent<HTMLInputElement> ) : void => onToggle( event.target.checked )} />
                <Typography variant="body2">{props.label}</Typography>
            </Box>
            {enabled && (
                <TextField
                    size="small" type="number" label="USD" value={milliCentsToDollars( props.rate!.amountMilliCents )}
                    disabled={props.readOnly}
                    slotProps={{ htmlInput: { min: 0, step: 0.01 } }}
                    onChange={( event : React.ChangeEvent<HTMLInputElement> ) : void => onAmountChange( Number( event.target.value ) )}
                    sx={{ width: 130 }}
                />
            )}
        </Box>
    );
}

namespace FeeRow
{
    export interface Props
    {
        label    : string;
        rate     : Billing.Rate | undefined;
        onChange : ( rate : Billing.Rate | undefined ) => void;
        readOnly : boolean;
    }
}

/** The use-case monthly fee table, the per-EVP vetting fee table, and the generic vetting-fee fallback. */
export function FeeTablesSection( props : FeeTablesSection.Props )
{
    /** Patch one use case's monthly fee (or clear it), preserving the rest of the table. */
    function onUseCaseFeeChange( useCase : Registration.UseCase, rate : Billing.Rate | undefined ) : void
    {
        const next : Partial<Record<Registration.UseCase, Billing.Rate>> = { ...props.useCaseMonthlyFee };
        if ( rate ) next[ useCase ] = rate; else delete next[ useCase ];
        props.onChangeUseCaseMonthlyFee( next );
    }

    /** Patch one vetting provider's fee (or clear it), preserving the rest of the table. */
    function onVettingFeeChange( provider : Registration.VettingProvider, rate : Billing.Rate | undefined ) : void
    {
        const next : Partial<Record<Registration.VettingProvider, Billing.Rate>> = { ...props.vettingFee };
        if ( rate ) next[ provider ] = rate; else delete next[ provider ];
        props.onChangeVettingFee( next );
    }

    return (
        <>
            <ConfigSection title="Use-case monthly fees" hint="Per-use-case monthly campaign fee (registration-2.0). A use case with no override here has no monthly fee.">
                {Object.values( Registration.UseCase ).map( ( useCase : Registration.UseCase ) => (
                    <FeeRow
                        key={useCase} label={useCase} rate={props.useCaseMonthlyFee[ useCase ]} readOnly={props.readOnly}
                        onChange={( rate : Billing.Rate | undefined ) : void => onUseCaseFeeChange( useCase, rate )}
                    />
                ) )}
            </ConfigSection>
            <ConfigSection title="Vetting fees" hint="Per-EVP (external vetting provider) fee override (registration-11.3). A provider with no override here falls back to the default vetting fee below.">
                {Object.values( Registration.VettingProvider ).map( ( provider : Registration.VettingProvider ) => (
                    <FeeRow
                        key={provider} label={provider} rate={props.vettingFee[ provider ]} readOnly={props.readOnly}
                        onChange={( rate : Billing.Rate | undefined ) : void => onVettingFeeChange( provider, rate )}
                    />
                ) )}
                <RangeNumberField
                    label="Default vetting fee (USD)" help="Fallback when a specific EVP+class price isn't configured above."
                    value={milliCentsToDollars( props.defaultVettingFee.amountMilliCents )} min={0} step={0.01} disabled={props.readOnly}
                    onChange={( dollars : number ) : void => props.onChangeDefaultVettingFee( { amountMilliCents: dollarsToMilliCents( dollars ), currency: props.defaultVettingFee.currency } )}
                />
            </ConfigSection>
        </>
    );
}

export namespace FeeTablesSection
{
    export interface Props
    {
        useCaseMonthlyFee         : Partial<Record<Registration.UseCase, Billing.Rate>>;
        vettingFee                : Partial<Record<Registration.VettingProvider, Billing.Rate>>;
        defaultVettingFee         : Billing.Rate;
        onChangeUseCaseMonthlyFee : ( value : Partial<Record<Registration.UseCase, Billing.Rate>> ) => void;
        onChangeVettingFee        : ( value : Partial<Record<Registration.VettingProvider, Billing.Rate>> ) => void;
        onChangeDefaultVettingFee : ( value : Billing.Rate ) => void;
        readOnly                  : boolean;
    }
}

export default FeeTablesSection;

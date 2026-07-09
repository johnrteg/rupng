//
import type { Type } from "../Types";

//
// CurrencyUtils — integer-minor-unit money math + conversions. Two precisions (see `Type.Cents` / `Type.MilliCents`):
//   • Cents      — whole cents (1/100 unit): balances, budgets, caps, settled amounts.
//   • MilliCents — thousandths of a cent (1/100000 unit): FRACTIONAL-cent per-unit rates (e.g. 2.5¢/SMS = 2500).
//
// Do money math in integer minor units, not floats/dollars. Convert dollars↔minor at the edges (parse/display),
// and MilliCents→Cents only when SETTLING a total, with an explicit rounding mode. 1 cent = 1000 milliCents.
//
export default class CurrencyUtils
{
    /** milliCents per cent (1 cent = 1000 milliCents). */
    public static readonly MILLICENTS_PER_CENT : number = 1000;
    /** cents per whole currency unit (1 dollar = 100 cents). */
    public static readonly CENTS_PER_UNIT : number = 100;
    /** milliCents per whole currency unit (1 dollar = 100000 milliCents). */
    public static readonly MILLICENTS_PER_UNIT : number = 100000;

    /////////////////////////////////////////////////////////////////////////////////
    // Dollars (major units) ⇄ Cents. Parse rounds to the nearest whole cent; format returns major units for
    // display via `appmodel.ui.locale.currency(...)` (never build the currency string here).

    /** Major units → whole cents (rounded). 12.34 → 1234. */
    public static dollarsToCents( dollars : number ) : Type.Cents
    {
        return Math.round( dollars * CurrencyUtils.CENTS_PER_UNIT );
    }

    /** Whole cents → major units (exact; may be fractional). 1234 → 12.34. */
    public static centsToDollars( cents : Type.Cents ) : number
    {
        return cents / CurrencyUtils.CENTS_PER_UNIT;
    }

    /////////////////////////////////////////////////////////////////////////////////
    // Dollars (major units) ⇄ MilliCents. For fractional-cent rates. 0.025 → 2500; 2500 → 0.025.

    /** Major units → milliCents (rounded). 0.025 → 2500. */
    public static dollarsToMilliCents( dollars : number ) : Type.MilliCents
    {
        return Math.round( dollars * CurrencyUtils.MILLICENTS_PER_UNIT );
    }

    /** MilliCents → major units (exact; may be fractional). 2500 → 0.025. */
    public static milliCentsToDollars( milliCents : Type.MilliCents ) : number
    {
        return milliCents / CurrencyUtils.MILLICENTS_PER_UNIT;
    }

    /////////////////////////////////////////////////////////////////////////////////
    // Cents ⇄ MilliCents. Widen a settled amount to rate precision; narrow a rate/total back to cents (rounded).

    /** Whole cents → milliCents (exact widen). 25 → 25000. */
    public static centsToMilliCents( cents : Type.Cents ) : Type.MilliCents
    {
        return cents * CurrencyUtils.MILLICENTS_PER_CENT;
    }

    /** MilliCents → cents (rounded — use when SETTLING a total to a chargeable whole-cent amount). 2500 → 3. */
    public static milliCentsToCents( milliCents : Type.MilliCents ) : Type.Cents
    {
        return Math.round( milliCents / CurrencyUtils.MILLICENTS_PER_CENT );
    }

    /////////////////////////////////////////////////////////////////////////////////
    // Rate math — a per-unit rate (milliCents) × a quantity → a total. Kept in milliCents to preserve fractions;
    // settle to cents with `milliCentsToCents` at the charge boundary.

    /** rate (milliCents/unit) × quantity → total in milliCents (exact, integer). */
    public static rateTotalMilliCents( rateMilliCents : Type.MilliCents, quantity : number ) : Type.MilliCents
    {
        return rateMilliCents * quantity;
    }

    /** rate (milliCents/unit) × quantity → total in whole cents (rounded — the chargeable amount). */
    public static rateTotalCents( rateMilliCents : Type.MilliCents, quantity : number ) : Type.Cents
    {
        return CurrencyUtils.milliCentsToCents( rateMilliCents * quantity );
    }
}

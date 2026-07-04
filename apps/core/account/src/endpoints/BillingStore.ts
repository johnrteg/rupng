//
import { Billing } from '@repo/api';
import { ObjectUtils, type Type } from '@repo/common';

//
// Where the account/billing surface persists (until Stripe + a dedicated ledger exist). The balance and
// settings live as a `billing` attribute on the account row; payment methods / payments / invoices come
// from Stripe at read time (empty for now). Defaults keep the UI functional on a brand-new account.
//
export namespace BillingStore
{
    const DEFAULT_CURRENCY : Type.Currency = "USD" as Type.Currency;

    ///////////////////////////////////////////////////////////////////////////////////////////
    /** A zeroed money value in the default currency (fresh copy each call — never share the object). */
    export function zero() : Billing.Money { return { amountMinor: 0, currency: DEFAULT_CURRENCY }; }

    /** The persisted billing state (subset of the overview that we actually own before Stripe). */
    export interface State
    {
        balance         : Billing.AccountBalance;
        settings        : Billing.BillingSettings;
        billingAddress? : Type.Address;
    }

    /** The extra attribute carried on the `accounts` row. */
    export interface Row { billing? : Partial<State>; }

    /** Read-time DEFAULT for the persisted billing state — the complete baseline a brand-new / partial blob
     *  fills up to. `billingAddress` is intentionally omitted (absent = "use the account address"). */
    export const DEFAULT : State =
    {
        balance:  { balance: { amountMinor: 0, currency: DEFAULT_CURRENCY }, updatedAt: new Date( 0 ).toISOString() },
        settings: { billingType: Billing.BillingType.CARD, autoReload: { enabled: false, threshold: zero(), amount: zero() }, billingAddressSameAsAccount: true },
    };

    ///////////////////////////////////////////////////////////////////////////////////////////
    /** Fill a (possibly partial / absent) stored blob with defaults so callers get a complete shape —
     *  deep-merges via the shared `ObjectUtils.withDefaults` (fills only missing fields; keeps present ones). */
    export function hydrate( stored? : Partial<State> ) : State
    {
        return ObjectUtils.withDefaults( ( stored ?? {} ) as State, DEFAULT );
    }
}

export default BillingStore;

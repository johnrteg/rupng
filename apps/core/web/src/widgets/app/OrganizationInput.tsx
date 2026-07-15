//
import { JSX } from "react";

import { Box } from "@mui/material";

import { Account } from "@repo/api";

import TextInput   from "@widgets/core/TextInput";
import SelectInput from "@widgets/core/SelectInput";

//
// OrganizationInput — an account's organization TYPE + its CLASSIFICATION (sub-type), with the mapping
// between them owned HERE (the single source of truth). Pick a type → the classification choices update to
// the valid set for that type (e.g. Nonprofit → 501(c)(3) / 501(c)(4) / …; Business → LLC / S Corp / …).
// Types with no predefined classifications (Individual, Other) fall back to a free-text classification.
// Emits the whole Account.Organization on any change; changing the type resets the sub-type.
//
export function OrganizationInput( props : OrganizationInput.Props ) : JSX.Element
{
    const type    : Account.OrganizationType = props.value.type;
    const subType : string = props.value.subType ?? "";

    const typeChoices : Array<SelectInput.Choice> = SelectInput.enumToChoices( Account.OrganizationType );
    const predefined  : Array<string> = OrganizationInput.CLASSIFICATIONS[ type ] ?? [];

    ////////////////////////////////////////////////////////////////////////////////////////////
    // change the type → reset the sub-type (the old classification isn't valid for the new type)
    function onType( next : string ) : void
    {
        props.onChange( { type: next as Account.OrganizationType, subType: undefined } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    function onSubType( next : string ) : void
    {
        props.onChange( { type, subType: next || undefined } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // classification choices for the current type: a blank "(none)" + the predefined set, plus the current
    // value if it isn't in the set (so legacy / custom classifications aren't silently dropped).
    function subTypeChoices() : Array<SelectInput.Choice>
    {
        const values : Array<string> = [ ...predefined ];
        if( subType !== "" && !values.includes( subType ) ) values.push( subType );
        return [ { value: "", label: "(none)" }, ...values.map( ( value : string ) => ( { value, label: value } ) ) ];
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // two-column responsive grid (stacks on narrow content)
    function grid( children : JSX.Element ) : JSX.Element
    {
        return <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" }, gap: 2 }}>{ children }</Box>;
    }

    return grid( <>
        <SelectInput id={ `${ props.id }-type` } label={"Organization type"} value={ type } choices={ typeChoices } disabled={ props.disabled } onChange={ onType } sx={{ width: "100%" }} />
        { predefined.length > 0
            ? <SelectInput id={ `${ props.id }-classification` } label={"Classification"} value={ subType } choices={ subTypeChoices() } disabled={ props.disabled } onChange={ onSubType } sx={{ width: "100%" }} />
            : <TextInput   id={ `${ props.id }-classification` } label={"Classification"} placeHolder={"e.g. LLC, PAC"} value={ subType } disabled={ props.disabled } onChange={ onSubType } fullWidth />
        }
    </> );
}

export namespace OrganizationInput
{
    // type → valid classifications (sub-types). The ONE place this mapping lives. Values are the stored
    // sub-type strings (label === value). An empty list ⇒ free-text classification (Individual / Other).
    export const CLASSIFICATIONS : Record<Account.OrganizationType, Array<string>> =
    {
        [ Account.OrganizationType.BUSINESS ]:   [ "LLC", "C Corporation", "S Corporation", "Sole Proprietorship", "Partnership", "Cooperative", "Franchise" ],
        [ Account.OrganizationType.NONPROFIT ]:  [ "501(c)(3)", "501(c)(4)", "501(c)(5)", "501(c)(6)", "501(c)(7)", "501(c)(19)", "527" ],
        [ Account.OrganizationType.GOVERNMENT ]: [ "Federal", "State", "County", "Municipal", "Tribal", "Special District" ],
        [ Account.OrganizationType.POLITICAL ]:  [ "Candidate Committee", "PAC", "Super PAC", "Party Committee", "527 Organization", "Ballot Measure Committee" ],
        [ Account.OrganizationType.EDUCATION ]:  [ "Public School", "Private School", "Charter School", "School District", "Higher Education" ],
        [ Account.OrganizationType.INDIVIDUAL ]: [],
        [ Account.OrganizationType.OTHER ]:      [],
    };

    export interface Props
    {
        id        : string;
        value     : Account.Organization;
        disabled? : boolean;
        onChange  : ( organization : Account.Organization ) => void;
    }
}

export default OrganizationInput;

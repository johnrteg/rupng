//
import React from "react";
import { JSX } from "react";
import { Box, Stack } from "@mui/material";
import CheckCircleRoundedIcon from "@mui/icons-material/CheckCircleRounded";
import RadioButtonUncheckedRoundedIcon from "@mui/icons-material/RadioButtonUncheckedRounded";

import { PasswordPolicy } from "@repo/api";

import TextLabel from "@widgets/core/TextLabel";

//
// PasswordChecklist — live "rule checklist" for a password field. Driven by the bootstrap password
// policy (the SAME PasswordPolicy.Rule the auth service enforces), so what the user sees here is exactly
// what the server requires. Each rule shows a check (met) or an open circle (not yet). Hardcoded strings
// (registration UI strings are not localized — by project rule).
//
export function PasswordChecklist( props : PasswordChecklist.Props ) : JSX.Element
{
    const items : Array<PasswordChecklist.Item> = PasswordChecklist.items( props.policy, props.password );

    return (
        <Stack direction="column" spacing={ 0.5 } sx={{ mt: 0.5 }}>
            { items.map( ( item : PasswordChecklist.Item, index : number ) => (
                <Box key={ index } sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
                    { item.ok
                        ? <CheckCircleRoundedIcon sx={{ fontSize: 16, color: "success.main" }} />
                        : <RadioButtonUncheckedRoundedIcon sx={{ fontSize: 16, color: "text.disabled" }} /> }
                    <TextLabel variant="caption"
                               color={ item.ok ? "success" : "secondary" }
                               value={ item.label } />
                </Box>
            ) ) }
        </Stack>
    );
}

export namespace PasswordChecklist
{
    export interface Props
    {
        policy   : PasswordPolicy.Rule;   // the active bootstrap policy
        password : string;                // the current password input
    }

    export interface Item
    {
        label : string;
        ok    : boolean;
    }

    /** Turn a policy + the current password into the checklist items (only the rules the policy requires). */
    export function items( policy : PasswordPolicy.Rule, password : string ) : Array<PasswordChecklist.Item>
    {
        const list : Array<PasswordChecklist.Item> = [];
        list.push( { label: `At least ${ policy.minLength } characters`, ok: password.length >= policy.minLength } );
        if( policy.requireUpper )  list.push( { label: "An uppercase letter (A–Z)", ok: /[A-Z]/.test( password ) } );
        if( policy.requireLower )  list.push( { label: "A lowercase letter (a–z)", ok: /[a-z]/.test( password ) } );
        if( policy.requireNumber ) list.push( { label: "A number (0–9)",           ok: /[0-9]/.test( password ) } );
        if( policy.requireSymbol ) list.push( { label: "A symbol (!@#$…)",          ok: /[^A-Za-z0-9]/.test( password ) } );
        return list;
    }

    /** Whether the password satisfies EVERY required rule (the gate for advancing the step). */
    export function satisfies( policy : PasswordPolicy.Rule, password : string ) : boolean
    {
        return PasswordChecklist.items( policy, password ).every( ( item : PasswordChecklist.Item ) => item.ok );
    }
}

export default PasswordChecklist;

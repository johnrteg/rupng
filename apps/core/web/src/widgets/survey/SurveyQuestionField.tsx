//
import React from 'react';
import { JSX } from "react";

import { Stack, Typography, ToggleButton, ToggleButtonGroup, Rating, RadioGroup, FormControlLabel, Radio, Checkbox } from '@mui/material';
import ArrowUpwardOutlinedIcon   from '@mui/icons-material/ArrowUpwardOutlined';
import ArrowDownwardOutlinedIcon from '@mui/icons-material/ArrowDownwardOutlined';

import { Question } from '@repo/api';

import TextInput from '@widgets/core/TextInput';
import ButtonIcon from '@widgets/core/ButtonIcon';

//
// SurveyQuestionField — renders ONE question's answer widget, dispatching on `question.type` (survey-1.2).
// Every question type lands on a value shape `PostSurveyForm` accepts as-is: a number for
// nps/csat/ces/rating/scale, a choice id (or array of ids) for select/ranking, a boolean for yes_no, sanitized
// text for open_text. Kept as a single dispatcher component (not ten tiny files) — each branch is a small,
// stateless render, not its own stateful component, so this doesn't fight the "one component per file" rule.
//
export function SurveyQuestionField( props : SurveyQuestionField.Props ) : JSX.Element
{
    const question : Question.Entity = props.question;

    ////////////////////////////////////////////////////////////////////////////////////////////
    // NPS (0-10) / CES (1-7) / scale (1..n) — a row of toggle buttons, one per value.
    function renderScale( min : number, max : number ) : JSX.Element
    {
        const values : Array<number> = Array.from( { length: max - min + 1 }, ( _unused : unknown, index : number ) : number => min + index );
        return <ToggleButtonGroup exclusive size="small" value={ props.value ?? null } onChange={ onScaleChange }>
            { values.map( ( value : number ) : JSX.Element => <ToggleButton key={ value } value={ value }>{ value }</ToggleButton> ) }
        </ToggleButtonGroup>;
    }
    function onScaleChange( _event : React.MouseEvent<HTMLElement>, value : number | null ) : void { if( value !== null ) props.onAnswer( value ); }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // CSAT (1-5) / rating — a star widget.
    function renderRating( max : number ) : JSX.Element
    {
        return <Rating max={ max } value={ typeof props.value === "number" ? props.value : 0 } onChange={ onRatingChange } />;
    }
    function onRatingChange( _event : React.SyntheticEvent, value : number | null ) : void { if( value !== null ) props.onAnswer( value ); }

    ////////////////////////////////////////////////////////////////////////////////////////////
    function renderSingleSelect() : JSX.Element
    {
        return <RadioGroup value={ props.value ?? "" } onChange={ onSingleSelectChange }>
            { ( question.config?.choices ?? [] ).map( ( choice : Question.Choice ) : JSX.Element =>
                <FormControlLabel key={ choice.id } value={ choice.id } control={ <Radio /> } label={ choice.label } /> ) }
        </RadioGroup>;
    }
    function onSingleSelectChange( event : React.ChangeEvent<HTMLInputElement> ) : void { props.onAnswer( event.target.value ); }

    ////////////////////////////////////////////////////////////////////////////////////////////
    function renderMultiSelect() : JSX.Element
    {
        const selected : Array<string> = Array.isArray( props.value ) ? props.value as Array<string> : [];
        return <Stack>
            { ( question.config?.choices ?? [] ).map( ( choice : Question.Choice ) : JSX.Element =>
                <FormControlLabel key={ choice.id }
                    control={ <Checkbox checked={ selected.includes( choice.id ) } onChange={ () => onMultiSelectToggle( choice.id, selected ) } /> }
                    label={ choice.label } /> ) }
        </Stack>;
    }
    function onMultiSelectToggle( choiceId : string, selected : Array<string> ) : void
    {
        const next : Array<string> = selected.includes( choiceId ) ? selected.filter( ( id : string ) : boolean => id !== choiceId ) : [ ...selected, choiceId ];
        props.onAnswer( next );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // ranking — an ordered list of choice ids, reordered with up/down (no drag — simplest correct UI).
    function renderRanking() : JSX.Element
    {
        const order : Array<string> = Array.isArray( props.value ) && ( props.value as Array<string> ).length
            ? props.value as Array<string>
            : ( question.config?.choices ?? [] ).map( ( choice : Question.Choice ) : string => choice.id );
        return <Stack spacing={ 1 }>
            { order.map( ( choiceId : string, index : number ) : JSX.Element =>
            {
                const choice : Question.Choice | undefined = question.config?.choices?.find( ( entry : Question.Choice ) : boolean => entry.id === choiceId );
                return <Stack key={ choiceId } direction="row" spacing={ 1 } sx={{ alignItems: "center" }}>
                    <Typography variant="body2" sx={{ minWidth: 20 }}>{ index + 1 }</Typography>
                    <Typography variant="body2" sx={{ flex: 1 }}>{ choice?.label ?? choiceId }</Typography>
                    <ButtonIcon id={ `rank-up-${ choiceId }` } icon={ <ArrowUpwardOutlinedIcon fontSize="small" /> } label="Move up" disabled={ index === 0 } onClick={ () => onRankMove( order, index, -1 ) } />
                    <ButtonIcon id={ `rank-down-${ choiceId }` } icon={ <ArrowDownwardOutlinedIcon fontSize="small" /> } label="Move down" disabled={ index === order.length - 1 } onClick={ () => onRankMove( order, index, 1 ) } />
                </Stack>;
            } ) }
        </Stack>;
    }
    function onRankMove( order : Array<string>, index : number, delta : number ) : void
    {
        const next : Array<string> = [ ...order ];
        const [ moved ] = next.splice( index, 1 );
        next.splice( index + delta, 0, moved );
        props.onAnswer( next );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    function renderYesNo() : JSX.Element
    {
        return <ToggleButtonGroup exclusive size="small" value={ props.value ?? null } onChange={ onYesNoChange }>
            <ToggleButton value="yes">{"Yes"}</ToggleButton>
            <ToggleButton value="no">{"No"}</ToggleButton>
        </ToggleButtonGroup>;
    }
    function onYesNoChange( _event : React.MouseEvent<HTMLElement>, value : string | null ) : void { if( value !== null ) props.onAnswer( value ); }

    ////////////////////////////////////////////////////////////////////////////////////////////
    function renderOpenText() : JSX.Element
    {
        return <TextInput id={ `question-${ question.id }` } label={ question.config?.placeholder ?? "Your answer" } value={ typeof props.value === "string" ? props.value : "" } multiline maxRows={ 3 } onChange={ props.onAnswer } />;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    function field() : JSX.Element
    {
        switch( question.type )
        {
            case Question.Type_.NPS:           return renderScale( 0, question.config?.scaleMax ?? 10 );
            case Question.Type_.CES:           return renderScale( 1, question.config?.scaleMax ?? 7 );
            case Question.Type_.SCALE:         return renderScale( 1, question.config?.scaleMax ?? 10 );
            case Question.Type_.CSAT:          return renderRating( question.config?.ratingMax ?? 5 );
            case Question.Type_.RATING:        return renderRating( question.config?.ratingMax ?? 5 );
            case Question.Type_.SINGLE_SELECT: return renderSingleSelect();
            case Question.Type_.MULTI_SELECT:  return renderMultiSelect();
            case Question.Type_.RANKING:       return renderRanking();
            case Question.Type_.YES_NO:        return renderYesNo();
            case Question.Type_.OPEN_TEXT:     return renderOpenText();
            default:                           return <Typography variant="body2" color="error">{"Unsupported question type"}</Typography>;
        }
    }

    // ===============================================================================================
    return <Stack spacing={ 1 }>
        <Typography variant="body1">{ question.prompt }{ question.required && " *" }</Typography>
        { field() }
    </Stack>;
}

export namespace SurveyQuestionField
{
    export interface Props
    {
        question : Question.Entity;
        value    : unknown;
        onAnswer : ( value : unknown ) => void;
    }
}

export default SurveyQuestionField;
// eof

import AppModel from "@model/AppModel";
//
import React from 'react';
import { JSX } from "react";

import { Box, Button, CircularProgress, LinearProgress, Paper, Stack, Typography } from "@mui/material";
import CheckCircleOutlinedIcon   from '@mui/icons-material/CheckCircleOutlined';
import ReportProblemOutlinedIcon from '@mui/icons-material/ReportProblemOutlined';

import { GetSurveyForm, PostSurveyForm, Question, SurveyResponse } from '@repo/api';
import { RestfulService } from '@repo/endpoint';

import SurveyQuestionField from '@widgets/survey/SurveyQuestionField';

//
// SurveyFormLanding — the PUBLIC no-auth hosted-form page (survey-2.2/9.3), the email/web runner's
// rendering surface. Opened from a survey invite link (`/s/:token`), mirrors ActionLanding's shape: fetch by
// token → render → submit → thank-you state. Renders ONE question at a time (a conversational feel that
// matches the SMS runner) and submits as soon as it's answered; `PostSurveyForm` tells us the next unanswered
// question (or completion) so this component never needs its own branching logic — the server owns that.
//
export function SurveyFormLanding( props : SurveyFormLanding.Props ) : JSX.Element
{
    const appmodel : AppModel = AppModel.instance();

    const [loading,setLoading]   = React.useState< boolean >( true );
    const [error,setError]       = React.useState< string >( "" );
    const [completed,setCompleted] = React.useState< boolean >( false );
    const [surveyName,setSurveyName] = React.useState< string >( "" );
    const [questions,setQuestions]   = React.useState< Array<Question.Entity> >( [] );
    const [answeredCount,setAnsweredCount] = React.useState< number >( 0 );
    const [totalCount,setTotalCount]       = React.useState< number >( 0 );
    const [answer,setAnswer]     = React.useState< unknown >( undefined );
    const [busy,setBusy]         = React.useState< boolean >( false );

    const current : Question.Entity | undefined = questions[ 0 ];

    ////////////////////////////////////////////////////////////////////////////////////////////
    React.useEffect( componentLoaded, [] );

    // on mount: fetch the form's current (unanswered) question set
    function componentLoaded() : void
    {
        void load();
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    async function load() : Promise<void>
    {
        setLoading( true );
        const reply : RestfulService.Reply<GetSurveyForm.Response> = await appmodel.server.fetch( new GetSurveyForm( props.token ) );
        if( reply.ok && reply.data )
        {
            setSurveyName( reply.data.surveyName );
            setQuestions( reply.data.questions );
            setAnsweredCount( reply.data.answeredCount );
            setTotalCount( reply.data.totalCount );
            setCompleted( reply.data.completed );
            setAnswer( undefined );
        }
        else setError( "This survey link is invalid or has expired." );
        setLoading( false );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // submit the current question's answer, then advance to whatever the server says is next
    async function onSubmitAnswer() : Promise<void>
    {
        if( !current || answer === undefined ) return;
        setBusy( true );
        const isLast : boolean = questions.length === 1;
        const reply : RestfulService.Reply<PostSurveyForm.Response> = await appmodel.server.fetch(
            new PostSurveyForm( props.token, { answers: [ { questionId: current.id, value: answer } ], captchaToken: "dev", complete: isLast } ) );
        if( reply.ok && reply.data )
        {
            if( reply.data.status === SurveyResponse.Status.COMPLETED ) setCompleted( true );
            setAnsweredCount( ( count : number ) : number => count + 1 );
            setQuestions( ( list : Array<Question.Entity> ) : Array<Question.Entity> => list.slice( 1 ) );
            setAnswer( undefined );
        }
        else setError( "This survey link has expired or was already used." );
        setBusy( false );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    function body() : JSX.Element
    {
        if( loading ) return <Stack direction="row" spacing={ 1 } sx={{ alignItems: "center", justifyContent: "center" }}><CircularProgress size={ 20 } /><Typography variant="body2" sx={{ color: "text.secondary" }}>{"Loading survey…"}</Typography></Stack>;
        if( error !== "" ) return <Stack spacing={ 2 } sx={{ alignItems: "center" }}><ReportProblemOutlinedIcon color="error" sx={{ fontSize: 44 }} /><Typography variant="body1" sx={{ textAlign: "center" }}>{ error }</Typography></Stack>;
        if( completed || !current ) return <Stack spacing={ 2 } sx={{ alignItems: "center" }}><CheckCircleOutlinedIcon color="success" sx={{ fontSize: 44 }} /><Typography variant="h6">{"Thank you!"}</Typography><Typography variant="body2" sx={{ color: "text.secondary", textAlign: "center" }}>{"Your response has been recorded."}</Typography></Stack>;
        return <Stack spacing={ 2 }>
            <Typography variant="h6" sx={{ textAlign: "center" }}>{ surveyName }</Typography>
            <LinearProgress variant="determinate" value={ totalCount > 0 ? ( answeredCount / totalCount ) * 100 : 0 } />
            <SurveyQuestionField question={ current } value={ answer } onAnswer={ setAnswer } />
            <Button variant="contained" fullWidth disabled={ busy || answer === undefined } onClick={ () => void onSubmitAnswer() }>{ busy ? "Submitting…" : "Next" }</Button>
        </Stack>;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    return <Box sx={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", bgcolor: "background.default", p: 2 }}>
        <Paper variant="outlined" sx={{ width: "100%", maxWidth: 480, p: 4 }}>
            { body() }
        </Paper>
    </Box>;
}

export namespace SurveyFormLanding
{
    export interface Props { token : string; }
}

export default SurveyFormLanding;
// eof

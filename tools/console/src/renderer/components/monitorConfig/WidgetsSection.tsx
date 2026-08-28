import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Typography from "@mui/material/Typography";
import AddIcon from "@mui/icons-material/Add";
import { MonitorConfig } from "@repo/api";
import { ConfigSection } from "../configEditor/ConfigSection";
import { WidgetRow } from "./WidgetRow";
import { MonitorConfigFormModel } from "./MonitorConfigFormModel";

//
// WidgetsSection — the repeating-row editor for MonitorConfig.Config's `widgets` array: one
// WidgetRow per configured dashboard widget, plus an "Add widget" row.
//

/** The dashboard widget list — add/edit/remove rows. */
export function WidgetsSection( props : WidgetsSection.Props )
{
    /** Replace one widget by index, preserving the rest of the array. */
    function updateAt( index : number, widget : MonitorConfig.WidgetConfig ) : void
    {
        props.onChange( props.value.map( ( existing : MonitorConfig.WidgetConfig, position : number ) : MonitorConfig.WidgetConfig => position === index ? widget : existing ) );
    }

    /** Drop one widget by index. */
    function removeAt( index : number ) : void
    {
        props.onChange( props.value.filter( ( _widget : MonitorConfig.WidgetConfig, position : number ) : boolean => position !== index ) );
    }

    /** Append a fresh blank widget row. */
    function addWidget() : void
    {
        props.onChange( [ ...props.value, MonitorConfigFormModel.blankWidget() ] );
    }

    return (
        <ConfigSection title="Dashboard widgets" hint="Each widget polls one physical AWS resource — DB table, SQS queue, ECS service, Lambda job, or an ALB target group.">
            <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
                {props.value.length === 0 && <Typography variant="caption" sx={{ color: "text.disabled" }}>No widgets configured yet.</Typography>}
                {props.value.map( ( widget : MonitorConfig.WidgetConfig, index : number ) => (
                    <WidgetRow
                        key={widget.id} value={widget} readOnly={props.readOnly}
                        onChange={( updated : MonitorConfig.WidgetConfig ) : void => updateAt( index, updated )}
                        onRemove={() : void => removeAt( index )}
                    />
                ) )}
                <Button size="small" startIcon={<AddIcon />} disabled={props.readOnly} onClick={addWidget} sx={{ alignSelf: "flex-start" }}>
                    Add widget
                </Button>
            </Box>
        </ConfigSection>
    );
}

export namespace WidgetsSection
{
    export interface Props
    {
        value    : Array<MonitorConfig.WidgetConfig>;
        onChange : ( value : Array<MonitorConfig.WidgetConfig> ) => void;
        readOnly : boolean;
    }
}

export default WidgetsSection;

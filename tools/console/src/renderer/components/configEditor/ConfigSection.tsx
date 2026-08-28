import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";

//
// ConfigSection — a titled, bordered card grouping one MediaConfig.Config section's fields. Every smart
// section (Upload, Scan, Lifecycle, …) renders inside one of these so the layout stays consistent without
// each section re-declaring the same border/spacing.
//

/** A bordered card with a title + optional hint caption, wrapping a section's fields in a vertical stack. */
export function ConfigSection( props : ConfigSection.Props )
{
    return (
        <Box sx={{ border: "1px solid", borderColor: "divider", borderRadius: 1, p: 1.5, mb: 1.5 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 0.25 }}>{props.title}</Typography>
            {props.hint && <Typography variant="caption" sx={{ color: "text.disabled", display: "block", mb: 1 }}>{props.hint}</Typography>}
            <Box sx={{ display: "flex", flexDirection: "column", gap: 1.25 }}>
                {props.children}
            </Box>
        </Box>
    );
}

export namespace ConfigSection
{
    export interface Props
    {
        title    : string;
        hint?    : string;
        children : React.ReactNode;
    }
}

export default ConfigSection;

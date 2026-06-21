import type { SvgIconComponent } from "@mui/icons-material";
import Hub from "@mui/icons-material/Hub";
import VpnKey from "@mui/icons-material/VpnKey";
import AccountCircle from "@mui/icons-material/AccountCircle";
import HowToReg from "@mui/icons-material/HowToReg";
import Contacts from "@mui/icons-material/Contacts";
import Campaign from "@mui/icons-material/Campaign";
import AccountTree from "@mui/icons-material/AccountTree";
import Storefront from "@mui/icons-material/Storefront";
import Textsms from "@mui/icons-material/Textsms";
import Email from "@mui/icons-material/Email";
import Call from "@mui/icons-material/Call";
import Print from "@mui/icons-material/Print";
import Share from "@mui/icons-material/Share";
import Poll from "@mui/icons-material/Poll";
import PermMedia from "@mui/icons-material/PermMedia";
import Link from "@mui/icons-material/Link";
import Analytics from "@mui/icons-material/Analytics";
import Assessment from "@mui/icons-material/Assessment";
import MonitorHeart from "@mui/icons-material/MonitorHeart";
import Gavel from "@mui/icons-material/Gavel";
import Search from "@mui/icons-material/Search";
import Bolt from "@mui/icons-material/Bolt";
import Groups from "@mui/icons-material/Groups";
import Language from "@mui/icons-material/Language";
import Extension from "@mui/icons-material/Extension";

//
// Maps a catalog icon NAME to its MUI component. Unknown names fall back to a generic icon so a
// newly-discovered service still renders. (Icons live here, in the renderer, not in shared/catalog —
// shared stays free of MUI/React.)
//
const MAP : Record<string, SvgIconComponent> =
{
    Hub, VpnKey, AccountCircle, HowToReg, Contacts, Campaign, AccountTree, Storefront,
    Textsms, Email, Call, Print, Share, Poll, PermMedia, Link, Analytics, Assessment,
    MonitorHeart, Gavel, Search, Bolt, Groups, Language, Extension
};

export function serviceIcon( name : string ) : SvgIconComponent
{
    return MAP[ name ] ?? Extension;
}

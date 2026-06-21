import type { SvgIconComponent } from "@mui/icons-material";
import BoltIcon from "@mui/icons-material/Bolt";
import ViewInArIcon from "@mui/icons-material/ViewInAr";
import Inventory2Icon from "@mui/icons-material/Inventory2";
import TableChartIcon from "@mui/icons-material/TableChart";
import StorageIcon from "@mui/icons-material/Storage";
import MemoryIcon from "@mui/icons-material/Memory";
import QueueIcon from "@mui/icons-material/Queue";
import CampaignIcon from "@mui/icons-material/Campaign";
import HubIcon from "@mui/icons-material/Hub";
import ScheduleIcon from "@mui/icons-material/Schedule";
import AccountTreeIcon from "@mui/icons-material/AccountTree";
import ApiIcon from "@mui/icons-material/Api";
import PublicIcon from "@mui/icons-material/Public";
import LanIcon from "@mui/icons-material/Lan";
import PeopleIcon from "@mui/icons-material/People";
import KeyIcon from "@mui/icons-material/Key";
import LockIcon from "@mui/icons-material/Lock";
import ArticleIcon from "@mui/icons-material/Article";
import InsightsIcon from "@mui/icons-material/Insights";
import SecurityIcon from "@mui/icons-material/Security";
import SearchIcon from "@mui/icons-material/Search";
import ForumIcon from "@mui/icons-material/Forum";
import WebIcon from "@mui/icons-material/Web";
import SettingsIcon from "@mui/icons-material/Settings";
import CloudIcon from "@mui/icons-material/Cloud";
import EmailIcon from "@mui/icons-material/Email";
import MovieIcon from "@mui/icons-material/Movie";

import type { CloudCategory } from "../shared/types";

//
// AWS-aligned styling for architecture nodes: the official AWS service category COLORS plus a
// recognizable MUI glyph per service. (These are approximations using MUI icons — not the licensed
// AWS Architecture Icon SVG pack — chosen to read at a glance with the right color family.)
//

export interface AwsStyle { color : string; Icon : SvgIconComponent; }

// AWS category color families
const COMPUTE  = "#ED7100";   // orange   — compute / containers
const STORAGE  = "#7AA116";   // green    — storage
const DATABASE = "#2E27AD";   // deep blue — databases / caches
const NETWORK  = "#8C4FFF";   // purple   — networking & content delivery
const INTEG    = "#E7157B";   // magenta  — app integration / messaging
const SECURITY = "#DD344C";   // red      — security, identity & compliance
const MGMT     = "#C925D1";   // violet   — management & governance
const MOBILE   = "#D6242D";   // red      — front-end web & mobile

// keyed by the service token in a CloudFormation type ("AWS::<Service>::<Resource>")
const SVC : Record<string, AwsStyle> =
{
    Lambda          : { color: COMPUTE,  Icon: BoltIcon },
    ECS             : { color: COMPUTE,  Icon: ViewInArIcon },
    Batch           : { color: COMPUTE,  Icon: ViewInArIcon },
    S3              : { color: STORAGE,  Icon: Inventory2Icon },
    DynamoDB        : { color: DATABASE, Icon: TableChartIcon },
    RDS             : { color: DATABASE, Icon: StorageIcon },
    ElastiCache     : { color: DATABASE, Icon: MemoryIcon },
    SQS             : { color: INTEG,    Icon: QueueIcon },
    SNS             : { color: INTEG,    Icon: CampaignIcon },
    Events          : { color: INTEG,    Icon: HubIcon },        // EventBridge
    Scheduler       : { color: INTEG,    Icon: ScheduleIcon },
    StepFunctions   : { color: INTEG,    Icon: AccountTreeIcon },
    ApiGatewayV2    : { color: INTEG,    Icon: ApiIcon },
    ApiGateway      : { color: INTEG,    Icon: ApiIcon },
    CloudFront      : { color: NETWORK,  Icon: PublicIcon },
    EC2             : { color: NETWORK,  Icon: LanIcon },         // VPC/subnets/SGs (Fargate — no EC2 instances)
    ElasticLoadBalancingV2 : { color: NETWORK, Icon: LanIcon },
    Cognito         : { color: SECURITY, Icon: PeopleIcon },
    KMS             : { color: SECURITY, Icon: KeyIcon },
    SecretsManager  : { color: SECURITY, Icon: LockIcon },
    IAM             : { color: SECURITY, Icon: SecurityIcon },
    Logs            : { color: MGMT,     Icon: ArticleIcon },
    CloudWatch      : { color: MGMT,     Icon: InsightsIcon },
    SSM             : { color: MGMT,     Icon: SettingsIcon },
    AppConfig       : { color: MGMT,     Icon: SettingsIcon },
    OpenSearchService : { color: NETWORK, Icon: SearchIcon },
    MSK             : { color: INTEG,    Icon: ForumIcon },
    Amplify         : { color: MOBILE,   Icon: WebIcon },
    SES             : { color: INTEG,    Icon: EmailIcon },
    MediaConvert    : { color: INTEG,    Icon: MovieIcon },
};

const CATEGORY_FALLBACK : Record<CloudCategory, AwsStyle> =
{
    edge          : { color: NETWORK,  Icon: PublicIcon },
    network       : { color: NETWORK,  Icon: LanIcon },
    compute       : { color: COMPUTE,  Icon: MemoryIcon },
    messaging     : { color: INTEG,    Icon: ForumIcon },
    data          : { color: DATABASE, Icon: StorageIcon },
    identity      : { color: SECURITY, Icon: SecurityIcon },
    observability : { color: MGMT,     Icon: InsightsIcon },
    other         : { color: "#6e7681", Icon: CloudIcon },
};

/** AWS color + icon for a CloudFormation resource type, falling back to its category. */
export function awsStyle( type : string, category : CloudCategory ) : AwsStyle
{
    const svc : string = type.split( "::" )[ 1 ] ?? "";
    return SVC[ svc ] ?? CATEGORY_FALLBACK[ category ] ?? { color: "#6e7681", Icon: CloudIcon };
}

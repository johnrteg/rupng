//
// AWS access layer — thin facades over the AWS SDK (and kafkajs for MSK). See the package
// README. Base Application exposes the common ones as lazy getters; services add more.
//
export { sdkConfig, type SdkClientConfig } from "./sdkConfig";
export { ClientUtils } from "./ClientUtils";
export { S3 } from "./S3";
export { Kms } from "./Kms";
export { AppConfig } from "./AppConfig";
export { Kafka } from "./Kafka";
export { Sqs } from "./Sqs";
export { WorkQueue } from "./WorkQueue";
export { Sns } from "./Sns";
export { Secrets } from "./Secrets";
export { EventBridge } from "./EventBridge";
export { Dynamo } from "./Dynamo";
export { Lambda } from "./Lambda";
export { Scheduler } from "./Scheduler";
export { Ses } from "./Ses";
export { Cache } from "./Cache";
export { Cognito } from "./Cognito";
export { Search } from "./Search";
export { MediaConvert } from "./MediaConvert";
export { WebSocketApi } from "./WebSocketApi";
export { Database } from "./Database";

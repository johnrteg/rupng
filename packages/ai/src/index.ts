//
// @repo/ai — provider-agnostic AI abstraction. A service builds a prompt; this package handles
// transport, provider selection (factory), key resolution (KMS), retries, and usage metering.
// See README.md.
//
export { Ai, default } from "./AiModel";
export { AiFactory } from "./AiFactory";
export type { AdapterFactory } from "./AiFactory";
export { KmsKeyProvider, EnvKeyProvider, SecretsKeyProvider } from "./KeyProvider";
export type { KeyProvider } from "./KeyProvider";
export { BaseAdapter } from "./adapters/BaseAdapter";
export type { AdapterOptions } from "./adapters/BaseAdapter";
export { BedrockAdapter } from "./adapters/BedrockAdapter";
export { AnthropicAdapter } from "./adapters/AnthropicAdapter";
export { OpenAiAdapter } from "./adapters/OpenAiAdapter";
export { FishAdapter } from "./adapters/FishAdapter";
export { ElevenLabsAdapter } from "./adapters/ElevenLabsAdapter";
export { MagnificAdapter } from "./adapters/MagnificAdapter";

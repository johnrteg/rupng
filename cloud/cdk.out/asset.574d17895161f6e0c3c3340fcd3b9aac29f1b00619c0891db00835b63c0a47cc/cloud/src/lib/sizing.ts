//
// Maps the abstract 1..10 Sizing scale to concrete AWS sizes per resource type, so service
// authors never name an instance type. Each ladder is indexed by scale (1 -> index 0).
//
import { Scale, Sizing, ResolvedScale, scales } from "@repo/cloud-manifest";

// Result shapes (named, not inline object literals).
export interface FargateSize { cpu : number; memoryMiB : number; }
export interface AcuRange    { min : number; max : number; }
export interface CacheLimits { storageGB : number; ecpu : number; }
export interface BatchSize   { vcpu : number; memoryMiB : number; }

/** Pick the ladder entry for a 1..10 scale (clamped), where scale 1 maps to index 0. */
function at<T>( ladder : Array<T>, s : Scale ) : T
{
    return ladder[ Math.min( Math.max( s, 1 ), 10 ) - 1 ];
}

// ── Fargate: valid (cpu units -> allowed memory MiB) combos ──────────────────
const FARGATE_CPU : Array<number> = [ 256, 256, 512, 1024, 2048, 4096, 8192, 8192, 16384, 16384 ];
const FARGATE_MEM : Record<number, Array<number>> = {
    256   : [ 512, 1024, 2048 ],
    512   : [ 1024, 2048, 3072, 4096 ],
    1024  : [ 2048, 3072, 4096, 5120, 6144, 7168, 8192 ],
    2048  : [ 4096, 6144, 8192, 10240, 12288, 14336, 16384 ],
    4096  : [ 8192, 12288, 16384, 20480, 24576, 30720 ],
    8192  : [ 16384, 24576, 32768, 40960, 49152, 61440 ],
    16384 : [ 32768, 49152, 65536, 81920, 98304, 122880 ],
};

/** Map a 1..10 Sizing to a *valid* Fargate cpu/memory combo (memory clamped to a legal slot). */
export function fargateSize( sizing : Sizing | undefined ) : FargateSize
{
    const resolved : ResolvedScale = scales( sizing );
    const cpu : number       = at( FARGATE_CPU, resolved.cpu );
    const mem : Array<number> = FARGATE_MEM[ cpu ];
    const idx : number        = Math.round( ( ( resolved.memory - 1 ) / 9 ) * ( mem.length - 1 ) );   // memory scale -> valid slot
    return { cpu: cpu, memoryMiB: mem[ idx ] };
}

// ── RDS provisioned instance class (EC2 form, RDS prepends "db.") ────────────
const RDS_CLASSES : Array<string> = [ "t4g.micro", "t4g.small", "t4g.medium", "r6g.large", "r6g.xlarge", "r6g.2xlarge", "r6g.4xlarge", "r6g.8xlarge", "r6g.12xlarge", "r6g.16xlarge" ];
/** Map a 1..10 Sizing to an RDS instance class (EC2 form; RDS prepends "db."). */
export function rdsInstanceClass( sizing : Sizing | undefined ) : string
{
    const resolved : ResolvedScale = scales( sizing );
    return at( RDS_CLASSES, Math.max( resolved.cpu, resolved.memory ) as Scale );
}

// ── Aurora Serverless v2 ACU range ──────────────────────────────────────────
const ACU_MIN : Array<number> = [ 0.5, 0.5, 0.5, 1, 2, 4, 8, 16, 32, 64 ];
const ACU_MAX : Array<number> = [ 1, 2, 4, 8, 16, 32, 64, 128, 192, 256 ];
/** Map a 1..10 Sizing to an Aurora Serverless v2 min/max ACU range. */
export function auroraAcu( sizing : Sizing | undefined ) : AcuRange
{
    const resolved : ResolvedScale = scales( sizing );
    const s : Scale = Math.max( resolved.cpu, resolved.memory ) as Scale;
    return { min: at( ACU_MIN, s ), max: at( ACU_MAX, s ) };
}

// ── MSK broker instance type ─────────────────────────────────────────────────
const MSK_TYPES : Array<string> = [ "kafka.t3.small", "kafka.m5.large", "kafka.m5.large", "kafka.m5.xlarge", "kafka.m5.2xlarge", "kafka.m5.4xlarge", "kafka.m5.8xlarge", "kafka.m5.12xlarge", "kafka.m5.16xlarge", "kafka.m5.24xlarge" ];
/** Map a 1..10 Sizing to an MSK broker instance type. */
export function mskInstanceType( sizing : Sizing | undefined ) : string
{
    const resolved : ResolvedScale = scales( sizing );
    return at( MSK_TYPES, Math.max( resolved.cpu, resolved.memory ) as Scale );
}

// ── ElastiCache Serverless usage caps ────────────────────────────────────────
const CACHE_GB   : Array<number> = [ 1, 2, 5, 10, 25, 50, 100, 250, 500, 1000 ];
const CACHE_ECPU : Array<number> = [ 1000, 2000, 5000, 10000, 25000, 50000, 100000, 250000, 500000, 1000000 ];
/** Map a 1..10 Sizing to ElastiCache Serverless storage (GB) and ECPU/sec caps. */
export function cacheLimits( sizing : Sizing | undefined ) : CacheLimits
{
    const resolved : ResolvedScale = scales( sizing );
    return { storageGB: at( CACHE_GB, resolved.memory ), ecpu: at( CACHE_ECPU, resolved.cpu ) };
}

// ── AWS Batch vCPU + memory ──────────────────────────────────────────────────
const BATCH_VCPU : Array<number> = [ 1, 1, 2, 2, 4, 4, 8, 8, 16, 16 ];
const BATCH_MEM  : Array<number> = [ 2048, 2048, 4096, 8192, 8192, 16384, 16384, 32768, 32768, 65536 ];
/** Map a 1..10 Sizing to AWS Batch vCPU + memory (MiB). */
export function batchSize( sizing : Sizing | undefined ) : BatchSize
{
    const resolved : ResolvedScale = scales( sizing );
    return { vcpu: at( BATCH_VCPU, resolved.cpu ), memoryMiB: at( BATCH_MEM, resolved.memory ) };
}

// ── OpenSearch node instance type / serverless OCU caps ──────────────────────
const OS_TYPES : Array<string> = [ "t3.small.search", "t3.medium.search", "m6g.large.search", "m6g.xlarge.search", "m6g.2xlarge.search", "r6g.2xlarge.search", "r6g.4xlarge.search", "r6g.8xlarge.search", "r6g.12xlarge.search", "r6g.16xlarge.search" ];
/** Map a 1..10 Sizing to an OpenSearch (node-based domain) data-node instance type. */
export function searchInstanceType( sizing : Sizing | undefined ) : string
{
    const resolved : ResolvedScale = scales( sizing );
    return at( OS_TYPES, Math.max( resolved.cpu, resolved.memory ) as Scale );
}
const OCU_MAX : Array<number> = [ 2, 2, 4, 6, 8, 12, 16, 24, 32, 50 ];
/** Map a 1..10 Sizing to an OpenSearch Serverless max OCU cap. */
export function searchOcu( sizing : Sizing | undefined ) : number
{
    const resolved : ResolvedScale = scales( sizing );
    return at( OCU_MAX, Math.max( resolved.cpu, resolved.memory ) as Scale );
}

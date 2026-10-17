/**
 * WebGPU Hardware Contention & Defense-Bypass Profiling Engine
 * Project: Linking Identical Machines Across Browsers with WebGPU Contention
 * 
 * Authors:
 *   - Dr. Sapna V M (Associate Professor, Dept of CSE, PES University) — sapnavm@pes.edu
 *   - Prajwal Chowdary (Cybersecurity Research Scholar, C-ISFCR, PES University) — prajwalchowdary5@gmail.com
 *   - Prof. Prasad B. Honnavalli (Director, C-ISFCR, PES University) — prasadhb@pes.edu
 * 
 * Target: Black Hat Asia Briefings
 */

// WGSL Compute Shader 1: Architecture & ALU Semantics Probe
// High-iteration transcendental arithmetic designed to verify IEEE-754 ALU compliance
// and classify the GPU microarchitecture family.
const WGSL_ALU_PROBE_KERNEL = `
@group(0) @binding(0) var<storage, read_write> outputBuffer: array<f32>;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let index = global_id.x;
    var acc: f32 = f32(index) * 0.001953125;
    
    for (var i: u32 = 0u; i < 256u; i = i + 1u) {
        acc = sin(acc) * cos(acc * 1.41421356) + sqrt(abs(acc) + 0.0001);
        acc = acc * 1.00000011920928955 - fract(acc * 3.14159265);
    }
    
    outputBuffer[index] = acc;
}
`;

// WGSL Compute Shader 2: Inter-Workgroup Atomic Memory & Bus Contention Kernel
// Dispatches multiple workgroups contending for atomic locks and strided memory access
// across on-chip shared cache lines to measure physical arbiter latency jitter.
const WGSL_CONTENTION_KERNEL = `
struct ContentionMetrics {
    globalCounter: atomic<u32>,
    bankCollisions: atomic<u32>,
};

@group(0) @binding(0) var<storage, read_write> metrics: ContentionMetrics;
@group(0) @binding(1) var<storage, read_write> contentionTrace: array<u32>;

var<workgroup> localScratch: array<u32, 64>;

@compute @workgroup_size(64)
fn main(
    @builtin(global_invocation_id) global_id: vec3<u32>,
    @builtin(local_invocation_id) local_id: vec3<u32>,
    @builtin(workgroup_id) group_id: vec3<u32>
) {
    let tid = local_id.x;
    let gid = global_id.x;
    
    // 1. Induce intra-workgroup shared memory bank conflict
    localScratch[tid] = tid * 33u;
    workgroupBarrier();
    
    var localAccum: u32 = localScratch[(tid * 17u) % 64u];
    
    // 2. Inter-workgroup atomic contention on central arbiter
    for (var i: u32 = 0u; i < 64u; i = i + 1u) {
        let ticket = atomicAdd(&metrics.globalCounter, 1u);
        localAccum = (localAccum ^ ticket) + 1u;
    }
    
    // 3. Stressed global bus write
    if (gid < arrayLength(&contentionTrace)) {
        contentionTrace[gid] = localAccum;
    }
}
`;

class SiliconContentionProfiler {
    constructor() {
        this.adapter = null;
        this.device = null;
        this.adapterInfo = {};
        this.defenseAudit = {};
    }

    /**
     * Audit browser environment and defense bypass capabilities
     */
    async auditDefenses() {
        const audit = {
            webGpuExposed: !!(navigator.gpu),
            userAgent: navigator.userAgent,
            browserFamily: "Unknown",
            privacyDefenseActive: false,
            defenseDetails: []
        };

        const ua = navigator.userAgent.toLowerCase();
        if (ua.includes("edg/")) {
            audit.browserFamily = "Microsoft Edge";
        } else if (ua.includes("chrome/") && !ua.includes("edg/")) {
            // Check for Brave
            if (navigator.brave && typeof navigator.brave.isBrave === 'function') {
                audit.browserFamily = "Brave Browser";
                audit.defenseDetails.push("Brave Shields active (Canvas Farbling enabled)");
            } else {
                audit.browserFamily = "Google Chrome";
            }
        } else if (ua.includes("safari/") && !ua.includes("chrome/")) {
            audit.browserFamily = "Apple Safari";
            audit.defenseDetails.push("Safari Advanced Tracking and Fingerprinting Protection (ATFP) evaluation");
        } else if (ua.includes("firefox/")) {
            audit.browserFamily = "Mozilla Firefox";
        }

        // Test Canvas 2D farbling vs WebGPU compute
        try {
            const canvas = document.createElement("canvas");
            const ctx = canvas.getContext("2d");
            if (ctx) {
                ctx.textBaseline = "top";
                ctx.font = "14px 'Arial'";
                ctx.fillText("ContentionProbe::SecurityAudit", 2, 2);
                const dataUrl = canvas.toDataURL();
                audit.canvasHash = this._fastHash(dataUrl);
            }
        } catch (e) {
            audit.defenseDetails.push("Canvas 2D access restricted: " + e.message);
        }

        if (!audit.webGpuExposed) {
            audit.defenseDetails.push("WebGPU blocked or disabled by browser (e.g. Tor Browser or Firefox RFP)");
        } else {
            audit.defenseDetails.push("WebGPU compute pipeline fully unconstrained (Zero permission prompts)");
        }

        this.defenseAudit = audit;
        return audit;
    }

    /**
     * Initializes WebGPU context and extracts device limits
     */
    async initialize() {
        if (!navigator.gpu) {
            throw new Error("WebGPU is not exposed in this browser environment.");
        }

        this.adapter = await navigator.gpu.requestAdapter({
            powerPreference: "high-performance"
        });

        if (!this.adapter) {
            throw new Error("No appropriate WebGPU adapter found.");
        }

        this.device = await this.adapter.requestDevice();

        let info = {};
        if (typeof this.adapter.requestAdapterInfo === 'function') {
            try {
                info = await this.adapter.requestAdapterInfo();
            } catch (e) {
                info = { vendor: "Restricted", architecture: "Protected" };
            }
        }

        this.adapterInfo = {
            vendor: info.vendor || "Standard GPU Adapter",
            architecture: info.architecture || "Unified Core Architecture",
            device: info.device || "Compute Device",
            description: info.description || "",
            maxComputeInvocationsPerWorkgroup: this.device.limits.maxComputeInvocationsPerWorkgroup,
            maxComputeWorkgroupSizeX: this.device.limits.maxComputeWorkgroupSizeX,
            maxBufferSize: this.device.limits.maxBufferSize,
            maxStorageBufferBindingSize: this.device.limits.maxStorageBufferBindingSize
        };
    }

    /**
     * Tier 1: Microarchitectural ALU Validation
     * Evaluates transcendental operations to verify IEEE-754 ALU compliance.
     */
    async profileAluArchitecture() {
        const workgroupCount = 64;
        const bufferSize = workgroupCount * 64 * 4;

        const gpuBuffer = this.device.createBuffer({
            size: bufferSize,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
        });

        const readBuffer = this.device.createBuffer({
            size: bufferSize,
            usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
        });

        const shaderModule = this.device.createShaderModule({ code: WGSL_ALU_PROBE_KERNEL });
        const pipeline = this.device.createComputePipeline({
            layout: 'auto',
            compute: { module: shaderModule, entryPoint: 'main' }
        });

        const bindGroup = this.device.createBindGroup({
            layout: pipeline.getBindGroupLayout(0),
            entries: [{ binding: 0, resource: { buffer: gpuBuffer } }]
        });

        const commandEncoder = this.device.createCommandEncoder();
        const pass = commandEncoder.beginComputePass();
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, bindGroup);
        pass.dispatchWorkgroups(workgroupCount);
        pass.end();

        commandEncoder.copyBufferToBuffer(gpuBuffer, 0, readBuffer, 0, bufferSize);
        this.device.queue.submit([commandEncoder.finish()]);

        await readBuffer.mapAsync(GPUMapMode.READ);
        const data = new Float32Array(readBuffer.getMappedRange().slice(0));
        readBuffer.unmap();

        gpuBuffer.destroy();
        readBuffer.destroy();

        // Calculate IEEE-754 arithmetic sample
        const sampleSum = data.reduce((acc, v, idx) => (idx % 64 === 0 ? acc + Math.abs(v) : acc), 0);
        return sampleSum.toFixed(6);
    }

    /**
     * Tier 2: Multi-Scale Workgroup Contention Latency Distribution
     * Measures memory arbiter serialization latency across scaling workgroups (16, 64, 128, 256, 512).
     */
    async profileContentionDistribution(scales = [16, 64, 128, 256, 512], runsPerScale = 6) {
        const shaderModule = this.device.createShaderModule({ code: WGSL_CONTENTION_KERNEL });
        const pipeline = this.device.createComputePipeline({
            layout: 'auto',
            compute: { module: shaderModule, entryPoint: 'main' }
        });

        const scaleResults = [];

        for (const workgroups of scales) {
            const threadCount = workgroups * 64;
            const metricsBufferSize = 8; // 2 * u32
            const traceBufferSize = threadCount * 4;

            const metricsBuffer = this.device.createBuffer({
                size: metricsBufferSize,
                usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
            });

            const traceBuffer = this.device.createBuffer({
                size: traceBufferSize,
                usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
            });

            const bindGroup = this.device.createBindGroup({
                layout: pipeline.getBindGroupLayout(0),
                entries: [
                    { binding: 0, resource: { buffer: metricsBuffer } },
                    { binding: 1, resource: { buffer: traceBuffer } }
                ]
            });

            const latencies = [];

            // Perform repeated runs per scale
            for (let r = 0; r < runsPerScale; r++) {
                const t0 = performance.now();

                const encoder = this.device.createCommandEncoder();
                const pass = encoder.beginComputePass();
                pass.setPipeline(pipeline);
                pass.setBindGroup(0, bindGroup);
                pass.dispatchWorkgroups(workgroups);
                pass.end();

                this.device.queue.submit([encoder.finish()]);

                // Synchronize via queue.onSubmittedWorkDone to measure GPU execution
                await this.device.queue.onSubmittedWorkDone();
                const t1 = performance.now();

                const elapsed = t1 - t0;
                // Discard run 0 (warmup)
                if (r > 0) {
                    latencies.push(elapsed);
                }
            }

            metricsBuffer.destroy();
            traceBuffer.destroy();

            // Statistical calculations for this scale
            latencies.sort((a, b) => a - b);
            const mean = latencies.reduce((a, b) => a + b, 0) / latencies.length;
            const median = latencies[Math.floor(latencies.length / 2)];
            const p10 = latencies[Math.floor(latencies.length * 0.1)] || latencies[0];
            const p90 = latencies[Math.floor(latencies.length * 0.9)] || latencies[latencies.length - 1];
            const q25 = latencies[Math.floor(latencies.length * 0.25)] || latencies[0];
            const q75 = latencies[Math.floor(latencies.length * 0.75)] || latencies[latencies.length - 1];
            const iqr = q75 - q25;

            const variance = latencies.reduce((acc, v) => acc + Math.pow(v - mean, 2), 0) / latencies.length;
            const stdDev = Math.sqrt(variance);

            scaleResults.push({
                workgroups: workgroups,
                threadCount: threadCount,
                meanMs: parseFloat(mean.toFixed(3)),
                medianMs: parseFloat(median.toFixed(3)),
                p10Ms: parseFloat(p10.toFixed(3)),
                p90Ms: parseFloat(p90.toFixed(3)),
                iqrMs: parseFloat(iqr.toFixed(3)),
                stdDevMs: parseFloat(stdDev.toFixed(3)),
                rawLatencies: latencies.map(l => parseFloat(l.toFixed(3)))
            });
        }

        // Calculate Contention Slope: dLatency / dWorkgroups
        const firstScale = scaleResults[0];
        const lastScale = scaleResults[scaleResults.length - 1];
        const deltaLatency = lastScale.medianMs - firstScale.medianMs;
        const deltaWorkgroups = lastScale.workgroups - firstScale.workgroups;
        const contentionSlope = deltaWorkgroups > 0 ? (deltaLatency / deltaWorkgroups) : 0;

        return {
            scales: scaleResults,
            contentionSlope: parseFloat(contentionSlope.toFixed(5))
        };
    }

    /**
     * Synthesizes full signature: architectural token, multi-scale timing vector, and defense audit
     */
    async generateFullProfile() {
        const audit = await this.auditDefenses();
        if (!audit.webGpuExposed) {
            return {
                supported: false,
                defenseAudit: audit,
                message: "WebGPU is disabled or blocked. Privacy defenses successfully stopped hardware probing."
            };
        }

        await this.initialize();
        const aluSignature = await this.profileAluArchitecture();
        const contention = await this.profileContentionDistribution([16, 64, 128, 256, 512], 6);

        // Feature vector for cross-browser linkage
        const featureVector = [
            contention.contentionSlope,
            ...contention.scales.map(s => s.medianMs),
            ...contention.scales.map(s => s.iqrMs),
            this.adapterInfo.maxComputeInvocationsPerWorkgroup
        ];

        // Normalized feature vector representation
        const normalizedVectorString = featureVector.map(v => typeof v === 'number' ? v.toFixed(3) : v).join('|');

        // Canonical Identifier (Hash of Architecture + Contention Class)
        const canonicalSeed = `${aluSignature}#${this.adapterInfo.vendor}#${this.adapterInfo.maxComputeInvocationsPerWorkgroup}#${contention.contentionSlope.toFixed(3)}`;
        const canonicalId = await this._sha256(canonicalSeed);

        return {
            supported: true,
            canonicalId: canonicalId,
            shortId: canonicalId.substring(0, 16),
            aluArchitectureSignature: aluSignature,
            contentionSlope: contention.contentionSlope,
            contentionDistribution: contention.scales,
            featureVector: featureVector,
            normalizedVectorString: normalizedVectorString,
            adapterInfo: this.adapterInfo,
            defenseAudit: audit,
            timestamp: new Date().toISOString()
        };
    }

    /**
     * Quantifies cross-browser linkage between two profiles via Cosine Similarity
     */
    static compareSignatures(profileA, profileB) {
        if (!profileA || !profileB || !profileA.featureVector || !profileB.featureVector) {
            return { error: "Invalid profiles for comparison" };
        }

        // 1. Architecture match check
        const aluMatch = profileA.aluArchitectureSignature === profileB.aluArchitectureSignature;

        // 2. Cosine Similarity on contention latency vectors
        const vecA = profileA.featureVector;
        const vecB = profileB.featureVector;
        const len = Math.min(vecA.length, vecB.length);

        let dotProduct = 0;
        let normA = 0;
        let normB = 0;

        for (let i = 0; i < len; i++) {
            dotProduct += vecA[i] * vecB[i];
            normA += vecA[i] * vecA[i];
            normB += vecB[i] * vecB[i];
        }

        const cosineSimilarity = (normA > 0 && normB > 0) ? (dotProduct / (Math.sqrt(normA) * Math.sqrt(normB))) : 0;
        const linkageConfidencePercent = Math.min(100, Math.max(0, cosineSimilarity * 100));

        return {
            aluMicroarchitectureMatch: aluMatch,
            cosineSimilarity: parseFloat(cosineSimilarity.toFixed(4)),
            linkageConfidence: linkageConfidencePercent.toFixed(1) + "%",
            verdict: linkageConfidencePercent >= 92 ? "SAME_DEVICE_CORRELATED" : "DISTINCT_OR_UNLINKED"
        };
    }

    async _sha256(str) {
        const encoder = new TextEncoder();
        const data = encoder.encode(str);
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
    }

    _fastHash(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            hash = (Math.imul(31, hash) + str.charCodeAt(i)) | 0;
        }
        return hash.toString(16).toUpperCase();
    }
}

if (typeof window !== 'undefined') {
    window.SiliconContentionProfiler = SiliconContentionProfiler;
    // Backward compatibility alias
    window.SiliconFingerprint = SiliconContentionProfiler;
}
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { SiliconContentionProfiler };
}

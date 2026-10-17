/**
 * WebGPU Microarchitectural Contention & Scheduling Profiler
 * Project: Linking Identical Machines Across Browsers with WebGPU Contention
 * 
 * Authors:
 *   - Dr. Sapna V M (Associate Professor, Dept of CSE, PES University) — sapnavm@pes.edu
 *   - Prajwal Chowdary (Cybersecurity Research Scholar, C-ISFCR, PES University) — prajwalchowdary5@gmail.com
 *   - Prof. Prasad B. Honnavalli (Director, C-ISFCR, PES University) — prasadhb@pes.edu
 * 
 * Target: Black Hat Asia Briefings
 */

// 1. Microarchitectural ALU Validation Kernel
// Evaluates IEEE-754 floating point arithmetic rounding and transcendental semantics.
// Acts as a categorical microarchitecture pre-filter (distinguishes GPU families/drivers).
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

// 2. In-Shader Execution Unit Scheduling & Arrival-Order Kernel
// Workgroups race to acquire tickets from a central atomic counter.
// The resulting arrival sequence records the hardware arbiter's physical scheduling order.
const WGSL_ARRIVAL_ORDER_KERNEL = `
struct Arbiter {
    next: atomic<u32>,
};

@group(0) @binding(0) var<storage, read_write> arbiter: Arbiter;
@group(0) @binding(1) var<storage, read_write> arrival: array<u32>;

@compute @workgroup_size(64)
fn main(
    @builtin(workgroup_id) wg: vec3<u32>,
    @builtin(local_invocation_id) lid: vec3<u32>
) {
    if (lid.x == 0u) {
        let ticket = atomicAdd(&arbiter.next, 1u);
        arrival[wg.x] = ticket;
    }
}
`;

// 3. Multi-Scale Memory Contention Scaling Kernel
// Stresses shared memory and global bus across scaling workgroups to extract regression slopes.
const WGSL_MEMORY_CONTENTION_KERNEL = `
struct MemoryStress {
    counter: atomic<u32>,
};

@group(0) @binding(0) var<storage, read_write> stress: MemoryStress;
@group(0) @binding(1) var<storage, read_write> trace: array<u32>;

var<workgroup> sharedTile: array<u32, 64>;

@compute @workgroup_size(64)
fn main(
    @builtin(global_invocation_id) gid: vec3<u32>,
    @builtin(local_invocation_id) lid: vec3<u32>,
    @builtin(workgroup_id) wgid: vec3<u32>
) {
    let tid = lid.x;
    sharedTile[tid] = tid * 31u;
    workgroupBarrier();
    
    var val: u32 = sharedTile[(tid * 7u) % 64u];
    for (var i: u32 = 0u; i < 48u; i = i + 1u) {
        let t = atomicAdd(&stress.counter, 1u);
        val = (val ^ t) + 1u;
    }
    
    if (gid.x < arrayLength(&trace)) {
        trace[gid.x] = val;
    }
}
`;

class SiliconContentionProfiler {
    constructor() {
        this.sessionId = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : ('sess_' + Math.random().toString(36).substring(2, 10));
        this.adapter = null;
        this.device = null;
        this.adapterInfo = {};
        this.defenseAudit = {};
        this.powerState = {};
    }

    /**
     * Measures actual timer resolution empirically rather than assuming it
     */
    static measureTimerResolution() {
        const deltas = new Set();
        let last = performance.now();
        let iterations = 0;
        while (deltas.size < 20 && iterations < 8000) {
            const t = performance.now();
            if (t !== last) {
                deltas.add(t - last);
                last = t;
            }
            iterations++;
        }
        if (deltas.size === 0) return 0.1;
        const minDelta = Math.min(...deltas);
        return parseFloat(minDelta.toFixed(4));
    }

    /**
     * Probes canvas state and detects session-keyed farbling (e.g. Brave Shields).
     * Brave farbling is session-stable, so repeated calls within one page match.
     * We record the hash and check for known Brave farbling API presence.
     */
    static async detectCanvasState() {
        try {
            const canvas = document.createElement("canvas");
            canvas.width = 64;
            canvas.height = 64;
            const ctx = canvas.getContext("2d");
            if (!ctx) return { supported: false };

            ctx.fillStyle = "rgb(120, 60, 30)";
            ctx.fillRect(0, 0, 64, 64);
            ctx.font = "14px 'Arial', sans-serif";
            ctx.fillStyle = "rgb(25, 200, 110)";
            ctx.fillText("FarbleProbe::PES", 2, 32);
            const dataUrl = canvas.toDataURL();

            const isBrave = typeof navigator !== 'undefined' && navigator.brave && typeof navigator.brave.isBrave === 'function';
            return {
                supported: true,
                canvasHash: dataUrl.substring(dataUrl.length - 24),
                braveDetected: !!isBrave,
                farblingExpected: !!isBrave
            };
        } catch (e) {
            return { supported: false, error: e.message };
        }
    }

    /**
     * Extracts power state (battery vs AC, level) to control for DVFS / thermal throttling.
     * Handles browser absence gracefully (e.g. Safari / Firefox do not implement getBattery).
     */
    static async getPowerState() {
        if (typeof navigator !== 'undefined' && typeof navigator.getBattery === 'function') {
            try {
                const b = await navigator.getBattery();
                return {
                    supported: true,
                    charging: b.charging,
                    level: Math.round(b.level * 100)
                };
            } catch (e) {}
        }
        return { supported: false, charging: "unsupported", level: "unsupported" };
    }

    /**
     * Audits actual browser environment without speculative UA assertions
     */
    async auditDefenses() {
        const timerRes = SiliconContentionProfiler.measureTimerResolution();
        const canvasState = await SiliconContentionProfiler.detectCanvasState();
        const power = await SiliconContentionProfiler.getPowerState();

        const audit = {
            webGpuExposed: !!(navigator.gpu),
            crossOriginIsolated: typeof window !== 'undefined' && !!(window.crossOriginIsolated),
            measuredTimerResolutionMs: timerRes,
            canvasState: canvasState,
            powerState: power,
            userAgent: navigator.userAgent
        };

        this.defenseAudit = audit;
        this.powerState = power;
        return audit;
    }

    /**
     * Initializes WebGPU context using standard adapter.info
     */
    async initialize() {
        if (!navigator.gpu) {
            throw new Error("WebGPU API not available in this context.");
        }

        this.adapter = await navigator.gpu.requestAdapter({
            powerPreference: "high-performance"
        });

        if (!this.adapter) {
            throw new Error("No appropriate WebGPU adapter returned.");
        }

        this.device = await this.adapter.requestDevice();

        let info = this.adapter.info || {};
        if (!info.vendor && typeof this.adapter.requestAdapterInfo === 'function') {
            try {
                info = await this.adapter.requestAdapterInfo();
            } catch (e) {
                info = {};
            }
        }

        this.adapterInfo = {
            vendor: info.vendor || "",
            architecture: info.architecture || "",
            device: info.device || "",
            description: info.description || "",
            maxComputeInvocationsPerWorkgroup: this.device.limits.maxComputeInvocationsPerWorkgroup,
            maxComputeWorkgroupSizeX: this.device.limits.maxComputeWorkgroupSizeX,
            maxBufferSize: this.device.limits.maxBufferSize,
            maxStorageBufferBindingSize: this.device.limits.maxStorageBufferBindingSize
        };
    }

    /**
     * Tier 1: Microarchitectural ALU Validation (Categorical Architecture Gate)
     * Verifies deterministic floating-point arithmetic rounding behavior.
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

        const encoder = this.device.createCommandEncoder();
        const pass = encoder.beginComputePass();
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, bindGroup);
        pass.dispatchWorkgroups(workgroupCount);
        pass.end();

        encoder.copyBufferToBuffer(gpuBuffer, 0, readBuffer, 0, bufferSize);
        this.device.queue.submit([encoder.finish()]);

        await readBuffer.mapAsync(GPUMapMode.READ);
        const data = new Float32Array(readBuffer.getMappedRange().slice(0));
        readBuffer.unmap();

        gpuBuffer.destroy();
        readBuffer.destroy();

        const sampleSum = data.reduce((acc, v, idx) => (idx % 64 === 0 ? acc + Math.abs(v) : acc), 0);
        return sampleSum.toFixed(6);
    }

    /**
     * Tier 2: In-Shader Scheduling Order (Hardware Arbiter Readback)
     * Explicitly resets arbiter to 0 on each run via mappedAtCreation.
     * Collects arrival sequences across multiple iterations.
     */
    async profileSchedulingOrder(workgroupCount = 64, iterations = 32) {
        const shaderModule = this.device.createShaderModule({ code: WGSL_ARRIVAL_ORDER_KERNEL });
        const pipeline = this.device.createComputePipeline({
            layout: 'auto',
            compute: { module: shaderModule, entryPoint: 'main' }
        });

        const arbiterBufferSize = 4;
        const arrivalBufferSize = workgroupCount * 4;

        const rankAccumulators = new Array(workgroupCount).fill(0);
        const rankSquaredAccumulators = new Array(workgroupCount).fill(0);
        const allArrivalRuns = [];

        for (let iter = 0; iter < iterations; iter++) {
            // Strictly reset arbiter.next to 0 at the start of every run
            const arbiterBuffer = this.device.createBuffer({
                size: arbiterBufferSize,
                usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
                mappedAtCreation: true
            });
            new Uint32Array(arbiterBuffer.getMappedRange())[0] = 0;
            arbiterBuffer.unmap();

            const arrivalBuffer = this.device.createBuffer({
                size: arrivalBufferSize,
                usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
            });

            const readBuffer = this.device.createBuffer({
                size: arrivalBufferSize,
                usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
            });

            const bindGroup = this.device.createBindGroup({
                layout: pipeline.getBindGroupLayout(0),
                entries: [
                    { binding: 0, resource: { buffer: arbiterBuffer } },
                    { binding: 1, resource: { buffer: arrivalBuffer } }
                ]
            });

            const encoder = this.device.createCommandEncoder();
            const pass = encoder.beginComputePass();
            pass.setPipeline(pipeline);
            pass.setBindGroup(0, bindGroup);
            pass.dispatchWorkgroups(workgroupCount);
            pass.end();

            encoder.copyBufferToBuffer(arrivalBuffer, 0, readBuffer, 0, arrivalBufferSize);
            this.device.queue.submit([encoder.finish()]);

            await readBuffer.mapAsync(GPUMapMode.READ);
            const arrivalArray = new Uint32Array(readBuffer.getMappedRange().slice(0));
            readBuffer.unmap();

            arbiterBuffer.destroy();
            arrivalBuffer.destroy();
            readBuffer.destroy();

            const runRanks = Array.from(arrivalArray);
            allArrivalRuns.push(runRanks);

            for (let wg = 0; wg < workgroupCount; wg++) {
                const rank = runRanks[wg];
                rankAccumulators[wg] += rank;
                rankSquaredAccumulators[wg] += (rank * rank);
            }
        }

        const meanArrivalRanks = [];
        const rankVariances = [];
        for (let wg = 0; wg < workgroupCount; wg++) {
            const mean = rankAccumulators[wg] / iterations;
            const variance = (rankSquaredAccumulators[wg] / iterations) - (mean * mean);
            meanArrivalRanks.push(parseFloat(mean.toFixed(2)));
            rankVariances.push(parseFloat(variance.toFixed(2)));
        }

        // Normalized mean rank vector in [0, 1]
        const normalizedRankVector = meanArrivalRanks.map(r => parseFloat((r / (workgroupCount - 1)).toFixed(4)));

        return {
            workgroupCount: workgroupCount,
            totalIterations: iterations,
            meanArrivalRanks: meanArrivalRanks,
            rankVariances: rankVariances,
            normalizedRankVector: normalizedRankVector,
            allRuns: allArrivalRuns
        };
    }

    /**
     * Tier 3: Memory Contention Curves & OLS Regression (Separates Additive Overhead)
     * Fits an Ordinary Least Squares (OLS) regression line across scales (16, 64, 128, 256):
     *   Latency(W) = slope * W + intercept
     * where intercept isolates constant additive software overhead (IPC, submission)
     * and slope captures the hardware execution unit scaling rate.
     */
    async profileContentionCurves(scales = [16, 64, 128, 256], runsPerScale = 30) {
        const shaderModule = this.device.createShaderModule({ code: WGSL_MEMORY_CONTENTION_KERNEL });
        const pipeline = this.device.createComputePipeline({
            layout: 'auto',
            compute: { module: shaderModule, entryPoint: 'main' }
        });

        const scaleProfiles = [];

        for (const wgCount of scales) {
            const threadCount = wgCount * 64;
            const stressBufSize = 4;
            const traceBufSize = threadCount * 4;

            const stressBuffer = this.device.createBuffer({
                size: stressBufSize,
                usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
            });

            const traceBuffer = this.device.createBuffer({
                size: traceBufSize,
                usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
            });

            const bindGroup = this.device.createBindGroup({
                layout: pipeline.getBindGroupLayout(0),
                entries: [
                    { binding: 0, resource: { buffer: stressBuffer } },
                    { binding: 1, resource: { buffer: traceBuffer } }
                ]
            });

            const timeSeriesLatencies = [];

            for (let r = 0; r < runsPerScale; r++) {
                const t0 = performance.now();

                const encoder = this.device.createCommandEncoder();
                const pass = encoder.beginComputePass();
                pass.setPipeline(pipeline);
                pass.setBindGroup(0, bindGroup);
                pass.dispatchWorkgroups(wgCount);
                pass.end();

                this.device.queue.submit([encoder.finish()]);
                await this.device.queue.onSubmittedWorkDone();

                const t1 = performance.now();
                const elapsed = t1 - t0;
                
                // Discard initial 3 runs as warmup
                if (r >= 3) {
                    timeSeriesLatencies.push(parseFloat(elapsed.toFixed(3)));
                }
            }

            stressBuffer.destroy();
            traceBuffer.destroy();

            const sorted = [...timeSeriesLatencies].sort((a, b) => a - b);
            const n = sorted.length;
            const mean = sorted.reduce((a, b) => a + b, 0) / n;
            const median = sorted[Math.floor(n / 2)];
            const p10 = sorted[Math.floor(n * 0.1)] || sorted[0];
            const p90 = sorted[Math.floor(n * 0.9)] || sorted[n - 1];
            const q25 = sorted[Math.floor(n * 0.25)] || sorted[0];
            const q75 = sorted[Math.floor(n * 0.75)] || sorted[n - 1];
            const iqr = q75 - q25;

            const variance = sorted.reduce((acc, v) => acc + Math.pow(v - mean, 2), 0) / n;
            const stdDev = Math.sqrt(variance);

            scaleProfiles.push({
                workgroups: wgCount,
                threadCount: threadCount,
                sampleCount: n,
                meanMs: parseFloat(mean.toFixed(3)),
                medianMs: parseFloat(median.toFixed(3)),
                p10Ms: parseFloat(p10.toFixed(3)),
                p90Ms: parseFloat(p90.toFixed(3)),
                iqrMs: parseFloat(iqr.toFixed(3)),
                stdDevMs: parseFloat(stdDev.toFixed(3)),
                timeSeries: timeSeriesLatencies
            });
        }

        // Ordinary Least Squares (OLS) Regression across workgroup scales
        // Resolves additive constant c: L = slope * W + c
        const xVals = scaleProfiles.map(s => s.workgroups);
        const yVals = scaleProfiles.map(s => s.medianMs);
        const xMean = xVals.reduce((a, b) => a + b, 0) / xVals.length;
        const yMean = yVals.reduce((a, b) => a + b, 0) / yVals.length;

        let num = 0;
        let den = 0;
        for (let i = 0; i < xVals.length; i++) {
            num += (xVals[i] - xMean) * (yVals[i] - yMean);
            den += Math.pow(xVals[i] - xMean, 2);
        }

        const regressionSlope = den > 0 ? (num / den) : 0;
        const additiveIntercept = yMean - (regressionSlope * xMean);

        // Incremental differences between successive scales (eliminates constant offset)
        const incrementalDiffs = [];
        for (let i = 1; i < scaleProfiles.length; i++) {
            const diff = scaleProfiles[i].medianMs - scaleProfiles[i - 1].medianMs;
            incrementalDiffs.push(parseFloat(diff.toFixed(3)));
        }

        return {
            scaleProfiles: scaleProfiles,
            regressionSlopeMsPerWg: parseFloat(regressionSlope.toFixed(5)),
            additiveInterceptMs: parseFloat(additiveIntercept.toFixed(3)),
            incrementalDifferencesMs: incrementalDiffs
        };
    }

    /**
     * Synthesizes full profile:
     * - Architecture Token (ALU math sample + adapter info as categorical gate)
     * - Continuous Feature Vector (Normalized arrival ranks + incremental scale differences + slope)
     * - Defense audit data
     */
    async generateFullProfile(deviceLabel = "unlabeled") {
        const audit = await this.auditDefenses();
        if (!audit.webGpuExposed) {
            return {
                supported: false,
                defenseAudit: audit,
                message: "WebGPU is not exposed. Privacy protections active."
            };
        }

        await this.initialize();
        const aluSig = await this.profileAluArchitecture();
        const scheduling = await this.profileSchedulingOrder(64, 32);
        const contention = await this.profileContentionCurves([16, 64, 128, 256], 30);

        // Continuous Physical Feature Vector (Strictly zero static metadata):
        // 1..64: In-shader normalized arrival rank across workgroups
        // 65..67: Incremental contention differences (removes additive IPC constant)
        // 68: Linear regression scaling slope
        const continuousFeatureVector = [
            ...scheduling.normalizedRankVector,
            ...contention.incrementalDifferencesMs,
            contention.regressionSlopeMsPerWg * 100 // scaled for numerical stability
        ];

        // Architectural Token: Categorical gate
        const architectureToken = `${aluSig}::${this.adapterInfo.vendor || 'anon'}::${this.adapterInfo.maxComputeInvocationsPerWorkgroup}`;

        return {
            supported: true,
            sessionId: this.sessionId,
            deviceLabel: deviceLabel,
            architectureToken: architectureToken,
            aluSignature: aluSig,
            featureVector: continuousFeatureVector,
            schedulingSummary: {
                workgroupCount: scheduling.workgroupCount,
                meanArrivalRanks: scheduling.meanArrivalRanks,
                sampleArrivalRuns: scheduling.allRuns.slice(0, 3)
            },
            contentionSummary: {
                scaleProfiles: contention.scaleProfiles,
                regressionSlopeMsPerWg: contention.regressionSlopeMsPerWg,
                additiveInterceptMs: contention.additiveInterceptMs,
                incrementalDifferencesMs: contention.incrementalDifferencesMs
            },
            adapterInfo: this.adapterInfo,
            defenseAudit: audit,
            powerState: this.powerState,
            timestamp: new Date().toISOString()
        };
    }

    /**
     * Evaluates linkage between two profiles:
     * 1. Categorical gate: Architecture token must match.
     * 2. Cosine Distance & Euclidean Distance on continuous feature vector.
     */
    static compareProfiles(profileA, profileB) {
        if (!profileA || !profileB || !profileA.featureVector || !profileB.featureVector) {
            return { error: "Missing feature vectors for comparison." };
        }

        const architectureMatch = profileA.architectureToken === profileB.architectureToken;
        if (!architectureMatch) {
            return {
                architectureMatch: false,
                cosineDistance: 1.0,
                cosineSimilarity: 0.0,
                verdict: "DIFFERENT_ARCHITECTURE"
            };
        }

        const vecA = profileA.featureVector;
        const vecB = profileB.featureVector;
        const len = Math.min(vecA.length, vecB.length);

        let dot = 0;
        let normA = 0;
        let normB = 0;
        let sumSquaredDiff = 0;

        for (let i = 0; i < len; i++) {
            dot += vecA[i] * vecB[i];
            normA += vecA[i] * vecA[i];
            normB += vecB[i] * vecB[i];
            sumSquaredDiff += Math.pow(vecA[i] - vecB[i], 2);
        }

        const cosineSimilarity = (normA > 0 && normB > 0) ? (dot / (Math.sqrt(normA) * Math.sqrt(normB))) : 0;
        const cosineDistance = 1.0 - cosineSimilarity;
        const euclideanDistance = Math.sqrt(sumSquaredDiff);

        return {
            architectureMatch: true,
            cosineSimilarity: parseFloat(cosineSimilarity.toFixed(5)),
            cosineDistance: parseFloat(cosineDistance.toFixed(5)),
            euclideanDistance: parseFloat(euclideanDistance.toFixed(5)),
            featureCount: len
        };
    }
}

if (typeof window !== 'undefined') {
    window.SiliconContentionProfiler = SiliconContentionProfiler;
    window.SiliconFingerprint = SiliconContentionProfiler;
}
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { SiliconContentionProfiler };
}

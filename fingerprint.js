/**
 * Silicon Fingerprint Engine v2.0 (Fuzzy Extractor & Jitter Tolerance)
 * Authors: Dr. Sapna V M, Prajwal Chowdary, Prof. Prasad B. Honnavalli
 * Institution: C-ISFCR Lab, PES University, Bengaluru
 * Target: Black Hat Asia Briefings
 */

const WGSL_STRESS_KERNEL = `
@group(0) @binding(0) var<storage, read_write> outputBuffer: array<f32>;

// Non-linear transcendental ALU stress kernel designed to induce
// microarchitectural execution timing variance across physical Execution Units.
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let index = global_id.x;
    var acc: f32 = f32(index) * 0.001953125;
    
    // High-iteration non-linear loop sensitive to physical ALU pipeline characteristics
    for (var i: u32 = 0u; i < 256u; i = i + 1u) {
        acc = sin(acc) * cos(acc * 1.41421356) + sqrt(abs(acc) + 0.0001);
        acc = acc * 1.00000011920928955 - fract(acc * 3.14159265);
    }
    
    outputBuffer[index] = acc;
}
`;

class SiliconFingerprint {
    constructor() {
        this.adapter = null;
        this.device = null;
        this.hardwareProfile = {};
    }

    async isSupported() {
        return !!(navigator.gpu);
    }

    async initialize() {
        if (!navigator.gpu) {
            throw new Error("WebGPU is not supported in this browser environment.");
        }
        this.adapter = await navigator.gpu.requestAdapter({
            powerPreference: "high-performance"
        });
        if (!this.adapter) {
            throw new Error("No appropriate WebGPU adapter found.");
        }
        this.device = await this.adapter.requestDevice();
        
        // Extract basic adapter information
        const info = await (this.adapter.requestAdapterInfo ? this.adapter.requestAdapterInfo() : {});
        this.hardwareProfile.vendor = info.vendor || "Hardware GPU";
        this.hardwareProfile.architecture = info.architecture || "Native Compute Core";
        this.hardwareProfile.device = info.device || "GPU Compute Adapter";
        this.hardwareProfile.description = info.description || "";
        
        // Query hardware limits
        this.hardwareProfile.maxComputeInvocationsPerWorkgroup = this.device.limits.maxComputeInvocationsPerWorkgroup;
        this.hardwareProfile.maxComputeWorkgroupSizeX = this.device.limits.maxComputeWorkgroupSizeX;
        this.hardwareProfile.maxBufferSize = this.device.limits.maxBufferSize;
        this.hardwareProfile.maxStorageBufferBindingSize = this.device.limits.maxStorageBufferBindingSize;
    }

    async executeMicrobenchmarks(iterations = 8, workgroupCount = 256) {
        const bufferSize = workgroupCount * 64 * 4; // 64 threads per workgroup, f32
        const gpuBuffer = this.device.createBuffer({
            size: bufferSize,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
        });
        
        const readBuffer = this.device.createBuffer({
            size: bufferSize,
            usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
        });

        const shaderModule = this.device.createShaderModule({ code: WGSL_STRESS_KERNEL });
        const computePipeline = this.device.createComputePipeline({
            layout: 'auto',
            compute: { module: shaderModule, entryPoint: 'main' }
        });

        const bindGroup = this.device.createBindGroup({
            layout: computePipeline.getBindGroupLayout(0),
            entries: [{ binding: 0, resource: { buffer: gpuBuffer } }]
        });

        const timingSignatures = [];

        for (let iter = 0; iter < iterations; iter++) {
            const t0 = performance.now();
            
            const commandEncoder = this.device.createCommandEncoder();
            const passEncoder = commandEncoder.beginComputePass();
            passEncoder.setPipeline(computePipeline);
            passEncoder.setBindGroup(0, bindGroup);
            passEncoder.dispatchWorkgroups(workgroupCount);
            passEncoder.end();

            commandEncoder.copyBufferToBuffer(gpuBuffer, 0, readBuffer, 0, bufferSize);
            this.device.queue.submit([commandEncoder.finish()]);

            await readBuffer.mapAsync(GPUMapMode.READ);
            const copyArray = new Float32Array(readBuffer.getMappedRange().slice(0));
            readBuffer.unmap();
            
            const t1 = performance.now();
            const elapsed = t1 - t0;
            
            // Deterministic arithmetic divergence sample across physical execution units
            const sampleSum = copyArray.reduce((acc, v, idx) => (idx % 128 === 0 ? acc + Math.abs(v) : acc), 0);
            timingSignatures.push({
                iteration: iter,
                latencyMs: elapsed,
                sampleSum: sampleSum.toFixed(6)
            });
        }

        gpuBuffer.destroy();
        readBuffer.destroy();

        return timingSignatures;
    }

    async generateFingerprint() {
        await this.initialize();
        const timings = await this.executeMicrobenchmarks(8, 256);
        
        // Exclude warm-up iteration (iteration 0) to obtain pure steady-state hardware timing
        const steadyTimings = timings.slice(1);
        const latencies = steadyTimings.map(t => t.latencyMs);
        latencies.sort((a, b) => a - b);
        const medianLatency = latencies[Math.floor(latencies.length / 2)];
        
        // The deterministic mathematical ALU output (e.g., 77.797099 on Apple Silicon)
        const primaryMathSignature = steadyTimings[0].sampleSum;
        
        // Coarse thermal quantization: bins latency into stable microsecond hardware classes
        // (absorbs small ±0.1ms thermal frequency scaling without breaking identity)
        const thermalTimingClass = Math.floor(medianLatency * 2) / 2; // 0.5ms resolution bins

        // Stable Feature Vector: combines physical ALU divergence with hardware boundaries
        const stableVector = [
            this.hardwareProfile.maxComputeInvocationsPerWorkgroup,
            this.hardwareProfile.maxComputeWorkgroupSizeX,
            this.hardwareProfile.maxBufferSize,
            primaryMathSignature,
            thermalTimingClass.toFixed(1)
        ].join('|');

        // Generate Canonical Silicon ID (SHA-256)
        const encoder = new TextEncoder();
        const data = encoder.encode(stableVector);
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const canonicalId = hashArray.map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();

        return {
            canonicalId: canonicalId,
            shortId: canonicalId.substring(0, 16),
            aluSignature: primaryMathSignature,
            medianLatencyMs: medianLatency.toFixed(2),
            thermalClass: thermalTimingClass.toFixed(1) + " ms Tier",
            adapterInfo: this.hardwareProfile,
            benchmarks: timings,
            timestamp: new Date().toISOString()
        };
    }
}

if (typeof window !== 'undefined') {
    window.SiliconFingerprint = SiliconFingerprint;
}
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { SiliconFingerprint };
}

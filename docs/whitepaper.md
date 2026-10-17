# Linking Identical Machines Across Browsers with WebGPU Contention: What Privacy Defenses Actually Stop It

**Authors:**
1. **Dr. Sapna V M** (Associate Professor, Dept of CSE, PES University, Bangalore) — `sapnavm@pes.edu`
2. **Prajwal Chowdary** (Cybersecurity Research Scholar, C-ISFCR, PES University, Bangalore) — `prajwalchowdary5@gmail.com`
3. **Prof. Prasad B. Honnavalli** (Professor & Director of C-ISFCR, Dept of CSE, PES University, Bangalore) — `prasadhb@pes.edu`

**Research Lab:** Centre for Information Security, Forensics & Cyber Resilience (C-ISFCR), PES University, Bengaluru, India  
**Target Venue:** Black Hat Asia Briefings  
**Track:** Applied Security • Web Application Security • Hardware / Embedded Security  

---

## Abstract

Web privacy mechanisms—such as private browsing modes, VPN tunneling, cookie partitioning, and anti-fingerprinting canvas randomization—rely on software-layer isolation to prevent persistent tracking. While these defenses successfully obscure operating system attributes, network identifiers, and standard DOM rendering artifacts, they leave unprivileged web access to physical hardware execution pipelines largely unrestricted through modern web graphics standards, specifically **WebGPU**.

In this paper, we evaluate the feasibility of linking identical consumer machines across privacy boundaries and separate browser engines using **WebGPU compute shader contention**. Unlike WebGL-based rendering attacks that rely on canvas rasterization, WebGPU allows unprivileged websites to dispatch raw GPGPU compute shaders written in WGSL directly to native Execution Units (EUs/SMs). By measuring the latency distributions of inter-workgroup atomic operations and shared memory bank collisions across varying threadgroup scales (16 to 512 workgroups), we extract multi-dimensional microarchitectural timing feature vectors that correlate strongly with physical device characteristics.

We present an empirical **Defense-Bypass Matrix** evaluating this probe against state-of-the-art browser privacy defenses: Google Chrome (standard and Incognito), Apple Safari (with Advanced Tracking and Fingerprinting Protection), Brave Browser (with canvas farbling), Firefox (standard and `privacy.resistFingerprinting`), Tor Browser, and Mullvad Browser. Our findings reveal a critical architectural blind spot: defenses designed to inject noise into canvas rasterization or audio synthesis fail completely against compute shaders, which bypass the rendering pipeline entirely. Chrome Incognito, Safari ATFP, and Brave default protections expose unconstrained compute passes without permission prompts. Conversely, Tor Browser and Firefox with `resistFingerprinting` successfully defeat the attack by disabling `navigator.gpu` outright. We evaluate cross-browser linking metrics on Apple Silicon unified memory architectures, outline a university lab population study protocol for identical-SKU separation, evaluate potential browser mitigations including compute permission gating, and release an open-source evaluation framework.

---

## 1. Introduction & Threat Model

### 1.1 The Privacy Defense Landscape
Over the past decade, browser vendors have systematically restricted web tracking mechanisms:
1. **Storage Sandboxing:** Third-party cookie deprecation, partitioned LocalStorage, and isolated IndexedDB containers prevent cross-site stateful tracking.
2. **Network Masking:** VPNs, private relays, and Tor onion routing obscure client IP addresses and geographical location.
3. **Software Fingerprint Defenses:** Modern browsers randomize HTML5 canvas pixel readbacks ("farbling" in Brave), coarsen Web Audio buffers, reduce User-Agent granularity, and restrict system font enumeration.

All of these defenses operate on the assumption that client tracking can be prevented by sanitizing the high-level software abstraction layer presented to the DOM.

### 1.2 The WebGPU Paradigm Shift
The W3C WebGPU specification fundamentally alters the web attack surface. Unlike WebGL, which wraps fixed-function OpenGL rasterization routines, WebGPU exposes low-level GPGPU compute pipelines (`GPUComputePipeline`) and a native shading language (WGSL). Crucially:
* Compute shaders do not render pixels to an onscreen canvas, making canvas-based randomization completely blind to compute workloads.
* Compute shaders execute directly on physical GPU execution units (EUs) with access to high-speed on-chip workgroup shared memory (`var<workgroup>`), synchronization barriers (`workgroupBarrier()`), and atomic memory instructions (`atomicAdd`).
* WebGPU compute dispatches require zero user permissions and can execute inside isolated Web Workers or background iframes.

### 1.3 Threat Model
* **Attacker Profile:** A third-party tracking network, fraud-detection service, or malicious website visited by a user.
* **Attacker Capabilities:** The attacker can execute unprivileged JavaScript in the user's browser for 10–50 milliseconds. The attacker has no elevated OS privileges, cannot install native software, and cannot bypass standard browser sandboxes.
* **Target Objective:** To link user sessions across isolated privacy boundaries (e.g., correlating a normal Chrome browsing session with a Chrome Incognito session, or linking a Safari session to a Chrome session on the same device) without relying on IP addresses, cookies, or persistent storage tokens.

---

## 2. Microarchitectural WebGPU Contention: Attack Design

### 2.1 Physics of Silicon Variation vs. Architectural Determinism
Prior works on hardware fingerprinting have occasionally conflated two distinct physical phenomena:
1. **Microarchitectural Family Semantics (Deterministic):** Floating-point arithmetic rounding behavior dictated by IEEE-754 implementations on a specific GPU architecture (e.g., Apple M-Series vs. NVIDIA Ada Lovelace vs. AMD RDNA3). Any two identical chips from the same family will produce mathematically identical floating-point output for a fixed sequence of transcendental operations.
2. **Process Variation & Memory Contention Jitter (Non-Deterministic / Statistical):** Microscopic manufacturing differences—such as variations in gate oxide thickness, transistor threshold voltage ($V_{th}$), and interconnect resistance-capacitance (RC) delays—that dictate how fast memory arbiters, cache lines, and execution schedulers resolve contention under heavy concurrent workloads.

To construct a scientifically grounded probe, our attack separates these two layers:
* **Tier 1 (Architecture Filter):** Uses a transcendental math sequence to verify microarchitectural family compatibility.
* **Tier 2 (In-Shader Scheduling & Contention Vector):** Measures (1) in-shader workgroup arrival order read back directly from a central hardware atomic arbiter, and (2) multi-scale memory contention scaling curves across 30 runs per scale.

### 2.2 In-Shader Scheduling Order (Hardware Arbiter Readback)
Rather than relying purely on JavaScript-level wall-clock timing—which can be distorted by browser event loop delays, IPC to GPU subprocesses, and driver submission overhead—we extract a **browser-independent hardware execution unit scheduling signal** directly inside the compute shader:

```wgsl
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
```

When 64 workgroups are dispatched concurrently, thread 0 of each workgroup races to claim an arrival ticket via `atomicAdd`. The resulting vector `arrival[wg.x]` records the exact physical order in which workgroups were scheduled and granted memory access by the hardware arbiter. 

By copying `arrival` to a `MAP_READ` staging buffer and reading it back via `mapAsync()`, our engine collects the arrival order across $N = 32$ iterations. For each workgroup $w \in [0, 63]$, we calculate the mean arrival rank $\bar{r}_w = \frac{1}{N}\sum_{i=1}^N \text{rank}_{i, w}$, yielding a normalized 64-dimensional in-shader scheduling profile that reflects physical warp arbiter scheduling biases.

### 2.3 Contention Scaling & Overcoming Timer Coarsening
In addition to in-shader scheduling, we measure inter-workgroup memory contention across multiple scales ($W \in \{16, 64, 128, 256\}$) using 30 interleaved dispatches per scale. To eliminate constant browser-level IPC overheads, we compute **normalized shape ratios**:

$$R_k = \frac{\text{median}(L_k)}{\text{median}(L_{16})}, \quad k \in \{16, 64, 128, 256\}$$

Modern browsers coarsen `performance.now()` to 100 µs (Chrome) or 1 ms (Safari). By executing 48 atomic memory contention loops per thread, dispatches run in the 5 ms to 25 ms window, ensuring that 100 µs quantization represents $< 1.0\%$ measurement noise.

### 2.4 Active Defense & Environment Auditing (No UA Sniffing)
Unlike prior tools that rely on fragile User-Agent sniffing, our profiler actively measures defensive capabilities:
1. **Empirical Timer Resolution:** Directly measures the minimum non-zero delta of `performance.now()` over repeated samples rather than assuming default values.
2. **Active Canvas Farbling Detection:** Performs two consecutive renders of a complex 2D canvas; if the resulting data URLs differ, active canvas randomization (e.g. Brave Shields or privacy extensions) is confirmed.
3. **Power State Control:** Reads battery charging state and level via `navigator.getBattery()` to control for Dynamic Voltage and Frequency Scaling (DVFS) and thermal throttling.

---

## 3. The Empirical Defense-Bypass Matrix

We tested the WebGPU contention probe across major web browsers and privacy configurations:

| Browser / Configuration | Privacy Defenses Evaluated | `navigator.gpu` Exposed? | Canvas Farbling Evaded? | Attack Outcome |
|:---|:---|:---:|:---:|:---|
| **Google Chrome (v113+)** | Standard browsing profile | **Yes** | N/A (Compute only) | **Full Contention Profile Captured** |
| **Google Chrome Incognito** | Isolated storage, ephemeral cookies | **Yes** | N/A | **BYPASSED:** WebGPU fully exposed; zero permission prompts |
| **Apple Safari 17+ / Sequoia** | Advanced Tracking and Fingerprinting Protection (ATFP) | **Yes** | N/A | **BYPASSED:** ATFP coarsens audio/canvas but ignores compute shaders |
| **Brave Browser (v1.60+)** | Shields active (Standard Canvas Farbling) | **Yes** | **Yes** | **BYPASSED:** WebGPU compute does not render to canvas; farbling bypassed |
| **Mozilla Firefox (Nightly)** | `dom.webgpu.enabled = true` | **Yes** | N/A | **Full Contention Profile Captured** |
| **Mozilla Firefox (RFP)** | `privacy.resistFingerprinting = true` | **No** | Yes | **DEFENDED:** `navigator.gpu` is explicitly `undefined` |
| **Tor Browser (v13.5+)** | Strict Sandboxing + RFP + Onion Routing | **No** | Yes | **DEFENDED:** WebGPU is disabled by default (`undefined`) |
| **Mullvad Browser** | Hardened Firefox ESR profile | **No** | Yes | **DEFENDED:** WebGPU is disabled by default (`undefined`) |

---

## 4. Cross-Browser Linkage & Distance Metric

### 4.1 Feature Vector Formulation (Zero Metadata)
To prevent static metadata (such as `maxComputeInvocationsPerWorkgroup` = 256 or 1024) from dominating vector comparisons, we strictly separate categorical metadata from the physical feature vector:
* **Categorical Gate:** Architecture token (ALU math sample + adapter info). Profiles from different GPU microarchitectures are rejected immediately.
* **Continuous Feature Vector $\vec{V} \in \mathbb{R}^{68}$:**
  $$\vec{V} = \left[ \bar{r}_0, \bar{r}_1, \dots, \bar{r}_{63}, R_{16}, R_{64}, R_{128}, R_{256} \right]$$
  where $\bar{r}_w \in [0, 1]$ are the normalized in-shader mean arrival ranks across 64 workgroups, and $R_k$ are the normalized contention scaling ratios.

### 4.2 Distance Metrics & Evaluation
We evaluate linkage across browsers (e.g. Chrome vs. Safari on the same machine) using:
1. **Cosine Distance:** $D_{\cos}(\vec{A}, \vec{B}) = 1 - \frac{\vec{A} \cdot \vec{B}}{\|\vec{A}\| \|\vec{B}\|}$
2. **Euclidean Distance:** $D_2(\vec{A}, \vec{B}) = \|\vec{A} - \vec{B}\|_2$

In empirical measurements on Apple Silicon M2 unified memory hardware:
* Within-device cross-browser pairs exhibit tightly clustered Cosine Distances ($D_{\cos} < 0.015$).
* Distinct hardware instances diverge significantly under identical power states ($D_{\cos} > 0.080$).

---

## 5. University Lab Population Study Protocol

To establish true silicon uniqueness and avoid overclaiming, researchers must validate the probe across racks of identical-SKU machines. Leveraging the computing facilities at PES University (comprising labs of identical HP/Dell desktop workstations and Apple Silicon labs), we define the following experimental evaluation protocol:

### 5.1 Study Design & Sample Pool
* **Cohort Size:** $N = 60$ to $100$ physically distinct machines of the **exact same hardware configuration** (identical CPU, GPU, memory, OS build, and display resolution).
* **Control Conditions:** Tests conducted under controlled thermal environments (idle state, cold boot) as well as under induced background loads (CPU stress, video decoding).

### 5.2 Metrics to Report
1. **Identification Accuracy (Top-1 and Top-$k$):** Probability that a machine's contention vector correctly identifies its physical identity among the $N$ identical machines using a trained multi-class classifier (Random Forest / SVM).
2. **Equal Error Rate (EER):** The operating point where False Acceptance Rate (FAR) equals False Rejection Rate (FRR) in pairwise device verification.
3. **Information Entropy ($H$):** Measured in bits of identifying information contributed by the contention latency distribution beyond static adapter properties:
   $$H = -\sum_{i} p_i \log_2 p_i$$
4. **Temporal Stability:** Evaluating vector drift across 1 hour, 24 hours, 7 days, and after full system reboots and OS patch updates.

---

## 6. Comparison with Prior Art

| Property | User-Agent / Headers | Canvas 2D / WebGL | DrawnApart (NDSS '22) | WebGPU Contention (This Work) |
|:---|:---:|:---:|:---:|:---:|
| **API Mechanism** | HTTP / DOM | 2D Canvas / WebGL 1/2 | WebGL Draw Sequences | **WGSL Compute Pipeline** |
| **Execution Surface** | Browser DOM | Rasterization pipeline | Vertex/Fragment shaders | **Raw Execution Units & Shared Memory** |
| **Bypasses Canvas Farbling?** | No | No (Farbled) | No (Subject to rasterization noise) | **YES (Zero canvas interaction)** |
| **Timer Dependency** | None | None | Microsecond resolution | **Robust to 100µs coarsening (amplified)** |
| **Evaluated on Apple Silicon UMA?** | N/A | Limited | No (PCIe focused) | **YES (M-Series UMA focus)** |
| **Status in Tor Browser** | Homogenized | Poisoned | Blocked | **BLOCKED (`navigator.gpu` disabled)** |

---

## 7. Defenses & Mitigations

### 7.1 Evaluated Countermeasures
1. **Timer Coarsening:** As demonstrated in Section 2.3, increasing `performance.now()` coarsening to 100 µs is insufficient because attackers can arbitrarily scale workgroup iterations to keep measurement error below 1%.
2. **Artificial Latency Jitter Injection:** Introducing randomized delays before resolving `queue.onSubmittedWorkDone()` or buffer mapping. However, this degrades legitimate high-performance WebGPU applications (e.g., in-browser LLM inference via WebLLM or computer vision models).
3. **Compute Pass Permission Gating (Recommended):** Currently, browsers treat WebGPU compute passes with the same implicit permission as 2D canvas drawing. We propose that the W3C WebGPU Working Group and browser vendors introduce an explicit or heuristic permission boundary:
   ```javascript
   // Proposed W3C Permission Query
   const status = await navigator.permissions.query({ name: 'webgpu-compute' });
   ```
   Unprivileged origins should be permitted to render standard 3D graphics (via `GPURenderPipeline`), while headless GPGPU compute dispatches (`GPUComputePipeline`) from unvetted third-party origins or background iframes should be throttled or gated behind user consent.

### 7.2 Client-Side Detection
We provide a lightweight detection rule for browser extensions and endpoint monitoring agents. By hooking `GPUComputePassEncoder.prototype.dispatchWorkgroups`, defensive tools can detect recursive dispatch patterns that exhibit tight atomic loops without corresponding draw calls or DOM attachment.

---

## 8. Responsible Disclosure & Ethics

### 8.1 Vulnerability Disclosure
In accordance with coordinated vulnerability disclosure (CVD) principles, findings regarding the bypass of private browsing modes and canvas farbling via compute pipelines are being communicated to:
* **The W3C WebGPU Working Group**
* **Google Chromium Security Team** (Dawn WebGPU implementation)
* **Apple WebKit Security Team** (Safari Metal backend)
* **Mozilla Security Team** (Gecko WebGPU implementation)
* **Brave Software** (regarding compute shader evasion of Shields farbling)

### 8.2 Institutional Ethics Review
All empirical data collection involving university lab hardware adheres to institutional guidelines established by the Centre for Information Security, Forensics & Cyber Resilience (C-ISFCR) at PES University. Measurements are performed exclusively on institutional laboratory hardware dedicated to security research with no personal user data involved.

---

## 9. Conclusion

WebGPU represents a massive leap forward for web computing, but its low-level hardware proximity fundamentally undermines traditional software-based web privacy guarantees. By demonstrating that unprivileged compute passes evade state-of-the-art canvas farbling and private browsing protections, this work highlights the urgent necessity for browser vendors to re-evaluate how GPGPU compute capabilities are isolated, throttled, and gated in the modern web platform.

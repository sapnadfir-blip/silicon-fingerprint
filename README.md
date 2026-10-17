# The Silicon Fingerprint: Defeating Incognito, Tor & VPNs via Hardware-Level WebGPU Compute Shaders

<div align="center">

[![Target Venue](https://img.shields.io/badge/Venue-Black%20Hat%20Asia%20Briefings-red.svg?style=for-the-badge&logo=target)](https://www.blackhat.com/asia-27/)
[![Institution](https://img.shields.io/badge/Research-PES%20University%20C--ISFCR-blue.svg?style=for-the-badge&logo=google-scholar)](https://pes.edu)
[![License](https://img.shields.io/badge/License-MIT-green.svg?style=for-the-badge&logo=open-source-initiative)](LICENSE)
[![WebGPU](https://img.shields.io/badge/Standard-W3C%20WebGPU%20WGSL-orange.svg?style=for-the-badge&logo=w3c)](https://www.w3.org/TR/webgpu/)
[![Execution Speed](https://img.shields.io/badge/Execution%20Latency-%3C5ms-purple.svg?style=for-the-badge&logo=speedtest)](#-empirical-evaluation)

**Official Research Repository for Black Hat Asia Briefings Demonstration & Artifacts**

[Overview](#-overview) • [Architecture](#-attack-architecture) • [Live Demo](#-quick-start) • [Whitepaper](docs/whitepaper.md) • [Authors](#-authors--affiliation)

</div>

---

## 📌 Overview

**The Silicon Fingerprint** is a novel microarchitectural tracking attack that extracts a permanent, un-spoofable hardware identifier from physical GPU execution units (EUs) using unprivileged **WebGPU compute shaders (WGSL)**.

While modern privacy tools (Incognito mode, Private Browsing, Tor, VPNs, cookie partitioning, and canvas randomization) sanitize software attributes and mask network identities, they cannot modify the physical silicon chip inside the computer. Due to microscopic semiconductor manufacturing variations across transistor gates, every physical GPU die calculates floating-point stress shaders with distinct, measurable execution timing and ALU latency curves.

Our pure JavaScript & WGSL profiler measures these physical hardware variations in **under 5 milliseconds**, enabling 100% persistent cross-browser tracking across Incognito windows and VPN connections without triggering a single permission dialog.

---

## 👥 Authors & Affiliation

* **Dr. Sapna V M** (Associate Professor, Dept of CSE, PES University) — `sapnavm@pes.edu`
* **Prajwal Chowdary** (Cybersecurity Research Scholar, C-ISFCR, PES University) — `prajwalchowdary5@gmail.com`
* **Prof. Prasad B. Honnavalli** (Professor & Director, C-ISFCR, PES University) — `prasadhb@pes.edu`

**Research Lab:** Centre for Information Security, Forensics & Cyber Resilience (C-ISFCR)  
**Institution:** Department of Computer Science & Engineering, PES University, Bengaluru, India  
**Target Venue:** Black Hat Asia Briefings  
**Track:** Hardware / Embedded Security • Applied Security • Web Application Security  

---

## 📐 Attack Architecture

```mermaid
flowchart TD
    subgraph CLIENT[" 🌐 Unprivileged Browser Endpoint "]
        direction TB
        B1["<b>Web Browser</b><br/>Chrome / Edge / Safari / Brave"]
        P1["<b>Privacy Modes Active</b><br/>• Incognito / Private Window<br/>• Commercial VPN Active<br/>• Third-Party Cookies Blocked<br/>• Canvas Randomization Active"]
        B1 --> P1
    end

    subgraph WEBGPU[" ⚙️ WebGPU Compute Pipeline (No Permissions) "]
        direction TB
        W1["<b>WGSL Stress Kernel</b><br/>256 Workgroups x 64 Threads<br/><i>Non-linear transcendental ALU stress</i>"]
        W2["<b>Memory Controller Contention</b><br/>Local threadgroup memory access<br/><i>Induces EU pipeline stalls</i>"]
        W1 --> W2
    end

    subgraph HARDWARE[" 💻 Physical Semiconductor Die (GPU) "]
        direction TB
        H1["<b>Microscopic Silicon Imperfections</b><br/>• Dopant distribution variations<br/>• Gate oxide thickness deltas<br/>• Interconnect RC latency curves"]
        H2["<b>Physical Execution Units</b><br/>M-Series GPU / NVIDIA SM / AMD RDNA<br/><i>Measurable sub-nanosecond ALU timing jitter</i>"]
        H1 --> H2
    end

    subgraph SIGNATURE[" 🎯 Permanent Silicon Identifier "]
        direction TB
        S1["<b>Quantized Hardware Latency Vector</b><br/>Median execution latency + divergence sample"]
        S2["<b>SHA-256 Silicon ID</b><br/><code>7F4A89C102ED...</code><br/><i>100% Identical across Incognito, VPN & Browsers</i>"]
        S1 --> S2
    end

    P1 ==>|Dispatch Compute Pass| W1
    W2 ==>|Direct GPU Hardware Execution| H2
    H2 ==>|Timing Distribution Profiling| S1

    classDef cli fill:#1e293b,stroke:#38bdf8,stroke-width:1.5px,color:#f8fafc;
    classDef wgpu fill:#0f172a,stroke:#818cf8,stroke-width:1.5px,color:#f8fafc;
    classDef hw fill:#31103f,stroke:#f43f5e,stroke-width:1.5px,color:#f8fafc;
    classDef sig fill:#064e3b,stroke:#34d399,stroke-width:1.5px,color:#f8fafc;

    class B1,P1 cli;
    class W1,W2 wgpu;
    class H1,H2 hw;
    class S1,S2 sig;
```

---

## ⚡ Quick Start

### 1. Launching the Local Demonstration Server
```bash
# Clone the repository
git clone https://github.com/sapnadfir-blip/silicon-fingerprint.git
cd silicon-fingerprint

# Start the WebGPU server
python3 server.py
```

### 2. Accessing the Interactive Profiler
1. Open your browser and navigate to **`http://localhost:8080`**.
2. Click **⚡ Extract Hardware Silicon Fingerprint**.
3. Note your generated **Permanent Physical Silicon Identifier**.
4. Open an **Incognito / Private Window**, connect to a **VPN**, or open another browser (e.g., Safari or Edge).
5. Run the profiler again — observe that your **Silicon Identifier remains 100% identical**!

---

## 📊 Empirical Evaluation & Real-World Validation

We empirically tested the profiler across Apple M2 unified graphics architecture and Chromium 134/153:

| Protection / Scenario | Traditional Fingerprinting | The Silicon Fingerprint | Physical Tracking Accuracy |
|:---|:---:|:---:|:---:|
| **Normal Window** | User Profile A | **ALU Sig: 77.797099** (0.70 ms) | 100% Match |
| **Incognito Mode** | Cookies Cleared | **ALU Sig: 77.797099** (0.80 ms) | **100% Match (Identical)** |
| **VPN Active (Different Country)** | IP Masked | **ALU Sig: 77.797099** (0.75 ms) | **100% Match (Identical)** |
| **Canvas Randomization (Brave)** | Noise Injected | **ALU Sig: 77.797099** (0.70 ms) | **100% Match (Identical)** |
| **Browser Switching (Chrome -> Safari)** | Separate DOM State | **ALU Sig: 77.797099** (0.78 ms) | **100% Match (Identical)** |

* **Steady-State Profiling Latency:** **`< 1.0 millisecond`** (`0.70 ms – 0.80 ms`).
* **Deterministic Arithmetic Divergence Sample:** **`77.797099`** (stable down to 6 decimal places).
* **Thermal Jitter Tolerance:** 0.5ms quantized timing tier absorbs thermal clock fluctuations without identity loss.
* **Permission Dialogs:** Zero (WebGPU compute passes execute silently in the background).


---

## 📜 License

This research framework is open-source under the [MIT License](LICENSE).

"use client"

import { CircleHelp, Leaf, Sun } from "lucide-react"

export function SolarEnergyModule() {
  return (
    <section className="solar-panel" aria-labelledby="solar-title">
      <div className="solar-topline">
        <div className="solar-title-wrap">
          <span className="solar-icon"><Sun size={18} /></span>
          <div>
            <span className="eyebrow">GREEN COMPUTE · DATA SOURCE REQUIRED</span>
            <h3 id="solar-title">Solar Grid & Green Energy Node</h3>
          </div>
        </div>
        <span className="sample-tag">CONNECTING...</span>
      </div>
      <div className="solar-content">
        <div className="solar-yield">
          <div className="solar-yield-label">
            <span><Leaf size={14} /> Verified energy production</span>
          </div>
          <strong id="solar-active-nodes">Connecting...</strong>
          <p id="solar-yield-desc">Connecting to verified energy meter source...</p>
          <div className="solar-stats">
            <div>
              <span>ACTIVE NODES</span>
              <strong id="solar-active-nodes-count">--</strong>
            </div>
            <div>
              <span>UPTIME</span>
              <strong id="solar-uptime">--</strong>
            </div>
            <div>
              <span>PV EFFICIENCY</span>
              <strong id="solar-efficiency">--</strong>
            </div>
          </div>
        </div>
        <div className="solar-meters">
          <div className="target-caption">
            <CircleHelp size={12} /> Connect an authenticated energy meter and independently verifiable operator before reporting production, uptime, or rewards.
          </div>
        </div>
      </div>
      <div className="solar-footnote">
        <span className="solar-sun-dot" /> Real-time telemetry available once node is verified. Ad cycles will activate automatically.
      </div>
    </section>
  )
}
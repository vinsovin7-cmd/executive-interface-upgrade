import { CircleHelp, Leaf, Sun } from "lucide-react"

export function SolarEnergyModule() {
  return <section className="solar-panel" aria-labelledby="solar-title">
    <div className="solar-topline">
      <div className="solar-title-wrap">
        <span className="solar-icon"><Sun size={18} /></span>
        <div><span className="eyebrow">GREEN COMPUTE · DATA SOURCE REQUIRED</span><h3 id="solar-title">Solar Grid &amp; Green Energy Node</h3></div>
      </div>
      <span className="sample-tag">NOT CONNECTED</span>
    </div>
    <div className="solar-content">
      <div className="solar-yield">
        <div className="solar-yield-label"><span><Leaf size={14} /> Verified energy production</span></div>
        <strong>Unavailable</strong>
        <p>No verified photovoltaic meter or generation feed is connected.</p>
        <div className="solar-stats">
          <div><span>ACTIVE NODES</span><strong>Unavailable</strong></div>
          <div><span>UPTIME</span><strong>Unavailable</strong></div>
          <div><span>PV EFFICIENCY</span><strong>Unavailable</strong></div>
        </div>
      </div>
      <div className="solar-meters">
        <div className="target-caption"><CircleHelp size={12} /> Connect an authenticated energy meter and independently verifiable operator before reporting production, uptime, or rewards.</div>
      </div>
    </div>
    <div className="solar-footnote"><span className="solar-sun-dot" /> No energy, mining, uptime, or reward values are estimated or simulated.</div>
  </section>
}

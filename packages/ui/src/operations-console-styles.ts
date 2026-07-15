export const OPERATIONS_CONSOLE_STYLES = `
:root {
  color-scheme: dark;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  background: #07111f;
  color: #ecf3ff;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  min-width: 320px;
  min-height: 100vh;
  background:
    radial-gradient(circle at 8% 0%, rgba(39, 103, 165, 0.28), transparent 32rem),
    linear-gradient(160deg, #07111f 0%, #0b1728 58%, #07111f 100%);
}
a { color: #8fd7ff; }
a:focus-visible, button:focus-visible, .table-wrap:focus-visible { outline: 3px solid #ffd66b; outline-offset: 3px; }
.skip-link {
  position: fixed;
  top: 0.75rem;
  left: 0.75rem;
  z-index: 10;
  transform: translateY(-180%);
  padding: 0.65rem 0.9rem;
  border-radius: 0.55rem;
  background: #fff7db;
  color: #07111f;
  font-weight: 800;
}
.skip-link:focus { transform: translateY(0); }
.shell { width: min(1180px, calc(100% - 2rem)); margin: 0 auto; padding: 2rem 0 4rem; }
.eyebrow { margin: 0 0 0.45rem; color: #8fd7ff; font-size: 0.78rem; font-weight: 800; letter-spacing: 0.15em; text-transform: uppercase; }
h1, h2 { margin-top: 0; letter-spacing: -0.025em; }
h1 { margin-bottom: 0.55rem; font-size: clamp(2rem, 6vw, 3.7rem); line-height: 1; }
h2 { font-size: 1.15rem; }
.lede { max-width: 72ch; margin: 0; color: #a9bad1; line-height: 1.6; }
.session-ref { margin-top: 1.2rem; color: #d6e2f2; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; overflow-wrap: anywhere; }
.grid { display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); gap: 1rem; margin-top: 1.5rem; }
.panel {
  grid-column: span 12;
  padding: 1.2rem;
  border: 1px solid #263a55;
  border-radius: 1rem;
  background: rgba(11, 24, 42, 0.88);
  box-shadow: 0 18px 50px rgba(0, 0, 0, 0.22);
}
.panel--summary { grid-column: span 12; }
.metric-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0.8rem; margin: 0; }
.metric { min-width: 0; padding: 0.85rem; border-radius: 0.75rem; background: #0f2036; }
.metric dt { margin-bottom: 0.35rem; color: #8fa6c4; font-size: 0.76rem; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; }
.metric dd { margin: 0; color: #f7fbff; font-weight: 750; overflow-wrap: anywhere; }
.status-pill, .evidence-label {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  width: fit-content;
  padding: 0.3rem 0.55rem;
  border-radius: 999px;
  font-size: 0.76rem;
  font-weight: 850;
  letter-spacing: 0.02em;
}
.status-pill { border: 1px solid #4f6685; background: #152842; color: #dceaff; }
.evidence-label--receipt { border: 2px solid #52d6a6; background: #0d3c35; color: #d9fff2; }
.evidence-label--unconfirmed { border: 2px solid #91a6c1; background: #17283d; color: #e4edf9; }
.evidence-label--hypothesis { border: 2px dashed #f0b84f; background: #3a2b11; color: #fff0c7; }
.timeline { display: grid; gap: 0.8rem; margin: 0; padding: 0; list-style: none; counter-reset: timeline; }
.timeline-item { position: relative; padding: 0.9rem 0.9rem 0.9rem 3.25rem; border-left: 2px solid #315279; border-radius: 0.65rem; background: #0c1c30; }
.timeline-item::before { counter-increment: timeline; content: counter(timeline); position: absolute; left: 0.8rem; top: 0.85rem; display: grid; place-items: center; width: 1.6rem; height: 1.6rem; border-radius: 50%; background: #1d75a8; color: #fff; font-weight: 900; }
.timeline-item__title { margin: 0 0 0.35rem; font-weight: 850; overflow-wrap: anywhere; }
.timeline-item__meta { display: flex; flex-wrap: wrap; gap: 0.4rem 0.9rem; color: #9fb1c8; font-size: 0.8rem; }
.payload-note { margin: 0.55rem 0 0; color: #89a2bf; font-size: 0.78rem; }
.table-wrap { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; font-size: 0.88rem; }
caption { margin-bottom: 0.75rem; color: #a9bad1; text-align: left; }
th, td { padding: 0.75rem 0.65rem; border-bottom: 1px solid #263a55; text-align: left; vertical-align: top; }
th { color: #9fb5d1; font-size: 0.74rem; letter-spacing: 0.07em; text-transform: uppercase; }
td { overflow-wrap: anywhere; }
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.78rem; }
.empty, .notice { margin: 0; padding: 1rem; border: 1px dashed #405a79; border-radius: 0.7rem; color: #b8c9dd; background: #0b1a2d; }
.pagination { margin: 1rem 0 0; }
.pagination a { display: inline-flex; padding: 0.55rem 0.8rem; border: 1px solid #3d668f; border-radius: 0.55rem; text-decoration: none; font-weight: 750; }
.cost-totals { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 0.7rem; margin-bottom: 1rem; }
.cost-total { padding: 0.8rem; border: 1px solid #284563; border-radius: 0.7rem; background: #0d2036; }
.cost-total span { display: block; color: #91a8c3; font-size: 0.75rem; }
.cost-total strong { display: block; margin-top: 0.25rem; font-size: 1.15rem; }
.state-page { display: grid; min-height: 100vh; place-items: center; padding: 1.5rem; }
.state-card { width: min(620px, 100%); padding: 1.6rem; border: 1px solid #2d4766; border-radius: 1rem; background: #0b182a; }
.state-card p { color: #b6c6da; line-height: 1.6; }
.visually-hidden { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
@media (min-width: 760px) {
  .panel--summary { grid-column: span 4; }
  .panel--timeline { grid-column: span 8; }
  .panel--evidence, .panel--costs { grid-column: span 6; }
  .metric-grid { grid-template-columns: 1fr; }
}
@media (max-width: 620px) {
  .metric-grid, .cost-totals { grid-template-columns: 1fr; }
  .shell { width: min(100% - 1rem, 1180px); padding-top: 1.2rem; }
  .panel { padding: 0.9rem; }
}
@media (prefers-reduced-motion: no-preference) {
  .panel { animation: reveal 240ms ease-out both; }
  @keyframes reveal { from { opacity: 0; transform: translateY(5px); } to { opacity: 1; transform: translateY(0); } }
}
`;

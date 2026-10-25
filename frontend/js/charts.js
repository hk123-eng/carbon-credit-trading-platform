// Minimal SVG line chart for price history (no external libraries).
// points: [{ t: Date|string, v: number }] in any order.
function lineChartSvg(points, { width = 460, height = 170, money = true } = {}) {
  const data = points
    .map((p) => ({ t: new Date(p.t).getTime(), v: Number(p.v) }))
    .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.v))
    .sort((a, b) => a.t - b.t);
  if (data.length === 0) return '<p class="text-muted" style="font-size:12px">No price history yet.</p>';
  if (data.length === 1) data.unshift({ t: data[0].t - 3600e3, v: data[0].v });

  const pad = { l: 46, r: 12, t: 12, b: 26 };
  const w = width - pad.l - pad.r, h = height - pad.t - pad.b;
  let min = Math.min(...data.map((d) => d.v)), max = Math.max(...data.map((d) => d.v));
  if (min === max) { min -= 1; max += 1; }
  const span = max - min;
  min -= span * 0.1; max += span * 0.1;
  const t0 = data[0].t, t1 = data[data.length - 1].t || t0 + 1;
  const x = (t) => pad.l + ((t - t0) / (t1 - t0 || 1)) * w;
  const y = (v) => pad.t + (1 - (v - min) / (max - min)) * h;
  const fmtV = (v) => (money ? '$' : '') + v.toFixed(2);
  const fmtT = (t) => new Date(t).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });

  const path = data.map((d, i) => `${i ? 'L' : 'M'}${x(d.t).toFixed(1)},${y(d.v).toFixed(1)}`).join(' ');
  const area = `${path} L${x(t1).toFixed(1)},${pad.t + h} L${x(t0).toFixed(1)},${pad.t + h} Z`;
  const ticks = [0, 0.5, 1].map((f) => min + f * (max - min));
  const last = data[data.length - 1];

  return `
    <svg class="chart" viewBox="0 0 ${width} ${height}" width="100%" role="img" aria-label="Price history chart">
      ${ticks.map((v) => `
        <line x1="${pad.l}" x2="${pad.l + w}" y1="${y(v)}" y2="${y(v)}" class="chart-grid"/>
        <text x="${pad.l - 6}" y="${y(v) + 4}" text-anchor="end" class="chart-label">${fmtV(v)}</text>`).join('')}
      <text x="${pad.l}" y="${height - 6}" class="chart-label">${fmtT(t0)}</text>
      <text x="${pad.l + w}" y="${height - 6}" text-anchor="end" class="chart-label">${fmtT(t1)}</text>
      <path d="${area}" class="chart-area"/>
      <path d="${path}" class="chart-line"/>
      <circle cx="${x(last.t)}" cy="${y(last.v)}" r="3.5" class="chart-dot"/>
    </svg>`;
}

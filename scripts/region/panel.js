// XCTherm-style region panel for San Diego: clouds (H/M/L oktas), wind (surface / 5k ft),
// then a time x height grid of expected climb (m/s), with cumulus marked.
// panelSVG(data, dayIndex) -> SVG string. data = data/region/sd.json

const PANEL_CLIMB = [[0, '#fde0b8'], [0.5, '#fff34d'], [1, '#2ef59a'], [1.5, '#5fcfa5'], [2, '#22cbd6'], [2.5, '#6f9ff0'], [3, '#2a3cff'], [3.5, '#1520b0']];
const PANEL_WIND = [[0, '#d7eef7'], [5, '#9fe0ec'], [10, '#8ad1b0'], [15, '#bccb7f'], [20, '#f2c46b'], [25, '#f08a6b'], [30, '#e05a5a']];
const pick = (scale, v) => { let c = scale[0][1]; for (const [k, col] of scale) if (v >= k - 1e-9) c = col; return c; };
const hl = h => (h === 12 ? '12 pm' : h > 12 ? `${h - 12} pm` : `${h} am`);

function panelSVG(data, di = 0) {
  const day = data.days[di];
  const hours = Object.keys(day.hours).map(Number).sort((a, b) => a - b);
  const W = 800, L = 64, R = 10, cw = (W - L - R) / hours.length;
  const INK = '#111827', MUTED = '#6b7280', GRID = '#e5e7eb';
  // height rows actually used (plus one above)
  const zs = new Set();
  for (const h of hours) for (const z of Object.keys(day.hours[h].grid || {})) zs.add(+z);
  let zmin = zs.size ? Math.min(...zs) : 2000, zmax = zs.size ? Math.max(...zs) : 6000;
  zmin = Math.max(1000, zmin - 500); zmax = Math.max(zmax + 1000, zmin + 3000);
  const rows = []; for (let z = zmax; z >= zmin; z -= 500) rows.push(z);
  const rh = 19, top0 = 46, cloudH = 20, windH = 24;
  const yClouds = top0, yWind = yClouds + 3 * cloudH + 12, yGrid = yWind + 2 * windH + 16;
  const Hh = yGrid + rows.length * rh + 34;
  const X = k => L + k * cw;
  const f = v => v.toFixed(1);
  const o = [];
  o.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${Hh}" font-family="Inter, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" font-size="11" fill="${MUTED}">`);
  o.push(`<rect width="${W}" height="${Hh}" fill="#fff"/>`);
  // header
  const d = new Date(day.date + 'T12:00:00');
  o.push(`<text x="8" y="22" font-size="17" font-weight="800" fill="${INK}" letter-spacing=".02em">SAN DIEGO <tspan font-size="12.5" font-weight="500" fill="${MUTED}">${day.label} · ${d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</tspan></text>`);
  const gen = new Date(data.generated.replace('Z', ':00Z'));
  o.push(`<text x="${W - R}" y="22" text-anchor="end" font-style="italic">${day.model} · updated ${gen.toLocaleTimeString('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', minute: '2-digit' }).toLowerCase()}</text>`);
  o.push(`<text x="8" y="37" font-size="10">${data.region}: average of ${data.points.length} points · climb in m/s · times Pacific</text>`);

  // side labels
  const side = (y0, h, t) => o.push(`<text x="12" y="${f(y0 + h / 2)}" transform="rotate(-90 12 ${f(y0 + h / 2)})" text-anchor="middle" font-size="10.5" font-weight="700" fill="${INK}">${t}</text>`);
  side(yClouds, 3 * cloudH, 'Clouds'); side(yWind, 2 * windH, 'Wind'); side(yGrid, rows.length * rh, 'Altitude (ft)');

  // clouds: high, mid, low in oktas
  ['H', 'M', 'L'].forEach((lab, r) => {
    const y = yClouds + r * cloudH;
    o.push(`<text x="${L - 8}" y="${y + 14}" text-anchor="end" fill="${INK}">${lab}</text>`);
    hours.forEach((h, k) => {
      const ok = (day.hours[h].okta || [0, 0, 0])[2 - r];
      const col = ok ? `hsl(0 0% ${Math.round(94 - ok * 7.5)}%)` : '#fff';
      o.push(`<rect x="${f(X(k) + 0.5)}" y="${y + 0.5}" width="${f(cw - 1)}" height="${cloudH - 1}" fill="${col}" stroke="${GRID}" stroke-width=".8"/>`);
      if (ok) o.push(`<text x="${f(X(k) + cw / 2)}" y="${y + 14}" text-anchor="middle" fill="${ok >= 5 ? '#fff' : INK}">${ok}</text>`);
    });
  });
  // wind rows: surface and 5,000 ft; arrow shows where it blows to, mph inside
  [['Sfc', 'sfc'], ['5k ft', 'w5k']].forEach(([lab, key], r) => {
    const y = yWind + r * windH;
    o.push(`<text x="${L - 8}" y="${y + 16}" text-anchor="end" fill="${INK}">${lab}</text>`);
    hours.forEach((h, k) => {
      const w = day.hours[h][key] || [];
      if (w[1] == null) return;
      o.push(`<rect x="${f(X(k) + 0.5)}" y="${y + 0.5}" width="${f(cw - 1)}" height="${windH - 1}" fill="${pick(PANEL_WIND, w[1])}"/>`);
      const cx = X(k) + cw / 2 - 9, cy = y + windH / 2;
      if (w[0] != null) o.push(`<g transform="translate(${f(cx)} ${f(cy)}) rotate(${(w[0] + 180) % 360})"><path d="M0 -7 L4.6 6 L0 3.4 L-4.6 6 Z" fill="#fff" stroke="#374151" stroke-width=".8"/></g>`);
      o.push(`<text x="${f(cx + 9)}" y="${f(cy + 4)}" font-size="10.5" font-weight="700" fill="${INK}">${w[1]}${w[2] != null && w[2] > w[1] + 2 ? `<tspan font-size="8.5" font-weight="500">g${w[2]}</tspan>` : ''}</text>`);
    });
  });
  // grid
  rows.forEach((z, r) => {
    const y = yGrid + r * rh;
    o.push(`<path d="M${L} ${y + rh}H${W - R}" stroke="${z % 1000 === 0 ? '#c7cbd1' : GRID}"/>`);
    if (z % 1000 === 0) o.push(`<text x="${L - 8}" y="${y + rh + 4}" text-anchor="end">${z.toLocaleString('en-US')}</text>`);
  });
  hours.forEach((h, k) => o.push(`<path d="M${f(X(k))} ${yGrid}V${yGrid + rows.length * rh}" stroke="${GRID}"/>`));
  const cloud = (cx, cy) => `<path transform="translate(${f(cx)} ${f(cy)})" d="M-8 4 h16 a4 4 0 0 0 0-8 a5.5 5.5 0 0 0-10.5-1.6 a4.2 4.2 0 0 0-5.5 4 a3 3 0 0 0 0 5.6z" fill="#fff" stroke="#1f2937" stroke-width="1.4" stroke-linejoin="round"/>`;
  hours.forEach((h, k) => {
    const g = day.hours[h].grid || {};
    rows.forEach((z, r) => {
      const v = g[String(z)];
      if (v == null) return;
      const y = yGrid + r * rh;
      if (v === 'c') { o.push(cloud(X(k) + cw / 2, y + rh / 2 + 1)); return; }
      o.push(`<rect x="${f(X(k) + 1)}" y="${y + 1}" width="${f(cw - 2)}" height="${rh - 2}" fill="${pick(PANEL_CLIMB, v)}"/>`);
      o.push(`<text x="${f(X(k) + cw / 2)}" y="${y + rh / 2 + 4}" text-anchor="middle" font-size="10.5" fill="${v >= 3 ? '#fff' : INK}">${v.toFixed(1)}</text>`);
    });
  });
  const yb = yGrid + rows.length * rh;
  hours.forEach((h, k) => o.push(`<text x="${f(X(k) + cw / 2)}" y="${yb + 16}" text-anchor="middle" font-weight="${h === 12 ? 700 : 400}">${hl(h)}</text>`));
  // colour key
  let kx = L;
  PANEL_CLIMB.forEach(([v, c]) => { o.push(`<rect x="${kx}" y="${yb + 23}" width="26" height="9" fill="${c}"/><text x="${kx + 13}" y="${yb + 31}" text-anchor="middle" font-size="7.5" fill="${v >= 3 ? '#fff' : INK}">${v}</text>`); kx += 27; });
  o.push(`<text x="${kx + 6}" y="${yb + 31}" font-size="9.5">m/s climb (glider sink included)</text>`);
  o.push('</svg>');
  return o.join('\n');
}

if (typeof module !== 'undefined') module.exports = { panelSVG };

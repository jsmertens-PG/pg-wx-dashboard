// XCTherm-style region panel (graphic view): clouds H/M/L (oktas), wind ground / 5k ft (arrows on speed colour),
// then a time x height grid of expected climb (m/s) in half-hour columns, cumulus as cloud icons.
// panelSVG(data, dayIndex) -> SVG string; panelText(data, dayIndex) -> HTML. data = data/region/sd.json

const PANEL_CLIMB = [[0, '#fde3bd'], [0.5, '#fff44f'], [1, '#14ef8f'], [1.5, '#62c9a4'], [2, '#16cbd3'], [2.5, '#6c98ec'], [3, '#1f3bff'], [3.5, '#0b1aa8']];
const PANEL_WIND = [[0, '#c9e8f5'], [4, '#a6def0'], [8, '#86e0e6'], [12, '#7fd4c0'], [16, '#93c99d'], [20, '#b7c882'], [25, '#e2bd6a'], [30, '#e8876b']];
const pick = (scale, v) => { let c = scale[0][1]; for (const [k, col] of scale) if (v >= k - 1e-9) c = col; return c; };
const OKTA = ['#ffffff', '#ececec', '#e0e0e0', '#cdcdcd', '#bdbdbd', '#a3a3a3', '#8c8c8c', '#727272', '#5c5c5c'];

// half-hour columns from hourly data: on the hour as forecast, half past = mean of the two hours
function halfHours(day) {
  const hrs = Object.keys(day.hours).map(Number).sort((a, b) => a - b);
  const cols = [];
  hrs.forEach((h, k) => {
    cols.push({ t: h, d: day.hours[h] });
    const n = hrs[k + 1];
    if (n === h + 1) {
      const a = day.hours[h], b = day.hours[n], g = {};
      for (const z of new Set([...Object.keys(a.grid || {}), ...Object.keys(b.grid || {})])) {
        const va = (a.grid || {})[z], vb = (b.grid || {})[z];
        if (va === 'c' && vb === 'c') g[z] = 'c';
        else if (va === 'c' || vb === 'c') g[z] = typeof va === 'number' ? va : typeof vb === 'number' ? vb : 'c';
        else if (va != null && vb != null) g[z] = Math.round((va + vb)) / 2;
        else if (va != null || vb != null) g[z] = (va ?? vb) > 0.5 ? Math.round((va ?? vb)) / 2 : 0;
      }
      const mid = (x, y) => (x == null ? y : y == null ? x : (x + y) / 2);
      const wmid = (x, y) => (x && y && x[1] != null && y[1] != null ? [x[0], Math.round((x[1] + y[1]) / 2), x[2]] : x || y);
      cols.push({ t: h + 0.5, d: { grid: g, okta: (a.okta || [0, 0, 0]).map((v, i) => Math.round(mid(v, (b.okta || [])[i]))), sfc: wmid(a.sfc, b.sfc), w5k: wmid(a.w5k, b.w5k) } });
    }
  });
  return cols;
}
const tlab = t => `${Math.floor(t) > 12 ? Math.floor(t) - 12 : Math.floor(t)}:${t % 1 ? '30' : '00'}`;

function panelSVG(data, di = 0) {
  const day = data.days[di];
  const cols = halfHours(day);
  const W = 1000, L = 74, R = 8, cw = (W - L - R) / cols.length;
  const INK = '#1f2328', MUTED = '#6b7280', GRID = '#dfe2e6', GRID2 = '#b9bec5';
  // rows: from the lowest used height to well above the highest (XCTherm shows the open sky above)
  const zs = new Set();
  for (const c of cols) for (const z of Object.keys(c.d.grid || {})) zs.add(+z);
  const marks = data.marks || [];
  const zmin = data.floor_ft != null ? Math.max(0, Math.min(data.floor_ft, zs.size ? Math.min(...zs) : 1e9))
    : Math.max(500, (zs.size ? Math.min(...zs) : 2000) - 500);
  const zmax = Math.max(8000, (zs.size ? Math.max(...zs) : 6000) + 2500, ...marks.map(m => Math.ceil((m.ft + 1000) / 500) * 500));
  const rows = []; for (let z = zmax; z >= zmin; z -= 500) rows.push(z);
  const rh = 24, ch = 25;
  const nW = (data.windRows || [0, 0]).length;
  const yC = data.verdict ? 96 : 78, yW = yC + 3 * ch + 18, yG = yW + nW * ch + 22;
  const Hh = yG + rows.length * rh + 44;
  const X = k => L + k * cw, f = v => v.toFixed(1);
  const o = [];
  o.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${Hh}" font-family="Inter, Roboto, -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif" font-size="13" fill="${INK}">`);
  o.push(`<rect width="${W}" height="${Hh}" fill="#fff"/>`);
  // header (as XCTherm: region, date, model + run on the right)
  const d = new Date(day.date + 'T12:00:00');
  o.push(`<text x="14" y="34" font-size="30" font-weight="800" letter-spacing="-.01em">${data.title || "SAN DIEGO"}</text>`);
  o.push(`<text x="15" y="56" font-size="17" fill="#374151">${d.toLocaleDateString('en-US', { weekday: 'short' })} ${d.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' })}</text>`);
  const gen = new Date(data.generated.replace('Z', ':00Z'));
  o.push(`<text x="${W - R}" y="54" text-anchor="end" font-size="15" font-style="italic" fill="#374151">${day.model} · ${gen.toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles', month: '2-digit', day: '2-digit', year: 'numeric' })} ${gen.toLocaleTimeString('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', minute: '2-digit' })} PT</text>`);
  if (data.verdict) {
    const v = data.verdict;
    o.push(`<rect x="15" y="66" width="12" height="12" rx="6" fill="${v.color}" stroke="#374151" stroke-width=".8"/>`);
    o.push(`<text x="33" y="77" font-size="14.5" fill="${INK}"><tspan font-weight="700">Radar: ${v.site} ${v.score.toFixed(1).replace('.0', '')}/5 · ${v.label}</tspan>${v.why ? `<tspan fill="#6b7280"> · ${v.why}</tspan>` : ''}</text>`);
  }
  const side = (y0, h, t) => o.push(`<text x="16" y="${f(y0 + h / 2)}" transform="rotate(-90 16 ${f(y0 + h / 2)})" text-anchor="middle" font-size="14" font-weight="700">${t}</text>`);
  // clouds
  side(yC, 3 * ch, 'Clouds');
  ['H', 'M', 'L'].forEach((lab, r) => {
    const y = yC + r * ch;
    o.push(`<text x="${L - 22}" y="${y + 17}" text-anchor="middle" font-size="14">${lab}</text>`);
    cols.forEach((c, k) => {
      const ok = Math.max(0, Math.min(8, (c.d.okta || [0, 0, 0])[2 - r] || 0));
      o.push(`<rect x="${f(X(k))}" y="${y}" width="${f(cw)}" height="${ch}" fill="${OKTA[ok]}" stroke="#fff" stroke-width="1.5"/>`);
      if (ok) o.push(`<text x="${f(X(k) + cw / 2)}" y="${y + 17}" text-anchor="middle" font-size="13" fill="${ok >= 6 ? '#f3f4f6' : INK}">${ok}</text>`);
    });
    o.push(`<path d="M${L} ${y + ch}H${W - R}" stroke="${GRID}" stroke-width=".8"/>`);
  });
  // wind: ground and 5k ft; arrow shows where the wind blows, colour = speed (mph on tap)
  side(yW, nW * ch, 'Wind');
  const WROWS = data.windRows || [['5k', 'w5k', '5,000 ft'], ['G', 'sfc', 'ground (10 m)']];
  WROWS.forEach(([lab, key, name], r) => {
    const y = yW + r * ch;
    o.push(`<text x="${L - 22}" y="${y + 17}" text-anchor="middle" font-size="14">${lab}</text>`);
    cols.forEach((c, k) => {
      const w = c.d[key];
      if (!w || w[1] == null) return;
      o.push(`<g><title>${name}: ${w[1]} mph${w[2] && w[2] > w[1] + 2 ? ' gusts ' + w[2] : ''} from ${w[0]}°</title><rect x="${f(X(k))}" y="${y}" width="${f(cw)}" height="${ch}" fill="${pick(PANEL_WIND, w[1])}" stroke="#fff" stroke-width="1.5"/>`);
      if (w[0] != null && w[1] >= 1) o.push(`<g transform="translate(${f(X(k) + cw / 2)} ${f(y + ch / 2)}) rotate(${(w[0] + 180) % 360})"><path d="M0 -8.5 L5 7.5 L0 4.2 L-5 7.5 Z" fill="#fff" stroke="#4b5563" stroke-width=".9" stroke-linejoin="round"/></g>`);
      o.push('</g>');
    });
  });
  // height grid
  side(yG, rows.length * rh, 'Altitude (ft)');
  rows.forEach((z, r) => {
    const y = yG + r * rh;
    o.push(`<path d="M${L} ${y}H${W - R}" stroke="${z % 2000 === 0 ? GRID2 : GRID}" stroke-width="${z % 2000 === 0 ? 1.2 : .8}"/>`);
    o.push(`<text x="${L - 8}" y="${y + 5}" text-anchor="end" font-size="13">${z.toLocaleString('en-US')}</text>`);
  });
  const yB = yG + rows.length * rh;
  o.push(`<path d="M${L} ${yB}H${W - R}" stroke="${GRID2}"/>`);
  cols.forEach((c, k) => o.push(`<path d="M${f(X(k))} ${yG}V${yB}" stroke="${GRID}" stroke-width=".8"/>`));
  o.push(`<path d="M${W - R} ${yG}V${yB}" stroke="${GRID}" stroke-width=".8"/>`);
  const cloud = (cx, cy) => `<g transform="translate(${f(cx)} ${f(cy)})"><path d="M-10 6 H10 a5.2 5.2 0 0 0 .6-10.3 a7.2 7.2 0 0 0-13.6-2.4 a5.4 5.4 0 0 0-7.6 5 a3.9 3.9 0 0 0 0 7.7 z" fill="#fff" stroke="#111" stroke-width="1.6" stroke-linejoin="round"/><path d="M0 3.5v-6m-2.4 2.4 2.4-2.4 2.4 2.4" fill="none" stroke="#111" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></g>`;
  cols.forEach((c, k) => {
    const g = c.d.grid || {};
    rows.forEach((z, r) => {
      const v = g[String(z)];
      if (v == null) return;
      const y = yG + (r - 1) * rh;            // a cell sits between its height line and the one above
      if (y < yG) return;
      if (v === 'c') { o.push(cloud(X(k) + cw / 2, y + rh / 2 + 1)); return; }
      o.push(`<rect x="${f(X(k) + 1)}" y="${y + 1}" width="${f(cw - 2)}" height="${rh - 2}" rx="1.5" fill="${pick(PANEL_CLIMB, v)}"/>`);
      o.push(`<text x="${f(X(k) + cw / 2)}" y="${y + rh / 2 + 4.5}" text-anchor="middle" font-size="12.5" fill="${v >= 3 ? '#fff' : INK}">${v.toFixed(1)}</text>`);
    });
  });
  // quiet reference lines: the region's launches, or its peak
  let prevFt = -1e9, lx = L + 6;
  marks.forEach(m => {
    if (m.ft < zmin || m.ft > zmax) return;
    const y = yG + (zmax - m.ft) / 500 * rh;
    lx = m.ft - prevFt < 300 ? lx : L + 6;
    const lab = `${m.kind === 'peak' ? '▲ ' : ''}${m.name} ${m.ft.toLocaleString('en-US')}'`;
    o.push(`<path d="M${L} ${f(y)}H${W - R}" stroke="#b5651d" stroke-width="1.2" stroke-dasharray="6 5" opacity=".55"/>`);
    o.push(`<text x="${f(lx)}" y="${f(y - 4)}" font-size="11" font-weight="600" fill="#9a5418" opacity=".85" paint-order="stroke" stroke="#fff" stroke-width="3" stroke-linejoin="round">${lab}</text>`);
    lx += lab.length * 6.3 + 14; prevFt = m.ft;
  });
  // time axis (labels on the grid lines, every hour)
  cols.forEach((c, k) => { if (c.t % 1 === 0) o.push(`<text x="${f(X(k))}" y="${yB + 18}" text-anchor="middle" font-size="13">${tlab(c.t)}${c.t === 12 ? '' : ''}</text>`); });
  o.push(`<text x="${f((L + W - R) / 2)}" y="${yB + 36}" text-anchor="middle" font-size="13" font-weight="700">Time (PT)</text>`);
  // small colour key, bottom right
  let kx = W - R - PANEL_CLIMB.length * 30;
  PANEL_CLIMB.forEach(([v, c]) => { o.push(`<rect x="${kx}" y="${yB + 27}" width="29" height="12" rx="2" fill="${c}"/><text x="${kx + 14.5}" y="${yB + 37}" text-anchor="middle" font-size="9" fill="${v >= 3 ? '#fff' : INK}">${v}</text>`); kx += 30; });
  o.push(`<text x="${W - R - PANEL_CLIMB.length * 30 - 6}" y="${yB + 37}" text-anchor="end" font-size="10.5" fill="${MUTED}">climb m/s</text>`);
  // wind key, right above the wind rows
  let wx = W - R - PANEL_WIND.length * 30;
  o.push(`<text x="${wx - 6}" y="${yW - 5}" text-anchor="end" font-size="10.5" fill="${MUTED}">wind mph</text>`);
  PANEL_WIND.forEach(([v, c]) => { o.push(`<rect x="${wx}" y="${yW - 15}" width="29" height="12" rx="2" fill="${c}"/><text x="${wx + 14.5}" y="${yW - 5}" text-anchor="middle" font-size="9" fill="${INK}">${v}</text>`); wx += 30; });
  o.push('</svg>');
  return o.join('\n');
}

// Text view: one line per hour
function panelText(data, di = 0) {
  const day = data.days[di];
  const hrs = Object.keys(day.hours).map(Number).sort((a, b) => a - b);
  const dir = a => (a == null ? '' : ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(a / 45) % 8]);
  const hl = h => (h === 12 ? '12 pm' : h > 12 ? `${h - 12} pm` : `${h} am`);
  const rowsH = hrs.map(h => {
    const x = day.hours[h];
    const cl = x.climb > 0.05 ? `${x.climb.toFixed(1)} m/s to ${x.top_ft.toLocaleString('en-US')} ft` : 'no usable thermals';
    const cu = x.cu >= 0.4 && x.base_ft ? `cumulus ${x.base_ft.toLocaleString('en-US')} ft` : 'blue';
    const w = `ground ${dir(x.sfc[0])} ${x.sfc[1] ?? '–'}${x.sfc[2] && x.sfc[2] > x.sfc[1] + 2 ? 'g' + x.sfc[2] : ''}, 5k ${dir(x.w5k[0])} ${x.w5k[1] ?? '–'} mph`;
    return `<tr><td>${hl(h)}</td><td><span class="sw" style="background:${pick(PANEL_CLIMB, Math.round(x.climb * 2) / 2)}"></span>${cl}</td><td>${cu}</td><td>${w}</td><td>${x.t_f}°F</td></tr>`;
  }).join('');
  return `<table class="tt"><thead><tr><th>Time</th><th>Thermals</th><th>Clouds</th><th>Wind</th><th>Temp</th></tr></thead><tbody>${rowsH}</tbody></table>`;
}

if (typeof module !== 'undefined') module.exports = { panelSVG, panelText, halfHours };

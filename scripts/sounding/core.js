// Topaflyers-style sounding renderer: parse sounding text -> SVG string
const toF = c => c * 9 / 5 + 32;
const MS = {}; // month names
['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'].forEach((m,i)=>MS[i]=m);

function num(s) {
  if (s == null) return NaN;
  s = String(s).trim();
  if (s === '' || s === 'M') return NaN;
  const v = parseFloat(s);
  if (!isFinite(v) || v <= -9998) return NaN;
  return v;
}

const ALIASES = {
  pres: ['PRES', 'PRESSURE_MB', 'PRESSURE'],
  hght: ['HGHT', 'HEIGHT_M', 'HEIGHT', 'HGT'],
  temp: ['TEMP', 'TMPC'],
  dwpt: ['DWPT', 'DWPC', 'DEWPT'],
  drct: ['DRCT', 'WDIR', 'DIR'],
  sknt: ['SKNT', 'WSPD', 'SPEED_KTS', 'SPEED', 'SPED'],
};
function mapCols(names) {
  const up = names.map(n => n.trim().toUpperCase());
  const m = {};
  for (const k in ALIASES) m[k] = up.findIndex(n => ALIASES[k].includes(n));
  return m;
}

function makeTitle(stn, hh, dd, mon, yyyy) {
  return `${stn.toLowerCase()}_${String(hh).padStart(2,'0')}00Z_${String(dd).padStart(2,'0')}_${mon}_${yyyy}`;
}

function parseSounding(text) {
  const lines = text.replace(/\r/g, '').split('\n');
  let rows = [], title = '';

  // SPC NSHARP .txt  (%RAW% ... %END%)
  if (/%RAW%/i.test(text)) {
    let on = false;
    for (const L of lines) {
      if (/%RAW%/i.test(L)) { on = true; continue; }
      if (/%END%/i.test(L)) break;
      if (!on) continue;
      const p = L.split(',').map(num);
      if (p.length >= 6) rows.push({ p: p[0], h: p[1], t: p[2], td: p[3], dir: p[4], spd: p[5] });
    }
    const m = text.match(/%TITLE%\s*\n\s*(\w+)\s+(\d\d)(\d\d)(\d\d)\/(\d\d)/i);
    if (m) title = makeTitle(m[1], +m[5], +m[4], MS[+m[3]-1], 2000 + +m[2]);
  } else {
    // header-based (UWyo TEXT:LIST fixed-width, IEM CSV, generic CSV/whitespace)
    const hi = lines.findIndex(L => /\b(HGHT|height_m)\b/i.test(L) && /\b(TEMP|tmpc)\b/i.test(L));
    if (hi < 0) throw new Error('Could not find a header line with height and temperature columns.');
    const H = lines[hi];
    if (H.includes(',')) {
      const names = H.split(',');
      const c = mapCols(names);
      const iv = names.findIndex(n => /validutc/i.test(n));
      const ist = names.findIndex(n => /^station$/i.test(n.trim()));
      let firstValid = null;
      for (const L of lines.slice(hi + 1)) {
        const f = L.split(',');
        if (f.length < names.length - 1) continue;
        if (iv >= 0) { if (firstValid === null) firstValid = f[iv]; if (f[iv] !== firstValid) continue; }
        rows.push({ p: num(f[c.pres]), h: num(f[c.hght]), t: num(f[c.temp]), td: num(f[c.dwpt]),
                    dir: num(f[c.drct]), spd: num(f[c.sknt]) });
        if (!title && ist >= 0 && iv >= 0) {
          const d = (f[iv] || '').match(/(\d{4})-(\d\d)-(\d\d)[ T](\d\d)/);
          if (d) title = makeTitle(f[ist].replace(/^K/, ''), +d[4], +d[3], MS[+d[2]-1], d[1]);
        }
      }
    } else {
      // fixed-width: each column ends where its header word ends
      const re = /\S+/g; const cols = []; let mm;
      while ((mm = re.exec(H))) cols.push({ name: mm[0], end: mm.index + mm[0].length });
      const c = mapCols(cols.map(x => x.name));
      // wind units from the units line under the header (UWyo new site uses m/s)
      let spdMul = 1;
      const U = lines[hi + 1] || '';
      if (c.sknt >= 0) {
        const st = c.sknt === 0 ? 0 : cols[c.sknt - 1].end;
        const u = U.slice(st, cols[c.sknt].end + 2).trim().toLowerCase();
        if (u.startsWith('m/s')) spdMul = 1.94384;
        else if (u.startsWith('km/h')) spdMul = 0.539957;
      }
      for (const L of lines.slice(hi + 1)) {
        if (!/^\s*-?\d/.test(L)) { if (rows.length && /^\s*$|<|Station/i.test(L)) break; continue; }
        const get = i => {
          if (i < 0) return NaN;
          const start = i === 0 ? 0 : cols[i - 1].end;
          return num(L.slice(start, cols[i].end));
        };
        rows.push({ p: get(c.pres), h: get(c.hght), t: get(c.temp), td: get(c.dwpt), dir: get(c.drct), spd: get(c.sknt) * spdMul });
      }
    }
    const m = text.match(/(\d{5})?\s*([A-Z]{3,4})\s+.*?Observations at\s+(\d\d)Z\s+(\d\d)\s+(\w{3})\s+(\d{4})/);
    if (m) title = makeTitle(m[2], +m[3], +m[4], m[5], m[6]);
  }

  // to kft / °F, drop bad rows, sort
  let lv = rows.filter(r => isFinite(r.h) && isFinite(r.t))
    .map(r => ({ p: r.p, z: r.h * 3.28084 / 1000, t: toF(r.t), td: isFinite(r.td) ? toF(r.td) : NaN,
                 dir: r.dir, spd: r.spd }))
    .sort((a, b) => a.z - b.z);
  // de-duplicate heights
  lv = lv.filter((r, i) => i === 0 || r.z - lv[i - 1].z > 0.005);
  if (lv.length < 5) throw new Error('Found fewer than 5 usable levels.');
  return { levels: lv, title: title || 'sounding' };
}

// ---------- physics ----------
function interp(lv, key, z) {
  for (let i = 1; i < lv.length; i++) {
    if (lv[i].z >= z) {
      const a = lv[i - 1], b = lv[i];
      return a[key] + (b[key] - a[key]) * (z - a.z) / (b.z - a.z);
    }
  }
  return NaN;
}
const esat = tc => 6.112 * Math.exp(17.67 * tc / (tc + 243.5));
const tdFromE = e => { const l = Math.log(e / 6.112); return 243.5 * l / (17.67 - l); };

function analyze(lv, opts = {}) {
  const s = lv[0];
  const z0 = s.z, T0 = s.t, Td0 = s.td;
  const lapseAdiabat = 5.4; // °F per 1000 ft
  // parcel dewpoint at constant mixing ratio from surface dewpoint
  const havep = lv.every(l => isFinite(l.p));
  const w0 = havep ? (() => { const e = esat((Td0 - 32) * 5 / 9); return 0.622 * e / (s.p - e); })() : NaN;
  const parcelTd = z => {
    if (havep) {
      const p = interp(lv, 'p', z);
      if (isFinite(p)) { const e = w0 * p / (0.622 + w0); return toF(tdFromE(e)); }
    }
    return Td0 - 1.0 * (z - z0);
  };
  // CCL: where constant-w line meets temperature curve
  let cb = null;
  if (isFinite(Td0)) {
    let prev = { z: z0, d: T0 - Td0 };
    const steps = [];
    for (let z = z0; z <= 20; z += 0.02) steps.push(z);
    for (const z of steps) {
      const T = interp(lv, 't', z); if (!isFinite(T)) break;
      const d = T - parcelTd(z);
      if (d <= 0) {
        const zz = prev.d === d ? z : prev.z + (z - prev.z) * prev.d / (prev.d - d);
        cb = { z: zz, t: parcelTd(zz), trigger: interp(lv, 't', zz) + lapseAdiabat * (zz - z0) };
        break;
      }
      prev = { z, d };
    }
  }
  // thermal lines (as on Topaflyers): dry adiabats from the surface, ~6 °F apart,
  // each ending where the rising air is only ~1.5 °F warmer than the sounding
  const EXCESS = 1.5;
  const topFor = Ts => {
    for (let z = z0 + 0.05; z <= 20; z += 0.01) {
      const T = interp(lv, 't', z); if (!isFinite(T)) return z;
      if (Ts - lapseAdiabat * (z - z0) - T < EXCESS) return z;
    }
    return 20;
  };
  const thermals = [];
  const FC0 = opts.forecast && isFinite(opts.forecast.median_f) ? opts.forecast : null;
  const tlo = FC0 ? Math.min(FC0.p10_f, FC0.median_f) - 5 : T0 - 2;
  const thi = FC0 ? Math.max(FC0.p90_f, FC0.median_f) + 5 : T0 + 18;
  for (let Ts = Math.floor(tlo / 5) * 5; Ts <= Math.ceil(thi / 5) * 5; Ts += 5) {
    if (Ts <= T0 - 8) continue;
    const top = topFor(Ts);
    thermals.push({ ts: Ts, z0, top, ttop: Ts - lapseAdiabat * (top - z0) });
  }
  // lapse rate between levels (thinned to >= ~0.35 kft spacing)
  const dense = lv.filter(l => l.z < 18).length > 150;
  const thin = [lv[0]];
  for (const l of lv) if (l.z - thin[thin.length - 1].z >= (dense ? 0.5 : 0.03)) thin.push(l);
  const lapse = [];
  for (let i = 1; i < thin.length; i++) {
    const a = thin[i - 1], b = thin[i];
    const lr = -(b.t - a.t) / (b.z - a.z);
    lapse.push({ z: a.z, v: lr });
    if (i === thin.length - 1) lapse.push({ z: b.z, v: lr });
  }
  return { cb, thermals, lapse, parcelTd, z0, topFor, EXCESS };
}

// ---------- SVG ----------
// Same layout and scales as the Topaflyers chart, with a modern finish.
// Original Topaflyers colours (green slightly deepened so it reads on white).
const COLORS = { temp: '#ff0000', dew: '#00c400', cloud: '#0000ff', thermal: '#ffa500', lapse: '#ff0000', wind: '#ff0000' };

// Ramer–Douglas–Peucker in screen space, to tame very dense soundings
function simplify(pts, tol) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const st = [[0, pts.length - 1]];
  while (st.length) {
    const [a, b] = st.pop(); let md = 0, mi = -1;
    const [x1, y1] = pts[a], [x2, y2] = pts[b], dx = x2 - x1, dy = y2 - y1, L = Math.hypot(dx, dy) || 1;
    for (let i = a + 1; i < b; i++) { const d = Math.abs(dy * (pts[i][0] - x1) - dx * (pts[i][1] - y1)) / L; if (d > md) { md = d; mi = i; } }
    if (md > tol) { keep[mi] = 1; st.push([a, mi], [mi, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

function prettyTitle(t) {
  const m = String(t).match(/^(\w+)_(\d\d)00Z_(\d\d)_(\w{3})_(\d{4})$/);
  return m ? { main: `${m[1].toUpperCase()} sounding`, sub: `${m[2]}Z · ${+m[3]} ${m[4]} ${m[5]}` } : { main: String(t), sub: '' };
}


// ---------- heatmap + notes panel (alternative to lapse/wind plots) ----------
function lerpColor(stops, v) {
  if (v <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) if (v <= stops[i][0]) {
    const [a, ca] = stops[i - 1], [b, cb] = stops[i], t = (v - a) / (b - a);
    const h = c => [1, 3, 5].map(k => parseInt(c.slice(k, k + 2), 16));
    const A = h(ca), B = h(cb);
    return '#' + A.map((x, k) => Math.round(x + (B[k] - x) * t).toString(16).padStart(2, '0')).join('');
  }
  return stops[stops.length - 1][1];
}
const LAPSE_STOPS = [[-3, '#2c5aa0'], [0, '#8fb8de'], [2.5, '#e8edf2'], [4, '#fde3a7'], [5.4, '#f4874b'], [7, '#c0392b']];
const WIND_STOPS = [[0, '#f3faf0'], [6, '#cdebc2'], [10, '#fde68a'], [15, '#fb923c'], [20, '#e11d48'], [30, '#7e22ce']];
const lum = c => { const h = [1, 3, 5].map(k => parseInt(c.slice(k, k + 2), 16)); return 0.299 * h[0] + 0.587 * h[1] + 0.114 * h[2]; };

function heatmapPanel(o, lv, A, FC, g) {
  const { x0, x1, top, bot, Y, f, INK, MUTED, EDGE, C, r100 } = g;
  const cL = [x0, x0 + 64], cW = [x0 + 70, x0 + 150], cN = [x0 + 160, x1];
  const zTop = 18;
  // column headers
  o.push(`<text x="${cL[0]}" y="${top - 9}" font-size="12.5" font-weight="600" fill="${INK}">Stability</text>`);
  o.push(`<text x="${cW[0]}" y="${top - 9}" font-size="12.5" font-weight="600" fill="${INK}">Wind (kt)</text>`);
  o.push(`<text x="${cN[0]}" y="${top - 9}" font-size="12.5" font-weight="600" fill="${INK}">What stands out</text>`);
  const zs = lv.map(l => l.z), zmin = zs[0];
  for (let k = 0; k < zTop; k++) {
    const za = Math.max(k, zmin), zb = k + 1;
    if (zb <= zmin) continue;
    const y0 = Y(zb), y1 = Y(za), h = y1 - y0;
    // lapse over the band, and the minimum sub-layer lapse (to catch thin inversions)
    const Ta = interp(lv, 't', za), Tb = interp(lv, 't', zb);
    const lr = -(Tb - Ta) / (zb - za);
    // flag an inversion only if some 200 ft sub-layer warms by >= 0.5 °F
    let minLr = lr;
    for (let z = za; z < zb - 0.19; z += 0.2) { const v = -(interp(lv, 't', z + 0.2) - interp(lv, 't', z)) / 0.2; if (v < minLr) minLr = v; }
    if (minLr > -2.5) minLr = Math.max(minLr, 0);
    const lcol = lerpColor(LAPSE_STOPS, minLr < 0 ? Math.min(lr, minLr) : lr);
    o.push(`<rect x="${cL[0]}" y="${f(y0)}" width="${cL[1] - cL[0]}" height="${f(h - 1)}" rx="3" fill="${lcol}"/>`);
    if (isFinite(lr) && h > 14) o.push(`<text x="${(cL[0] + cL[1]) / 2}" y="${f(y0 + h / 2 + 4)}" text-anchor="middle" font-size="10" font-weight="${minLr < 0 ? 700 : 500}" fill="${lum(lcol) < 140 ? '#fff' : INK}">${minLr < 0 ? 'inv' : lr.toFixed(1)}</text>`);
    // wind: vector mean of levels in the band
    const inb = lv.filter(l => l.z >= za && l.z < zb && isFinite(l.spd) && isFinite(l.dir));
    if (inb.length) {
      let u = 0, v = 0, sp = 0;
      for (const l of inb) { const r = l.dir * Math.PI / 180; u += -l.spd * Math.sin(r); v += -l.spd * Math.cos(r); sp += l.spd; }
      u /= inb.length; v /= inb.length; sp /= inb.length;
      const dir = (Math.atan2(-u, -v) * 180 / Math.PI + 360) % 360;
      const wcol = lerpColor(WIND_STOPS, sp), tc = lum(wcol) < 140 ? '#fff' : INK;
      o.push(`<rect x="${cW[0]}" y="${f(y0)}" width="${cW[1] - cW[0]}" height="${f(h - 1)}" rx="3" fill="${wcol}"/>`);
      if (h > 14) {
        const cx = cW[0] + 14, cy = y0 + h / 2;
        o.push(`<g transform="translate(${cx} ${f(cy)}) rotate(${((dir + 180) % 360).toFixed(0)})"><path d="M0 5V-5M-3 -2L0 -5L3 -2" fill="none" stroke="${tc}" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></g>`);
        o.push(`<text x="${cx + 10}" y="${f(cy + 4)}" font-size="10.5" font-weight="600" fill="${tc}">${Math.round(sp)}<tspan font-weight="400" font-size="9.5" dx="3">${String(Math.round(dir) % 360).padStart(3, '0')}°</tspan></text>`);
      }
    }
  }
  // ---- notes: auto-generated, placed at their altitude ----
  const notes = [];
  if (FC && A.forecastTops) notes.push({ z: A.forecastTops.median_ft / 1000, c: '#e07b00', t: `Thermal tops ~${A.forecastTops.median_ft.toLocaleString('en-US')} ft`, s: `at ${Math.round(FC.median_f)}°F; ${A.forecastTops.low_ft.toLocaleString('en-US')}–${A.forecastTops.high_ft.toLocaleString('en-US')} ft range` });
  if (A.cb) notes.push({ z: A.cb.z, c: C.cloud, t: `Cloudbase ${r100(A.cb.z)} ft`, s: FC && FC.p90_f < A.cb.trigger ? `needs ~${Math.round(A.cb.trigger)}°F: likely blue` : `trigger ~${Math.round(A.cb.trigger)}°F` });
  // inversions (>= 1 °F warming), from 100 ft steps
  let inv = null;
  for (let z = zmin; z < zTop; z += 0.1) {
    const d = interp(lv, 't', z + 0.1) - interp(lv, 't', z);
    if (d > 0) { if (!inv) inv = { a: z, t0: interp(lv, 't', z) }; }
    else if (inv) { const dt = interp(lv, 't', z) - inv.t0; if (dt >= 1) notes.push({ z: inv.a, c: '#2c5aa0', t: `Inversion ${r100(inv.a)}–${r100(z)} ft`, s: `+${Math.round(dt)}°F, caps weak thermals` }); inv = null; }
  }
  // freezing level
  for (let z = zmin; z < zTop; z += 0.05) if (interp(lv, 't', z) <= 32) { notes.push({ z, c: MUTED, t: `Freezing level ${r100(z)} ft`, s: '' }); break; }
  // first height with wind >= 15 kt
  const strong = lv.find(l => isFinite(l.spd) && l.spd >= 15 && l.z <= zTop);
  if (strong) notes.push({ z: strong.z, c: '#e11d48', t: `Wind ≥15 kt above ${r100(strong.z)} ft`, s: `${String(Math.round(strong.dir) % 360).padStart(3, '0')}° at ${Math.round(strong.spd)} kt` });
  // lay out: keep at their altitude, push apart to avoid overlap
  notes.sort((a, b) => b.z - a.z);
  let lastY = top - 4;
  for (const n of notes) {
    const yz = Y(Math.min(n.z, zTop));
    const y = Math.min(Math.max(yz, lastY + 30), bot - 18);
    lastY = y;
    o.push(`<path d="M${cW[1] + 2} ${f(yz)}H${cN[0] - 6}L${cN[0]} ${f(y)}" fill="none" stroke="${n.c}" stroke-width="1.2" opacity="0.8"/>`);
    o.push(`<circle cx="${cW[1] + 2}" cy="${f(yz)}" r="2.2" fill="${n.c}"/>`);
    o.push(`<text x="${cN[0] + 4}" y="${f(y + 1)}" font-size="12" font-weight="650" fill="${n.c === MUTED ? INK : n.c}">${n.t}</text>`);
    if (n.s) o.push(`<text x="${cN[0] + 4}" y="${f(y + 15)}" font-size="10.5" fill="${MUTED}">${n.s}</text>`);
  }
  // colour keys under the strips
  const key = (x, w, stops, lo, hi, label) => {
    const id = 'k' + Math.round(x);
    o.push(`<defs><linearGradient id="${id}">${stops.map(([v, c]) => `<stop offset="${((v - lo) / (hi - lo) * 100).toFixed(0)}%" stop-color="${c}"/>`).join('')}</linearGradient></defs>`);
    o.push(`<rect x="${x}" y="${bot + 10}" width="${w}" height="8" rx="2" fill="url(#${id})"/>`);
    o.push(`<text x="${x}" y="${bot + 30}" font-size="9.5">${label[0]}</text><text x="${x + w}" y="${bot + 30}" font-size="9.5" text-anchor="end">${label[1]}</text>`);
  };
  key(cL[0], cL[1] - cL[0], LAPSE_STOPS, -3, 7, ['inv', 'dry']);
  key(cW[0], cW[1] - cW[0], WIND_STOPS, 0, 30, ['0', '30 kt']);
  o.push(`<text x="${cN[0] + 4}" y="${bot + 30}" font-size="9.5">Stability: °F lost per 1000 ft (5.4 = dry, inv = warming)</text>`);
}

function renderSVG(snd, opts = {}) {
  const C = Object.assign({}, COLORS, opts.colors || {});
  const lv = snd.levels;
  const A = analyze(lv, opts);
  const FC = opts.forecast && isFinite(opts.forecast.median_f) ? opts.forecast : null;
  const HM = opts.layout === 'heatmap';
  const W = 800, Hh = 640, top = 84, bot = 584, ZMAX = 18;
  const dense = lv.filter(l => l.z < ZMAX).length > 150;
  const maxSpd = Math.max(0, ...lv.filter(l => l.z <= ZMAX && isFinite(l.spd)).map(l => l.spd));
  const P1 = { x0: 46, x1: 362, lo: -20, hi: 100 };
  const P2 = { x0: 380, x1: 530, lo: -2, hi: 6 };
  const P3 = { x0: 548, x1: 780, lo: 0, hi: Math.max(30, Math.ceil(maxSpd / 10) * 10), gutter: 72 };
  P3.d0 = P3.x0 + P3.gutter;               // wind data area starts after the label column
  const Y = z => bot - (z / ZMAX) * (bot - top);
  const X = (P, v) => (P.d0 || P.x0) + (v - P.lo) / (P.hi - P.lo) * (P.x1 - (P.d0 || P.x0));
  const f = v => v.toFixed(1);
  const INK = '#111827', MUTED = '#6b7280', GRID = '#e5e7eb', PANEL = '#fafbfc', EDGE = '#d1d5db';
  const FCOL = '#e07b00';
  const r100 = z => (Math.round(z * 10) * 100).toLocaleString('en-US');
  const o = [];
  o.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${Hh}" font-family="Inter, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" font-size="11" fill="${MUTED}">`);
  o.push(`<rect width="${W}" height="${Hh}" fill="#fff"/>`);
  o.push('<defs>' + [P1, P2, P3].map((P, i) =>
    `<clipPath id="c${i}"><rect x="${P.d0 || P.x0}" y="${top}" width="${P.x1 - (P.d0 || P.x0)}" height="${bot - top}"/></clipPath>`).join('') + '</defs>');
  const poly = (pts, color, clip, opt = {}) => {
    const segs = [[]];
    for (const p of pts) { if (!isFinite(p[0]) || !isFinite(p[1])) { segs.push([]); continue; } segs[segs.length - 1].push(p); }
    return segs.filter(q => q.length > 1).map(q => (opt.simp ? simplify(q, opt.simp) : q)).map(q =>
      `<polyline clip-path="url(#${clip})" fill="none" stroke="${color}" stroke-width="${opt.w || 2}" stroke-linejoin="round" stroke-linecap="round"${opt.dash ? ` stroke-dasharray="${opt.dash}"` : ''}${opt.op ? ` opacity="${opt.op}"` : ''} points="${q.map(p => f(p[0]) + ',' + f(p[1])).join(' ')}"/>`).join('');
  };
  const L = lv.filter(l => l.z <= ZMAX + 1);

  // ---- header (all text lives here, off the plots) ----
  const pt = prettyTitle(snd.title);
  o.push(`<text x="${P1.x0}" y="24" font-size="16" font-weight="700" fill="${INK}">${pt.main}<tspan dx="8" font-size="12.5" font-weight="500" fill="${MUTED}">${pt.sub}</tspan></text>`);
  if (FC) {
    const tm = A.topFor(FC.median_f), lo = Math.min(FC.p10_f, FC.median_f), hi = Math.max(FC.p90_f, FC.median_f);
    A.forecastTops = { median_ft: Math.round(tm * 10) * 100, low_ft: Math.round(A.topFor(lo) * 10) * 100, high_ft: Math.round(A.topFor(hi) * 10) * 100 };
    o.push(`<text x="${P3.x1}" y="24" text-anchor="end" font-size="13" font-weight="700" fill="${FCOL}">${FC.label === 'today' ? 'Today' : 'Tomorrow'}: high ${Math.round(FC.median_f)}°F <tspan font-weight="500">(${Math.round(lo)}–${Math.round(hi)})</tspan> → thermals ~${r100(tm)} ft <tspan font-weight="500">(${r100(A.topFor(lo))}–${r100(A.topFor(hi))})</tspan></text>`);
  }
  // legend row
  const lg = [['Temperature', C.temp, 2.4], ['Dew point', C.dew, 2.4], ['Cloudbase', C.cloud, 2.4], ['Thermals', C.thermal, 1.6]]
    .concat(FC ? [['Forecast high', FCOL, 3.2]] : []);
  let lx = P1.x0;
  for (const [name, c, w] of lg) {
    o.push(`<path d="M${lx} 45h16" stroke="${c}" stroke-width="${w}" stroke-linecap="round"/>`);
    o.push(`<text x="${lx + 22}" y="49" fill="${INK}">${name}</text>`);
    lx += 30 + name.length * 6.3;
  }
  if (FC) { o.push(`<rect x="${lx}" y="40" width="16" height="10" rx="2" fill="${FCOL}" fill-opacity="0.22"/><text x="${lx + 22}" y="49" fill="${INK}">Likely range</text>`); lx += 100; }
  if (A.cb) o.push(`<text x="${P3.x1}" y="49" text-anchor="end" font-weight="600" fill="${C.cloud}">Cloudbase ${r100(A.cb.z)} ft · trigger ${Math.round(A.cb.trigger)}°F</text>`);

  // ---- panels ----
  const panel = (P, xt, xlabel, title, first) => {
    const xa = P.d0 || P.x0;
    o.push(`<rect x="${P.x0}" y="${top}" width="${P.x1 - P.x0}" height="${bot - top}" rx="6" fill="${PANEL}" stroke="${EDGE}"/>`);
    if (P.gutter) o.push(`<path d="M${xa} ${top}V${bot}" stroke="${EDGE}"/>`);
    for (let z = 3; z < ZMAX; z += 3) o.push(`<path d="M${xa} ${f(Y(z))}H${P.x1}" stroke="${GRID}"/>`);
    for (const t of xt.slice(1, -1)) o.push(`<path d="M${f(X(P, t))} ${top}V${bot}" stroke="${GRID}"/>`);
    for (const t of xt) o.push(`<text x="${f(X(P, t))}" y="${bot + 28}" text-anchor="middle">${t}</text>`);
    if (first) for (let z = 0; z <= ZMAX; z += 3) o.push(`<text x="${P.x0 - 8}" y="${f(Y(z) + 4)}" text-anchor="end">${z}${z === ZMAX ? 'k' : ''}</text>`);
    o.push(`<text x="${f((xa + P.x1) / 2)}" y="${bot + 45}" text-anchor="middle">${xlabel}</text>`);
    if (title) o.push(`<text x="${P.x0 + 2}" y="${top - 9}" font-size="12.5" font-weight="600" fill="${INK}">${title}</text>`);
  };
  panel(P1, [-20, 0, 20, 40, 60, 80, 100], 'Temperature (°F)', 'Temperature &amp; thermals', true);
  if (!HM) panel(P2, [-2, 0, 2, 4, 6], 'Lapse (°F / 1000 ft)', 'Lapse rate', false);
  if (!HM) panel(P3, P3.hi <= 30 ? [0, 10, 20, 30] : Array.from({ length: P3.hi / 10 + 1 }, (_, i) => i * 10), 'Wind speed (kt)', 'Wind', false);
  o.push(`<text x="13" y="${f((top + bot) / 2)}" transform="rotate(-90 13 ${f((top + bot) / 2)})" text-anchor="middle">Altitude MSL (1000 ft)</text>`);

  // ---- panel 1 ----
  const G = 5.4, z0 = A.z0;
  if (FC) {
    const lo = Math.min(FC.p10_f, FC.median_f), hi = Math.max(FC.p90_f, FC.median_f);
    const tLo = A.topFor(lo), tHi = A.topFor(hi);
    const band = [[hi, z0], [hi - G * (tHi - z0), tHi]];
    for (let z = tHi - 0.05; z > tLo; z -= 0.05) band.push([interp(lv, 't', z) + A.EXCESS, z]);
    band.push([lo - G * (tLo - z0), tLo], [lo, z0]);
    o.push(`<polygon clip-path="url(#c0)" points="${band.map(([t, z]) => f(X(P1, t)) + ',' + f(Y(z))).join(' ')}" fill="${FCOL}" fill-opacity="0.22"/>`);
  }
  const strip = [];   // thermal start temperatures, in a strip just under the frame
  for (const th of A.thermals) {
    if (FC && Math.abs(th.ts - FC.median_f) < 2.5) continue;
    o.push(poly([[X(P1, th.ts), Y(th.z0)], [X(P1, th.ttop), Y(th.top)]], C.thermal, 'c0', { w: 1.5, op: 0.85 }));
    const tx = X(P1, th.ttop), ty = Y(th.top);
    if (ty > top + 4) o.push(`<circle cx="${f(tx)}" cy="${f(ty)}" r="2.4" fill="${C.thermal}"/>`);
    strip.push([th.ts, false]);
  }
  if (A.cb) {
    const pts = [];
    for (let z = z0; z < A.cb.z; z += 0.1) pts.push([X(P1, A.parcelTd(z)), Y(z)]);
    pts.push([X(P1, A.cb.t), Y(A.cb.z)]);
    o.push(poly(pts, C.cloud, 'c0', { simp: 0.6, w: 1.6 }));
    o.push(poly([[P1.x0, Y(A.cb.z)], [P1.x1, Y(A.cb.z)]], C.cloud, 'c0', { w: 1.3, dash: '6 4' }));
    o.push(`<circle cx="${f(X(P1, A.cb.t))}" cy="${f(Y(A.cb.z))}" r="3.2" fill="#fff" stroke="${C.cloud}" stroke-width="1.6"/>`);
    // tag on the axis instead of text on the plot
    const yc = Y(A.cb.z);
    o.push(`<rect x="${P1.x1 + 1}" y="${f(yc - 7)}" width="16" height="14" rx="3" fill="${C.cloud}"/><text x="${P1.x1 + 9}" y="${f(yc + 3.5)}" text-anchor="middle" font-size="9" font-weight="700" fill="#fff">CB</text>`);
  }
  o.push(poly(L.map(l => [X(P1, l.td), Y(l.z)]), C.dew, 'c0', { simp: dense ? 1.2 : 0, w: 2.2 }));
  o.push(poly(L.map(l => [X(P1, l.t), Y(l.z)]), C.temp, 'c0', { simp: dense ? 1.2 : 0, w: 2.2 }));
  if (FC) {
    const tm = A.topFor(FC.median_f);
    o.push(poly([[X(P1, FC.median_f), Y(z0)], [X(P1, FC.median_f - G * (tm - z0)), Y(tm)]], FCOL, 'c0', { w: 3.4 }));
    o.push(`<circle cx="${f(X(P1, FC.median_f - G * (tm - z0)))}" cy="${f(Y(tm))}" r="4.2" fill="${FCOL}" stroke="#fff" stroke-width="1.6"/>`);
    // thermal-top tag on the left axis, like the cloudbase tag
    strip.push([FC.median_f, true]);
  }
  // start-temperature strip: skip labels that would collide
  strip.sort((a, b) => (b[1] - a[1]) || ((Math.round(a[0]) % 10 ? 1 : 0) - (Math.round(b[0]) % 10 ? 1 : 0)));
  const used = [];
  for (const [t, bold] of strip) {
    const x = X(P1, t);
    if (x < P1.x0 + 6 || x > P1.x1 - 6) continue;
    if (used.some(u => Math.abs(u - x) < 18)) continue;
    used.push(x);
    o.push(`<text x="${f(x)}" y="${bot + 13}" text-anchor="middle" font-size="${bold ? 11.5 : 10}" font-weight="${bold ? 800 : 600}" fill="${bold ? FCOL : '#d08a00'}">${Math.round(t)}</text>`);
  }

  if (HM) heatmapPanel(o, lv, A, FC, { x0: 380, x1: 780, top, bot, Y, f, INK, MUTED, EDGE, PANEL, GRID, C, r100 });
  else {
  // ---- panel 2: lapse rate, references labelled above the panel ----
  for (const [v, name] of [[3.6, 'std'], [5.4, 'dry']]) {
    o.push(`<path d="M${f(X(P2, v))} ${top}V${bot}" stroke="${MUTED}" stroke-width="1" stroke-dasharray="3 3" opacity="0.6"/>`);
    o.push(`<text x="${f(X(P2, v))}" y="${top - 9}" text-anchor="middle" font-size="9.5">${name}</text>`);
  }
  o.push(poly(A.lapse.filter(p => p.z <= ZMAX + 1).map(p => [X(P2, p.v), Y(p.z)]), C.lapse, 'c1', { w: 1.8 }));

  // ---- panel 3: wind, labels in their own column ----
  const W3 = L.filter(l => isFinite(l.spd));
  o.push(poly(W3.map(l => [X(P3, l.spd), Y(l.z)]), C.wind, 'c2', { simp: dense ? 1.2 : 0, w: 2 }));
  let lab = W3.filter(l => isFinite(l.dir) && l.z <= ZMAX - 0.4);
  if (dense) { const t = []; for (const l of lab) if (!t.length || l.z - t[t.length - 1].z >= 1.0) t.push(l); lab = t; }
  let lastY = 1e9;
  for (const l of lab) {
    const y = Y(l.z);
    if (lastY - y < 12) continue;
    lastY = y;
    const dir = Math.round(l.dir) % 360 || 360, ax = P3.x0 + 11;
    o.push(`<g transform="translate(${ax} ${f(y)}) rotate(${(dir + 180) % 360})"><path d="M0 5V-5M-3 -2L0 -5L3 -2" fill="none" stroke="${INK}" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></g>`);
    o.push(`<text x="${ax + 9}" y="${f(y + 4)}" font-size="10.5" fill="${INK}">${String(dir).padStart(3, '0')}<tspan fill="${MUTED}">@</tspan>${Math.round(l.spd)}</text>`);
  }
  }
  o.push('</svg>');
  return { svg: o.join('\n'), analysis: A };
}

if (typeof module !== 'undefined') module.exports = { parseSounding, renderSVG, analyze };

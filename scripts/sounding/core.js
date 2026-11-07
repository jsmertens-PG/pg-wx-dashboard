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
  const thermals = [];
  const n = opts.nThermals || 7;
  for (let k = 0; k < n; k++) {
    const Ts = Math.round(T0) + 8 + 6 * k;
    let top = null;
    for (let z = z0 + 0.05; z <= 20; z += 0.01) {
      const T = interp(lv, 't', z); if (!isFinite(T)) break;
      if (Ts - lapseAdiabat * (z - z0) - T < EXCESS) { top = z; break; }
    }
    if (top === null) top = 20;
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
  return { cb, thermals, lapse, parcelTd, z0 };
}

// ---------- SVG ----------
// Layout measured from the Topaflyers 800x600 gnuplot PNG.
const COLORS = { temp: '#d7263d', dew: '#1b998b', cloud: '#2e6fd8', thermal: '#8e44ad', lapse: '#d7263d', wind: '#d7263d' };

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

function renderSVG(snd, opts = {}) {
  const C = Object.assign({}, COLORS, opts.colors || {});
  const lv = snd.levels;
  const A = analyze(lv, opts);
  const W = 800, Hh = 600, top = 39, bot = 558, ZMAX = 18;
  const dense = lv.filter(l => l.z < ZMAX).length > 150;
  const maxSpd = Math.max(0, ...lv.filter(l => l.z <= ZMAX && isFinite(l.spd)).map(l => l.spd));
  const P1 = { x0: 31, x1: 338, lo: -20, hi: 100 };
  const P2 = { x0: 377, x1: 538, lo: -2, hi: 6 };
  const P3 = { x0: 577, x1: 778, lo: 0, hi: Math.max(30, Math.ceil(maxSpd / 10) * 10) };
  const Y = z => bot - (z / ZMAX) * (bot - top);
  const X = (P, v) => P.x0 + (v - P.lo) / (P.hi - P.lo) * (P.x1 - P.x0);
  const o = [];
  o.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${Hh}" font-family="Arial, Helvetica, sans-serif" font-size="13" font-style="italic" fill="#000">`);
  o.push(`<rect width="${W}" height="${Hh}" fill="#fff"/>`);
  o.push('<defs>' + [P1, P2, P3].map((P, i) =>
    `<clipPath id="c${i}"><rect x="${P.x0}" y="${top}" width="${P.x1 - P.x0}" height="${bot - top}"/></clipPath>`).join('') + '</defs>');
  const poly = (pts, color, clip, simp = 0) => {
    const segs = [[]];
    for (const p of pts) { if (!isFinite(p[0]) || !isFinite(p[1])) { segs.push([]); continue; } segs[segs.length - 1].push(p); }
    return segs.filter(q => q.length > 1).map(q => (simp ? simplify(q, simp) : q)).map(q =>
      `<polyline clip-path="url(#${clip})" fill="none" stroke="${color}" stroke-width="1.1" stroke-linejoin="round" points="${q.map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ')}"/>`).join('');
  };
  const L = lv.filter(l => l.z <= ZMAX + 1);
  const T = 6; // tick length

  const frame = (P, xt, xlabel, first) => {
    o.push(`<rect x="${P.x0}" y="${top}" width="${P.x1 - P.x0}" height="${bot - top}" fill="none" stroke="#000"/>`);
    for (const t of xt) {
      const x = X(P, t).toFixed(1);
      o.push(`<path d="M${x} ${bot}v-${T}M${x} ${top}v${T}" stroke="#000"/>`);
      o.push(`<text x="${x}" y="${bot + 19}" text-anchor="middle">${t}</text>`);
    }
    for (let z = 0; z <= ZMAX; z += 3) {
      const y = Y(z).toFixed(1);
      if (z > 0 && z < ZMAX) {
        // panel 1: inward ticks; panels 2 and 3: left ticks cross the frame (as in the original)
        o.push(first ? `<path d="M${P.x0} ${y}h${T}M${P.x1} ${y}h-${T}" stroke="#000"/>`
                     : `<path d="M${P.x0 - 4} ${y}h${T + 4}M${P.x1} ${y}h-${T}" stroke="#000"/>`);
      }
      if (first) o.push(`<text x="${P.x0 - 7}" y="${(+y + 5).toFixed(1)}" text-anchor="end">${z}</text>`);
    }
    o.push(`<text x="${((P.x0 + P.x1) / 2).toFixed(1)}" y="${bot + 37}" text-anchor="middle">${xlabel}</text>`);
  };
  frame(P1, [-20, 0, 20, 40, 60, 80, 100], 'deg F', true);
  frame(P2, [-2, 0, 2, 4, 6], 'deg F / 1000 ft', false);
  frame(P3, P3.hi <= 30 ? [0, 5, 10, 15, 20, 25, 30] : Array.from({ length: P3.hi / 10 + 1 }, (_, i) => i * 10), 'wind speed (knt)', false);
  const head = (P, t) => o.push(`<text x="${((P.x0 + P.x1) / 2).toFixed(1)}" y="25" text-anchor="middle">${t}</text>`);
  head(P1, snd.title); head(P2, 'Lapse Rate'); head(P3, 'Wind Profile');

  // ---- panel 1 ----
  for (const th of A.thermals)
    o.push(poly([[X(P1, th.ts), Y(th.z0)], [X(P1, th.ttop), Y(th.top)]], C.thermal, 'c0'));
  if (A.cb) {
    const pts = [];
    for (let z = A.z0; z < A.cb.z; z += 0.1) pts.push([X(P1, A.parcelTd(z)), Y(z)]);
    pts.push([X(P1, A.cb.t), Y(A.cb.z)]);
    o.push(poly(pts, C.cloud, 'c0', 0.6));
    o.push(poly([[P1.x0, Y(A.cb.z)], [P1.x1, Y(A.cb.z)]], C.cloud, 'c0'));
  }
  o.push(poly(L.map(l => [X(P1, l.t), Y(l.z)]), C.temp, 'c0', dense ? 1.2 : 0));
  o.push(poly(L.map(l => [X(P1, l.td), Y(l.z)]), C.dew, 'c0', dense ? 1.2 : 0));
  [['temperature', C.temp], ['dew point', C.dew], ['cloudbase', C.cloud], ['thermal heights', C.thermal]].forEach(([name, c], i) => {
    const y = 51 + i * 13;
    o.push(`<text x="283" y="${y + 5}" text-anchor="end" font-size="13">${name}</text>`);
    o.push(`<path d="M290 ${y}h35" stroke="${c}" stroke-width="1.1"/>`);
  });

  // ---- panel 2: lapse rate ----
  o.push(poly(A.lapse.filter(p => p.z <= ZMAX + 1).map(p => [X(P2, p.v), Y(p.z)]), C.lapse, 'c1'));

  // ---- panel 3: wind ----
  let W3 = L.filter(l => isFinite(l.spd));
  o.push(poly(W3.map(l => [X(P3, l.spd), Y(l.z)]), C.wind, 'c2', dense ? 1.2 : 0));
  // labels at each reported level (dense soundings: about every 1000 ft), like the original
  let lab = W3.filter(l => isFinite(l.dir) && l.z <= ZMAX - 0.6);
  if (dense) { const t = []; for (const l of lab) if (!t.length || l.z - t[t.length - 1].z >= 1.0) t.push(l); lab = t; }
  let lastY = 1e9;
  for (const l of lab) {
    const y = Y(l.z);
    if (lastY - y < 9) continue;
    lastY = y;
    o.push(`<text x="${P3.x0 + 13}" y="${(y + 5).toFixed(1)}" font-size="13" textLength="" >${Math.round(l.dir) % 360 || 360} @ ${Math.round(l.spd)}</text>`.replace(' textLength=""', ''));
  }
  o.push('</svg>');
  return { svg: o.join('\n'), analysis: A };
}

if (typeof module !== 'undefined') module.exports = { parseSounding, renderSVG, analyze };

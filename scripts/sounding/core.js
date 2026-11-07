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


// inversions: layers where temperature rises with height by >= 1 °F
function findInversions(lv, zTop) {
  const out = []; let inv = null; const z0 = lv[0].z;
  for (let z = z0; z < zTop; z += 0.05) {
    const d = interp(lv, 't', z + 0.05) - interp(lv, 't', z);
    if (d > 0) { if (!inv) inv = { a: z, t0: interp(lv, 't', z) }; }
    else if (inv) { const dt = interp(lv, 't', z) - inv.t0; if (dt >= 1) out.push({ a: inv.a, b: z, dt }); inv = null; }
  }
  return out;
}

function renderSVG(snd, opts = {}) {
  const C = Object.assign({}, COLORS, opts.colors || {});
  const lv = snd.levels;
  const A = analyze(lv, opts);
  const FC = opts.forecast && isFinite(opts.forecast.median_f) ? opts.forecast : null;
  const W = 800, Hh = 880, top = 84, bot = 826;
  const dense = lv.filter(l => l.z < 18).length > 150;
  const z0 = A.z0, G = 5.4;
  const lo = FC ? Math.min(FC.p10_f, FC.median_f) : lv[0].t, hi = FC ? Math.max(FC.p90_f, FC.median_f) : lv[0].t + 10;
  // ---- zoom to what matters for flying ----
  const tHiTop = A.topFor(hi);
  const ZMAX = Math.min(18, Math.max(8, Math.ceil(Math.max(A.cb ? A.cb.z : 0, tHiTop, ...A.thermals.map(t => Math.min(t.top, 18))) + 2.5)));
  // keep Topaflyers proportions (same °F-per-1000-ft aspect, so adiabats keep their angle);
  // the panel width then decides how many °F fit, anchored on the warm side
  const ASPECT = (2.558 / 28.83);                    // original: px per °F ÷ px per 1000 ft
  const pxPerKft = (bot - top) / ZMAX, pxPerF = ASPECT * pxPerKft;
  const P1 = { x0: 52, x1: 600 };
  const XHI = Math.ceil((Math.max(...A.thermals.map(t => t.ts), hi, lv[0].t) + 3) / 10) * 10;
  const XLO = XHI - (P1.x1 - P1.x0) / pxPerF;
  P1.lo = XLO; P1.hi = XHI;
  const WC = { x0: 690, x1: 790 };   // wind text column
  const Y = z => bot - (z / ZMAX) * (bot - top);
  const X = v => P1.x0 + (v - P1.lo) / (P1.hi - P1.lo) * (P1.x1 - P1.x0);
  const f = v => v.toFixed(1);
  const INK = '#111827', MUTED = '#6b7280', GRID = '#e5e7eb', PANEL = '#fafbfc', EDGE = '#d1d5db', FCOL = '#e07b00', INVC = '#3b6fd8';
  const r100 = z => (Math.round(z * 10) * 100).toLocaleString('en-US');
  const k1 = z => (Math.round(z * 10) / 10).toFixed(1) + 'k';
  const o = [];
  o.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${Hh}" font-family="Inter, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" font-size="11" fill="${MUTED}">`);
  o.push(`<rect width="${W}" height="${Hh}" fill="#fff"/>`);
  o.push(`<defs><clipPath id="c0"><rect x="${P1.x0}" y="${top}" width="${P1.x1 - P1.x0}" height="${bot - top}"/></clipPath></defs>`);
  const poly = (pts, color, opt = {}) => {
    const segs = [[]];
    for (const p of pts) { if (!isFinite(p[0]) || !isFinite(p[1])) { segs.push([]); continue; } segs[segs.length - 1].push(p); }
    return segs.filter(q => q.length > 1).map(q => (opt.simp ? simplify(q, opt.simp) : q)).map(q =>
      `<polyline clip-path="url(#c0)" fill="none" stroke="${color}" stroke-width="${opt.w || 2}" stroke-linejoin="round" stroke-linecap="round"${opt.dash ? ` stroke-dasharray="${opt.dash}"` : ''}${opt.op ? ` opacity="${opt.op}"` : ''} points="${q.map(p => f(p[0]) + ',' + f(p[1])).join(' ')}"/>`).join('');
  };
  const L = lv.filter(l => l.z <= ZMAX + 1);
  const invs = findInversions(lv, ZMAX);

  // ---- header ----
  const pt = prettyTitle(snd.title);
  o.push(`<text x="${P1.x0}" y="24" font-size="16" font-weight="700" fill="${INK}">${pt.main}<tspan dx="8" font-size="12.5" font-weight="500" fill="${MUTED}">${pt.sub}</tspan></text>`);
  if (FC) {
    const tm = A.topFor(FC.median_f), tl = A.topFor(lo);
    A.forecastTops = { median_ft: Math.round(tm * 10) * 100, low_ft: Math.round(tl * 10) * 100, high_ft: Math.round(tHiTop * 10) * 100 };
    o.push(`<text x="${WC.x1}" y="24" text-anchor="end" font-size="13" font-weight="700" fill="${FCOL}">${FC.label === 'today' ? 'Today' : 'Tomorrow'}: high ${Math.round(FC.median_f)}°F <tspan font-weight="500">(${Math.round(lo)}–${Math.round(hi)})</tspan> → thermals ~${r100(tm)} ft <tspan font-weight="500">(${r100(tl)}–${r100(tHiTop)})</tspan></text>`);
  }
  const lg = [['Temperature', C.temp, 2.4], ['Dew point', C.dew, 2.4], ['Cloudbase', C.cloud, 2.4], ['Thermals', C.thermal, 1.6]]
    .concat(FC ? [['Forecast high', FCOL, 3.2]] : []);
  let lx = P1.x0;
  for (const [name, c, w] of lg) {
    o.push(`<path d="M${lx} 45h16" stroke="${c}" stroke-width="${w}" stroke-linecap="round"/><text x="${lx + 22}" y="49" fill="${INK}">${name}</text>`);
    lx += 30 + name.length * 6.3;
  }
  if (FC) { o.push(`<rect x="${lx}" y="40" width="16" height="10" rx="2" fill="${FCOL}" fill-opacity="0.22"/><text x="${lx + 22}" y="49" fill="${INK}">Likely range</text>`); lx += 104; }
  if (invs.length) { o.push(`<rect x="${lx}" y="40" width="16" height="10" rx="2" fill="${INVC}" fill-opacity="0.16"/><text x="${lx + 22}" y="49" fill="${INK}">Inversion</text>`); lx += 84; }
  const facts = [];
  if (A.cb) facts.push(`<tspan fill="${C.cloud}" font-weight="600">Cloudbase ${r100(A.cb.z)} ft</tspan> (trigger ${Math.round(A.cb.trigger)}°F)`);
  for (const v of invs.slice(0, 2)) facts.push(`<tspan fill="${INVC}" font-weight="600">Inversion ${r100(v.a)}–${r100(v.b)} ft</tspan> (+${Math.round(v.dt)}°F)`);
  o.push(`<text x="${P1.x0}" y="70" fill="${INK}">${facts.join('<tspan fill="#9ca3af" dx="10">·</tspan><tspan dx="10"></tspan>')}</text>`);

  // ---- main panel ----
  o.push(`<rect x="${P1.x0}" y="${top}" width="${P1.x1 - P1.x0}" height="${bot - top}" rx="6" fill="${PANEL}" stroke="${EDGE}"/>`);
  const zstep = ZMAX <= 12 ? 1 : 2;
  for (let z = zstep; z < ZMAX; z += zstep) o.push(`<path d="M${P1.x0} ${f(Y(z))}H${P1.x1}" stroke="${GRID}"/>`);
  for (let t = Math.ceil(XLO / 10) * 10; t < XHI; t += 10) if (t > XLO) o.push(`<path d="M${f(X(t))} ${top}V${bot}" stroke="${GRID}"/>`);
  for (let t = Math.ceil(XLO / 10) * 10; t <= XHI; t += 10) o.push(`<text x="${f(X(t))}" y="${bot + 30}" text-anchor="middle">${t}</text>`);
  for (let z = 0; z <= ZMAX; z += zstep) o.push(`<text x="${P1.x0 - 8}" y="${f(Y(z) + 4)}" text-anchor="end">${z}${z ? 'k' : ''}</text>`);
  o.push(`<text x="${f((P1.x0 + P1.x1) / 2)}" y="${bot + 47}" text-anchor="middle">Temperature (°F)</text>`);
  o.push(`<text x="13" y="${f((top + bot) / 2)}" transform="rotate(-90 13 ${f((top + bot) / 2)})" text-anchor="middle">Altitude MSL (ft)</text>`);

  // inversions: shaded bands
  for (const v of invs) o.push(`<rect x="${P1.x0}" y="${f(Y(v.b))}" width="${P1.x1 - P1.x0}" height="${f(Math.max(2, Y(v.a) - Y(v.b)))}" fill="${INVC}" fill-opacity="0.12"/>`);

  if (FC) {
    const tLo = A.topFor(lo);
    const band = [[hi, z0], [hi - G * (tHiTop - z0), tHiTop]];
    for (let z = tHiTop - 0.02; z > tLo; z -= 0.02) band.push([interp(lv, 't', z) + A.EXCESS, z]);
    band.push([lo - G * (tLo - z0), tLo], [lo, z0]);
    o.push(`<polygon clip-path="url(#c0)" points="${band.map(([t, z]) => f(X(t)) + ',' + f(Y(z))).join(' ')}" fill="${FCOL}" fill-opacity="0.2"/>`);
  }
  const strip = [];
  for (const th of A.thermals) {
    if (FC && Math.abs(th.ts - FC.median_f) < 2) continue;
    o.push(poly([[X(th.ts), Y(th.z0)], [X(th.ttop), Y(th.top)]], C.thermal, { w: 1.6, op: 0.9 }));
    if (th.top < ZMAX) o.push(`<circle cx="${f(X(th.ttop))}" cy="${f(Y(th.top))}" r="2.8" fill="${C.thermal}"/>`);
    strip.push([th.ts, false]);
  }
  const tags = [];   // right-axis tags: [z, text, colour]
  if (A.cb) {
    const pts = [];
    for (let z = z0; z < A.cb.z; z += 0.05) pts.push([X(A.parcelTd(z)), Y(z)]);
    pts.push([X(A.cb.t), Y(A.cb.z)]);
    o.push(poly(pts, C.cloud, { simp: 0.5, w: 1.8 }));
    o.push(poly([[P1.x0, Y(A.cb.z)], [P1.x1, Y(A.cb.z)]], C.cloud, { w: 1.4, dash: '7 5' }));
    o.push(`<circle cx="${f(X(A.cb.t))}" cy="${f(Y(A.cb.z))}" r="3.6" fill="#fff" stroke="${C.cloud}" stroke-width="1.8"/>`);
    if (A.cb.z <= ZMAX) tags.push([A.cb.z, 'CB ' + k1(A.cb.z), C.cloud]);
  }
  o.push(poly(L.map(l => [X(l.td), Y(l.z)]), C.dew, { simp: dense ? 1.6 : 0, w: 2.4 }));
  o.push(poly(L.map(l => [X(l.t), Y(l.z)]), C.temp, { simp: dense ? 1.6 : 0, w: 2.4 }));
  if (FC) {
    const tm = A.topFor(FC.median_f);
    o.push(poly([[X(FC.median_f), Y(z0)], [X(FC.median_f - G * (tm - z0)), Y(tm)]], FCOL, { w: 3.6 }));
    o.push(`<circle cx="${f(X(FC.median_f - G * (tm - z0)))}" cy="${f(Y(tm))}" r="4.6" fill="${FCOL}" stroke="#fff" stroke-width="1.8"/>`);
    tags.push([tm, 'Top ' + k1(tm), FCOL]);
    strip.push([FC.median_f, true]);
  }
  for (const v of invs) tags.push([(v.a + v.b) / 2, 'INV', INVC]);
  // start-temperature labels under the frame
  strip.sort((a, b) => b[1] - a[1]);
  const used = [];
  for (const [t, bold] of strip) {
    const x = X(t);
    if (x < P1.x0 + 8 || x > P1.x1 - 8 || used.some(u => Math.abs(u - x) < 19)) continue;
    used.push(x);
    o.push(`<text x="${f(x)}" y="${bot + 14}" text-anchor="middle" font-size="${bold ? 12 : 10.5}" font-weight="${bold ? 800 : 600}" fill="${bold ? FCOL : '#d08a00'}">${Math.round(t)}</text>`);
  }
  // right-axis tags, nudged apart
  tags.sort((a, b) => b[0] - a[0]);
  let lastY = -1e9;
  for (const [z, txt, c] of tags) {
    const yz = Y(z); let y = Math.max(yz, lastY + 17); lastY = y;
    const w = txt.length * 6.4 + 10;
    o.push(`<path d="M${P1.x1} ${f(yz)}L${P1.x1 + 5} ${f(y)}" stroke="${c}" stroke-width="1.2"/>`);
    o.push(`<rect x="${P1.x1 + 5}" y="${f(y - 7.5)}" width="${f(w)}" height="15" rx="3.5" fill="${c}"/>`);
    o.push(`<text x="${f(P1.x1 + 5 + w / 2)}" y="${f(y + 3.8)}" text-anchor="middle" font-size="10" font-weight="700" fill="#fff">${txt}</text>`);
  }

  // ---- wind as text ----
  o.push(`<text x="${WC.x0}" y="${top - 9}" font-size="12.5" font-weight="600" fill="${INK}">Wind</text>`);
  let W3 = L.filter(l => isFinite(l.spd) && isFinite(l.dir) && l.z <= ZMAX);
  const step = ZMAX <= 12 ? 0.5 : 1.0;
  if (dense) { const t = []; for (const l of W3) if (!t.length || l.z - t[t.length - 1].z >= step) t.push(l); W3 = t; }
  let wy = 1e9;
  for (const l of W3) {
    const y = Y(l.z);
    if (wy - y < 15) continue;
    wy = y;
    const dir = Math.round(l.dir) % 360 || 360, sp = Math.round(l.spd);
    const col = sp >= 20 ? '#dc2626' : sp >= 15 ? '#ea580c' : INK;
    o.push(`<path d="M${WC.x0 - 8} ${f(y)}h4" stroke="${EDGE}"/>`);
    o.push(`<g transform="translate(${WC.x0 + 6} ${f(y)}) rotate(${(dir + 180) % 360})"><path d="M0 5.5V-5.5M-3.2 -2.2L0 -5.5L3.2 -2.2" fill="none" stroke="${col}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></g>`);
    o.push(`<text x="${WC.x0 + 16}" y="${f(y + 4)}" font-size="11.5" font-weight="650" fill="${col}">${sp}<tspan font-size="9.5" font-weight="500" fill="${MUTED}" dx="2">kt</tspan><tspan font-size="10.5" font-weight="500" fill="${MUTED}" dx="6">${String(dir).padStart(3, '0')}°</tspan></text>`);
  }
  o.push('</svg>');
  return { svg: o.join('\n'), analysis: A };
}

if (typeof module !== 'undefined') module.exports = { parseSounding, renderSVG, analyze };

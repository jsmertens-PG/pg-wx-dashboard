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
  sknt: ['SKNT', 'WSPD', 'SPEED_KTS', 'SPEED'],
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
      for (const L of lines.slice(hi + 1)) {
        if (!/^\s*-?\d/.test(L)) { if (rows.length && /^\s*$|<|Station/i.test(L)) break; continue; }
        const get = i => {
          if (i < 0) return NaN;
          const start = i === 0 ? 0 : cols[i - 1].end;
          return num(L.slice(start, cols[i].end));
        };
        rows.push({ p: get(c.pres), h: get(c.hght), t: get(c.temp), td: get(c.dwpt), dir: get(c.drct), spd: get(c.sknt) });
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
  // thermal lines: dry adiabats from surface every 5°F
  const thermals = [];
  const start = Math.floor(T0 / 5) * 5 + 5;
  const n = opts.nThermals || 10;
  for (let k = 0; k < n; k++) {
    const Ts = start + 5 * k;
    let top = null;
    for (let z = z0 + 0.02; z <= 20; z += 0.02) {
      const T = interp(lv, 't', z); if (!isFinite(T)) break;
      if (Ts - lapseAdiabat * (z - z0) <= T) { top = z; break; }
    }
    if (top === null) top = 20;
    thermals.push({ ts: Ts, z0, top, ttop: Ts - lapseAdiabat * (top - z0) });
  }
  // lapse rate between levels (thinned to >= ~0.35 kft spacing)
  const thin = [lv[0]];
  for (const l of lv) if (l.z - thin[thin.length - 1].z >= 0.25) thin.push(l);
  const lapse = [];
  for (let i = 1; i < thin.length; i++) {
    const a = thin[i - 1], b = thin[i];
    const lr = -(b.t - a.t) / (b.z - a.z);
    lapse.push({ z: (a.z + b.z) / 2, v: lr });
  }
  return { cb, thermals, lapse, parcelTd, z0 };
}

// ---------- SVG ----------
function renderSVG(snd, opts = {}) {
  const lv = snd.levels;
  const A = analyze(lv, opts);
  const W = 800, Hh = 600, top = 38, bot = 558, ZMAX = opts.zmax || 18;
  const P1 = { x0: 45, x1: 340, lo: -20, hi: 100 };
  const P2 = { x0: 377, x1: 493, lo: -2, hi: 6 };
  const P3 = { x0: 576, x1: 783, lo: 0, hi: 30 };
  const Y = z => bot - (z / ZMAX) * (bot - top);
  const X = (P, v) => P.x0 + (v - P.lo) / (P.hi - P.lo) * (P.x1 - P.x0);
  const font = 'font-family="Arial, Helvetica, sans-serif"';
  let o = [];
  o.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${Hh}" ${font} font-size="12">`);
  o.push(`<rect width="${W}" height="${Hh}" fill="#fff"/>`);
  o.push('<defs>' + [P1, P2, P3].map((P, i) =>
    `<clipPath id="c${i}"><rect x="${P.x0}" y="${top}" width="${P.x1 - P.x0}" height="${bot - top}"/></clipPath>`).join('') + '</defs>');
  const poly = (pts, color, clip, w = 1) => {
    // split on NaN
    let segs = [[]];
    for (const p of pts) { if (!isFinite(p[0]) || !isFinite(p[1])) { segs.push([]); continue; } segs[segs.length - 1].push(p); }
    return segs.filter(s => s.length > 1).map(s =>
      `<polyline clip-path="url(#${clip})" fill="none" stroke="${color}" stroke-width="${w}" points="${s.map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ')}"/>`).join('');
  };
  const inRange = l => l.z <= ZMAX + 0.5;
  const L = lv.filter(inRange);

  // frames + ticks
  const frame = (P, ticks, xlabel, yLabels) => {
    o.push(`<rect x="${P.x0}" y="${top}" width="${P.x1 - P.x0}" height="${bot - top}" fill="none" stroke="#000"/>`);
    for (const t of ticks) {
      const x = X(P, t);
      o.push(`<line x1="${x}" y1="${bot}" x2="${x}" y2="${bot - 6}" stroke="#000"/><line x1="${x}" y1="${top}" x2="${x}" y2="${top + 6}" stroke="#000"/>`);
      o.push(`<text x="${x}" y="${bot + 16}" text-anchor="middle">${t}</text>`);
    }
    for (let z = 0; z <= ZMAX; z += 3) {
      const y = Y(z);
      o.push(`<line x1="${P.x0}" y1="${y}" x2="${P.x0 + 6}" y2="${y}" stroke="#000"/><line x1="${P.x1}" y1="${y}" x2="${P.x1 - 6}" y2="${y}" stroke="#000"/>`);
      if (yLabels) o.push(`<text x="${P.x0 - 8}" y="${y + 4}" text-anchor="end">${z}</text>`);
      else if (z > 0 && z < ZMAX) o.push(`<text x="${P.x0 - 3}" y="${y + 4}" text-anchor="end">-</text>`);
    }
    o.push(`<text x="${(P.x0 + P.x1) / 2}" y="${bot + 34}" text-anchor="middle" font-style="italic">${xlabel}</text>`);
  };
  frame(P1, [-20, 0, 20, 40, 60, 80, 100], 'deg F', true);
  frame(P2, [-2, 0, 2, 4, 6], 'deg F / 1000 ft', false);
  frame(P3, [0, 5, 10, 15, 20, 25, 30], 'wind speed (knt)', false);
  o.push(`<text x="${(P1.x0 + P1.x1) / 2}" y="${top - 12}" text-anchor="middle" font-style="italic" font-size="13">${snd.title}</text>`);
  o.push(`<text x="${(P2.x0 + P2.x1) / 2}" y="${top - 12}" text-anchor="middle" font-style="italic" font-size="13">Lapse Rate</text>`);
  o.push(`<text x="${(P3.x0 + P3.x1) / 2}" y="${top - 12}" text-anchor="middle" font-style="italic" font-size="13">Wind Profile</text>`);

  // panel 1
  const ORANGE = '#ffa500', BLUE = '#0000ff', RED = '#ff0000', GREEN = '#00e000';
  for (const th of A.thermals)
    o.push(poly([[X(P1, th.ts), Y(th.z0)], [X(P1, th.ttop), Y(th.top)]], ORANGE, 'c0'));
  if (A.cb) {
    const pts = [];
    for (let z = A.z0; z <= A.cb.z; z += 0.1) pts.push([X(P1, A.parcelTd(z)), Y(z)]);
    pts.push([X(P1, A.cb.t), Y(A.cb.z)]);
    o.push(poly(pts, BLUE, 'c0'));
    o.push(poly([[P1.x0, Y(A.cb.z)], [P1.x1, Y(A.cb.z)]], BLUE, 'c0'));
  }
  o.push(poly(L.map(l => [X(P1, l.t), Y(l.z)]), RED, 'c0'));
  o.push(poly(L.map(l => [X(P1, l.td), Y(l.z)]), GREEN, 'c0'));
  // legend
  const lg = [['temperature', RED], ['dew point', GREEN], ['cloudbase', BLUE], ['thermal heights', ORANGE]];
  lg.forEach(([name, c], i) => {
    const y = top + 14 + i * 13;
    o.push(`<text x="${P1.x1 - 50}" y="${y + 4}" text-anchor="end" font-style="italic">${name}</text>`);
    o.push(`<line x1="${P1.x1 - 44}" y1="${y}" x2="${P1.x1 - 8}" y2="${y}" stroke="${c}"/>`);
  });

  // panel 2: lapse
  o.push(poly(A.lapse.filter(p => p.z <= ZMAX + 1).map(p => [X(P2, p.v), Y(p.z)]), RED, 'c1'));

  // panel 3: wind
  const W3 = L.filter(l => isFinite(l.spd));
  o.push(poly(W3.map(l => [X(P3, l.spd), Y(l.z)]), RED, 'c2'));
  let lastY = 1e9;
  for (const l of W3) {
    if (!isFinite(l.dir) || l.z > ZMAX - 0.3) continue;
    const y = Y(l.z);
    if (lastY - y < 15) continue;
    lastY = y;
    o.push(`<text x="${P3.x0 + 10}" y="${y + 4}" font-style="italic">${Math.round(l.dir)} @ ${Math.round(l.spd)}</text>`);
  }

  o.push('</svg>');
  return { svg: o.join('\n'), analysis: A };
}

if (typeof module !== 'undefined') module.exports = { parseSounding, renderSVG, analyze };

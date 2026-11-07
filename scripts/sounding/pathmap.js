// Balloon flight path on a plain map: coast, major freeways as thin lines, a few towns.
// Uses the published track (lat/lon per level) when the station's data carries it, else reconstructs it from the
// winds: the balloon rises ~5 m/s (~1,000 ft/min) and drifts with the wind at each level.
// Needs COAST / ROADS / TOWNS from scripts/region/regionmap.js when loaded (San Diego detail); adds the High Desert.

const PM_ROADS = [   // [label, [[lat, lon], ...]] beyond the San Diego map
  ['14', [[34.30, -118.47], [34.45, -118.30], [34.58, -118.12], [34.69, -118.14], [34.85, -118.16], [35.05, -118.17], [35.30, -118.00]]],
  ['58', [[35.05, -118.17], [35.02, -117.90], [35.00, -117.65], [34.94, -117.30], [34.90, -117.03]]],
  ['15', [[34.40, -117.40], [34.54, -117.29], [34.70, -117.15], [34.90, -117.02], [35.05, -116.70], [35.27, -116.07]]],
  ['395', [[34.54, -117.29], [34.80, -117.47], [35.10, -117.68], [35.45, -117.80]]],
  ['40', [[34.90, -117.02], [34.83, -116.55], [34.77, -116.00]]],
  ['5', [[33.75, -117.82], [34.00, -118.10], [34.15, -118.26], [34.40, -118.56], [34.80, -118.86]]],
  ['10', [[34.07, -117.85], [34.04, -118.25], [34.02, -118.49]]],
];
const PM_TOWNS = [['Edwards AFB', 34.905, -117.884], ['Lancaster', 34.698, -118.137], ['Palmdale', 34.579, -118.117], ['Mojave', 35.053, -118.174],
  ['Boron', 35.000, -117.650], ['California City', 35.126, -117.986], ['Victorville', 34.536, -117.291], ['Barstow', 34.898, -117.023],
  ['Los Angeles', 34.052, -118.244], ['MCAS Miramar', 32.868, -117.142], ['Palm Springs', 33.830, -116.545], ['Lake Isabella', 35.62, -118.47]];

// published track [{lat, lon, z_ft}] from a UWyo CSV with latitude/longitude columns
function trackFromCSV(csv) {
  const lines = String(csv || '').trim().split(/\r?\n/);
  if (lines.length < 5) return null;
  const h = lines[0].toLowerCase().split(',').map(x => x.trim());
  const ix = k => h.findIndex(x => x.startsWith(k));
  const la = ix('lat'), lo = ix('lon'), z = h.findIndex(x => /geopotential|height|hght/.test(x));
  if (la < 0 || lo < 0 || z < 0) return null;
  const out = [];
  for (const L of lines.slice(1)) {
    const f = L.split(',');
    const p = { lat: +f[la], lon: +f[lo], z_ft: +f[z] * 3.28084 };
    if (isFinite(p.lat) && isFinite(p.lon) && isFinite(p.z_ft)) out.push(p);
  }
  return out.length > 10 ? out : null;
}

// reconstructed track from the sounding's winds (levels: z in kft, dir deg from, spd kt)
function trackFromWinds(levels, lat0, lon0, rise = 5.0) {
  const lv = levels.filter(l => isFinite(l.z) && l.dir != null && l.spd != null && isFinite(l.dir) && isFinite(l.spd)).sort((a, b) => a.z - b.z);
  if (lv.length < 3) return null;
  let x = 0, y = 0;
  const out = [{ lat: lat0, lon: lon0, z_ft: lv[0].z * 1000 }];
  for (let k = 1; k < lv.length; k++) {
    const dz = (lv[k].z - lv[k - 1].z) * 304.8;
    if (dz <= 0) continue;
    const dt = dz / rise, a = lv[k - 1], b = lv[k];
    // average the wind vectors of the two levels; the wind blows from dir, so the balloon goes to dir + 180
    const u = (s, d) => -s * 0.5144 * Math.sin(d * Math.PI / 180), v = (s, d) => -s * 0.5144 * Math.cos(d * Math.PI / 180);
    x += (u(a.spd, a.dir) + u(b.spd, b.dir)) / 2 * dt;
    y += (v(a.spd, a.dir) + v(b.spd, b.dir)) / 2 * dt;
    out.push({ lat: lat0 + y / 111200, lon: lon0 + x / (111200 * Math.cos(lat0 * Math.PI / 180)), z_ft: b.z * 1000 });
  }
  return out;
}

function balloonPathSVG(track, stn, opts = {}) {
  const top = opts.top_ft || 30000;
  const tr = track.filter(p => p.z_ft <= top + 1);
  if (tr.length < 2) return '';
  const lats = tr.map(p => p.lat).concat(stn.lat), lons = tr.map(p => p.lon).concat(stn.lon);
  const cl = Math.cos(stn.lat * Math.PI / 180);
  let la0 = Math.min(...lats), la1 = Math.max(...lats), lo0 = Math.min(...lons), lo1 = Math.max(...lons);
  // at least ~70 x 50 km, padded, in the 3:2 frame
  const cla = (la0 + la1) / 2, clo = (lo0 + lo1) / 2;
  let hw = Math.max((lo1 - lo0) / 2 * 1.35, 0.4), hh = Math.max((la1 - la0) / 2 * 1.35, 0.27);
  if (hw * cl / hh > 1.5) hh = hw * cl / 1.5; else hw = hh * 1.5 / cl;
  la0 = cla - hh; la1 = cla + hh; lo0 = clo - hw; lo1 = clo + hw;
  const W = 600, H = 400, X = lo => (lo - lo0) / (lo1 - lo0) * W, Y = la => (la1 - la) / (la1 - la0) * H, f = v => v.toFixed(1);
  const P = ([la, lo]) => `${f(X(lo))},${f(Y(la))}`;
  const o = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" font-family="Inter, -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif" role="img" aria-label="Balloon flight path">`,
    `<defs><clipPath id="pmc"><rect width="${W}" height="${H}" rx="10"/></clipPath></defs><g clip-path="url(#pmc)">`,
    `<rect width="${W}" height="${H}" fill="#f5f4f0"/>`];
  if (typeof COAST !== 'undefined') o.push(`<polygon points="${COAST.map(P).join(' ')} -2000,${H + 2000} -2000,-2000" fill="#cfe2ee" stroke="#b7cfdd"/>`);
  if (typeof BAY !== 'undefined') o.push(`<polygon points="${BAY.map(P).join(' ')}" fill="#cfe2ee"/>`);
  const roads = (typeof ROADS !== 'undefined' ? ROADS.map(r => [r[0], r[1]]) : []).concat(PM_ROADS);
  for (const [, pts] of roads) o.push(`<polyline points="${pts.map(P).join(' ')}" fill="none" stroke="#d9b779" stroke-width="1.3" stroke-linejoin="round"/>`);
  const ticks = [5000, 10000, 20000, 30000].filter(zt => zt <= top).map(zt => [zt, track.find(q => q.z_ft >= zt)]).filter(([, p]) => p)
    .map(([zt, p]) => [zt, X(p.lon), Y(p.lat)]).filter(([, x, y]) => Math.hypot(x - X(stn.lon), y - Y(stn.lat)) > 28);
  const busy = [[X(stn.lon), Y(stn.lat)], ...ticks.map(([, x, y]) => [x, y])];
  const towns = (typeof TOWNS !== 'undefined' ? TOWNS.map(t => [t[0], t[1], t[2]]) : []).concat(PM_TOWNS);
  const seen = new Set();
  for (const [n, la, lo] of towns) {
    const x = X(lo), y = Y(la);
    if (x < 8 || x > W - 70 || y < 14 || y > H - 8 || seen.has(n) || busy.some(([bx, by]) => Math.abs(bx - x) < 70 && Math.abs(by - y) < 18)) continue;
    seen.add(n);
    o.push(`<circle cx="${f(x)}" cy="${f(y)}" r="2.2" fill="#6b7280"/><text x="${f(x + 5)}" y="${f(y + 4)}" font-size="11.5" fill="#4b5563" paint-order="stroke" stroke="#f5f4f0" stroke-width="3">${n}</text>`);
  }
  // path, coloured low (warm) to high (blue), with height ticks
  const col = z => z < 5000 ? '#e07b24' : z < 10000 ? '#d4a017' : z < 20000 ? '#3aa457' : '#2f7fcf';
  for (let k = 1; k < tr.length; k++) o.push(`<path d="M${P([tr[k - 1].lat, tr[k - 1].lon])}L${P([tr[k].lat, tr[k].lon])}" stroke="${col(tr[k].z_ft)}" stroke-width="3" stroke-linecap="round"/>`);
  for (const [zt, x, y] of ticks) {
    o.push(`<circle cx="${f(x)}" cy="${f(y)}" r="4" fill="#fff" stroke="${col(zt - 1)}" stroke-width="2"/>`);
    o.push(`<text x="${f(x + 7)}" y="${f(y - 6)}" font-size="12" font-weight="700" fill="#1f2328" paint-order="stroke" stroke="#fff" stroke-width="3">${zt / 1000}k ft</text>`);
  }
  // launch
  o.push(`<circle cx="${f(X(stn.lon))}" cy="${f(Y(stn.lat))}" r="6" fill="#c26a24" stroke="#fff" stroke-width="2"/>`);
  o.push(`<text x="${f(X(stn.lon) + 9)}" y="${f(Y(stn.lat) - 8)}" font-size="12.5" font-weight="700" fill="#9a5418" paint-order="stroke" stroke="#fff" stroke-width="3">launch · ${stn.name}</text>`);
  // scale (10 mi) and north
  const mi10 = 16093 / (111200 * cl) / (lo1 - lo0) * W;
  o.push(`<path d="M${W - 20 - mi10} ${H - 16}h${f(mi10)}" stroke="#4b5563" stroke-width="2"/><text x="${f(W - 20 - mi10 / 2)}" y="${H - 22}" text-anchor="middle" font-size="11" fill="#4b5563">10 mi</text>`);
  o.push(`<text x="${W - 18}" y="22" text-anchor="middle" font-size="12" font-weight="700" fill="#4b5563">N</text><path d="M${W - 18} 26l-5 12 5-3 5 3z" fill="#4b5563"/>`);
  o.push('</g></svg>');
  return o.join('');
}

if (typeof module !== 'undefined') module.exports = { balloonPathSVG, trackFromWinds, trackFromCSV };

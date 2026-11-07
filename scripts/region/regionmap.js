// SD Radar Regions map: clean, modern, flat (pure SVG, no tiles).
// Light land, pale water, soft relief, roads, towns, clear launch pins, regions as a soft heat glow in score colours,
// region names lettered across each region (placed by a collision search). mapSVG(D, day, radar) -> SVG
const FM = { lon0: -117.74, lon1: -116.17, lat0: 32.47, lat1: 34.46, W: 800 };
FM.H = Math.round(FM.W * (FM.lat1 - FM.lat0) / ((FM.lon1 - FM.lon0) * Math.cos(33.2 * Math.PI / 180)));
const fx = lo => (lo - FM.lon0) / (FM.lon1 - FM.lon0) * FM.W;
const fy = la => (FM.lat1 - la) / (FM.lat1 - FM.lat0) * FM.H;
const P = ([la, lo]) => `${fx(lo).toFixed(1)},${fy(la).toFixed(1)}`;
const SCORE_COL = { 1: '#d8402f', 2: '#ee8a1c', 3: '#f1c72b', 4: '#3aa457', 5: '#2f7fcf' };
function scoreCol(r) {
  const x = Math.max(1, Math.min(5, r)), lo = Math.floor(x), hi = Math.min(5, lo + 1), t = x - lo;
  const h = c => [1, 3, 5].map(k => parseInt(c.slice(k, k + 2), 16));
  const a = h(SCORE_COL[lo]), b = h(SCORE_COL[hi]);
  return '#' + a.map((v, k) => Math.round(v + (b[k] - v) * t).toString(16).padStart(2, '0')).join('');
}
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
const COAST = [[34.4, -118.6], [34.0, -118.2], [33.75, -118.05], [33.62, -117.93], [33.54, -117.79], [33.47, -117.71], [33.42, -117.62], [33.37, -117.56],
  [33.30, -117.47], [33.21, -117.40], [33.13, -117.34], [33.05, -117.30], [32.96, -117.27], [32.88, -117.255], [32.85, -117.28],
  [32.80, -117.26], [32.77, -117.25], [32.75, -117.255], [32.72, -117.255], [32.67, -117.245], [32.69, -117.21], [32.68, -117.185],
  [32.62, -117.14], [32.58, -117.13], [32.535, -117.125], [32.48, -117.12], [32.40, -117.10]];

const BAY = [[32.715, -117.175], [32.70, -117.155], [32.66, -117.12], [32.625, -117.105], [32.605, -117.12], [32.63, -117.14],
  [32.665, -117.165], [32.685, -117.185], [32.70, -117.215], [32.712, -117.205]];

const ROADS = [
  ['5', [[32.54, -117.04], [32.62, -117.09], [32.70, -117.15], [32.76, -117.20], [32.86, -117.22], [32.95, -117.24], [33.05, -117.28], [33.15, -117.33], [33.21, -117.37], [33.30, -117.47], [33.42, -117.61], [33.50, -117.67], [33.62, -117.71], [33.75, -117.82]], 0.55],
  ['15', [[32.70, -117.11], [32.82, -117.11], [32.95, -117.10], [33.02, -117.08], [33.12, -117.09], [33.25, -117.15], [33.40, -117.15], [33.49, -117.15], [33.58, -117.24], [33.66, -117.30], [33.75, -117.38], [33.90, -117.48], [34.06, -117.50], [34.18, -117.42], [34.30, -117.47], [34.40, -117.40]], 0.35],
  ['10', [[34.07, -117.85], [34.07, -117.60], [34.06, -117.40], [34.05, -117.20], [33.99, -117.00], [33.93, -116.80], [33.90, -116.50], [33.80, -116.20], [33.75, -116.0]], 0.5],
  ['8', [[32.76, -117.21], [32.77, -117.10], [32.79, -116.96], [32.84, -116.77], [32.85, -116.62], [32.84, -116.45], [32.75, -116.25], [32.70, -116.0]], 0.5],
  ['805', [[32.56, -117.05], [32.70, -117.10], [32.80, -117.15], [32.90, -117.22]], 0.3],
  ['215', [[33.58, -117.24], [33.68, -117.21], [33.78, -117.23], [33.95, -117.28], [34.07, -117.29], [34.15, -117.33], [34.20, -117.40]], 0.6],
  ['78', [[33.20, -117.36], [33.14, -117.20], [33.12, -117.09], [33.05, -116.88], [33.08, -116.60], [33.10, -116.40], [33.15, -116.10]], 0.25],
  ['94', [[32.72, -117.10], [32.72, -116.90], [32.65, -116.70], [32.60, -116.50]], 0.12],
  ['79', [[33.49, -117.15], [33.40, -116.95], [33.25, -116.73], [33.08, -116.60], [32.90, -116.55], [32.84, -116.62]], 0.3],
  ['74', [[33.50, -117.66], [33.62, -117.42], [33.66, -117.33], [33.75, -117.10], [33.80, -116.97], [33.70, -116.60]], 0.45],
];

const RANGES = [
  [[[33.85, -117.66], [33.70, -117.55], [33.58, -117.47], [33.47, -117.38]], 13, 10],      // Santa Ana Mtns
  [[[33.43, -116.98], [33.36, -116.86], [33.30, -116.74]], 14, 6],                          // Palomar
  [[[33.36, -116.66], [33.30, -116.56], [33.22, -116.52]], 12, 5],                          // Hot Springs
  [[[33.14, -116.66], [33.04, -116.62], [32.95, -116.60], [32.88, -116.54]], 13, 7],        // Volcan / Cuyamaca
  [[[32.95, -116.45], [32.86, -116.42], [32.74, -116.40], [32.62, -116.42]], 12, 6],        // Laguna
  [[[33.90, -116.74], [33.81, -116.68], [33.72, -116.62]], 18, 5],                          // San Jacinto
  [[[34.24, -117.42], [34.24, -117.25], [34.22, -117.05], [34.18, -116.85]], 15, 9],      // San Bernardino Mtns
  [[[34.30, -117.80], [34.27, -117.62], [34.26, -117.50]], 15, 5],                        // San Gabriel Mtns
  [[[33.62, -116.48], [33.52, -116.38], [33.44, -116.27]], 13, 5],                          // Santa Rosa Mtns
  [[[32.92, -116.82], [32.89, -116.78]], 9, 2],                                             // El Cajon Mtn
  [[[32.62, -116.88], [32.58, -116.82]], 9, 2],                                             // Otay Mtn
  [[[33.02, -116.98], [33.00, -116.94]], 7, 2],                                             // Woodson / Poway hills
];

const TOWNS = [['San Diego', 32.72, -117.16, 3], ['Tijuana', 32.52, -117.03, 2], ['Oceanside', 33.20, -117.38, 2], ['Escondido', 33.12, -117.09, 2],
  ['El Cajon', 32.79, -116.96, 2], ['Ramona', 33.04, -116.87, 1], ['Julian', 33.08, -116.60, 1], ['Temecula', 33.49, -117.15, 2],
  ['Lake Elsinore', 33.68, -117.33, 1], ['Riverside', 33.95, -117.40, 2], ['San Bernardino', 34.11, -117.29, 2], ['Lake Arrowhead', 34.25, -117.19, 1], ['Hemet', 33.75, -116.97, 2], ['Borrego Springs', 33.26, -116.37, 1], ['Alpine', 32.84, -116.77, 1]];

const SITES = [['Torrey Pines', 32.890, -117.252], ['Little Black', 32.988, -117.122], ['Blossom', 32.877, -116.848], ['Otay', 32.574, -116.894],
  ["Whale's V", 32.645, -116.887, 'left'], ['Laguna', 32.86, -116.43], ['Elsinore', 33.630, -117.371], ['Soboba', 33.822, -116.959], ['Marshall', 34.210, -117.303, 'left']];

const SUMMITS = [['Palomar Mtn', 33.363, -116.836, 6140], ['Hot Springs Mtn', 33.312, -116.582, 6533], ['Cuyamaca Pk', 32.947, -116.606, 6512],
    ['Laguna Mtns', 32.867, -116.422, 6271], ['El Cajon Mtn', 32.902, -116.807, 3675], ['Otay Mtn', 32.601, -116.846, 3566],
    ['Santiago Pk', 33.711, -117.534, 5689], ['San Jacinto Pk', 33.815, -116.679, 10834], ['San Gorgonio', 34.099, -116.825, 11503],
    ['Toro Pk', 33.524, -116.425, 8716]];
const SITE_NAME = { torrey: 'Torrey', lb: 'Little Black', blossom: 'Blossom', otay: 'Otay', whalesv: "Whale's V", lagunahorse: 'Laguna', elsinore: 'Elsinore', soboba: 'Soboba', marshall: 'Marshall' };
const WHY_TXT = { offshore: 'offshore flow aloft', otb: 'over the back', cross: 'cross wind', windy: 'blown out', strong: 'strong on launch', gusty: 'gusty',
  lid: 'low lid', weak: 'weak thermals', aloft: 'strong wind aloft', light: 'too light', aloftdir: 'wrong flow aloft', drift: 'strong drift' };
// the radar's verdict for a region on a date: its best launch, score, label and reasons
function radarVerdict(radar, regionId, date) {
  const rd = radar && (radar.days || []).find(x => x.date === date);
  if (!rd) return null;
  const ids = (REGION_SITES[regionId] || []).filter(id => rd.sites?.[id]?.rating != null);
  if (!ids.length) return null;
  const id = ids.reduce((a, b) => (rd.sites[b].rating > rd.sites[a].rating ? b : a));
  const c = rd.sites[id], v = Math.round(c.rating * 2) / 2;
  const why = (c.why || []).map(k => WHY_TXT[k] || k).slice(0, 2).join(', ');
  return { site: SITE_NAME[id] || id, score: v, label: c.label || '', why: v < 2.5 ? why : '', color: scoreCol(v) };
}
const REGION_SITES = { coast: ['torrey'], north: ['lb'], east: ['blossom'], south: ['otay', 'whalesv'], mountains: ['lagunahorse'],
  inland_empire: ['elsinore', 'soboba'], marshall: ['marshall'] };

// region lettering: [lat, lon], rotation, size
const NAME_AT = {   // placed by a collision search against every other label
  coast: [[33.00, -117.37], -62, 17], north: [[33.28, -117.12], -66, 17], east: [[33.01, -116.70], -6, 14], south: [[32.72, -116.79], -4, 11],
  mountains: [[32.78, -116.52], -80, 17], desert: [[32.96, -116.27], -82, 17], palmsj: [[33.70, -116.40], -60, 14],
  marshall: [[34.05, -117.39], -4, 17], inland_empire: [[33.88, -117.22], -3, 18] };

const BOXES = [];
function box(kind, x, y, w, h, rot = 0, anchor = 'start') {
  const cx = anchor === 'middle' ? x : anchor === 'end' ? x - w / 2 : x + w / 2;
  BOXES.push({ kind, cx, cy: y - h * 0.35, w, h, rot });
}
const tw = (t, fs, k = 0.56, ls = 0) => t.length * (fs * k + ls);
function clashes(x, y, w, h, anchor, kinds) {
  const cx = anchor === 'middle' ? x : anchor === 'end' ? x - w / 2 : x + w / 2, cy = y - h * 0.35;
  return BOXES.some(b => kinds.includes(b.kind) && Math.abs(b.cx - cx) < (b.w + w) / 2 + 2 && Math.abs(b.cy - cy) < (b.h + h) / 2 + 1);
}
const SANS = "Inter, 'Work Sans', -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif";

function mapSVG(D, day = 0, radar = null) {
  BOXES.length = 0;
  const { W, H } = FM, f = v => v.toFixed(1), r = rng(7);
  const LAND = '#f5f4f0', WATER = '#cfe2ee', SHORE = '#9dbdd2', INK = '#1f2937', MUTED = '#6b7280', ROAD = '#e2b36a';
  const rate = (rg, dd) => {
    if (rg.own_score) return dd?.summary?.score == null ? null : Math.round(dd.summary.score * 2) / 2;
    const vd = radarVerdict(radar, rg.id, dd?.date);
    const v = vd ? vd.score : dd?.summary?.score;
    return v == null ? null : Math.round(v * 2) / 2;
  };
  const o = [];
  o.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" font-family="${SANS}" fill="${INK}">`);
  o.push(`<defs>
    <filter id="soft" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="10"/></filter>
    <filter id="relief" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="7"/></filter>
    <filter id="shadow" x="-10%" y="-10%" width="120%" height="140%"><feDropShadow dx="0" dy="1.5" stdDeviation="2" flood-color="#000" flood-opacity=".18"/></filter>
    <clipPath id="frame"><rect width="${W}" height="${H}" rx="12"/></clipPath>
  </defs><g clip-path="url(#frame)">`);
  o.push(`<rect width="${W}" height="${H}" fill="${LAND}"/>`);
  // desert tint east of the crest
  o.push(`<polygon points="${[[34.46, -116.62], [34.46, -116.0], [32.4, -116.0], [32.4, -116.30], [32.75, -116.33], [33.0, -116.40], [33.25, -116.45], [33.45, -116.50], [33.75, -116.62]].map(P).join(' ')}" fill="#f1e9d8" filter="url(#relief)"/>`);
  // soft relief along the ranges
  o.push(`<g fill="#d9d6cc" opacity=".75" filter="url(#relief)">`);
  for (const [spine, size, n] of RANGES) {
    for (let i = 0; i <= n * 2; i++) {
      const t = i / (n * 2), seg = t * (spine.length - 1), k = Math.min(spine.length - 2, Math.floor(seg)), u = seg - k;
      const la = spine[k][0] + (spine[k + 1][0] - spine[k][0]) * u, lo = spine[k][1] + (spine[k + 1][1] - spine[k][1]) * u;
      o.push(`<circle cx="${f(fx(lo))}" cy="${f(fy(la))}" r="${f(size * (1.5 + r() * 0.6))}"/>`);
    }
  }
  o.push(`</g>`);
  // water
  o.push(`<polygon points="${COAST.map(P).join(' ')} -50,${H + 50} -50,-50" fill="${WATER}"/>`);
  o.push(`<polyline points="${COAST.map(P).join(' ')}" fill="none" stroke="${SHORE}" stroke-width="1.3" stroke-linejoin="round"/>`);
  o.push(`<polygon points="${BAY.map(P).join(' ')}" fill="${WATER}" stroke="${SHORE}"/>`);
  o.push(`<ellipse cx="${f(fx(-117.355))}" cy="${f(fy(33.665))}" rx="9" ry="5" transform="rotate(-25 ${f(fx(-117.355))} ${f(fy(33.665))})" fill="${WATER}" stroke="${SHORE}"/>`);
  o.push(`<path d="M${f(fx(-117.125))} ${f(fy(32.535))} L${W} ${f(fy(32.62))}" stroke="#a3a3a3" stroke-width="1" stroke-dasharray="6 4" fill="none"/>`);
  o.push(`<text x="${f(fx(-116.55))}" y="${f(fy(32.57) + 14)}" font-size="10" fill="${MUTED}" letter-spacing="2">MEXICO</text>`);
  // regions: heat glow in score colours + thin white borders
  const regs = D.regions;
  o.push(`<g opacity=".55">`);
  for (const rg of regs) {
    const v = rate(rg, rg.days[Math.min(day, rg.days.length - 1)]);
    o.push(`<polygon points="${rg.poly.map(P).join(' ')}" fill="${v != null ? scoreCol(v) : '#cbd5e1'}" filter="url(#soft)"/>`);
  }
  o.push(`</g>`);
  for (const rg of regs) o.push(`<polygon points="${rg.poly.map(P).join(' ')}" fill="none" stroke="#ffffff" stroke-width="1.6" stroke-opacity=".9"/>`);
  // priority: launches, then towns, then route labels, then summit labels (lower ones are skipped if they would touch)
  for (const [n, la, lo, side] of SITES) {
    const x = fx(lo), y = fy(la), lw = tw(n, 11.5, 0.6) + 12, px = side === 'left' ? x - 12 - lw : x + 12;
    box('site', px + lw / 2, y + 8, lw, 17, 0, 'middle'); box('site', x, y + 2, 22, 26, 0, 'middle');
  }
  for (const [n, la, lo, sz] of TOWNS) {
    const x = fx(lo), y = fy(la), left = x > W - 130, fs = 10 + sz;
    box('town', left ? x - 7 : x + 7, y + 4, tw(n, fs), fs, 0, left ? 'end' : 'start'); box('town', x, y + 3, 9, 9, 0, 'middle');
  }
  // roads: white casing + warm line, small grey route labels
  for (const [num, pts, at] of ROADS) {
    const d = pts.map(P).join(' ');
    o.push(`<polyline points="${d}" fill="none" stroke="#fff" stroke-width="4" stroke-linejoin="round" stroke-linecap="round" opacity=".9"/>`);
    o.push(`<polyline points="${d}" fill="none" stroke="${ROAD}" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/>`);
    const k = Math.min(pts.length - 2, Math.floor(at * (pts.length - 1))), a = pts[k], b = pts[k + 1];
    const sx = (fx(a[1]) + fx(b[1])) / 2, sy = (fy(a[0]) + fy(b[0])) / 2, iw = num.length > 2 ? 24 : 18;
    if (clashes(sx, sy + 5, iw, 14, 'middle', ['site', 'town', 'shield'])) continue;
    box('shield', sx, sy + 5, iw, 14, 0, 'middle');
    o.push(`<g transform="translate(${f(sx)} ${f(sy)})"><rect x="${-iw / 2}" y="-7" width="${iw}" height="13" rx="3" fill="#fff" stroke="#9ca3af" stroke-width=".8"/><text y="3.2" font-size="9" font-weight="700" text-anchor="middle" fill="#4b5563">${num}</text></g>`);
  }
  // summits
  for (const [n, la, lo, ft] of SUMMITS) {
    const x = fx(lo), y = fy(la);
    if (x < 8 || x > W - 8 || y < 8 || y > H - 8) continue;
    const sw = tw(n + ' ' + ft.toLocaleString('en-US') + "'", 9);
    if (clashes(x + 6, y + 3, sw, 9, 'start', ['site', 'town', 'shield']) || clashes(x, y + 2, 9, 9, 'middle', ['site', 'town', 'shield'])) continue;
    box('summit', x + 6, y + 3, sw, 9); box('summit', x, y + 2, 9, 9, 0, 'middle');
    o.push(`<path d="M${f(x)} ${f(y - 4)} l3.6 6.2 h-7.2 z" fill="#8b8579"/>`);
    o.push(`<text x="${f(x + 6)}" y="${f(y + 3)}" font-size="9" fill="#6b6457" stroke="${LAND}" stroke-width="2.5" paint-order="stroke">${n} ${ft.toLocaleString('en-US')}′</text>`);
  }
  // towns
  for (const [n, la, lo, sz] of TOWNS) {
    const x = fx(lo), y = fy(la), left = x > W - 130, fs = 10 + sz;
    o.push(`<circle cx="${f(x)}" cy="${f(y)}" r="${sz >= 3 ? 3.6 : 2.6}" fill="#4b5563" stroke="#fff" stroke-width="1.4"/>`);
    o.push(`<text x="${f(left ? x - 7 : x + 7)}" y="${f(y + 4)}" text-anchor="${left ? 'end' : 'start'}" font-size="${fs}" font-weight="${sz >= 3 ? 600 : 500}" fill="#374151" stroke="${LAND}" stroke-width="3" stroke-opacity=".9" paint-order="stroke">${n}</text>`);
  }
  // launch sites: orange pin with a white glider, label in a white pill
  for (const [n, la, lo, side] of SITES) {
    const x = fx(lo), y = fy(la), lw = tw(n, 11.5, 0.6) + 12, left = side === 'left';
    const px = left ? x - 12 - lw : x + 12;
    o.push(`<g filter="url(#shadow)"><path d="M${f(x)} ${f(y + 9)} c-2 -4 -9 -8 -9 -15 a9 9 0 0 1 18 0 c0 7 -7 11 -9 15z" fill="#ea580c" stroke="#fff" stroke-width="1.6"/>
      <path d="M${f(x - 5)} ${f(y - 6)} q5 -5 10 0 M${f(x - 4.5)} ${f(y - 6)} L${f(x)} ${f(y - 1)} L${f(x + 4.5)} ${f(y - 6)}" fill="none" stroke="#fff" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></g>`);
    o.push(`<g filter="url(#shadow)"><rect x="${f(px)}" y="${f(y - 6)}" width="${f(lw)}" height="17" rx="8.5" fill="#fff"/></g>`);
    o.push(`<text x="${f(px + lw / 2)}" y="${f(y + 6.3)}" text-anchor="middle" font-size="11.5" font-weight="700" fill="#9a3412">${n}</text>`);
  }
  // tap targets: the whole region (names live in the panel that opens; the map shows colour only)
  for (const rg of regs) o.push(`<g class="rg" data-id="${rg.id}" style="cursor:pointer"><polygon points="${rg.poly.map(P).join(' ')}" fill="#000" fill-opacity="0"/></g>`);
  // title card + north arrow (top right), scale bar
  const tx = W - 214;
  box('title', tx + 98, 74 - 52 * 0.15, 196, 56, 0, 'middle');
  o.push(`<g filter="url(#shadow)"><rect x="${tx}" y="18" width="196" height="52" rx="10" fill="#fff"/></g>`);
  o.push(`<text x="${tx + 14}" y="41" font-size="16" font-weight="800" letter-spacing="-.01em">SD Radar Regions</text>`);
  o.push(`<text x="${tx + 14}" y="58" font-size="10.5" fill="${MUTED}">${D.regions[0].days[Math.min(day, D.regions[0].days.length - 1)]?.label || ''} · colour = score</text>`);
  const cx = W - 34, cy = 98;
  box('compass', cx, cy + 12, 30, 40, 0, 'middle');
  o.push(`<g transform="translate(${cx} ${cy})" filter="url(#shadow)"><circle r="13" fill="#fff"/><path d="M0 -9 L4.5 5 L0 2.4 L-4.5 5 Z" fill="${INK}"/></g><text x="${cx}" y="${cy - 17}" text-anchor="middle" font-size="10" font-weight="700" fill="${MUTED}">N</text>`);
  const mi = 10 / 69 / Math.cos(33.2 * Math.PI / 180) / (FM.lon1 - FM.lon0) * W;
  o.push(`<g transform="translate(${f(W - 22 - mi)} ${H - 22})"><rect width="${f(mi)}" height="4" rx="2" fill="#9ca3af"/><rect width="${f(mi / 2)}" height="4" rx="2" fill="#4b5563"/><text y="-5" font-size="9.5" fill="${MUTED}">0</text><text x="${f(mi)}" y="-5" font-size="9.5" text-anchor="end" fill="${MUTED}">10 mi</text></g>`);
  o.push(`</g><rect x=".5" y=".5" width="${W - 1}" height="${H - 1}" rx="12" fill="none" stroke="#d1d5db"/>`);
  o.push('</svg>');
  return o.join('\n');
}

if (typeof module !== 'undefined') module.exports = { mapSVG, scoreCol, radarVerdict, BOXES, FM };

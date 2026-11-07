// Hand-drawn, fantasy-book style map of the San Diego flying area (pure SVG, no tiles):
// parchment, inked coastline with ripples, pencil mountain ranges, desert stipple, freeways as double pencil lines,
// towns, launches, and the soaring regions as a soft heat glow in the radar's score colours with a score badge.
// mapSVG(D, day) -> SVG string (regions are <g class="rg" data-id=...> for click handling)

const FM = { lon0: -117.74, lon1: -116.17, lat0: 32.47, lat1: 34.37, W: 800 };
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
// deterministic jitter so the drawing is stable between loads
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
// mountain ranges: [lat, lon] spine points, peak size, density
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
const LABEL_LEFT = { desert: true };
const LABEL_AT = { coast: [32.99, -117.58], north: [33.33, -117.24], east: [32.99, -116.80], south: [32.71, -116.83],
  mountains: [33.22, -116.80], desert: [32.98, -116.26], inland_empire: [33.88, -117.33], marshall: [34.05, -117.56] };

// the radar sites that colour each region (best of them that day); regions without a launch use their own score
const REGION_SITES = { coast: ['torrey'], north: ['lb'], east: ['blossom'], south: ['otay', 'whalesv'], mountains: ['lagunahorse'],
  inland_empire: ['elsinore', 'soboba'], marshall: ['marshall'] };

function mapSVG(D, day = 0, radar = null) {
  // radar: data/forecast.json; the colour of a region is the radar's score for its launches (shown rounded to .5 like the radar)
  const rate = (rg, dd) => {
    const rd = radar && dd && (radar.days || []).find(x => x.date === dd.date);
    const vals = rd ? (REGION_SITES[rg.id] || []).map(id => rd.sites?.[id]?.rating).filter(v => v != null) : [];
    const v = vals.length ? Math.max(...vals) : dd?.summary?.score;
    return v == null ? null : Math.round(v * 2) / 2;
  };
  const { W, H } = FM, f = v => v.toFixed(1), r = rng(7);
  const INK = '#4a3b2a', INK2 = '#7a6650', PAPER = '#f3e9d2';
  const o = [];
  o.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" font-family="'Caveat', 'Segoe Print', cursive" fill="${INK}">`);
  o.push(`<defs>
    <filter id="pencil" x="-5%" y="-5%" width="110%" height="110%"><feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="2" seed="3"/><feDisplacementMap in="SourceGraphic" scale="2.6"/></filter>
    <filter id="paper" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="3" seed="9" result="n"/><feColorMatrix in="n" type="matrix" values="0 0 0 0 0.35  0 0 0 0 0.27  0 0 0 0 0.16  0 0 0 0.10 0"/></filter>
    <filter id="heat" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="9"/></filter>
    <radialGradient id="vig" cx="50%" cy="50%" r="72%"><stop offset="62%" stop-color="#000" stop-opacity="0"/><stop offset="100%" stop-color="#5b4426" stop-opacity=".28"/></radialGradient>
    <clipPath id="frame"><rect x="0" y="0" width="${W}" height="${H}" rx="8"/></clipPath>
  </defs>`);
  o.push(`<g clip-path="url(#frame)">`);
  o.push(`<rect width="${W}" height="${H}" fill="${PAPER}"/><rect width="${W}" height="${H}" filter="url(#paper)"/>`);
  // ---- sea: the area west of the coast, tinted, with ripple lines following the shore and little waves
  const coastPts = COAST.map(P).join(' ');
  o.push(`<polygon points="${coastPts} ${f(-50)},${f(H + 50)} ${f(-50)},${f(-50)}" fill="#d9e2dc" opacity=".85"/>`);
  for (const [k, op] of [[6, .55], [13, .38], [21, .24], [30, .14]])
    o.push(`<polyline points="${COAST.map(([la, lo]) => `${f(fx(lo) - k)},${f(fy(la) + k * .35)}`).join(' ')}" fill="none" stroke="#6f8a86" stroke-width="1" opacity="${op}" filter="url(#pencil)"/>`);
  for (let i = 0; i < 26; i++) {
    const x = 20 + r() * 210, y = 380 + r() * (H - 420);
    if (x > fx(-117.2 - (y / H) * 0.6) - 30) continue;
    o.push(`<path d="M${f(x)} ${f(y)}q4 -4 8 0t8 0" fill="none" stroke="#6f8a86" stroke-width="1" opacity=".55"/>`);
  }
  o.push(`<polygon points="${BAY.map(P).join(' ')}" fill="#d9e2dc" stroke="${INK2}" stroke-width="1" filter="url(#pencil)"/>`);
  o.push(`<ellipse cx="${f(fx(-117.355))}" cy="${f(fy(33.665))}" rx="9" ry="5" transform="rotate(-25 ${f(fx(-117.355))} ${f(fy(33.665))})" fill="#d9e2dc" stroke="${INK2}" filter="url(#pencil)"/>`);
  o.push(`<polyline points="${coastPts}" fill="none" stroke="${INK}" stroke-width="2" stroke-linejoin="round" filter="url(#pencil)"/>`);
  o.push(`<text x="70" y="${f(H * 0.70)}" font-size="26" fill="#5f7a76" opacity=".8" transform="rotate(-62 70 ${f(H * 0.70)})" font-family="'IM Fell English SC', Georgia, serif" letter-spacing="6">Pacific Ocean</text>`);
  // border
  o.push(`<path d="M${f(fx(-117.125))} ${f(fy(32.535))} L${f(W)} ${f(fy(32.62))}" stroke="${INK2}" stroke-width="1.3" stroke-dasharray="7 4 2 4" fill="none" filter="url(#pencil)"/>`);
  o.push(`<text x="${f(fx(-116.55))}" y="${f(fy(32.57) + 16)}" font-size="13" fill="${INK2}" transform="rotate(-4 ${f(fx(-116.55))} ${f(fy(32.57) + 16)})">Mexico</text>`);
  // ---- desert stipple east of the mountains
  for (let i = 0; i < 900; i++) {
    const la = 32.62 + r() * 1.25, lo = -116.42 + r() * 0.42;
    if (lo < -116.42 + (la - 32.6) * 0.12) continue;
    o.push(`<circle cx="${f(fx(lo))}" cy="${f(fy(la))}" r="${(0.5 + r() * 0.7).toFixed(2)}" fill="${INK2}" opacity=".45"/>`);
  }
  o.push(`<text x="${f(fx(-116.36))}" y="${f(fy(33.33))}" font-size="17" fill="${INK2}" font-family="'IM Fell English SC', Georgia, serif" text-anchor="middle" letter-spacing="2" transform="rotate(-8 ${f(fx(-116.36))} ${f(fy(33.33))})">Anza-Borrego</text>`);
  // ---- freeways: double pencil lines with a little shield
  for (const [num, pts, at] of ROADS) {
    const d = pts.map(P).join(' ');
    o.push(`<polyline points="${d}" fill="none" stroke="${INK2}" stroke-width="3.6" stroke-linejoin="round" stroke-linecap="round" opacity=".75" filter="url(#pencil)"/>`);
    o.push(`<polyline points="${d}" fill="none" stroke="${PAPER}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>`);
    const k = Math.min(pts.length - 2, Math.floor(at * (pts.length - 1))), a = pts[k], b = pts[k + 1];
    const sx = (fx(a[1]) + fx(b[1])) / 2, sy = (fy(a[0]) + fy(b[0])) / 2;
    const iw = num.length > 2 ? 22 : 17;
    o.push(`<g transform="translate(${f(sx)} ${f(sy)})"><path d="M${-iw / 2} -7 h${iw} v6 q0 6 ${-iw / 2} 9 q${-iw / 2} -3 ${-iw / 2} -9 z" fill="${PAPER}" stroke="${INK}" stroke-width="1"/><text y="3.5" font-size="11" font-weight="700" text-anchor="middle" font-family="Georgia, serif">${num}</text></g>`);
  }
  // ---- mountains: little hatched peaks along each range
  const peak = (x, y, s) => `<g filter="url(#pencil)"><path d="M${f(x - s)} ${f(y)} L${f(x)} ${f(y - s * 1.25)} L${f(x + s)} ${f(y)}" fill="${PAPER}" stroke="${INK}" stroke-width="1.3" stroke-linejoin="round"/>` +
    [0.25, 0.5, 0.75].map(t => `<path d="M${f(x + s * t * 0.9)} ${f(y - s * 1.25 * (1 - t) + 1)} l${f(s * 0.22)} ${f(s * 0.32)}" stroke="${INK2}" stroke-width=".9"/>`).join('') + '</g>';
  for (const [spine, size, n] of RANGES) {
    for (let i = 0; i < n * 2; i++) {
      const t = (i + r() * 0.6) / (n * 2), seg = t * (spine.length - 1), k = Math.min(spine.length - 2, Math.floor(seg)), u = seg - k;
      const la = spine[k][0] + (spine[k + 1][0] - spine[k][0]) * u + (r() - 0.5) * 0.05, lo = spine[k][1] + (spine[k + 1][1] - spine[k][1]) * u + (r() - 0.5) * 0.06;
      o.push(peak(fx(lo), fy(la), size * (0.65 + r() * 0.5)));
    }
  }
  // ---- soaring regions: soft heat glow in the score colour, dashed border, big score badge
  const regs = D.regions;
  o.push(`<g opacity=".62">`);
  for (const rg of regs) {
    const v = rate(rg, rg.days[Math.min(day, rg.days.length - 1)]);
    o.push(`<polygon points="${rg.poly.map(P).join(' ')}" fill="${v != null ? scoreCol(v) : '#bbb'}" filter="url(#heat)"/>`);
  }
  o.push(`</g>`);
  for (const rg of regs) o.push(`<polygon points="${rg.poly.map(P).join(' ')}" fill="none" stroke="${INK}" stroke-width="1.1" stroke-dasharray="5 4" opacity=".55" filter="url(#pencil)"/>`);
  // ---- towns and launches
  for (const [n, la, lo, sz] of TOWNS) {
    const x = fx(lo), y = fy(la);
    o.push(sz >= 3 ? `<g filter="url(#pencil)"><rect x="${f(x - 6)}" y="${f(y - 5)}" width="12" height="9" fill="${PAPER}" stroke="${INK}"/><path d="M${f(x - 6)} ${f(y - 5)}v-4h3v2h2v-2h2v2h2v-2h3v4" fill="none" stroke="${INK}"/></g>`
      : `<circle cx="${f(x)}" cy="${f(y)}" r="${sz + 1.5}" fill="${PAPER}" stroke="${INK}" stroke-width="1.2"/><circle cx="${f(x)}" cy="${f(y)}" r="1.2" fill="${INK}"/>`);
    const left = x > W - 130;
    o.push(`<text x="${f(left ? x - 8 : x + 8)}" y="${f(y + 5)}" text-anchor="${left ? 'end' : 'start'}" font-size="${12 + sz * 2}" fill="${INK}" stroke="${PAPER}" stroke-width="3" paint-order="stroke">${n}</text>`);
  }
  for (const [n, la, lo, side] of SITES) {
    const x = fx(lo), y = fy(la);
    o.push(`<g transform="translate(${f(x)} ${f(y)})"><path d="M-8 -3 q8 -8 16 0" fill="#f59e0b" stroke="#7c2d12" stroke-width="1.2"/><path d="M-7 -3 L0 6 L7 -3 M0 -6 L0 6" stroke="#7c2d12" stroke-width=".8" fill="none"/><circle cy="7" r="1.6" fill="#7c2d12"/></g>`);
    o.push(`<text x="${f(side === 'left' ? x - 10 : x + 10)}" y="${f(y + 10)}" text-anchor="${side === 'left' ? 'end' : 'start'}" font-size="14.5" font-weight="700" fill="#7c2d12" stroke="${PAPER}" stroke-width="3" paint-order="stroke">${n}</text>`);
  }
  // ---- region badges (score number, name, climb · top) and click targets
  for (const rg of regs) {
    const dd = rg.days[Math.min(day, rg.days.length - 1)], s = dd?.summary;
    const [la, lo] = LABEL_AT[rg.id] || [rg.points[0].lat, rg.points[0].lon];
    const v = rate(rg, dd), x = fx(lo), y = fy(la), col = v != null ? scoreCol(v) : '#9ca3af';
    o.push(`<g class="rg" data-id="${rg.id}" style="cursor:pointer"><polygon points="${rg.poly.map(P).join(' ')}" fill="#000" fill-opacity="0"/>
      <circle cx="${f(x)}" cy="${f(y)}" r="7" fill="${col}" stroke="${INK}" stroke-width="1.4" filter="url(#pencil)"/>
      <text x="${f(LABEL_LEFT[rg.id] ? x - 12 : x + 12)}" y="${f(y - 1)}" text-anchor="${LABEL_LEFT[rg.id] ? 'end' : 'start'}" font-size="15" font-family="'IM Fell English SC', Georgia, serif" fill="${INK}" stroke="${PAPER}" stroke-width="3.5" paint-order="stroke" letter-spacing=".5">${rg.name}</text>
      <text x="${f(LABEL_LEFT[rg.id] ? x - 12 : x + 12)}" y="${f(y + 14)}" text-anchor="${LABEL_LEFT[rg.id] ? 'end' : 'start'}" font-size="14.5" fill="${INK}" stroke="${PAPER}" stroke-width="3" paint-order="stroke">${s ? `${s.climb.toFixed(1)} m/s · ${(s.top_ft / 1000).toFixed(1)}k${s.cu && s.base_ft ? ' · cu' : ''}` : 'no thermals'}</text></g>`);
  }
  // ---- cartouche, compass rose, scale
  o.push(`<g transform="translate(18 ${H - 200})" filter="url(#pencil)"><rect width="232" height="58" rx="4" fill="${PAPER}" stroke="${INK}" stroke-width="1.5"/><rect x="4" y="4" width="224" height="50" rx="3" fill="none" stroke="${INK}" stroke-width=".7"/></g>`);
  o.push(`<text x="134" y="${H - 171}" text-anchor="middle" font-size="22" font-family="'IM Fell English SC', Georgia, serif" letter-spacing="1">The Soaring Lands</text>`);
  o.push(`<text x="134" y="${H - 152}" text-anchor="middle" font-size="15">of San Diego · ${D.regions[0].days[Math.min(day, D.regions[0].days.length - 1)]?.label || ''}</text>`);
  const cx = 80, cy = H - 70;
  o.push(`<g transform="translate(${cx} ${cy})" filter="url(#pencil)" stroke="${INK}" stroke-width="1"><circle r="30" fill="none"/><circle r="24" fill="none" stroke-dasharray="2 3"/>
    <path d="M0 -40 L6 0 L0 40 L-6 0 Z" fill="${PAPER}"/><path d="M0 -40 L6 0 L0 0 Z M0 40 L-6 0 L0 0 Z" fill="${INK}"/>
    <path d="M-40 0 L0 -5 L40 0 L0 5 Z" fill="${PAPER}"/><path d="M40 0 L0 -5 L0 0 Z M-40 0 L0 5 L0 0 Z" fill="${INK}"/></g>`);
  o.push(`<text x="${cx}" y="${cy - 44}" text-anchor="middle" font-size="16" font-family="'IM Fell English SC', Georgia, serif">N</text>`);
  const mi = 10 / 69 / Math.cos(33.2 * Math.PI / 180) / (FM.lon1 - FM.lon0) * W;   // 10 miles in px
  o.push(`<g transform="translate(${W - 30 - mi} ${H - 28})" filter="url(#pencil)"><path d="M0 0h${f(mi)}M0 -5v10M${f(mi / 2)} -3v6M${f(mi)} -5v10" stroke="${INK}" stroke-width="1.4"/></g><text x="${f(W - 30 - mi / 2)}" y="${H - 36}" text-anchor="middle" font-size="14">10 miles</text>`);
  o.push(`<rect width="${W}" height="${H}" fill="url(#vig)" pointer-events="none"/>`);
  o.push(`</g><rect x="1" y="1" width="${W - 2}" height="${H - 2}" rx="8" fill="none" stroke="${INK}" stroke-width="2" pointer-events="none"/>`);
  o.push('</svg>');
  return o.join('\n');
}

if (typeof module !== 'undefined') module.exports = { mapSVG, scoreCol };

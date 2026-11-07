// Little "where does this chart come from" strip: MCAS Miramar, the balloon, and a timeline of
// launch -> flight -> data posted -> chart updated, with the cycle the chart shows highlighted.
// timelineSVG({ now: Date, shown: Date (nominal 00Z/12Z of the sounding shown), fetched: Date|null })

const TL_TZ = 'America/Los_Angeles';
// chart update times (UTC hours/minutes), matching .github/workflows/sounding.yml
const TL_UPDATES = [[13, 47], [14, 47], [15, 47], [16, 47], [1, 47], [2, 47]];
const TL_LAUNCH_BEFORE_H = 1.0;   // balloons go up about an hour before the nominal 00Z/12Z time
const TL_FLIGHT_H = 1.75;         // ~100 min until the balloon bursts near 100,000 ft
const TL_POSTED_H = 1.25;         // data usually public ~75 min after nominal time

function tlFmt(d, opts) { return new Intl.DateTimeFormat('en-US', Object.assign({ timeZone: TL_TZ }, opts)).format(d); }
function tlHour(d) { return tlFmt(d, { hour: 'numeric', minute: '2-digit' }).replace(':00', '').replace(' ', ' ').toLowerCase(); }
function tlDay(d) { return tlFmt(d, { weekday: 'short' }); }

function timelineSVG({ now = new Date(), shown = null, fetched = null } = {}) {
  const H = 3600e3;
  const W = 800, Hh = 160;
  const t0 = new Date(now.getTime() - 15 * H), t1 = new Date(now.getTime() + 9 * H);
  const x0 = 162, x1 = 782, yAxis = 84;
  const X = t => x0 + (t - t0) / (t1 - t0) * (x1 - x0);
  const f = v => v.toFixed(1);
  const INK = '#111827', MUTED = '#6b7280', EDGE = '#e5e7eb', ACC = '#e07b00', BLUE = '#2563eb';
  const o = [];
  o.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${Hh}" font-family="Inter, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" font-size="11" fill="${MUTED}">`);
  o.push(`<rect width="${W}" height="${Hh}" rx="12" fill="#fff"/>`);

  // ---- little scene: two happy Marines letting the balloon go at a generic airfield ----
  const flying = (() => {
    for (let k = -1; k <= 1; k++) {
      const c = Math.round(now / (12 * H)) * 12 * H + k * 12 * H;
      const a = c - TL_LAUNCH_BEFORE_H * H;
      if (now >= a && now <= a + TL_FLIGHT_H * H) return true;
    }
    return false;
  })();
  const marine = (x, flip) => `<g transform="translate(${x} 0) scale(${flip ? -1 : 1} 1)">
      <path d="M-5 128 l-2 14 M5 128 l2 14" stroke="#3f4a2c" stroke-width="4" stroke-linecap="round"/>
      <path d="M-7 141.5h-3M7 141.5h3" stroke="#1f2937" stroke-width="3" stroke-linecap="round"/>
      <rect x="-8" y="104" width="16" height="26" rx="6" fill="#6b7a4b"/>
      <path d="M-4 110l3 4M2 118l3 3M-5 122l2 2" stroke="#55623a" stroke-width="2" stroke-linecap="round"/>
      <path d="M6 108 Q16 96 14 84" fill="none" stroke="#6b7a4b" stroke-width="4" stroke-linecap="round"/>
      <path d="M-6 108 Q-14 100 -16 92" fill="none" stroke="#6b7a4b" stroke-width="4" stroke-linecap="round"/>
      <circle cx="14" cy="83" r="2.6" fill="#e8b98f"/><circle cx="-16" cy="91" r="2.6" fill="#e8b98f"/>
      <circle cx="0" cy="96" r="7.5" fill="#e8b98f"/>
      <path d="M-8 92 Q0 82 8 92 Z" fill="#55623a"/><path d="M6 91.5h5" stroke="#55623a" stroke-width="2.2" stroke-linecap="round"/>
      <circle cx="-2.6" cy="96" r="0.95" fill="#1f2937"/><circle cx="2.6" cy="96" r="0.95" fill="#1f2937"/>
      <path d="M-3.2 99 Q0 102.6 3.2 99" fill="none" stroke="#1f2937" stroke-width="1.1" stroke-linecap="round"/>
      <circle cx="-4.6" cy="98.6" r="1.2" fill="#f4a3a3" opacity="0.7"/><circle cx="4.6" cy="98.6" r="1.2" fill="#f4a3a3" opacity="0.7"/>
    </g>`;
  o.push(`<style>
    @keyframes tlbob { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-4px) } }
    @keyframes tlrise { 0% { transform: translateY(10px); opacity: 0 } 12% { opacity: 1 } 85% { opacity: 1 } 100% { transform: translateY(-60px); opacity: 0 } }
    .tl-bob { animation: tlbob 3.5s ease-in-out infinite; }
    .tl-rise { animation: tlrise 6s linear infinite; }
    @media (prefers-reduced-motion: reduce) { .tl-bob, .tl-rise { animation: none } }
  </style>`);
  // generic F-35-style side profile, nose left, ~62 units long
  const jet = (x, y, sc, col) => `<g transform="translate(${x} ${y}) scale(${sc})">
      <path d="M48 3 L53 -7 L57.5 -7 L57 3 Z" fill="${col}"/>
      <path d="M0 7 Q7 3.4 17 3 L23 1.8 Q28 -0.4 33 1.8 L44 3 L57 3.2 L62 4.6 L62 7.6 L57 8.6 L9 9.4 Q3 9 0 7 Z" fill="${col}"/>
      <path d="M15.5 3.3 Q21 -0.6 27.5 1.9 L23.5 3.4 Z" fill="#475569"/>
      <path d="M27 7.2 L45 11.6 L51 11.6 L47 7.4 Z" fill="${col}" opacity="0.85"/>
      <path d="M52 6.2 L61 9.8 L63.5 9.2 L58.5 5.6 Z" fill="${col}" opacity="0.85"/>
      <rect x="61.5" y="4.6" width="3" height="3" rx="0.6" fill="#64748b"/>
    </g>`;
  o.push(`<g transform="translate(10 4)">
    <clipPath id="scn"><rect x="0" y="4" width="136" height="148" rx="10"/></clipPath>
    <g clip-path="url(#scn)">
      <rect x="0" y="4" width="136" height="148" fill="#eef4fb"/>
      <circle cx="122" cy="24" r="6.5" fill="#fde68a"/>
      <g opacity="0.9">${jet(84, 36, 0.42, '#94a3b8')}</g>
      <path d="M112 41 h22" stroke="#cbd5e1" stroke-width="1" stroke-dasharray="3 3"/>
      <path d="M0 116 Q34 110 68 114 T136 112 V152 H0 Z" fill="#d9e7c9"/>
      <path d="M2 118 Q22 92 44 118 Z" fill="#b9c3cf"/><rect x="2" y="117" width="42" height="9" fill="#b9c3cf"/>
      <rect x="14" y="117" width="18" height="9" fill="#8a96a5"/>
      <path d="M8 118 Q22 98 38 118" fill="none" stroke="#a5b0bd" stroke-width="1"/>
      <rect x="117" y="86" width="5" height="40" fill="#b9c3cf"/><rect x="112" y="79" width="15" height="8" rx="2" fill="#8a96a5"/>
      <rect x="114" y="81" width="11" height="3.5" fill="#bfdbfe"/>
      <path d="M126 78 v-7" stroke="#8a96a5"/><path d="M126 71 l6 1.8 -6 1.8 z" fill="#ef4444"/>
      <rect x="0" y="134" width="136" height="12" fill="#9aa3ad"/>
      <path d="M6 140h10M26 140h10M46 140h10M66 140h10M86 140h10M106 140h10M126 140h10" stroke="#fff" stroke-width="1.4"/>
      <g transform="translate(22 0)"><g class="${flying ? 'tl-rise' : 'tl-bob'}">
        <path d="M45 68 Q43.5 80 46 92" fill="none" stroke="#64748b" stroke-width="0.8"/>
        <ellipse cx="45" cy="55" rx="10.5" ry="13" fill="#fff" stroke="#cbd5e1"/>
        <ellipse cx="41" cy="50" rx="3" ry="4" fill="#f1f5f9"/>
        <rect x="42.5" y="92" width="6" height="4" rx="1" fill="${ACC}"/>
      </g></g>
      <g transform="translate(67 132) scale(0.6) translate(-69 -142)">
        ${marine(52, false)}
        ${marine(86, true)}
      </g>
    </g>
    <text x="68" y="18" text-anchor="middle" font-size="9.5" font-weight="700" fill="${INK}">MCAS Miramar</text>
  </g>`);

  // ---- timeline ----
  o.push(`<text x="${x0}" y="22" font-size="12" font-weight="700" fill="${INK}">NKX balloon timeline <tspan font-weight="500" fill="${MUTED}">(Pacific time)</tspan></text>`);
  o.push(`<path d="M${x0} ${yAxis}H${x1}" stroke="${EDGE}" stroke-width="2" stroke-linecap="round"/>`);
  // hour ticks every 3 h on local clock
  const startH = new Date(Math.ceil(t0 / H) * H);
  for (let t = startH.getTime(); t <= t1; t += H) {
    const d = new Date(t), hr = +tlFmt(d, { hour: 'numeric', hour12: false }) % 24;
    if (hr % 3) continue;
    const x = X(t);
    o.push(`<path d="M${f(x)} ${yAxis - 3}v6" stroke="#cbd5e1"/>`);
    o.push(`<text x="${f(x)}" y="${yAxis + 24}" text-anchor="middle" font-size="10">${hr === 0 ? tlDay(d) : tlHour(d)}</text>`);
  }
  // cycles
  const firstC = Math.floor((t0.getTime() - 3 * H) / (12 * H)) * 12 * H;
  for (let c = firstC; c <= t1.getTime() + 3 * H; c += 12 * H) {
    const a = c - TL_LAUNCH_BEFORE_H * H, b = a + TL_FLIGHT_H * H, p = c + TL_POSTED_H * H;
    const isShown = shown && Math.abs(shown.getTime() - c) < H;
    const col = isShown ? ACC : '#94a3b8';
    const xa = Math.max(X(a), x0), xb = Math.min(X(b), x1);
    if (xb > x0 && xa < x1) {
      o.push(`<rect x="${f(xa)}" y="${yAxis - 5}" width="${f(Math.max(3, xb - xa))}" height="10" rx="5" fill="${col}" fill-opacity="${isShown ? 0.9 : 0.45}"/>`);
      // little balloon above the launch
      if (X(a) >= x0 - 2 && X(a) <= x1 - 78) {
        o.push(`<g transform="translate(${f(X(a) + 4)} ${yAxis - 30})"><ellipse cx="0" cy="0" rx="5.5" ry="6.5" fill="#fff" stroke="${col}" stroke-width="1.4"/><path d="M0 6.5 Q-1 12 0 17" fill="none" stroke="${col}"/></g>`);
        o.push(`<text x="${f(X(a) + 13)}" y="${yAxis - 30}" font-size="10" fill="${isShown ? INK : MUTED}" font-weight="${isShown ? 650 : 400}">launch ${tlHour(new Date(a))}</text>`);
        o.push(`<text x="${f(X(a) + 13)}" y="${yAxis - 18}" font-size="9.5">${tlDay(new Date(a))} · ${String(new Date(c).getUTCHours()).padStart(2, '0')}Z</text>`);
      }
    }
    if (X(p) > x0 && X(p) < x1) o.push(`<circle cx="${f(X(p))}" cy="${yAxis}" r="3.5" fill="#fff" stroke="${col}" stroke-width="1.6"><title>data posted ~${tlHour(new Date(p))}</title></circle>`);
    if (isShown) {
      const xm = Math.min(Math.max((xa + xb) / 2, x0 + 40), x1 - 40);
      o.push(`<rect x="${f(xm - 38)}" y="${yAxis + 31}" width="76" height="17" rx="8.5" fill="${ACC}"/>`);
      o.push(`<text x="${f(xm)}" y="${yAxis + 43}" text-anchor="middle" font-size="10" font-weight="700" fill="#fff">this chart</text>`);
    }
  }
  // chart updates
  let next = null;
  for (let d = -1; d <= 1; d++) for (const [hh, mm] of TL_UPDATES) {
    const base = new Date(now); base.setUTCHours(hh, mm, 0, 0);
    const t = base.getTime() + d * 24 * H;
    if (t > now.getTime() && (!next || t < next)) next = t;
    if (t < t0.getTime() || t > t1.getTime()) continue;
    o.push(`<path d="M${f(X(t))} ${yAxis + 7}l-3.5 6h7z" fill="${BLUE}" opacity="${t <= now.getTime() ? 0.45 : 0.9}"><title>chart update ${tlHour(new Date(t))}</title></path>`);
  }
  // now
  const xn = X(now.getTime());
  o.push(`<path d="M${f(xn)} 36V${yAxis + 8}" stroke="${INK}" stroke-width="1.4" stroke-dasharray="2 3"/>`);
  o.push(`<rect x="${f(xn - 16)}" y="28" width="32" height="15" rx="7.5" fill="${INK}"/><text x="${f(xn)}" y="38.5" text-anchor="middle" font-size="9.5" font-weight="700" fill="#fff">now</text>`);

  // footer line: what the chart shows + next update
  const parts = [];
  if (shown) {
    const a = new Date(shown.getTime() - TL_LAUNCH_BEFORE_H * H);
    parts.push(`<tspan fill="${ACC}" font-weight="700">Showing</tspan> <tspan fill="${INK}">${tlDay(a)} ${tlHour(a)} launch (${String(shown.getUTCHours()).padStart(2, '0')}Z)</tspan>`);
  }
  if (next) {
    const mins = Math.round((next - now.getTime()) / 60000);
    parts.push(`<tspan fill="${BLUE}" font-weight="700">Next update</tspan> <tspan fill="${INK}">${tlHour(new Date(next))}</tspan> (in ${mins >= 60 ? Math.floor(mins / 60) + ' h ' : ''}${mins % 60} min)`);
  }
  o.push(`<text x="${x0}" y="${Hh - 9}" font-size="11">${parts.join('<tspan fill="#cbd5e1" dx="10">·</tspan><tspan dx="10"></tspan>')}</text>`);
  // mini legend
  o.push(`<g transform="translate(${x1 - 214} 18)" font-size="9.5">
    <rect x="0" y="-6" width="14" height="7" rx="3.5" fill="#94a3b8" fill-opacity="0.6"/><text x="18" y="0">flight</text>
    <circle cx="58" cy="-2.5" r="3.2" fill="#fff" stroke="#94a3b8" stroke-width="1.5"/><text x="65" y="0">data out</text>
    <path d="M120 -6l-3.5 6h7z" fill="${BLUE}"/><text x="127" y="0">chart update</text>
  </g>`);
  o.push('</svg>');
  return o.join('\n');
}

if (typeof module !== 'undefined') module.exports = { timelineSVG };

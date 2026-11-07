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
  const W = 800, Hh = 190;
  const t0 = new Date(now.getTime() - 15 * H), t1 = new Date(now.getTime() + 9 * H);
  const x0 = 196, x1 = 784, yAxis = 120;
  const X = t => x0 + (t - t0) / (t1 - t0) * (x1 - x0);
  const f = v => v.toFixed(1);
  const INK = '#111827', MUTED = '#6b7280', EDGE = '#e5e7eb', ACC = '#e07b00', BLUE = '#2563eb';
  const o = [];
  o.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${Hh}" font-family="Inter, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" font-size="11" fill="${MUTED}">`);
  o.push(`<style>
    @keyframes tlbob { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-5px) } }
    @keyframes tlrise { 0% { transform: translateY(26px); opacity: 0 } 15% { opacity: 1 } 85% { opacity: 1 } 100% { transform: translateY(-40px); opacity: 0 } }
    .tl-bob { animation: tlbob 4s ease-in-out infinite; }
    .tl-rise { animation: tlrise 7s linear infinite; }
    @media (prefers-reduced-motion: reduce) { .tl-bob, .tl-rise { animation: none } }
  </style>`);
  o.push(`<rect width="${W}" height="${Hh}" rx="12" fill="#fff"/>`);

  // ---- scene: generic airfield (hangar, tower, runway) + weather balloon ----
  const flying = (() => { // is a balloon in the air right now?
    for (let k = -1; k <= 1; k++) {
      const c = new Date(Math.round(now / (12 * H)) * 12 * H + k * 12 * H);
      const a = c.getTime() - TL_LAUNCH_BEFORE_H * H, b = a + TL_FLIGHT_H * H;
      if (now >= a && now <= b) return true;
    }
    return false;
  })();
  o.push(`<g transform="translate(14 0)">
    <rect x="0" y="12" width="164" height="166" rx="10" fill="#eef4fb"/>
    <circle cx="146" cy="62" r="8" fill="#fde68a" opacity="0.9"/>
    <g transform="translate(0 22)"><path d="M0 126 Q40 118 82 124 T164 122 V146 a10 10 0 0 1 -10 10 H10 a10 10 0 0 1 -10 -10Z" fill="#d9e7c9"/>
    <rect x="6" y="136" width="152" height="9" rx="2" fill="#9aa3ad"/>
    <path d="M14 140.5h12M36 140.5h12M58 140.5h12M80 140.5h12M102 140.5h12M124 140.5h12" stroke="#fff" stroke-width="1.6"/>
    <path d="M16 128 Q38 104 60 128 Z" fill="#94a3b8"/><rect x="16" y="127" width="44" height="9" fill="#94a3b8"/>
    <rect x="31" y="128" width="14" height="8" fill="#64748b"/>
    <rect x="118" y="102" width="6" height="34" fill="#94a3b8"/><rect x="113" y="94" width="16" height="9" rx="2" fill="#64748b"/>
    <rect x="115" y="96" width="12" height="4" fill="#bfdbfe"/>
    <path d="M128 92 v-8" stroke="#64748b"/><path d="M128 84 l7 2 -7 2" fill="#ef4444"/></g>
    <g transform="translate(0 16)"><g class="${flying ? 'tl-rise' : 'tl-bob'}">
      <path d="M86 78 Q84 92 88 104" fill="none" stroke="#64748b" stroke-width="0.9"/>
      <ellipse cx="86" cy="60" rx="15" ry="18" fill="#fff" stroke="#cbd5e1"/>
      <ellipse cx="80" cy="53" rx="4" ry="6" fill="#f1f5f9"/>
      <path d="M83 77 h6 l-3 3 z" fill="#cbd5e1"/>
      <rect x="84" y="104" width="8" height="6" rx="1" fill="${ACC}"/>
    </g></g>
    <text x="82" y="26" text-anchor="middle" font-size="10.5" font-weight="700" fill="${INK}">MCAS Miramar</text>
    <text x="82" y="38" text-anchor="middle" font-size="9.5">NKX weather balloon</text>
  </g>`);

  // ---- timeline ----
  o.push(`<text x="${x0}" y="28" font-size="12.5" font-weight="700" fill="${INK}">Balloon timeline <tspan font-weight="500" fill="${MUTED}">(Pacific time)</tspan></text>`);
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
  o.push(`<path d="M${f(xn)} 40V${yAxis + 8}" stroke="${INK}" stroke-width="1.4" stroke-dasharray="2 3"/>`);
  o.push(`<rect x="${f(xn - 16)}" y="34" width="32" height="15" rx="7.5" fill="${INK}"/><text x="${f(xn)}" y="44.5" text-anchor="middle" font-size="9.5" font-weight="700" fill="#fff">now</text>`);

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
  o.push(`<text x="${x0}" y="${Hh - 10}" font-size="11">${parts.join('<tspan fill="#cbd5e1" dx="10">·</tspan><tspan dx="10"></tspan>')}</text>`);
  // mini legend
  o.push(`<g transform="translate(${x1 - 214} 22)" font-size="9.5">
    <rect x="0" y="-6" width="14" height="7" rx="3.5" fill="#94a3b8" fill-opacity="0.6"/><text x="18" y="0">flight</text>
    <circle cx="58" cy="-2.5" r="3.2" fill="#fff" stroke="#94a3b8" stroke-width="1.5"/><text x="65" y="0">data out</text>
    <path d="M120 -6l-3.5 6h7z" fill="${BLUE}"/><text x="127" y="0">chart update</text>
  </g>`);
  o.push('</svg>');
  return o.join('\n');
}

if (typeof module !== 'undefined') module.exports = { timelineSVG };

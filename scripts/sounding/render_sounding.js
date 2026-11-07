// node scripts/sounding/render_sounding.js  -> data/sounding/nkx_latest.svg + summary json
const fs = require('fs'), path = require('path');
const { parseSounding, renderSVG } = require('./core.js');
const dir = path.join(__dirname, '..', '..', 'data', 'sounding');
const txt = fs.readFileSync(path.join(dir, 'nkx_latest.txt'), 'utf8');
const snd = parseSounding(txt);
let forecast = null;
try { forecast = JSON.parse(fs.readFileSync(path.join(dir, 'surface_forecast.json'), 'utf8')); } catch (e) { /* optional */ }
const { svg, analysis: A } = renderSVG(snd, { forecast });
fs.writeFileSync(path.join(dir, 'nkx_latest.svg'), svg);
const s = snd.levels[0];
const summary = {
  title: snd.title,
  source: (txt.match(/^# source: (.*)$/m) || [])[1] || null,
  fetched: (txt.match(/^# fetched: (.*)$/m) || [])[1] || null,
  surface_ft: Math.round(s.z * 1000), surface_temp_f: Math.round(s.t),
  surface_dewpoint_f: isFinite(s.td) ? Math.round(s.td) : null,
  cloudbase_ft_msl: A.cb ? Math.round(A.cb.z * 1000 / 100) * 100 : null,
  trigger_temp_f: A.cb ? Math.round(A.cb.trigger) : null,
  forecast_high: forecast ? { ...forecast, thermal_tops: A.forecastTops || null } : null,
  thermal_tops_ft: A.thermals.map(t => ({ surface_f: t.ts, top_ft: Math.round(t.top * 1000 / 100) * 100 })),
};
fs.writeFileSync(path.join(dir, 'nkx_latest.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary));

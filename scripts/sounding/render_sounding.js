// node scripts/sounding/render_sounding.js  -> data/sounding/<stn>_latest.svg + summary json (Miramar, Edwards)
const fs = require('fs'), path = require('path');
const { parseSounding, renderSVG } = require('./core.js');
const dir = path.join(__dirname, '..', '..', 'data', 'sounding');
const STNS = [['nkx', 'nkx_latest.txt', 'surface_forecast.json'], ['edw', 'stations/EDW_latest.txt', 'surface_forecast_edw.json']];
for (const [id, file, fc] of STNS) {
  let txt;
  try { txt = fs.readFileSync(path.join(dir, file), 'utf8'); } catch (e) { console.log(`${id}: no data`); continue; }
  const snd = parseSounding(txt);
  let forecast = null;
  try { forecast = JSON.parse(fs.readFileSync(path.join(dir, fc), 'utf8')); } catch (e) { /* optional */ }
  const { svg, analysis: A } = renderSVG(snd, { forecast });
  fs.writeFileSync(path.join(dir, `${id}_latest.svg`), svg);
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
  fs.writeFileSync(path.join(dir, `${id}_latest.json`), JSON.stringify(summary, null, 2));
  console.log(id, JSON.stringify(summary).slice(0, 200));
}

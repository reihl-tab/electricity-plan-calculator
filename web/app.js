import { TARIFFS } from './tariffs-data.js';
import { CITIES, parseCsv, summarize, rankPlans, weatherSensitivity, hvacSplit } from './calc.js';

const $ = id => document.getElementById(id);
const nis = v => `${Math.round(v).toLocaleString('he-IL')} ₪`;

const cityList = $('cities');
for (const c of Object.keys(CITIES)) {
  const o = document.createElement('option'); o.value = c; cityList.appendChild(o);
}
$('csv').addEventListener('change', () => { $('go').disabled = !$('csv').files.length; });

// populate current-plan select from catalog
{
  const sel = $('currentPlan');
  const labels = ['חברת החשמל - תעריף אחיד מפוקח', 'תעו"ז מפוקח (מונה חכם)',
    ...TARIFFS.supplier_plans.map(p => `${p.supplier} - ${p.plan}`)];
  for (const l of labels) { const o = document.createElement('option'); o.value = l; o.textContent = l; sel.appendChild(o); }
}
$('sources').textContent = TARIFFS.sources.map(s => new URL(s.url).hostname).join(', ');

function axis(ctx, w, h, pad) {
  ctx.strokeStyle = '#999'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(pad, 10); ctx.lineTo(pad, h - pad); ctx.lineTo(w - 10, h - pad); ctx.stroke();
}

function barChart(canvas, labels, values, color) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height, pad = 40;
  ctx.clearRect(0, 0, w, h); axis(ctx, w, h, pad);
  const max = Math.max(...values, 0.001);
  const bw = (w - pad - 20) / values.length;
  values.forEach((v, i) => {
    const bh = (v / max) * (h - pad - 20);
    ctx.fillStyle = color;
    ctx.fillRect(pad + i * bw + 1, h - pad - bh, bw - 2, bh);
  });
  ctx.fillStyle = '#333'; ctx.font = '11px sans-serif'; ctx.textAlign = 'center';
  labels.forEach((l, i) => { if (l !== null) ctx.fillText(l, pad + i * bw + bw / 2, h - pad + 14); });
  ctx.textAlign = 'right';
  ctx.fillText(max.toFixed(1), pad - 4, 20);
}

function scatterChart(canvas, xs, ys, days) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height, pad = 40;
  ctx.clearRect(0, 0, w, h); axis(ctx, w, h, pad);
  const xMin = Math.min(...xs), xMax = Math.max(...xs), yMax = Math.max(...ys, 0.001);
  const X = t => pad + (t - xMin) / (xMax - xMin || 1) * (w - pad - 20);
  const Y = v => h - pad - (v / yMax) * (h - pad - 30);
  ctx.fillStyle = '#0b6bcb';
  xs.forEach((t, i) => { ctx.beginPath(); ctx.arc(X(t), Y(ys[i]), 3.5, 0, 7); ctx.fill(); });
  // regression line
  const n = xs.length, mx = xs.reduce((a, b) => a + b) / n, my = ys.reduce((a, b) => a + b) / n;
  const slope = xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0) / xs.reduce((s, x) => s + (x - mx) ** 2, 0);
  ctx.strokeStyle = '#d32f2f'; ctx.lineWidth = 2; ctx.beginPath();
  ctx.moveTo(X(xMin), Y(my + slope * (xMin - mx))); ctx.lineTo(X(xMax), Y(my + slope * (xMax - mx))); ctx.stroke();
  ctx.fillStyle = '#333'; ctx.font = '12px sans-serif'; ctx.textAlign = 'center';
  ctx.fillText('טמפרטורה יומית ממוצעת (°C)', w / 2, h - 6);
  ctx.fillText(`${xMin.toFixed(0)}°`, X(xMin), h - pad + 14);
  ctx.fillText(`${xMax.toFixed(0)}°`, X(xMax), h - pad + 14);
}

function plansChart(canvas, plans, currentLabel) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height, pad = 8, labelW = 250;
  ctx.clearRect(0, 0, w, h);
  const max = Math.max(...plans.map(p => p.annual));
  const bh = Math.min(20, (h - 10) / plans.length - 4);
  ctx.font = '12px sans-serif';
  plans.forEach((p, i) => {
    const y = 8 + i * (bh + 4);
    const bwv = (p.annual / max) * (w - labelW - 80);
    ctx.fillStyle = i === 0 ? '#2e7d32' : (p.label === currentLabel ? '#0b6bcb' : '#90a4ae');
    ctx.fillRect(w - 8 - bwv, y, bwv, bh); // RTL: bars grow leftward
    ctx.fillStyle = '#333'; ctx.textAlign = 'right';
    ctx.fillText(p.label.length > 32 ? p.label.slice(0, 31) + '…' : p.label, w - 10 - bwv - 6, y + bh - 6);
    ctx.textAlign = 'left';
    ctx.fillText(nis(p.annual), w - 4 - bwv - 250 > 0 ? 4 : 4, y + bh - 6);
    ctx.fillText(nis(p.annual), 4, y + bh - 6);
  });
}

async function fetchTemps(lat, lon, start, end) {
  const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}` +
    `&start_date=${start}&end_date=${end}&daily=temperature_2m_mean&timezone=auto`;
  const r = await fetch(url);
  if (!r.ok) throw new Error('שגיאה בשליפת נתוני מזג אוויר');
  const j = await r.json();
  const out = {};
  j.daily.time.forEach((d, i) => { if (j.daily.temperature_2m_mean[i] !== null) out[d] = j.daily.temperature_2m_mean[i]; });
  return out;
}

async function geocode(city) {
  if (CITIES[city]) return CITIES[city];
  const r = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=he`);
  const j = await r.json();
  if (j.results && j.results.length) return [j.results[0].latitude, j.results[0].longitude];
  return null;
}

$('go').addEventListener('click', async () => {
  const err = $('err'); err.style.display = 'none';
  try {
    const text = await $('csv').files[0].text();
    const { intervals, city } = parseCsv(text);
    if (city && !$('city').value) $('city').value = city;
    const sum = summarize(intervals);

    $('summaryCard').style.display = '';
    const total = sum.total.toFixed(1);
    $('summary').innerHTML =
      `<b>${sum.days} ימי מדידה</b> · סה"כ ${total} קוט"ש · ממוצע ${(sum.total / sum.days).toFixed(2)} קוט"ש/יום` +
      ` · הערכה שנתית ${Math.round(sum.total / sum.days * 365).toLocaleString('he-IL')} קוט"ש`;
    barChart($('chHourly'), [...Array(24).keys()].map(h => h % 2 ? null : `${h}:00`),
      [...sum.hourlyAvg], '#0b6bcb');
    const days = [...sum.daily.keys()].sort();
    barChart($('chDaily'), days.map((d, i) => i % Math.ceil(days.length / 12) ? null : d.slice(5)),
      days.map(d => sum.daily.get(d)), '#00897b');

    const opts = {
      phase: $('phase').value,
      smartMeter: $('smartMeter').checked,
      gasCustomer: $('gasCustomer').checked,
      hotCustomer: $('hotCustomer').checked,
    };
    const ranked = rankPlans(intervals, opts);
    const currentLabel = $('currentPlan').value || null;
    const current = currentLabel ? ranked.find(p => p.label === currentLabel) : null;

    $('plansCard').style.display = '';
    plansChart($('chPlans'), ranked.slice(0, 14), currentLabel);
    const tbl = $('plansTable');
    tbl.innerHTML = '<tr><th>#</th><th>מסלול</th><th>עלות שנתית</th><th>חיסכון מול תעריף אחיד</th></tr>' +
      ranked.map((p, i) =>
        `<tr class="${i === 0 ? 'best' : ''} ${p.label === currentLabel ? 'current' : ''}">` +
        `<td>${i + 1}</td><td>${p.label}${i === 0 ? ' ◀ הכי משתלם' : ''}${p.label === currentLabel ? ' ◀ המסלול הנוכחי' : ''}</td>` +
        `<td>${nis(p.annual)}</td><td>${nis(p.saving)}</td></tr>`).join('');
    $('currentPlanNote').innerHTML = current
      ? (current === ranked[0]
          ? `<p><b>המסלול הנוכחי שלך (${current.label}) הוא הזול ביותר - אין צורך להחליף.</b></p>`
          : `<p><b>מעבר ל${ranked[0].label} חוסך ${nis(current.annual - ranked[0].annual)} לשנה מול המסלול הנוכחי (${current.label}).</b></p>`)
      : '';
    $('plansNote').textContent = 'בתעו"ז התשלום הקבוע גבוה יותר. מסלולי שעות דורשים מונה חכם.';

    if ($('weather').checked) {
      $('status').textContent = 'שולף נתוני מזג אוויר...';
      const [lat, lon] = (await geocode($('city').value || 'ירושלים')) || CITIES['ירושלים'];
      const temps = await fetchTemps(lat, lon, days[0], days[days.length - 1]);
      const w = weatherSensitivity(sum.daily.size ? Object.fromEntries(sum.daily) : {}, temps);
      const hv = hvacSplit(Object.fromEntries(sum.daily), temps);
      $('weatherCard').style.display = '';
      $('weatherText').innerHTML = w
        ? `רגישות (אחרי נטרול סופ"ש): <b>${w.kwhPerDegree >= 0 ? '+' : ''}${w.kwhPerDegree.toFixed(2)} קוט"ש/יום למעלה</b> · ` +
          `סופ"ש: +${w.weekendExtra.toFixed(2)} קוט"ש/יום · הסבר המודל R²=${w.r2.toFixed(2)}`
        : 'אין מספיק שונות בטמפרטורה בתקופה למדידת רגישות.';
      const ts = days.filter(d => temps[d] !== undefined);
      scatterChart($('chWeather'), ts.map(d => temps[d]), ts.map(d => sum.daily.get(d)));
      $('hvacText').innerHTML = hv
        ? `<p>קירור: <b>${hv.kwhPerCoolingDegree === null ? 'אין מספיק שונות' : '+' + hv.kwhPerCoolingDegree.toFixed(2) + ' קוט"ש/יום לכל מעלה מעל ' + hv.coolingBase + '°'}</b> · ` +
          `חימום: <b>${hv.kwhPerHeatingDegree === null ? 'אין מספיק שונות' : '+' + hv.kwhPerHeatingDegree.toFixed(2) + ' קוט"ש/יום לכל מעלה מתחת ' + hv.heatingBase + '°'}</b></p>` +
          '<table><tr><th>חודש</th><th>סה"כ</th><th>בסיס</th><th>סופ"ש</th><th>קירור</th><th>חימום</th></tr>' +
          hv.monthly.map(m => `<tr><td>${m.month}</td><td>${m.total.toFixed(0)}</td><td>${m.base.toFixed(0)}</td>` +
            `<td>${m.weekend.toFixed(0)}</td><td>${m.cooling.toFixed(0)}</td><td>${m.heating.toFixed(0)}</td></tr>`).join('') + '</table>'
        : '';
    }
    $('status').textContent = '';
  } catch (e) {
    err.textContent = e.message; err.style.display = '';
    $('status').textContent = '';
  }
});

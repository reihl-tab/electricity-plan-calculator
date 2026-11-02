import { TARIFFS } from './tariffs-data.js';
import { parseCsv, summarize, rankPlans } from './calc.js';

const $ = id => document.getElementById(id);
const nis = v => `${Math.round(v).toLocaleString('he-IL')} ₪`;

$('csv').addEventListener('change', () => { $('go').disabled = !$('csv').files.length; });

// populate current-plan select from catalog
{
  const sel = $('currentPlan');
  const labels = ['חברת החשמל - תעריף אחיד מפוקח', 'תעו"ז מפוקח (מונה חכם)',
    ...TARIFFS.supplier_plans.map(p => `${p.supplier} - ${p.plan}`)];
  for (const l of labels) { const o = document.createElement('option'); o.value = l; o.textContent = l; sel.appendChild(o); }
}
$('sources').textContent = [...new Set(TARIFFS.sources.map(s => new URL(s.url).hostname))].join(', ');

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
    ctx.fillText(nis(p.annual), 4, y + bh - 6);
  });
}

$('go').addEventListener('click', async () => {
  const err = $('err'); err.style.display = 'none';
  try {
    const text = await $('csv').files[0].text();
    const intervals = parseCsv(text);
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
    tbl.innerHTML = '';
    const head = tbl.insertRow();
    for (const t of ['#', 'מסלול', 'עלות שנתית', 'חיסכון מול תעריף אחיד']) {
      const th = document.createElement('th'); th.textContent = t; head.appendChild(th);
    }
    ranked.forEach((p, i) => {
      const row = tbl.insertRow();
      if (i === 0) row.className = 'best';
      if (p.label === currentLabel) row.className += ' current';
      row.insertCell().textContent = String(i + 1);
      row.insertCell().textContent =
        p.label + (i === 0 ? ' ◀ הכי משתלם' : '') + (p.label === currentLabel ? ' ◀ המסלול הנוכחי' : '');
      row.insertCell().textContent = nis(p.annual);
      row.insertCell().textContent = nis(p.saving);
    });
    const note = $('currentPlanNote');
    note.innerHTML = '';
    if (current) {
      const b = document.createElement('b');
      b.textContent = current === ranked[0]
        ? `המסלול הנוכחי שלך (${current.label}) הוא הזול ביותר - אין צורך להחליף.`
        : `מעבר ל${ranked[0].label} חוסך ${nis(current.annual - ranked[0].annual)} לשנה מול המסלול הנוכחי (${current.label}).`;
      const p = document.createElement('p'); p.appendChild(b); note.appendChild(p);
    }
    $('plansNote').textContent = 'בתעו"ז התשלום הקבוע גבוה יותר. מסלולי שעות דורשים מונה חכם.';

    $('status').textContent = '';
  } catch (e) {
    err.textContent = e.message; err.style.display = '';
    $('status').textContent = '';
  }
});

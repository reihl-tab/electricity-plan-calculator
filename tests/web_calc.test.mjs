// Cross-validation: the JS port must agree with the Python engine on the sample export.
// Run: node tests/web_calc.test.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseCsv, summarize, rankPlans, ols, pstdev, hvacSplit } from '../web/calc.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const text = readFileSync(join(root, 'data', 'sample_consumption.csv'), 'utf-8');

let failures = 0;
function check(name, cond) {
  if (!cond) { failures++; console.error('FAIL', name); } else console.log('ok', name);
}

const { intervals, city } = parseCsv(text);
check('city extracted from address line', city === 'חיפה');
check('1344 intervals parsed', intervals.length === 1344);
const sum = summarize(intervals);
check('14 local days (no UTC phantom day)', sum.days === 14);

const ranked = rankPlans(intervals, {});
check('22 plans ranked', ranked.length === 22);
check('sorted ascending', ranked.every((p, i) => i === 0 || ranked[i - 1].annual <= p.annual));
// expected values from the Python engine on the same file
check('taoz annual = 3185', Math.round(ranked.find(p => p.kind === 'taoz').annual) === 3185);
check('flat annual = 3774', Math.round(ranked.find(p => p.kind === 'flat').annual) === 3774);
check('best is taoz on the sample', ranked[0].kind === 'taoz');

// eligibility flags
const noGas = rankPlans(intervals, { gasCustomer: false });
check('--no-gas drops Amisragas', !noGas.some(p => p.label.includes('אמישראגז')));

// 24:00 normalization covered implicitly: sample has a 24:00 row -> parsed to next day 00:00
check('no hour-24 timestamps', intervals.every(i => i.start.getHours() < 24));

// OLS sanity: perfect linear data
const rows = [[1, 0, 0], [1, 1, 0], [1, 0, 1], [1, 1, 1], [1, 2, 1]];
const { coef, r2 } = ols(rows, [1, 3, 3, 5, 7]);
check('ols recovers coefficients', Math.abs(coef[0] - 1) < 1e-9 && Math.abs(coef[1] - 2) < 1e-9 && Math.abs(coef[2] - 2) < 1e-9);
check('ols r2 = 1', Math.abs(r2 - 1) < 1e-9);

// hvac split on synthetic data with known coefficients
const kwh = {}, temps = {};
for (let i = 0; i < 28; i++) {
  const d = new Date(2026, 8, 1 + i);
  const t = 20 + 8 * ((i * 7) % 13) / 13;
  const key = `2026-09-${String(1 + i).padStart(2, '0')}`;
  temps[key] = t;
  kwh[key] = 5 + ([5, 6].includes(d.getDay()) ? 3 : 0) + 0.8 * Math.max(0, t - 22) + i * 0.01;
}
const hv = hvacSplit(kwh, temps);
check('hvac cooling coefficient recovered', hv && Math.abs(hv.kwhPerCoolingDegree - 0.8) < 0.05);
check('hvac heating unfitted (no variance) -> null', hv && hv.kwhPerHeatingDegree === null);
check('hvac monthly attribution present', hv && hv.monthly.length === 1 && hv.monthly[0].month === '2026-09');

process.exit(failures ? 1 : 0);

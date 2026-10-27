// รัน: node tests/engine.test.js  (ดึง engine จาก index.html มาทดสอบกับเคสคำนวณมือ)
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const src = html.split('// ===== ENGINE START =====')[1].split('// ===== ENGINE END =====')[0];
const Engine = new Function(src + '; return Engine;')();

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);
let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log('✓', name); };

const baseInp = {
  gross: 18000, comm: 0.18, opexVar: 0.05, opexPerPolicy: 0, opexFixed: 2000000,
  mktVar: 0.03, mktPerPolicy: 0, mktFixed: 1000000,
  lossMode: 'lr', lr: 0.60, freq: 0, sev: 0,
  growth: 0.10, retention: 0.70, targetCR: 0.95,
};

test('ถอดภาษี: 18,000 -> เบี้ยสุทธิ 16,754.43 อากร 68', () => {
  const p = Engine.netFromGross(18000);
  // มือ: 18000/1.07 = 16822.43; อากร ceil(16754.43*0.004)=ceil(67.02)=68; สุทธิ = 16822.43-68
  near(p.net, 16754.43, 0.01, 'net');
  assert.strictEqual(p.stamp, 68);
  near((p.net + p.stamp) * 1.07, 18000, 0.01, 'ย้อนกลับเป็นเบี้ยรวม');
});

test('Base: CR ปี 1 = 100% ต้องขาย 2,558 กรมธรรม์', () => {
  const r = Engine.solve(baseInp);
  near(r.v, 0.86, 1e-9, 'variable ratio');
  // มือ: EP* = 3,000,000/0.14 = 21,428,571; EP ต่อกรมธรรม์ปี 1 = 16754.43/2 = 8377.21; 21,428,571/8377.21 = 2557.96 -> 2558
  assert.strictEqual(r.base.new1, 2558);
  const y1 = r.base.rows[0];
  assert.ok(y1.cr <= 1.0 && y1.cr > 0.9999, `CR ปี1 ${y1.cr}`);
  assert.ok(y1.profit >= 0 && y1.profit < 8377.21 * 0.14, `profit ปี1 ${y1.profit}`);
});

test('Best: CR ปี 1 < 95% ต้องขาย 3,980 กรมธรรม์', () => {
  const r = Engine.solve(baseInp);
  // มือ: EP = 3,000,000/(0.95-0.86) = 33,333,333; /8377.21 = 3979.03 -> 3980
  assert.strictEqual(r.best.new1, 3980);
  assert.ok(r.best.rows[0].cr < 0.95);
});

test('Worst: กำไรสะสม 3 ปี = 0', () => {
  const r = Engine.solve(baseInp);
  // มือ (ต่อ New_1 = 1, P = 16754.43): Pol = 1, 1.1+0.7=1.8, 1.21+1.26=2.47
  // EP = 0.5, (1+1.8)/2=1.4, (1.8+2.47)/2=2.135 -> รวม 4.035 x P = 67604.13
  // New_1 = 9,000,000 / (0.14 x 67604.13) = 950.91 -> 951
  assert.strictEqual(r.worst.new1, 951);
  const rows = r.worst.rows;
  assert.ok(rows[0].profit < 0, 'ปี 1 ขาดทุน');
  assert.ok(rows[2].cum >= 0 && rows[2].cum < 0.14 * 67604.13, `สะสม ${rows[2].cum}`);
  const r950 = Engine.simulate(baseInp, 950);
  assert.ok(r950[2].cum < 0, 'ขาย 950 ยังไม่ถึงจุดคุ้มทุนสะสม');
});

test('Frequency x Severity -> LR', () => {
  const inp = { ...baseInp, lossMode: 'fs', freq: 0.5, sev: 20000 };
  const r = Engine.solve(inp);
  near(r.lr, 10000 / r.premium.net, 1e-12, 'LR');
  near(r.lossPerPolicy, 10000, 1e-6, 'Loss/กรมธรรม์');
});

test('ต้นทุนต่อกรมธรรม์ (บาท) นับเข้า variable ratio', () => {
  const net = Engine.netFromGross(18000).net;
  const r = Engine.solve({ ...baseInp, opexPerPolicy: 0.02 * net, mktPerPolicy: 0 });
  near(r.v, 0.88, 1e-12, 'v');
});

test('v >= CR เป้า -> แจ้งว่าเป็นไปไม่ได้', () => {
  const r = Engine.solve({ ...baseInp, lr: 0.75 }); // v = 1.01
  assert.strictEqual(r.base.feasible, false);
  assert.strictEqual(r.best.feasible, false);
  assert.strictEqual(r.worst.feasible, false);
  const r2 = Engine.solve({ ...baseInp, lr: 0.70 }); // v = 0.96: เท่าทุนได้ แต่ 95% ไม่ได้
  assert.strictEqual(r2.base.feasible, true);
  assert.strictEqual(r2.best.feasible, false);
});

test('Benchmark: เตือนเมื่อ LR ดีกว่าตลาดเกินเกณฑ์', () => {
  assert.strictEqual(Engine.benchmark(0.55, 0.596).level, 'ok');
  assert.strictEqual(Engine.benchmark(0.45, 0.596).level, 'warn');
  assert.strictEqual(Engine.benchmark(0.35, 0.596).level, 'alert');
  assert.strictEqual(Engine.benchmark(0.5, null).level, 'none');
});

console.log(`\n${passed} tests passed`);

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { validatePlan, classify, summarize } = require('../face-identification.cjs');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'face-eval-unit-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  // Synthetic bytes exercise file bookkeeping only, not biometric inference.
  for (const name of ['ref', 'known', 'unknown']) fs.writeFileSync(path.join(root, name + '.jpg'), name);
  const plan = { mode: 'identification-1:N', runId: 'mock-test', isolatedService: true, threshold: .6,
    modelName: 'MOCK_TEST_ONLY', serviceRevision: 'mock-revision', thresholdSource: 'frozen before test',
    subjects: [{ code: 'P01', consentRef: 'TEST_ONLY', enrolled: true, providerUserId: 101, referenceImages: ['ref.jpg'] }, { code: 'P02', consentRef: 'TEST_ONLY', enrolled: false }],
    probes: [{ id: 'T01', subject: 'P01', condition: 'normal', image: 'known.jpg' }, { id: 'T02', subject: 'P02', condition: 'normal', image: 'unknown.jpg' }] };
  return { root, plan };
}

test('plan requires consent, disjoint enrollment/probe photos, known and unknown cohorts', t => {
  const { root, plan } = fixture(t);
  assert.equal(validatePlan(plan, root).gallerySubjects, 1);
  const bad = structuredClone(plan); bad.subjects[0].consentRef = '';
  assert.throws(() => validatePlan(bad, root), /consentRef/);
  const leak = structuredClone(plan); leak.probes[0].image = 'ref.jpg';
  assert.throws(() => validatePlan(leak, root), /leakage/);
  const duplicate = structuredClone(plan); duplicate.probes[1].image = 'known.jpg';
  assert.throws(() => validatePlan(duplicate, root), /duplicate/);
  const oneCohort = structuredClone(plan); oneCohort.probes.pop();
  assert.throws(() => validatePlan(oneCohort, root), /unknown probes/);
  const threshold = structuredClone(plan); threshold.threshold = '0.6';
  assert.throws(() => validatePlan(threshold, root), /threshold/);
});

test('1:N classifies correct identity, wrong identity, rejection and unknown acceptance', () => {
  const ids = new Set([101, 102]), known = { enrolled: true, providerUserId: 101 }, unknown = { enrolled: false };
  const match = { matched: true, reason: 'MATCHED', user_id: 101, similarity: .8 };
  const reject = { matched: false, reason: 'NOT_MATCHED', user_id: null, similarity: .4 };
  assert.equal(classify(match, known, .6, ids), 'KNOWN_CORRECT');
  assert.equal(classify({ ...match, user_id: 102 }, known, .6, ids), 'KNOWN_WRONG_ID');
  assert.equal(classify(reject, known, .6, ids), 'KNOWN_REJECTED');
  assert.equal(classify(match, unknown, .6, ids), 'UNKNOWN_ACCEPTED');
  assert.equal(classify(reject, unknown, .6, ids), 'UNKNOWN_REJECTED');
  for (const result of [{ ...match, similarity: .5 }, { ...match, user_id: 999 }, { ...match, similarity: 1.1 }, { ...match, verification_available: false }, null]) assert.equal(classify(result, known, .6, ids), 'ERROR');
  assert.equal(classify({ matched: false, reason: 'NO_FACE_DETECTED' }, known, .6, ids), 'NO_FACE');
});

test('rates separate conditional identification, acquisition and operational failures', () => {
  const outcomes = [['KNOWN_CORRECT', true], ['KNOWN_WRONG_ID', true], ['KNOWN_REJECTED', true], ['NO_FACE', true], ['ERROR', true], ['UNKNOWN_ACCEPTED', false], ['UNKNOWN_REJECTED', false]];
  const stats = summarize(outcomes.map(([outcome, enrolled]) => ({ outcome, enrolled, latencyMs: 10 })));
  assert.equal(stats.scoredKnown, 3); assert.equal(stats.fnirRank1Percent, 66.67);
  assert.equal(stats.fpirPercent, 50); assert.equal(stats.knownEndToEndSuccessPercent, 20);
  assert.equal(stats.errors, 1); assert.equal(stats.noFace, 1);
  assert.equal(summarize([]).fpirPercent, null);
});

test('CLI dry-run sends nothing; explicit execution records mock results and refuses overwrite', async t => {
  const { root, plan } = fixture(t); let calls = 0;
  const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/health') return res.end(JSON.stringify({ database: 'connected', cache_loaded: true, cached_users: 1 }));
    assert.equal(req.url, '/api/v1/faces/verify'); assert.equal(req.headers['x-api-key'], 'unit-test-key');
    let body = ''; req.on('data', chunk => { body += chunk; }); req.on('end', () => {
      assert.match(body, /name="threshold"/); calls++;
      res.end(JSON.stringify(calls === 1 ? { matched: true, reason: 'MATCHED', user_id: 101, similarity: .8 } : { matched: false, reason: 'NOT_MATCHED', user_id: null, similarity: .2 }));
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  plan.baseUrl = 'http://127.0.0.1:' + server.address().port;
  plan.intervalMs = 500;
  const proof = 'MOCK TEST ONLY: model loaded successfully'; fs.writeFileSync(path.join(root, 'proof.log'), proof);
  plan.runtimeEvidence = { realModelActive: true, isolatedGalleryVerified: true, file: 'proof.log', sha256: crypto.createHash('sha256').update(proof).digest('hex') };
  const config = path.join(root, 'plan.json'); fs.writeFileSync(config, JSON.stringify(plan));
  const cli = path.resolve(__dirname, '../face-identification.cjs'), execute = promisify(execFile);
  const env = { ...process.env, FACE_EVAL_API_KEY: 'unit-test-key' };
  const dry = await execute(process.execPath, [cli, config], { env });
  assert.match(dry.stdout, /DRY_RUN/); assert.equal(calls, 0);
  await execute(process.execPath, [cli, config, '--execute'], { env });
  assert.equal(calls, 2);
  const report = JSON.parse(fs.readFileSync(path.join(root, 'results/mock-test/summary.json')));
  assert.equal(report.complete, true); assert.equal(report.summary.knownCorrect, 1);
  assert.equal(report.summary.fpirPercent, 0); assert.equal(report.byCondition.normal.attempts, 2);
  const output = fs.readFileSync(path.join(root, 'results/mock-test/attempts.jsonl'), 'utf8');
  assert.ok(!output.includes('unit-test-key')); assert.ok(!output.includes('providerUserId'));
  await assert.rejects(execute(process.execPath, [cli, config, '--execute'], { env }));
  assert.equal(calls, 2);
});

test('CLI rejects simulated evidence and records auth failure as error, never correct rejection', async t => {
  const { root, plan } = fixture(t); let requests = 0;
  const server = http.createServer((req, res) => {
    requests++; res.setHeader('Content-Type', 'application/json');
    if (req.url === '/health') return res.end(JSON.stringify({ database: 'connected', cache_loaded: true, cached_users: 1 }));
    req.resume(); res.writeHead(401); res.end(JSON.stringify({ detail: 'SECRET_RESPONSE_MUST_NOT_BE_SAVED' }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  plan.baseUrl = 'http://127.0.0.1:' + server.address().port;
  const config = path.join(root, 'plan.json'), proofFile = path.join(root, 'proof.log');
  const setProof = text => {
    fs.writeFileSync(proofFile, text);
    plan.runtimeEvidence = { realModelActive: true, isolatedGalleryVerified: true, file: 'proof.log', sha256: crypto.createHash('sha256').update(text).digest('hex') };
    fs.writeFileSync(config, JSON.stringify(plan));
  };
  const cli = path.resolve(__dirname, '../face-identification.cjs'), execute = promisify(execFile);
  const env = { ...process.env, FACE_EVAL_API_KEY: 'unit-test-key' };
  setProof('MOCK TEST: loaded successfully; Falling back to Simulated mode');
  await assert.rejects(execute(process.execPath, [cli, config, '--execute'], { env }));
  assert.equal(requests, 0);
  setProof('MOCK TEST ONLY: loaded successfully');
  await assert.rejects(execute(process.execPath, [cli, config, '--execute'], { env }), error => error.code === 2);
  assert.equal(requests, 2); // health + one failed attempt, no retries or next probe
  const summary = JSON.parse(fs.readFileSync(path.join(root, 'results/mock-test/summary.json')));
  assert.equal(summary.complete, false); assert.equal(summary.summary.errors, 1);
  assert.equal(summary.summary.fpirPercent, null); assert.equal(summary.summary.unknownRejected, 0);
  assert.ok(!fs.readFileSync(path.join(root, 'results/mock-test/attempts.jsonl'), 'utf8').includes('SECRET_RESPONSE'));
});

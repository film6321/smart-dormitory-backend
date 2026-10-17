// Offline plan validation by default; --execute sends probes only to an isolated Face API.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { performance } = require('node:perf_hooks');

const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const fail = message => { const error = new Error(message); error.safeToDisplay = true; throw error; };
const rate = (n, d) => d ? Number((100 * n / d).toFixed(2)) : null;
const validCode = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(value);
function image(file, base) {
  const absolute = path.resolve(base, file);
  const data = fs.readFileSync(absolute);
  const ext = path.extname(absolute).toLowerCase();
  const mime = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' }[ext];
  if (!mime || !data.length || data.length > 5 * 1024 * 1024) fail('Images must be JPG/PNG/WEBP, nonempty and <= 5 MB');
  return { data, mime, sha256: hash(data) };
}

function validatePlan(plan, base) {
  if (plan.mode !== 'identification-1:N' || plan.isolatedService !== true) fail('Use identification-1:N and an isolated service');
  if (typeof plan.threshold !== 'number' || !(plan.threshold > 0 && plan.threshold <= 1)) fail('threshold must be > 0 and <= 1');
  if (!validCode(plan.runId)) fail('runId must be a short pseudonymous code');
  if (!plan.modelName || !plan.serviceRevision || !plan.thresholdSource) fail('Record modelName, serviceRevision and thresholdSource');
  if (!Array.isArray(plan.subjects) || !plan.subjects.length || !Array.isArray(plan.probes) || !plan.probes.length) fail('subjects and probes are required');
  const subjects = new Map(), ids = new Set(), references = new Set();
  for (const subject of plan.subjects) {
    if (!validCode(subject.code) || subjects.has(subject.code) || typeof subject.consentRef !== 'string' || !subject.consentRef.trim()) fail('Unique subject code and consentRef required');
    if (typeof subject.enrolled !== 'boolean') fail('enrolled must be boolean');
    if (subject.enrolled) {
      if (!Number.isSafeInteger(subject.providerUserId) || subject.providerUserId <= 0 || ids.has(subject.providerUserId)) fail('Unique positive providerUserId required');
      ids.add(subject.providerUserId);
      if (!Array.isArray(subject.referenceImages) || !subject.referenceImages.length) fail('Record all enrollment reference images');
      for (const file of subject.referenceImages) {
        const digest = image(file, base).sha256;
        if (references.has(digest)) fail('Duplicate enrollment image');
        references.add(digest);
      }
    } else if (subject.providerUserId != null || subject.referenceImages?.length) fail('Unknown subjects must not be enrolled');
    subjects.set(subject.code, subject);
  }
  const probes = [], seen = new Set(), probeIds = new Set();
  for (const probe of plan.probes) {
    if (!validCode(probe.id) || probeIds.has(probe.id) || !subjects.has(probe.subject) || !validCode(probe.condition)) fail('Unique probe id, known subject and condition code required');
    probeIds.add(probe.id);
    const img = image(probe.image, base);
    if (references.has(img.sha256) || seen.has(img.sha256)) fail('Enrollment/probe leakage or duplicate probe image');
    seen.add(img.sha256);
    probes.push({ ...probe, ...img, subjectInfo: subjects.get(probe.subject) });
  }
  if (!probes.some(p => p.subjectInfo.enrolled) || !probes.some(p => !p.subjectInfo.enrolled)) fail('Need enrolled and unknown probes');
  return { subjects, probes, gallerySubjects: ids.size, galleryTemplates: [...subjects.values()].reduce((n, s) => n + (s.referenceImages?.length || 0), 0) };
}

function classify(result, subject, threshold, galleryIds) {
  if (!result || typeof result !== 'object' || typeof result.matched !== 'boolean' || result.verification_available === false) return 'ERROR';
  if (result.reason === 'NO_FACE_DETECTED') return 'NO_FACE';
  if (result.reason === 'MULTIPLE_FACES_DETECTED') return 'MULTIPLE_FACES';
  if (!['MATCHED', 'NOT_MATCHED'].includes(result.reason) || !Number.isFinite(result.similarity) || result.similarity < -1 || result.similarity > 1) return 'ERROR';
  if (result.matched !== (result.reason === 'MATCHED')) return 'ERROR';
  if (result.matched && (!galleryIds.has(result.user_id) || result.similarity < threshold)) return 'ERROR';
  if (!result.matched && result.user_id != null) return 'ERROR';
  if (!subject.enrolled) return result.matched ? 'UNKNOWN_ACCEPTED' : 'UNKNOWN_REJECTED';
  return !result.matched ? 'KNOWN_REJECTED' : result.user_id === subject.providerUserId ? 'KNOWN_CORRECT' : 'KNOWN_WRONG_ID';
}

function summarize(rows) {
  const known = rows.filter(r => r.enrolled), unknown = rows.filter(r => !r.enrolled);
  const count = outcome => rows.filter(r => r.outcome === outcome).length;
  const invalid = count('ERROR'), noFace = count('NO_FACE'), multiFace = count('MULTIPLE_FACES');
  const scoredKnown = known.filter(r => r.outcome.startsWith('KNOWN_'));
  const scoredUnknown = unknown.filter(r => r.outcome.startsWith('UNKNOWN_'));
  const times = rows.filter(r => r.outcome !== 'ERROR').map(r => r.latencyMs).sort((a, b) => a - b);
  return {
    attempts: rows.length, knownAttempts: known.length, unknownAttempts: unknown.length,
    errors: invalid, noFace, multipleFaces: multiFace,
    knownCorrect: count('KNOWN_CORRECT'), knownRejected: count('KNOWN_REJECTED'), knownWrongIdentity: count('KNOWN_WRONG_ID'),
    unknownAccepted: count('UNKNOWN_ACCEPTED'), unknownRejected: count('UNKNOWN_REJECTED'),
    // Conditional recognition rates exclude acquisition/service failures, which are reported separately.
    identifiedCorrectlyPercent: rate(count('KNOWN_CORRECT'), scoredKnown.length),
    fnirRank1Percent: rate(count('KNOWN_REJECTED') + count('KNOWN_WRONG_ID'), scoredKnown.length),
    fpirPercent: rate(count('UNKNOWN_ACCEPTED'), scoredUnknown.length),
    scoredKnown: scoredKnown.length, scoredUnknown: scoredUnknown.length,
    knownEndToEndSuccessPercent: rate(count('KNOWN_CORRECT'), known.length),
    acquisitionFailurePercent: rate(noFace + multiFace, rows.length), serviceErrorPercent: rate(invalid, rows.length),
    meanLatencyMs: times.length ? Number((times.reduce((a, b) => a + b, 0) / times.length).toFixed(2)) : null,
    p95LatencyMs: times.length ? times[Math.ceil(times.length * .95) - 1] : null,
  };
}

async function main(args) {
  const filename = args.find(a => !a.startsWith('--'));
  if (!filename) fail('Usage: node tests/face-identification.cjs <private-plan.json> [--execute]');
  if (args.some(a => a.startsWith('--') && a !== '--execute')) fail('Unknown option');
  const plan = JSON.parse(fs.readFileSync(filename, 'utf8').replace(/^\uFEFF/, ''));
  const base = path.dirname(path.resolve(filename)), checked = validatePlan(plan, base);
  if (!args.includes('--execute')) {
    process.stdout.write(JSON.stringify({ mode: 'DRY_RUN', probes: checked.probes.length, gallerySubjects: checked.gallerySubjects, note: 'No requests sent; enrollment is manual in an isolated provider.' }) + '\n');
    return;
  }
  const endpoint = new URL(plan.baseUrl);
  if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || endpoint.pathname !== '/') fail('baseUrl must be an origin without credentials');
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname)) fail('Use a local isolated provider, not production');
  if (!plan.runtimeEvidence || plan.runtimeEvidence.realModelActive !== true || !plan.runtimeEvidence.isolatedGalleryVerified) fail('Verify real model and isolated gallery first');
  const proof = fs.readFileSync(path.resolve(base, plan.runtimeEvidence.file));
  if (hash(proof) !== plan.runtimeEvidence.sha256 || !/loaded successfully/i.test(proof.toString()) || /falling back to simulated|using simulated mode|simulated mode|insightface not available/i.test(proof.toString())) fail('Runtime evidence missing, changed, or simulated');
  if (!process.env.FACE_EVAL_API_KEY) fail('Set FACE_EVAL_API_KEY privately in the environment');
  const interval = plan.intervalMs ?? 1000;
  if (!Number.isFinite(interval) || interval < 500) fail('intervalMs must be >= 500; this is not a load test');
  const timeout = plan.timeoutMs ?? 15000;
  if (!Number.isFinite(timeout) || timeout < 1000 || timeout > 60000) fail('timeoutMs must be 1000..60000');
  const health = await fetch(new URL('/health', endpoint), { signal: AbortSignal.timeout(timeout), redirect: 'error' });
  const status = await health.json();
  if (!health.ok || status.database !== 'connected' || status.cache_loaded !== true || status.cached_users !== checked.gallerySubjects) fail('Health/gallery count mismatch; check isolated enrollment');
  const root = path.resolve(base, plan.outputDirectory || 'results'), out = path.join(root, plan.runId);
  fs.mkdirSync(root, { recursive: true });
  fs.mkdirSync(out); // Never overwrite an earlier experiment.
  const galleryIds = new Set([...checked.subjects.values()].filter(s => s.enrolled).map(s => s.providerUserId));
  const rows = [], startedAt = new Date().toISOString();
  for (const probe of checked.probes) {
    const row = { probe: probe.id, subject: probe.subject, condition: probe.condition, enrolled: probe.subjectInfo.enrolled, imageSha256: probe.sha256 };
    const form = new FormData();
    form.append('file', new Blob([probe.data], { type: probe.mime }), probe.id + '.image');
    form.append('threshold', String(plan.threshold));
    const start = performance.now();
    try {
      const response = await fetch(new URL('/api/v1/faces/verify', endpoint), { method: 'POST', body: form, headers: { 'X-API-Key': process.env.FACE_EVAL_API_KEY }, signal: AbortSignal.timeout(timeout), redirect: 'error' });
      row.httpStatus = response.status;
      row.latencyMs = Number((performance.now() - start).toFixed(2));
      if (!response.ok) { await response.arrayBuffer(); row.outcome = 'ERROR'; }
      else {
        const result = await response.json();
        row.latencyMs = Number((performance.now() - start).toFixed(2));
        row.outcome = classify(result, probe.subjectInfo, plan.threshold, galleryIds);
        row.similarity = Number.isFinite(result.similarity) ? result.similarity : null;
        row.predictedSubject = [...checked.subjects.values()].find(s => s.enrolled && s.providerUserId === result.user_id)?.code ?? null;
        row.reason = ['MATCHED', 'NOT_MATCHED', 'NO_FACE_DETECTED', 'MULTIPLE_FACES_DETECTED'].includes(result.reason) ? result.reason : 'INVALID_RESPONSE';
      }
    } catch { row.outcome = 'ERROR'; row.latencyMs = Number((performance.now() - start).toFixed(2)); }
    rows.push(row);
    fs.appendFileSync(path.join(out, 'attempts.jsonl'), JSON.stringify(row) + '\n');
    if ([401, 403, 429].includes(row.httpStatus)) break; // No silent retries or bypassing rate limits.
    if (rows.length < checked.probes.length) await new Promise(resolve => setTimeout(resolve, interval));
  }
  const complete = rows.length === checked.probes.length, summary = summarize(rows);
  const manifest = { mode: plan.mode, modelName: plan.modelName, serviceRevision: plan.serviceRevision, threshold: plan.threshold, thresholdSource: plan.thresholdSource, gallerySubjects: checked.gallerySubjects, galleryTemplates: checked.galleryTemplates, planSha256: hash(fs.readFileSync(filename)), runtimeEvidenceSha256: hash(proof), runtimeEvidence: 'Operator-reviewed log; API health does not attest active model', startedAt, finishedAt: new Date().toISOString(), complete, summary, byCondition: Object.fromEntries([...new Set(rows.map(r => r.condition))].map(c => [c, summarize(rows.filter(r => r.condition === c))])) };
  fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify(manifest, null, 2) + '\n');
  const f = (n, d) => d ? `${n}/${d} (${rate(n, d)}%)` : 'N/A';
  const report = `# Face identification 1:N — ${plan.runId}\n\nStatus: ${complete && !summary.errors ? 'COMPLETED; review evidence before reporting' : 'INCOMPLETE / ERRORS; not a clean accuracy result'}\n\nThreshold: ${plan.threshold}; gallery: ${checked.gallerySubjects} subjects / ${checked.galleryTemplates} reference images (operator verified).\n\n| Measure | Result |\n|---|---|\n| Correct rank-1 known identification | ${f(summary.knownCorrect, summary.scoredKnown)} |\n| FNIR at rank 1 (reject or wrong identity) | ${f(summary.knownRejected + summary.knownWrongIdentity, summary.scoredKnown)} |\n| FPIR (unknown accepted) | ${f(summary.unknownAccepted, summary.scoredUnknown)} |\n| Known end-to-end success, including failures | ${f(summary.knownCorrect, summary.knownAttempts)} |\n| No/multiple face | ${summary.noFace}/${summary.multipleFaces} |\n| Service/HTTP/invalid response errors | ${summary.errors} |\n| Mean / p95 HTTP latency, non-error attempts | ${summary.meanLatencyMs ?? 'N/A'} / ${summary.p95LatencyMs ?? 'N/A'} ms |\n\nConditional recognition denominators exclude service/acquisition failures; all failures remain in attempts.jsonl and end-to-end totals. Latency includes HTTP/detection/search/logging, not model inference alone. No result establishes door access, liveness, demographic fairness, or production capacity. Repeated photos per subject are correlated; zero observed errors do not prove a zero population error rate.\n\nRuntime model evidence is operator-reviewed, not a response-level attestation. Preserve the isolated gallery and model throughout the run. See summary.json for condition groups and run metadata.\n`;
  fs.writeFileSync(path.join(out, 'final_report.md'), report);
  process.stdout.write(JSON.stringify({ output: out, complete, summary }) + '\n');
  if (!complete || summary.errors) process.exitCode = 2;
}

module.exports = { validatePlan, classify, summarize };
if (require.main === module) main(process.argv.slice(2)).catch(error => {
  // Do not echo file paths, response bodies, face identities, or API credentials on failure.
  process.stderr.write(error.safeToDisplay ? `Evaluation stopped: ${error.message}\n` : 'Evaluation stopped. Check private plan, images, consent, runtime evidence, API key and isolated provider health.\n');
  process.exitCode = 1;
});

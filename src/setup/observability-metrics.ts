import promClient from 'prom-client';

export type LoginOutcome = 'success' | 'invalid_credentials' | 'error';
export type FaceVerificationOutcome = 'matched' | 'not_matched' | 'error';

const authLoginAttempts = new promClient.Counter<'outcome'>({
  name: 'dormitory_auth_login_attempts_total',
  help: 'Total login attempts grouped by outcome',
  labelNames: ['outcome'],
});

const faceVerificationAttempts = new promClient.Counter<'outcome'>({
  name: 'dormitory_face_verification_attempts_total',
  help: 'Total face verification attempts grouped by outcome',
  labelNames: ['outcome'],
});

// Export zero-valued series before the first event so missing metrics remain distinguishable.
for (const outcome of ['success', 'invalid_credentials', 'error'] as const) {
  authLoginAttempts.inc({ outcome }, 0);
}
for (const outcome of ['matched', 'not_matched', 'error'] as const) {
  faceVerificationAttempts.inc({ outcome }, 0);
}

export const recordLoginAttempt = (outcome: LoginOutcome) => {
  authLoginAttempts.inc({ outcome });
};

export const recordFaceVerificationAttempt = (outcome: FaceVerificationOutcome) => {
  faceVerificationAttempts.inc({ outcome });
};

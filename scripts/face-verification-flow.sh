#!/usr/bin/env bash
set -Eeuo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:3000}"
ADMIN_EMAIL="${QA_ADMIN_EMAIL:?Set QA_ADMIN_EMAIL}"
ADMIN_PASSWORD="${QA_ADMIN_PASSWORD:?Set QA_ADMIN_PASSWORD}"
USER_ID="${USER_ID:-99}"
IMAGE_PATH="${IMAGE_PATH:-./tests/fixtures/face.jpg}"
DEVICE_CODE="${DEVICE_CODE:-CAMERA_01}"

command -v curl >/dev/null || { echo "curl is required" >&2; exit 1; }
command -v jq >/dev/null || { echo "jq is required" >&2; exit 1; }
test -f "$IMAGE_PATH" || { echo "Image file not found: $IMAGE_PATH" >&2; exit 1; }

request_json() {
  curl --fail-with-body --silent --show-error "$@"
}

echo '[1/6] Health check'
request_json "$BASE_URL/api/health" | jq .

echo '[2/6] Admin login'
LOGIN_JSON="$(request_json -X POST "$BASE_URL/api/auth/login" \
  -H 'Content-Type: application/json' \
  --data "$(jq -n --arg email "$ADMIN_EMAIL" --arg password "$ADMIN_PASSWORD" '{email: $email, password: $password}')")"
TOKEN="$(jq -r '.data.token // empty' <<<"$LOGIN_JSON")"
test -n "$TOKEN" || { echo 'Login response did not contain data.token' >&2; exit 1; }

AUTH_HEADER="Authorization: Bearer $TOKEN"

echo "[3/6] Register face photo for user $USER_ID"
request_json -X POST "$BASE_URL/api/face-verification/register" \
  -H "$AUTH_HEADER" \
  -F "userId=$USER_ID" \
  -F "file=@$IMAGE_PATH" | jq .

echo '[4/6] Verify image'
request_json -X POST "$BASE_URL/api/face-verification/verify-image" \
  -F 'threshold=0.65' \
  -F "file=@$IMAGE_PATH" | jq .

echo '[5/6] Read monitor devices and scan history'
request_json "$BASE_URL/api/face-verification/devices" -H "$AUTH_HEADER" | jq .
request_json "$BASE_URL/api/face-verification/scan-history" -H "$AUTH_HEADER" | jq .

echo "[6/6] Send unlock then lock command for $DEVICE_CODE"
for ACTION in unlock lock; do
  request_json -X POST "$BASE_URL/api/face-verification/door-command" \
    -H "$AUTH_HEADER" \
    -H 'Content-Type: application/json' \
    --data "$(jq -n --arg device "$DEVICE_CODE" --arg action "$ACTION" --arg timestamp "$(date -u +%Y-%m-%dT%H:%M:%SZ)" '{device_code: $device, action: $action, timestamp: $timestamp}')" | jq .
done

echo 'Flow completed. Check whether verify.data.matched is real biometric output or mock fallback.'

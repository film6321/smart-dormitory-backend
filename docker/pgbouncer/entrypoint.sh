#!/bin/sh
set -eu

POSTGRESQL_HOST="${POSTGRESQL_HOST:-db}"
POSTGRESQL_PORT="${POSTGRESQL_PORT:-5432}"
POSTGRESQL_USERNAME="${POSTGRESQL_USERNAME:-postgres}"
POSTGRESQL_PASSWORD="${POSTGRESQL_PASSWORD:-postgrespw}"
POSTGRESQL_DATABASE="${POSTGRESQL_DATABASE:-projectdb}"
PGBOUNCER_PORT="${PGBOUNCER_PORT:-6432}"
PGBOUNCER_POOL_MODE="${PGBOUNCER_POOL_MODE:-transaction}"
PGBOUNCER_MAX_CLIENT_CONN="${PGBOUNCER_MAX_CLIENT_CONN:-1000}"
PGBOUNCER_DEFAULT_POOL_SIZE="${PGBOUNCER_DEFAULT_POOL_SIZE:-50}"

mkdir -p /etc/pgbouncer /var/log/pgbouncer /var/run/pgbouncer

cat > /etc/pgbouncer/pgbouncer.ini <<EOF
[databases]
${POSTGRESQL_DATABASE} = host=${POSTGRESQL_HOST} port=${POSTGRESQL_PORT} dbname=${POSTGRESQL_DATABASE}
* = host=${POSTGRESQL_HOST} port=${POSTGRESQL_PORT}

[pgbouncer]
listen_addr = 0.0.0.0
listen_port = ${PGBOUNCER_PORT}
auth_type = plain
auth_file = /etc/pgbouncer/userlist.txt
pool_mode = ${PGBOUNCER_POOL_MODE}
max_client_conn = ${PGBOUNCER_MAX_CLIENT_CONN}
default_pool_size = ${PGBOUNCER_DEFAULT_POOL_SIZE}
ignore_startup_parameters = extra_float_digits
admin_users = ${POSTGRESQL_USERNAME}
stats_users = ${POSTGRESQL_USERNAME}
EOF

printf '"%s" "%s"\n' "${POSTGRESQL_USERNAME}" "${POSTGRESQL_PASSWORD}" > /etc/pgbouncer/userlist.txt

addgroup -S pgbouncer >/dev/null 2>&1 || true
adduser -S -D -H -G pgbouncer pgbouncer >/dev/null 2>&1 || true
chown -R pgbouncer:pgbouncer /etc/pgbouncer /var/log/pgbouncer /var/run/pgbouncer

exec su-exec pgbouncer pgbouncer /etc/pgbouncer/pgbouncer.ini

FROM alpine:3.20

RUN apk add --no-cache pgbouncer postgresql-client su-exec

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 6432

ENTRYPOINT ["/entrypoint.sh"]

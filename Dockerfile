# syntax=docker/dockerfile:1
# cloud-demo serves the disclosed synthetic simulation; native profiles stay on main.
FROM nginx/nginx-unprivileged:stable-alpine-slim@sha256:931bec1e41a3a643f2672162405093fe04002dd20e41d04faf67d700b7556b49

LABEL org.opencontainers.image.title="KnAIghts of The Round simulation" \
      org.opencontainers.image.source="https://github.com/KennethJSmithDev/KnAIghtsOfTheRound" \
      org.opencontainers.image.description="Recorded synthetic review simulation; no IRIS connection or live inference." \
      org.opencontainers.image.licenses="Apache-2.0"

# Restrict template expansion so NGINX's $uri variables remain intact.
ENV PORT=8080 NGINX_ENVSUBST_FILTER="^PORT$"

COPY --chown=101:101 demo/index.html demo/demo.css demo/demo.js /usr/share/nginx/html/kotr/
COPY --chown=101:101 LICENSE NOTICE THIRD_PARTY_NOTICES.md /usr/share/licenses/kotr/

COPY --chown=101:101 <<'NGINX' /etc/nginx/templates/default.conf.template
server {
    listen ${PORT};
    server_name _;
    root /usr/share/nginx/html/kotr;
    index index.html;

    location = /healthz {
        access_log off;
        default_type text/plain;
        return 200 "ok\n";
    }

    location / {
        try_files $uri $uri/ =404;
    }
}
NGINX

USER 101:101
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget -q -O /dev/null "http://127.0.0.1:${PORT}/healthz" || exit 1
CMD ["nginx", "-g", "daemon off;"]

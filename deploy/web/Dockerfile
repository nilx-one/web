# © 2026 aiaiaiai · aiaiaiai.org
# SPDX-License-Identifier: MPL-2.0

FROM caddy:2-alpine

LABEL org.opencontainers.image.title="0x1 Web Clients"
LABEL org.opencontainers.image.description="Immutable static runtime containing every 0x1 Web host composition"

WORKDIR /srv
COPY apps/site/dist/ /srv/site/
COPY apps/telegram-mini-app/dist/ /srv/telegram-mini-app/
COPY apps/discord-activity/dist/ /srv/discord-activity/
COPY deploy/web/map/ /srv/map/
COPY deploy/web/Caddyfile /etc/caddy/Caddyfile

ENV CLIENT_ROOT=/srv/site

EXPOSE 8080

HEALTHCHECK --interval=15s --timeout=5s --retries=6 --start-period=5s \
  CMD wget -q -O - http://127.0.0.1:8080/health >/dev/null || exit 1

CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile"]

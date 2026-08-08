# AgentTalks. Obraz jest trywialny, bo nie ma kroku budowania ani modulow natywnych:
# Node 26 uruchamia TypeScript wprost, a SQLite jest w node:sqlite.
#
# Powod istnienia tego pliku: serwer docelowy ma juz usluge na Node 18. Kontener
# czyni wersje Node wlasnoscia obrazu, a nie maszyny, wiec nic nie koliduje
# i nic sie nie psuje przy aktualizacji systemu.
FROM node:26-alpine

WORKDIR /app

# Manifesty osobno i pierwsze: warstwa z jedyna zaleznoscia
# (@modelcontextprotocol/sdk dla /mcp) cache'uje sie niezaleznie od kodu.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY src ./src
COPY bin ./bin
COPY integrations ./integrations
COPY AgentTalks.md ./AgentTalks.md
COPY NEWS.md ./NEWS.md

ENV AGENTTALKS_DATA=/data \
    AGENTTALKS_IN_CONTAINER=1 \
    AGENTTALKS_PORT=8080 \
    NODE_ENV=production

# Katalog danych powstaje przed przejsciem na uzytkownika `node`, inaczej proces
# bez uprawnien nie zalozy bazy przy pierwszym starcie.
RUN mkdir -p /data && chown -R node:node /data /app
VOLUME /data
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node bin/agenttalks.js healthcheck

USER node

# init jest idempotentne, wiec bezpiecznie stoi w sciezce startu: pierwszy start
# zaklada baze, kazdy nastepny nic nie zmienia.
#
# Bez --port: AGENTTALKS_PORT (env, domyslnie 8080 z ENV wyzej) ustawia port przez
# loadConfig, wiec `serve` i `healthcheck` maja jedno zrodlo prawdy - nadpisanie
# env zmienia oba spojnie, zamiast psuc healthcheck przy zmianie portu.
CMD ["sh", "-c", "node bin/agenttalks.js init && exec node bin/agenttalks.js serve --host 0.0.0.0"]

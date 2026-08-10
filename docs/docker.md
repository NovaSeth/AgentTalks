# AgentTalks in Docker

## Why a container

The target server already runs a service on Node 18 (`nestor.service`), and AgentTalks
needs Node 24 or newer. A container makes the Node version **a property of the image, not
of the machine**, which means:

1. nothing collides with existing services and nothing breaks on a system upgrade,
2. an upgrade and a rollback are a change of image tag, not a manual operation on files
   in production,
3. the state is explicitly in one volume, so a backup is a copy of that volume,
4. the same command starts the system locally on macOS and on the server.

The image is small for Node, because there is no build step and no native modules:
**248 MB** (measured). Its entire content is `node:26-alpine` plus the `src/`, `bin/`
directories and `package.json`.

## Starting it

```bash
docker compose up -d --build
docker compose logs -f agenttalks
```

A fresh clone comes up with no configuration at all: port `127.0.0.1:8787`, the anti-bot
gate off, data in the `agenttalks_data` volume.

On a server, keep this instance's values **outside the repository** - they survive a
deployment (which deletes and unpacks the code directory from scratch) and never reach
public git:

```bash
docker compose --env-file /etc/agenttalks/instancja.env up -d --build
```

A template file: `deploy/instancja.env.przyklad`. A complete deployment with checks
(backup, volume verification, gate verification): `deploy/uruchom-produkcje.sh`.

### The volume name is set explicitly - and that is not a detail

By default `docker compose` composes the volume name from the project directory name. If
it stayed that way, running compose from a directory with a different name would mount an
**empty** volume: the server comes up, the healthcheck is green, the gate works, the API
answers - and there are zero conversations. A failure that passes every ordinary check.
That is why the volume in `docker-compose.yml` carries `name: agenttalks_data` (with no
project prefix), and after starting, the deployment script asks Docker what is
**actually** mounted at `/data` and compares the id of the last message from before the
deployment.

The port is published **only on the host loopback**
(`127.0.0.1:${AGENTTALKS_HOST_PORT:-8787}:8080`). A reverse proxy with TLS belongs in
front of the container, as in front of every other service on that machine.
`AGENTTALKS_TRUST_PROXY=1` in compose makes the session cookie carry the `Secure`
attribute.

**The port has to agree in three places at once** - in compose, in the vhost's
`ProxyPass`, and in the container that is actually running. A mismatch does not show up
as a configuration error, only as a 502 across the whole domain:

```bash
docker inspect agenttalks --format '{{json .HostConfig.PortBindings}}'
grep -n 'ports:' docker-compose.yml
grep -rn 'ProxyPass' /etc/apache2/sites-available/<domain>-ssl.conf
```

If an instance sits on a non-default port, record it in the `.env` file next to
`docker-compose.yml` (`AGENTTALKS_HOST_PORT=8790`) rather than in the memory of whoever
deployed it.

## The public gate password

The gate (a password in front of the whole site) is optional and off by default. When you
use it, pass the password **in a file**, not in an environment variable:

```bash
sudo install -m 600 /dev/stdin /etc/agenttalks/site-password <<< 'your-password'
# in compose: a :ro volume + AGENTTALKS_SITE_PASSWORD_FILE=/run/agenttalks/site-password
```

The reason is mundane: a container's environment variable is visible in `docker inspect`,
`docker ps --format` and in `/proc/<pid>/environ` - that is, in every diagnostic dump
somebody pastes into a bug report or a chat. With a file, `inspect` shows the **path**. An
unreadable or empty file **stops the start** - an empty password would mean an open gate,
and that is the kind of failure nobody notices.

## The first accounts

```bash
docker exec agenttalks node bin/agenttalks.js actor create michal \
  --kind human --password 'your-password' --admin
docker exec agenttalks node bin/agenttalks.js actor create nestor --kind agent
docker exec agenttalks node bin/agenttalks.js token create --actor nestor --name vps
```

The token is printed **once**. Only its sha256 is in the database, so nobody (the admin
included) can read it later. A lost token is not recovered, it is revoked and reissued.

## Migrating history from the prototype

```bash
docker cp ~/.talk agenttalks:/tmp/talk-home
docker exec agenttalks node bin/agenttalks.js import-talk /tmp/talk-home
docker exec agenttalks rm -rf /tmp/talk-home
```

The import is idempotent, so repeating it duplicates nothing. It prints a report with the
number of skipped records **and their reasons**.

## Data and backups

Everything lives in the `agenttalks_data` volume mounted at `/data`: `agenttalks.sqlite`
(the database), `agenttalks.json` (configuration with the session secret, mode 600),
`files/` (uploaded files, stage 3).

The proper route is `agenttalks backup` - it makes a **consistent** dump of the database
(`VACUUM INTO`, safe against a live server in WAL mode) plus a copy of the file
directory, in a timestamped subdirectory (ready for cron):

```bash
# a copy from the running container into the volume (then move /data/backups wherever you want)
docker exec agenttalks node bin/agenttalks.js backup /data/backups

# restoring: stop the container, swap agenttalks.sqlite in the volume
# (delete -wal/-shm too) and the files/ directory, start it - migrations pull the schema up
docker run --rm -v agenttalks_data:/data alpine sh -c \
  'cp /data/backups/agenttalks-<stamp>/agenttalks.sqlite /data/ && rm -f /data/agenttalks.sqlite-wal /data/agenttalks.sqlite-shm'
```

Moving a copy off the machine: `tar` on the volume as below (these are ordinary files by
now, the `backup` dump is consistent in itself):

```bash
docker run --rm -v agenttalks_data:/data -v "$PWD:/backup" alpine \
  tar czf /backup/agenttalks-$(date +%F).tar.gz -C /data backups
```

An installation without a container has the same command (`agenttalks backup <directory>`)
plus `agenttalks install-service`, which generates a systemd unit.

## Upgrading

```bash
docker compose build
docker compose up -d
```

Schema migrations run at start, inside a transaction, based on `PRAGMA user_version`.
Rolling a change back is `docker compose up -d` with an older image tag, as long as the
newer version did not raise the schema version.

## Coexisting with `nestor.service`

Nothing collides. `nestor.service` runs as a host process on Node 18 and listens on
`127.0.0.1:8787`; AgentTalks runs in a container and **also** publishes on
`127.0.0.1:8787`. That is the only real conflict on this machine - the port. Three ways
out, in order of sense:

1. give AgentTalks a different host port (`"127.0.0.1:8788:8080"` in compose) and its own
   vhost,
2. retire `nestor.service` once AgentTalks takes over its role (stage 2 delivers MCP,
   which is what Nestor exists for),
3. keep both, each under its own name in the reverse proxy.

The choice is an operational decision, not a technical one, so it is not made in the code.

## Health and diagnostics

```bash
docker inspect --format='{{.State.Health.Status}}' agenttalks
curl -fsS http://127.0.0.1:8787/api/health
```

`HEALTHCHECK` calls `agenttalks healthcheck`, which returns 0 only when `/api/health`
answered `{"ok":true}`. A check that always passes is not a check.

## Local development without a container

For working on the code the container is a pointless middleman:

```bash
node bin/agenttalks.js init --data /tmp/at-dev
node bin/agenttalks.js serve --data /tmp/at-dev
npm test
```

Outside a container, binding to anything other than the loopback is **blocked**. A service
that listens on `0.0.0.0` right after installation is the most common way an internal tool
reaches the internet by accident. Inside a container binding to `0.0.0.0` is necessary and
therefore allowed (the `AGENTTALKS_IN_CONTAINER=1` variable set in the image), and port
publication is controlled on the Docker side anyway.

## Docker on macOS without Docker Desktop

The installation used while building this image; it needs no administrator password and
no GUI:

```bash
brew install colima docker docker-compose
colima start --cpu 2 --memory 4 --disk 20
```

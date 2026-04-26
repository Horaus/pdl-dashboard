const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const { exec, spawn } = require('child_process');
const { randomUUID } = require('crypto');

const app = express();
const PORT = Number(process.env.PORT || 3001);
const SELF_UPDATE_ENABLED = String(process.env.SELF_UPDATE_ENABLED || 'true').toLowerCase() !== 'false';
const SELF_UPDATE_FOLDER_RAW = process.env.SELF_UPDATE_FOLDER || process.env.PROJECT_NAME || 'pdl-dashboard';

app.use(cors());
app.use(bodyParser.json());

const BASE_PATH = process.env.WEBS_HOME || '/home/pdl1host/webs';
const SRV_WEBS_PATH = process.env.SRV_WEBS_HOME || '/srv/webs';
const STATE_FILE = path.join(__dirname, 'dashboard-state.json');
const DOMAIN_CATALOG_FILE_CANDIDATES = [
  path.join(BASE_PATH, 'domains.txt'),
  path.join(SRV_WEBS_PATH, 'domains.txt'),
];
const SOFT_DELETE_TTL_MS = 48 * 60 * 60 * 1000;
const jobs = new Map();
const MAX_LOG_LINES = 1000;
const autoDeleteLocks = new Set();
let domainCatalogCache = null;

const normalizeFolder = (value) => String(value || '').replace(/[^a-zA-Z0-9-]/g, '');
const SELF_UPDATE_FOLDER = normalizeFolder(SELF_UPDATE_FOLDER_RAW);

const shellQuote = (value) => `'${String(value || '').replace(/'/g, `'\\''`)}'`;

const normalizeRepoRef = (value) => {
  const repo = String(value || '').trim();
  if (!repo) return '';
  if (/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?$/i.test(repo)) return repo;
  if (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) return repo;
  return '';
};

const loadState = () => {
  try {
    if (!fs.existsSync(STATE_FILE)) {
      return { projects: {} };
    }
    const parsed = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || typeof parsed.projects !== 'object') {
      return { projects: {} };
    }
    return parsed;
  } catch (error) {
    console.error('Cannot load dashboard state:', error.message);
    return { projects: {} };
  }
};

let dashboardState = loadState();

const saveState = () => {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(dashboardState, null, 2));
  } catch (error) {
    console.error('Cannot save dashboard state:', error.message);
  }
};

const defaultMeta = () => ({
  lifecycle: 'active',
  deleteMeta: null,
  runtime: {
    domain: null,
    port: null,
    maintenanceStartTime: null,
    maintenanceEndTime: null,
  },
  rollbackMeta: {
    currentSha: null,
    previousSha: null,
    availableCommits: [],
    updatedAt: null,
  },
  updatedAt: Date.now(),
});

const getProjectMeta = (folder) => {
  if (!dashboardState.projects[folder]) {
    dashboardState.projects[folder] = defaultMeta();
    saveState();
  }
  return dashboardState.projects[folder];
};

const patchProjectMeta = (folder, patch) => {
  const current = getProjectMeta(folder);
  dashboardState.projects[folder] = {
    ...current,
    ...patch,
    rollbackMeta: {
      ...current.rollbackMeta,
      ...(patch.rollbackMeta || {}),
    },
    updatedAt: Date.now(),
  };
  saveState();
  return dashboardState.projects[folder];
};

const detectPathsCommand = (folder) => {
  const folderSafe = normalizeFolder(folder);
  const homeRootPath = `${BASE_PATH}/${folderSafe}`;
  const srvRootPath = `${SRV_WEBS_PATH}/${folderSafe}`;
  return `if [ -d ${homeRootPath} ]; then ROOT_PATH=${homeRootPath}; \\
else if [ -d ${srvRootPath} ]; then ROOT_PATH=${srvRootPath}; \\
else echo "Project folder not found in ${homeRootPath} or ${srvRootPath}" && exit 2; fi; fi; \\
if [ -d $ROOT_PATH/source/.git ]; then REPO_PATH=$ROOT_PATH/source; \\
else if [ -d $ROOT_PATH/.git ]; then REPO_PATH=$ROOT_PATH; \\
else echo "Repository not found in $ROOT_PATH/source or $ROOT_PATH" && exit 2; fi; fi;`;
};

const ensureSafeGitDirectoryCommand = 'git config --global --add safe.directory $REPO_PATH';

const buildCommand = ({ action, folder, type, domain, port, endTime, sha, repo }) => {
  const folderSafe = normalizeFolder(folder);
  if (!folderSafe) return null;
  const runtimeMeta = getProjectMeta(folderSafe).runtime || {};
  const resolvedDomain = String(domain || runtimeMeta.domain || '').trim();
  const resolvedPort = String(port || runtimeMeta.port || '').trim();
  const repoRef = normalizeRepoRef(repo);
  const repoEnv = repoRef ? `PDL_REPO_URL=${shellQuote(repoRef)} ` : '';

  if (action === 'deploy') {
    const safeType = type === 'preview' ? 'preview' : 'production';
    if (safeType === 'production' && !resolvedDomain) {
      return null;
    }
    const val = safeType === 'preview' ? resolvedPort : resolvedDomain;
    const extra = safeType === 'production' && resolvedPort ? ` ${resolvedPort}` : '';
    return `cd ${BASE_PATH} && ${repoEnv}./manager.sh deploy ${folderSafe} ${safeType} ${val}${extra}`;
  }

  if (action === 'offair') {
    if (!resolvedDomain) {
      return null;
    }
    const extra = resolvedPort ? ` ${resolvedPort}` : '';
    return `cd ${BASE_PATH} && ./manager.sh offair ${folderSafe} ${resolvedDomain} ${endTime || 'undefined'}${extra}`;
  }

  if (action === 'update') {
    return `${detectPathsCommand(folderSafe)} \\
${ensureSafeGitDirectoryCommand} && cd $REPO_PATH && git pull && cd $ROOT_PATH && docker compose up -d --build`;
  }

  if (action === 'delete_soft') {
    return `${detectPathsCommand(folderSafe)} cd $ROOT_PATH && docker compose down --remove-orphans || true`;
  }

  if (action === 'restore') {
    return `${detectPathsCommand(folderSafe)} cd $ROOT_PATH && docker compose up -d --build --remove-orphans`;
  }

  if (action === 'delete_hard') {
    return `${detectPathsCommand(folderSafe)} cd $ROOT_PATH && docker compose down --remove-orphans || true; rm -rf $ROOT_PATH`;
  }

  if (action === 'rollback_apply') {
    const safeSha = String(sha || '').trim();
    if (!/^[a-f0-9]{7,40}$/i.test(safeSha)) return null;
    return `${detectPathsCommand(folderSafe)} ${ensureSafeGitDirectoryCommand} && cd $REPO_PATH && git fetch --all --prune && PRE_SHA=$(git rev-parse HEAD) && echo "__PRE_SHA__:$PRE_SHA" && git reset --hard ${safeSha} && cd $ROOT_PATH && docker compose up -d --build --remove-orphans`;
  }

  return null;
};

const pushJobLine = (job, stream, text) => {
  const trimmed = String(text || '').trim();
  if (!trimmed) return;
  job.lines.push({ ts: Date.now(), stream, text: trimmed });
  if (job.lines.length > MAX_LOG_LINES) {
    job.lines.splice(0, job.lines.length - MAX_LOG_LINES);
    job.baseOffset += 1;
  }
};

const normalizeChunks = (chunk) => String(chunk || '').split('\n').filter(Boolean);

const runRealtimeJob = ({ command, action, folder, onSuccess }) => {
  const jobId = randomUUID();
  const job = {
    id: jobId,
    action,
    folder,
    status: 'running',
    startedAt: Date.now(),
    endedAt: null,
    exitCode: null,
    error: null,
    lines: [],
    baseOffset: 0,
    meta: null,
  };
  jobs.set(jobId, job);

  const child = spawn('sh', ['-lc', command], { stdio: ['ignore', 'pipe', 'pipe'] });

  child.stdout.on('data', (chunk) => {
    normalizeChunks(chunk).forEach((line) => pushJobLine(job, 'stdout', line));
  });

  child.stderr.on('data', (chunk) => {
    normalizeChunks(chunk).forEach((line) => pushJobLine(job, 'stderr', line));
  });

  child.on('error', (err) => {
    job.status = 'error';
    job.error = err.message;
    job.endedAt = Date.now();
    pushJobLine(job, 'stderr', err.message);
  });

  child.on('close', (code) => {
    job.exitCode = code;
    job.endedAt = Date.now();
    job.status = code === 0 ? 'success' : 'error';
    if (code !== 0 && !job.error) {
      job.error = `Command exited with code ${code}`;
    }
    if (job.status === 'success' && typeof onSuccess === 'function') {
      try {
        job.meta = onSuccess(job) || null;
      } catch (error) {
        job.status = 'error';
        job.error = error.message;
        pushJobLine(job, 'stderr', error.message);
      }
    }
  });

  return job;
};

const execPromise = (command, options = {}) =>
  new Promise((resolve, reject) => {
    exec(
      command,
      {
        maxBuffer: options.maxBuffer || 4 * 1024 * 1024,
        timeout: options.timeout || 15000,
      },
      (error, stdout, stderr) => {
      if (error) {
        reject({ error, stdout, stderr });
        return;
      }
      resolve({ stdout, stderr });
      },
    );
  });

const parseHostsFromRule = (value) => {
  const rule = String(value || '');
  const hosts = [];
  let hostBlockMatch = null;
  const hostBlockPattern = /Host(?:SNI)?\s*\(([^)]*)\)/gi;
  while ((hostBlockMatch = hostBlockPattern.exec(rule)) !== null) {
    const block = hostBlockMatch[1] || '';
    const quoted = [];
    let quotedMatch = null;
    const quotedPattern = /`([^`]+)`|"([^"]+)"|'([^']+)'/g;
    while ((quotedMatch = quotedPattern.exec(block)) !== null) {
      quoted.push((quotedMatch[1] || quotedMatch[2] || quotedMatch[3] || '').trim());
    }
    if (quoted.length > 0) {
      hosts.push(...quoted);
      continue;
    }
    hosts.push(...block.split(',').map((part) => part.trim()));
  }
  return hosts;
};

const matchWildcardHostname = (hostname, wildcardRule) => {
  const host = String(hostname || '').toLowerCase();
  const rule = String(wildcardRule || '').toLowerCase();
  if (!rule.startsWith('*.')) return host === rule;
  const suffix = rule.slice(1); // ".example.com"
  return host.endsWith(suffix) && host !== suffix.slice(1);
};

const parseCloudflaredIngressConfig = (content) => {
  const lines = String(content || '').split('\n');
  const rules = [];
  let tunnelId = null;

  lines.forEach((line, index) => {
    const trimmed = line.trim();
    const tunnelMatch = trimmed.match(/^tunnel:\s*([a-z0-9-]+)\s*$/i);
    if (tunnelMatch) {
      tunnelId = tunnelMatch[1];
    }
    if (!trimmed.startsWith('- hostname:')) return;

    const hostname = trimmed.replace('- hostname:', '').trim().replace(/^["']|["']$/g, '');
    let service = null;
    for (let i = index + 1; i < Math.min(lines.length, index + 12); i += 1) {
      const lookahead = lines[i].trim();
      if (lookahead.startsWith('- ') && !lookahead.startsWith('- hostname:')) break;
      if (lookahead.startsWith('- hostname:')) break;
      if (lookahead.startsWith('service:')) {
        service = lookahead.replace('service:', '').trim().replace(/^["']|["']$/g, '');
        break;
      }
    }
    if (hostname) {
      rules.push({ hostname, service });
    }
  });

  return { tunnelId, rules };
};

const readCloudflaredConfigViaDocker = async () => {
  const command = `CF_NAME=$(docker ps --format '{{.Names}}' | grep -i '^cloudflared$' | head -n1); \
if [ -z "$CF_NAME" ]; then CF_NAME=$(docker ps --format '{{.Names}}' | grep -i cloudflared | head -n1); fi; \
if [ -z "$CF_NAME" ]; then exit 0; fi; \
SRC=$(docker inspect "$CF_NAME" --format '{{range .Mounts}}{{if eq .Destination "/etc/cloudflared"}}{{.Source}}{{end}}{{end}}'); \
if [ -z "$SRC" ]; then exit 0; fi; \
docker run --rm -v "$SRC:/cfg:ro" alpine sh -lc 'cat /cfg/config.yml 2>/dev/null || true'`;
  const { stdout } = await execPromise(command);
  return String(stdout || '');
};

const resolveTunnelRouteForDomain = async (domain) => {
  const configText = await readCloudflaredConfigViaDocker();
  if (!configText.trim()) {
    return { matched: false, reason: 'cloudflared config not found' };
  }
  const parsed = parseCloudflaredIngressConfig(configText);
  const host = normalizeDomainName(domain);
  if (!host) return { matched: false, reason: 'invalid domain' };

  const exactMatch = parsed.rules.find((rule) => normalizeDomainName(rule.hostname) === host);
  if (exactMatch) {
    return {
      matched: true,
      tunnelId: parsed.tunnelId || null,
      matchedRule: exactMatch.hostname,
      service: exactMatch.service || null,
      matchType: 'exact',
    };
  }

  const wildcardMatch = parsed.rules.find((rule) => rule.hostname.startsWith('*.') && matchWildcardHostname(host, rule.hostname));
  if (wildcardMatch) {
    return {
      matched: true,
      tunnelId: parsed.tunnelId || null,
      matchedRule: wildcardMatch.hostname,
      service: wildcardMatch.service || null,
      matchType: 'wildcard',
    };
  }

  return {
    matched: false,
    tunnelId: parsed.tunnelId || null,
    reason: 'no ingress rule matched this hostname',
  };
};

const normalizeDomainName = (value) => {
  const normalized = String(value || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^\*\./, '');
  if (!normalized) return '';
  if (!/^[a-z0-9.-]+$/.test(normalized)) return '';
  if (!normalized.includes('.')) return '';
  return normalized;
};

const normalizePortNumber = (value) => {
  const port = String(value || '').trim();
  if (!/^\d{2,5}$/.test(port)) return '';
  const numeric = Number(port);
  if (!Number.isInteger(numeric) || numeric < 1 || numeric > 65535) return '';
  return port;
};

const splitLabels = (host) => normalizeDomainName(host).split('.').filter(Boolean);

const getBaseDomain = (host) => {
  const labels = splitLabels(host);
  if (labels.length < 2) return '';
  const suffix2 = `${labels[labels.length - 2]}.${labels[labels.length - 1]}`;
  const threeLevelSuffixes = new Set(['com.vn', 'net.vn', 'org.vn', 'io.vn', 'edu.vn', 'gov.vn', 'co.uk', 'org.uk', 'com.au']);
  if (labels.length >= 3 && threeLevelSuffixes.has(suffix2)) {
    return `${labels[labels.length - 3]}.${suffix2}`;
  }
  return suffix2;
};

const readDomainsFromLocalFile = () => {
  const collected = [];
  DOMAIN_CATALOG_FILE_CANDIDATES.forEach((filePath) => {
    if (!fs.existsSync(filePath)) return;
    const lines = fs.readFileSync(filePath, 'utf8').split('\n');
    lines.forEach((line) => {
      const clean = line.trim();
      if (!clean || clean.startsWith('#')) return;
      const normalized = normalizeDomainName(clean);
      if (normalized) collected.push(normalized);
    });
  });
  return collected;
};

const readDomainsFromTraefikDockerLabels = async () => {
  const command = `docker ps --format '{{.ID}}' | xargs -r docker inspect --format '{{json .Config.Labels}}'`;
  const { stdout } = await execPromise(command);
  const domains = [];
  String(stdout || '')
    .trim()
    .split('\n')
    .filter(Boolean)
    .forEach((line) => {
      try {
        const labels = JSON.parse(line);
        Object.entries(labels || {}).forEach(([key, value]) => {
          if (!key.includes('traefik.http.routers.') || !key.endsWith('.rule')) return;
          parseHostsFromRule(value).forEach((host) => {
            const normalized = normalizeDomainName(host);
            if (normalized) domains.push(normalized);
          });
        });
      } catch {
        // Ignore malformed lines and continue parsing.
      }
    });
  return domains;
};

const readDomainsFromTraefikDynamicConfig = async () => {
  const command = `TRAEFIK_NAME=$(docker ps --format '{{.Names}}' | grep -i '^traefik$' | head -n1); \
if [ -z "$TRAEFIK_NAME" ]; then TRAEFIK_NAME=$(docker ps --format '{{.Names}}' | grep -i traefik | head -n1); fi; \
if [ -n "$TRAEFIK_NAME" ]; then docker exec "$TRAEFIK_NAME" cat /etc/traefik/dynamic.yml; fi`;
  const { stdout } = await execPromise(command);
  const domains = [];
  parseHostsFromRule(stdout).forEach((host) => {
    const normalized = normalizeDomainName(host);
    if (normalized) domains.push(normalized);
  });
  return domains;
};

const buildDomainCatalog = async () => {
  const sourceMeta = {
    fromDocker: 0,
    fromDynamic: 0,
    fromFile: 0,
    updatedAt: Date.now(),
  };

  const allDomains = new Set();
  const pushDomains = (domains, sourceKey) => {
    sourceMeta[sourceKey] += domains.length;
    domains.forEach((domain) => allDomains.add(domain));
  };

  try {
    pushDomains(await readDomainsFromTraefikDockerLabels(), 'fromDocker');
  } catch (error) {
    console.error('Domain scan (docker labels) failed:', error.message);
  }

  try {
    pushDomains(await readDomainsFromTraefikDynamicConfig(), 'fromDynamic');
  } catch (error) {
    console.error('Domain scan (dynamic.yml) failed:', error.message);
  }

  try {
    pushDomains(readDomainsFromLocalFile(), 'fromFile');
  } catch (error) {
    console.error('Domain scan (domains file) failed:', error.message);
  }

  const fqdnExamples = Array.from(allDomains).sort();
  const baseDomains = Array.from(
    new Set(
      fqdnExamples
        .map((fqdn) => getBaseDomain(fqdn))
        .filter(Boolean),
    ),
  ).sort();

  return {
    baseDomains,
    fqdnExamples,
    sourceMeta,
  };
};

const getDomainCatalog = async (forceReload = false) => {
  const now = Date.now();
  const cacheTtlMs = 30 * 1000;
  if (!forceReload && domainCatalogCache && now - domainCatalogCache.cachedAt < cacheTtlMs) {
    return domainCatalogCache.data;
  }
  const data = await buildDomainCatalog();
  domainCatalogCache = { cachedAt: now, data };
  return data;
};

const parseCommits = (stdout) => {
  return String(stdout || '')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [sha, author, time, message] = line.split('\t');
      return { sha, author, time, message };
    });
};

const refreshRollbackMeta = async (folder) => {
  const folderSafe = normalizeFolder(folder);
  if (!folderSafe) throw new Error('Invalid folder');

  const command = `${detectPathsCommand(folderSafe)} ${ensureSafeGitDirectoryCommand} && cd $REPO_PATH && git fetch --all --prune && git rev-parse HEAD && git log --date=iso --pretty=format:'%H\t%an\t%ad\t%s' -n 20`;
  const { stdout } = await execPromise(command);
  const lines = String(stdout || '').trim().split('\n').filter(Boolean);
  const currentSha = lines[0] || null;
  const commits = parseCommits(lines.slice(1).join('\n'));

  const meta = patchProjectMeta(folderSafe, {
    rollbackMeta: {
      currentSha,
      availableCommits: commits,
      updatedAt: Date.now(),
    },
  });

  return {
    currentSha: meta.rollbackMeta.currentSha,
    previousSha: meta.rollbackMeta.previousSha,
    commits: meta.rollbackMeta.availableCommits,
  };
};

const applySoftDeleteMeta = (folder) => {
  const now = Date.now();
  const hardDeleteAt = now + SOFT_DELETE_TTL_MS;
  return patchProjectMeta(folder, {
    lifecycle: 'pending_delete',
    deleteMeta: {
      deletedAt: now,
      hardDeleteAt,
    },
  });
};

const applyRestoreMeta = (folder) => {
  return patchProjectMeta(folder, {
    lifecycle: 'active',
    deleteMeta: null,
  });
};

const applyHardDeleteMeta = (folder) => {
  return patchProjectMeta(folder, {
    lifecycle: 'deleted',
    deleteMeta: {
      hardDeletedAt: Date.now(),
    },
  });
};

const runAutoHardDeleteSweep = async () => {
  const now = Date.now();
  const entries = Object.entries(dashboardState.projects || {});
  for (const [folder, meta] of entries) {
    if (!meta || meta.lifecycle !== 'pending_delete') continue;
    const hardDeleteAt = Number(meta.deleteMeta?.hardDeleteAt || 0);
    if (!hardDeleteAt || hardDeleteAt > now) continue;
    if (autoDeleteLocks.has(folder)) continue;

    autoDeleteLocks.add(folder);
    try {
      const command = buildCommand({ action: 'delete_hard', folder });
      if (!command) continue;
      runRealtimeJob({
        command,
        action: 'delete_hard_auto',
        folder,
        onSuccess: () => {
          applyHardDeleteMeta(folder);
          return { autoDeleted: true };
        },
      });
    } catch (error) {
      console.error(`Auto hard delete failed for ${folder}:`, error.message);
    } finally {
      setTimeout(() => autoDeleteLocks.delete(folder), 5000);
    }
  }
};

setInterval(() => {
  runAutoHardDeleteSweep().catch((error) => {
    console.error('Sweep error:', error.message);
  });
}, 60 * 1000);

app.post('/api/execute', async (req, res) => {
  const payload = req.body || {};
  const { action, realtime, folder, sha, type } = payload;
  const folderSafe = normalizeFolder(folder);

  if (action === 'rollback_list') {
    if (!folderSafe) {
      return res.status(400).json({ error: 'Invalid folder' });
    }
    try {
      const data = await refreshRollbackMeta(folderSafe);
      return res.json({ action, folder: folderSafe, ...data });
    } catch (error) {
      return res.status(500).json({ error: error.error?.message || error.message || 'Cannot load rollback list' });
    }
  }

  if (action === 'rollback_apply') {
    const currentMeta = getProjectMeta(folderSafe);
    const available = currentMeta.rollbackMeta?.availableCommits || [];
    if (!available.some((commit) => commit.sha === sha)) {
      return res.status(400).json({ error: 'Selected SHA is not in rollback list. Refresh rollback list and try again.' });
    }
  }

  if (action === 'deploy' && payload.repo && !normalizeRepoRef(payload.repo)) {
    return res.status(400).json({ error: 'Invalid GitHub repo. Use owner/repository or https://github.com/owner/repository.' });
  }

  const command = buildCommand(payload);
  if (!command) {
    if (action === 'offair') {
      return res.status(400).json({ error: 'Missing domain for maintenance mode. Please configure a production domain first.' });
    }
    if (action === 'deploy' && type !== 'preview') {
      return res.status(400).json({ error: 'Missing production domain. Cannot deploy/restore from maintenance without a domain.' });
    }
    return res.status(400).json({ error: 'Action không hợp lệ' });
  }

  console.log(`Executing [${action}] ${folderSafe || ''}: ${command}`);

  const onSuccess = (job) => {
    if (!folderSafe) return null;

    if (action === 'deploy' || action === 'update' || action === 'offair') {
      const currentMeta = getProjectMeta(folderSafe);
      const nextDomain = String(payload.domain || currentMeta.runtime?.domain || '').trim() || null;
      const nextPort = String(payload.port || currentMeta.runtime?.port || '').trim() || null;
      const maintenanceEndTime = payload.endTime ? new Date(payload.endTime).toISOString() : currentMeta.runtime?.maintenanceEndTime || null;
      patchProjectMeta(folderSafe, {
        lifecycle: action === 'offair' ? 'maintenance' : 'active',
        runtime: {
          domain: nextDomain,
          port: nextPort,
          maintenanceStartTime: action === 'offair' ? new Date().toISOString() : null,
          maintenanceEndTime: action === 'offair' ? maintenanceEndTime : null,
        },
      });
    }

    if (action === 'delete_soft') {
      const meta = applySoftDeleteMeta(folderSafe);
      return { lifecycle: meta.lifecycle, deleteMeta: meta.deleteMeta };
    }

    if (action === 'restore') {
      const meta = applyRestoreMeta(folderSafe);
      return { lifecycle: meta.lifecycle };
    }

    if (action === 'delete_hard') {
      const meta = applyHardDeleteMeta(folderSafe);
      return { lifecycle: meta.lifecycle, deleteMeta: meta.deleteMeta };
    }

    if (action === 'rollback_apply') {
      const preShaLine = (job.lines || []).find((line) => line.text.startsWith('__PRE_SHA__:'));
      const previousSha = preShaLine ? preShaLine.text.replace('__PRE_SHA__:', '').trim() : null;
      const current = getProjectMeta(folderSafe).rollbackMeta?.currentSha || null;
      const meta = patchProjectMeta(folderSafe, {
        rollbackMeta: {
          previousSha: previousSha || current,
          currentSha: sha,
          updatedAt: Date.now(),
        },
        lifecycle: 'active',
      });
      return {
        rollbackMeta: meta.rollbackMeta,
      };
    }

    return null;
  };

  if (!realtime) {
    exec(command, (error, stdout, stderr) => {
      if (error) {
        console.error(`Error: ${error.message}`);
        return res.status(500).json({
          error: error.message,
          stderr,
          stdout,
        });
      }
      return res.json({
        message: 'Thành công',
        stdout,
        stderr,
      });
    });
    return;
  }

  const job = runRealtimeJob({ command, action, folder: folderSafe, onSuccess });
  return res.json({ jobId: job.id, status: 'running', action, folder: folderSafe });
});

app.get('/api/jobs/:jobId', (req, res) => {
  const { jobId } = req.params;
  const from = Number.parseInt(String(req.query.from || '0'), 10);
  const job = jobs.get(jobId);

  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }

  const safeFrom = Number.isNaN(from) || from < 0 ? 0 : from;
  const relativeFrom = Math.max(0, safeFrom - job.baseOffset);
  const lines = job.lines.slice(relativeFrom);
  const nextOffset = job.baseOffset + relativeFrom + lines.length;

  return res.json({
    jobId,
    action: job.action,
    folder: job.folder,
    status: job.status,
    startedAt: job.startedAt,
    endedAt: job.endedAt,
    exitCode: job.exitCode,
    error: job.error,
    lines,
    nextOffset,
    meta: job.meta,
  });
});

app.get('/api/projects', (req, res) => {
  return res.json({
    projects: dashboardState.projects,
    serverTime: Date.now(),
    softDeleteTtlMs: SOFT_DELETE_TTL_MS,
  });
});

app.post('/api/projects/sync', (req, res) => {
  const folders = Array.isArray(req.body?.folders) ? req.body.folders : [];
  folders
    .map((folder) => normalizeFolder(folder))
    .filter(Boolean)
    .forEach((folder) => {
      getProjectMeta(folder);
    });

  saveState();
  return res.json({ ok: true, projects: dashboardState.projects });
});

app.get('/api/rollback/:folder/list', async (req, res) => {
  const folder = normalizeFolder(req.params.folder);
  if (!folder) {
    return res.status(400).json({ error: 'Invalid folder' });
  }

  try {
    const data = await refreshRollbackMeta(folder);
    return res.json({ folder, ...data });
  } catch (error) {
    return res.status(500).json({ error: error.error?.message || error.message || 'Cannot load rollback list' });
  }
});

app.get('/api/check-dns', async (req, res) => {
  const { domain } = req.query;
  if (!domain) return res.status(400).json({ error: 'Domain missing' });

  try {
    const [aResponse, cnameResponse] = await Promise.all([
      fetch(`https://cloudflare-dns.com/dns-query?name=${domain}&type=A`, {
        headers: { Accept: 'application/dns-json' },
      }),
      fetch(`https://cloudflare-dns.com/dns-query?name=${domain}&type=CNAME`, {
        headers: { Accept: 'application/dns-json' },
      }),
    ]);
    const aData = await aResponse.json();
    const cnameData = await cnameResponse.json();
    const aRecords = Array.isArray(aData.Answer) ? aData.Answer : [];
    const cnameRecords = Array.isArray(cnameData.Answer) ? cnameData.Answer : [];
    const cnameTarget = (cnameRecords[0]?.data || '').replace(/\.$/, '');
    const usesTunnel = cnameTarget.endsWith('.cfargotunnel.com');
    const hasRecord = aRecords.length > 0 || cnameRecords.length > 0;

    const tunnelRoute = await resolveTunnelRouteForDomain(domain);

    return res.json({
      status: hasRecord ? 'online' : 'offline',
      hasRecord,
      detail: hasRecord ? 'DNS is resolving' : 'No DNS records found',
      aRecords,
      cnameRecords,
      cnameTarget,
      tunnelDetected: usesTunnel,
      checkCommand: `nslookup -type=CNAME ${domain}`,
      tunnelRoute,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.get('/api/domains/catalog', async (req, res) => {
  try {
    const catalog = await getDomainCatalog(false);
    return res.json(catalog);
  } catch (error) {
    const fallback = domainCatalogCache?.data || { baseDomains: [], fqdnExamples: [], sourceMeta: { fallback: true, updatedAt: Date.now() } };
    return res.status(200).json({
      ...fallback,
      warning: error.message || 'Cannot load domain catalog',
    });
  }
});

app.get('/api/ports/check', async (req, res) => {
  const port = normalizePortNumber(req.query.port);
  if (!port) {
    return res.status(400).json({ error: 'Invalid port' });
  }

  const stateConflict = Object.entries(dashboardState.projects || {}).find(([, meta]) => {
    const runtimePort = normalizePortNumber(meta?.runtime?.port);
    return runtimePort === port && meta?.lifecycle !== 'deleted';
  });
  if (stateConflict) {
    return res.json({
      port,
      available: false,
      source: 'dashboard-state',
      owner: stateConflict[0],
    });
  }

  try {
    const { stdout } = await execPromise(`docker ps --format '{{.Names}}\\t{{.Ports}}'`, { timeout: 8000 });
    const match = String(stdout || '')
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [name, ports = ''] = line.split('\t');
        return { name, ports };
      })
      .find((entry) => new RegExp(`(?:0\\.0\\.0\\.0|::|127\\.0\\.0\\.1|\\[::\\]):${port}->|:${port}->`).test(entry.ports));

    if (match) {
      return res.json({
        port,
        available: false,
        source: 'docker',
        owner: match.name,
        detail: match.ports,
      });
    }

    return res.json({ port, available: true });
  } catch (error) {
    return res.status(500).json({ error: error.error?.message || error.message || 'Cannot inspect Docker ports' });
  }
});

app.post('/api/domains/reload', async (req, res) => {
  try {
    const catalog = await getDomainCatalog(true);
    return res.json(catalog);
  } catch (error) {
    const fallback = domainCatalogCache?.data || { baseDomains: [], fqdnExamples: [], sourceMeta: { fallback: true, updatedAt: Date.now() } };
    return res.status(200).json({
      ...fallback,
      warning: error.message || 'Cannot reload domain catalog',
    });
  }
});

app.get('/api/self/info', (req, res) => {
  return res.json({
    enabled: SELF_UPDATE_ENABLED && Boolean(SELF_UPDATE_FOLDER),
    folder: SELF_UPDATE_FOLDER || null,
    action: 'update',
  });
});

app.post('/api/self/update', async (req, res) => {
  if (!SELF_UPDATE_ENABLED || !SELF_UPDATE_FOLDER) {
    return res.status(403).json({ error: 'Self update is disabled' });
  }

  const folderSafe = normalizeFolder(SELF_UPDATE_FOLDER);
  if (!folderSafe) {
    return res.status(400).json({ error: 'Cannot build self-update command' });
  }

  const command = `${detectPathsCommand(folderSafe)} \\
${ensureSafeGitDirectoryCommand} && cd $REPO_PATH && git pull && \\
if [ -f manager.sh ]; then cp manager.sh ${shellQuote(path.join(BASE_PATH, 'manager.sh'))} && chmod +x ${shellQuote(path.join(BASE_PATH, 'manager.sh'))} && chown "$(stat -c '%u:%g' ${shellQuote(BASE_PATH)})" ${shellQuote(path.join(BASE_PATH, 'manager.sh'))}; fi && \\
cd $ROOT_PATH && docker compose up -d --build --remove-orphans`;
  const jobId = randomUUID();
  const runnerName = `pdl-dashboard-self-update-${jobId.slice(0, 8)}`;
  const volumeArgs = [
    `-v ${shellQuote('/var/run/docker.sock:/var/run/docker.sock')}`,
    `-v ${shellQuote(`${BASE_PATH}:${BASE_PATH}`)}`,
    SRV_WEBS_PATH === BASE_PATH ? '' : `-v ${shellQuote(`${SRV_WEBS_PATH}:${SRV_WEBS_PATH}`)}`,
  ].filter(Boolean).join(' ');
  const launcher = `docker run -d --rm --name ${runnerName} ${volumeArgs} -w ${shellQuote(BASE_PATH)} pdl-dashboard-backend:latest sh -lc ${shellQuote(command)}`;

  try {
    await execPromise(launcher, { timeout: 15000 });
    patchProjectMeta(folderSafe, { lifecycle: 'active' });
  } catch (error) {
    return res.status(500).json({ error: error.error?.message || error.message || 'Cannot start self-update runner' });
  }

  return res.json({
    jobId,
    status: 'running',
    action: 'update',
    folder: folderSafe,
    self: true,
    detached: true,
    runner: runnerName,
  });
});

app.listen(PORT, () => {
  console.log(`Dashboard Backend running at http://localhost:${PORT}`);
});

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';

const API_BASE = `http://${window.location.hostname}:3001`;
const SERVER_SYNC_INTERVAL_MS = 15000;
const TOAST_TTL_MS = 4000;
const MAX_ACTIVITY_ITEMS = 80;
const MAX_TOAST_ITEMS = 4;
const DEFAULT_TUNNEL_ID = 'db4d8d27-c08c-4e42-9afe-b458950b7bb5';
const TAG_COLOR_OPTIONS = ['#2563EB', '#7C3AED', '#DB2777', '#DC2626', '#EA580C', '#CA8A04', '#16A34A', '#0D9488', '#0891B2', '#4B5563'];

const DEFAULT_PROJECTS = [
  { id: 1, name: 'Web MML', repo: 'horaus/mml', folder: 'mml', type: 'Production Environment', status: 'online', endpoint: '192.168.1.104' },
  { id: 2, name: 'ERPNext', repo: 'horaus/erpnext', folder: 'erp', type: 'Enterprise Suite', status: 'online', endpoint: 'erp.internal.local' },
  { id: 3, name: 'Yacht Builder Pro', repo: 'Horaus/yacht-builder-pro', folder: 'yacht-builder-pro', type: 'Design Cluster', status: 'online', endpoint: '10.0.4.22' },
  { id: 4, name: 'Portfolio V3', repo: 'Horaus/portfolio-v3', folder: 'portfolio-v3', type: 'Static Hosting', status: 'online', endpoint: 'cdn.px-v3.net' },
];

// --- Sub-components ---

const Toast = ({ id, message, type, onClose }) => {
  useEffect(() => {
    const timer = setTimeout(onClose, TOAST_TTL_MS);
    return () => clearTimeout(timer);
  }, [onClose]);

  const colorClass = type === 'success' ? 'text-emerald-600 border-emerald-500/20 bg-emerald-50' : type === 'error' ? 'text-red-600 border-red-500/20 bg-red-50' : 'text-primary border-primary/20 bg-primary/5';

  return (
    <div className={`flex items-center gap-3 rounded-xl border px-4 py-3 text-xs font-bold shadow-xl animate-in slide-in-from-right-8 duration-300 ${colorClass}`}>
      <span className="material-symbols-outlined text-sm">{type === 'success' ? 'check_circle' : type === 'error' ? 'report' : 'info'}</span>
      <span>{message}</span>
    </div>
  );
};

const ModalWrapper = ({ title, onClose, children }) => (
  <div className="fixed inset-0 z-[100] flex items-center justify-center bg-on-surface/45 p-2 sm:p-4 animate-in fade-in duration-150">
    <div className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-surface-container-lowest shadow-2xl ring-1 ring-outline-variant/10 scale-in-center">
      <div className="flex shrink-0 items-center justify-between border-b border-surface-container px-4 py-3 sm:px-6 sm:py-4">
        <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-on-surface-variant font-headline">{title}</h3>
        <button onClick={onClose} className="rounded-full p-2 text-outline-variant hover:bg-surface-container transition-colors">
          <span className="material-symbols-outlined text-sm">close</span>
        </button>
      </div>
      <div className="overflow-y-auto p-3 sm:p-6">{children}</div>
    </div>
  </div>
);

const NavItem = ({ icon, label, active = false }) => (
  <a className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${active ? 'text-primary font-bold bg-white shadow-sm ring-1 ring-outline-variant/5' : 'text-on-surface/60 hover:bg-surface-container-high hover:text-on-surface'}`} href="#">
    <span className="material-symbols-outlined text-[20px]">{icon}</span>
    <span className="text-xs uppercase tracking-widest">{label}</span>
  </a>
);

const Metric = ({ label, value, detail }) => (
  <div className="space-y-1">
    <span className="text-[10px] font-extrabold uppercase tracking-[0.2em] text-outline">{label}</span>
    <div className="flex items-baseline gap-3">
      <h2 className="text-7xl font-extrabold tracking-tighter text-on-surface leading-none">{value}</h2>
      {detail}
    </div>
  </div>
);

const ProjectCard = React.memo(({ project, onSync, onOpenBack, onOpenSettings, onOpenDelete, isBusy }) => {
  const lifecycle = project.lifecycle || 'active';
  const badgeText = lifecycle === 'maintenance' ? 'Maintenance' : (project.status || 'Online');
  const badgeClass = lifecycle === 'maintenance' ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-600';
  const maintenanceEndTs = project.runtime?.maintenanceEndTime ? Date.parse(project.runtime.maintenanceEndTime) : NaN;
  const maintenanceStartTs = project.runtime?.maintenanceStartTime ? Date.parse(project.runtime.maintenanceStartTime) : NaN;
  const nowTs = Date.now();
  const hasMaintenanceWindow = lifecycle === 'maintenance' && Number.isFinite(maintenanceEndTs) && maintenanceEndTs > nowTs;
  const totalWindow = Number.isFinite(maintenanceStartTs) && maintenanceEndTs > maintenanceStartTs ? maintenanceEndTs - maintenanceStartTs : 0;
  const elapsed = totalWindow > 0 ? Math.min(totalWindow, Math.max(0, nowTs - maintenanceStartTs)) : 0;
  const progressPercent = totalWindow > 0 ? Math.max(0, Math.min(100, (elapsed / totalWindow) * 100)) : 0;
  const remainingMs = hasMaintenanceWindow ? maintenanceEndTs - nowTs : 0;
  const remainingMin = Math.max(0, Math.ceil(remainingMs / 60000));

  return (
  <div className="group bg-surface-container-lowest p-4 sm:p-5 rounded-2xl hover:shadow-2xl hover:shadow-on-surface/5 transition-all duration-500 ring-1 ring-outline-variant/10 hover:ring-primary/20">
    <div className="flex justify-between items-start mb-4">
      <span className={`px-2 py-1 text-[9px] font-black rounded uppercase tracking-wider ${badgeClass}`}>
        {badgeText}
      </span>
      <div className="flex gap-1.5 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity duration-100">
        <button disabled={isBusy} onClick={() => onSync(project)} className="group/ctrl relative inline-flex h-8 w-8 items-center justify-center rounded-lg text-on-surface hover:text-primary transition-colors duration-100 hover:bg-primary/5 disabled:opacity-40">
          <span className="material-symbols-outlined text-sm">sync</span>
          <span className="pointer-events-none absolute -bottom-7 left-1/2 -translate-x-1/2 rounded bg-black px-2 py-0.5 text-[10px] font-bold text-white opacity-0 transition-opacity duration-75 group-hover/ctrl:opacity-100">Update</span>
        </button>
        <button disabled={isBusy} onClick={() => onOpenBack(project)} className="group/ctrl relative inline-flex h-8 w-8 items-center justify-center rounded-lg text-on-surface hover:text-primary transition-colors duration-100 hover:bg-primary/5 disabled:opacity-40">
          <span className="material-symbols-outlined text-sm">settings_backup_restore</span>
          <span className="pointer-events-none absolute -bottom-7 left-1/2 -translate-x-1/2 rounded bg-black px-2 py-0.5 text-[10px] font-bold text-white opacity-0 transition-opacity duration-75 group-hover/ctrl:opacity-100">Backversion</span>
        </button>
        <button disabled={isBusy} onClick={() => onOpenSettings(project)} className="group/ctrl relative inline-flex h-8 w-8 items-center justify-center rounded-lg text-on-surface hover:text-primary transition-colors duration-100 hover:bg-primary/5 disabled:opacity-40">
          <span className="material-symbols-outlined text-sm">settings</span>
          <span className="pointer-events-none absolute -bottom-7 left-1/2 -translate-x-1/2 rounded bg-black px-2 py-0.5 text-[10px] font-bold text-white opacity-0 transition-opacity duration-75 group-hover/ctrl:opacity-100">Config</span>
        </button>
        <button disabled={isBusy} onClick={() => onOpenDelete(project)} className="group/ctrl relative ml-0.5 inline-flex h-8 w-8 items-center justify-center rounded-lg bg-red-600 text-[8px] font-black uppercase leading-none text-white shadow-lg shadow-red-600/20 transition-colors duration-100 disabled:opacity-40">
          DEL
          <span className="pointer-events-none absolute -bottom-7 left-1/2 -translate-x-1/2 rounded bg-black px-2 py-0.5 text-[10px] font-bold text-white opacity-0 transition-opacity duration-75 group-hover/ctrl:opacity-100">Delete</span>
        </button>
      </div>
    </div>
    <h4 className="text-base sm:text-lg font-bold tracking-tight mb-1 group-hover:text-primary transition-colors">{project.name}</h4>
    <p className="text-[11px] sm:text-xs text-on-surface-variant mb-4 sm:mb-5 font-medium uppercase tracking-wide">{project.type}</p>
    {Array.isArray(project.tags) && project.tags.length > 0 ? (
      <div className="mb-4 flex flex-wrap gap-1.5">
        {project.tags.slice(0, 4).map((tag) => (
          <span
            key={`${project.folder}-${tag.name}`}
            className="rounded-md px-2 py-0.5 text-[9px] font-black uppercase tracking-wider ring-1"
            style={{ backgroundColor: `${tag.color || '#4B5563'}26`, color: tag.color || '#4B5563', borderColor: `${tag.color || '#4B5563'}66` }}
          >
            {tag.name}
          </span>
        ))}
      </div>
    ) : null}
    {hasMaintenanceWindow ? (
      <div className="mb-4 rounded-xl border border-amber-300/50 bg-amber-50/70 p-2">
        <div className="mb-1 flex items-center justify-between text-[10px] font-black uppercase tracking-widest text-amber-700">
          <span>Maintenance Remaining</span>
          <span>{remainingMin}m</span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-amber-100">
          <div className="h-full bg-amber-500 transition-all duration-500" style={{ width: `${progressPercent}%` }} />
        </div>
      </div>
    ) : null}
    <div className="pt-4 border-t border-surface-container">
      <p className="text-[10px] font-mono text-outline uppercase tracking-tighter">Production Node</p>
      <p className="text-sm font-semibold truncate text-on-surface/80">{project.productionUrl || project.endpoint || 'Initializing...'}</p>
    </div>
  </div>
  );
});

// --- Main App ---

function App() {
  const [isDark, setIsDark] = useState(() => localStorage.getItem('pdl_theme') === 'dark');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [, setClockTick] = useState(0);
  const [projects, setProjects] = useState(() => {
    const saved = localStorage.getItem('pdl_projects');
    return saved ? JSON.parse(saved) : DEFAULT_PROJECTS;
  });
  const [searchTerm, setSearchTerm] = useState('');
  const [toasts, setToasts] = useState([]);
  const [serverMeta, setServerMeta] = useState({});
  const [isBusy, setIsBusy] = useState(false);
  
  // Modal states
  const [selectedProject, setSelectedProject] = useState(null);
  const [showNewModal, setShowNewModal] = useState(false);
  const [deleteModal, setDeleteModal] = useState(null);
  const [rollbackModal, setRollbackModal] = useState(null);
  const [commits, setCommits] = useState([]);
  const [commitsLoading, setCommitsLoading] = useState(false);
  const [activityEvents, setActivityEvents] = useState([]);
  const [dnsChecking, setDnsChecking] = useState(false);
  const [dnsStatus, setDnsStatus] = useState(null);
  const [domainCatalog, setDomainCatalog] = useState({ baseDomains: [], fqdnExamples: [], sourceMeta: null });
  const [domainCatalogLoading, setDomainCatalogLoading] = useState(false);
  const [activeTagFilter, setActiveTagFilter] = useState('all');
  const [tagDraft, setTagDraft] = useState('');
  const [tagColorDraft, setTagColorDraft] = useState(TAG_COLOR_OPTIONS[0]);
  const [selfUpdateTarget, setSelfUpdateTarget] = useState({ enabled: false, folder: '' });
  const toastDedupRef = useRef(new Map());

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark);
    localStorage.setItem('pdl_theme', isDark ? 'dark' : 'light');
  }, [isDark]);

  useEffect(() => {
    const timer = setInterval(() => setClockTick((prev) => prev + 1), 30000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    localStorage.setItem('pdl_projects', JSON.stringify(projects));
    fetch(`${API_BASE}/api/projects/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folders: projects.map((project) => project.folder) }),
    }).catch(() => {});
  }, [projects]);

  const addToast = useCallback((msg, type = 'info') => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setToasts((prev) => [...prev, { id, message: msg, type }].slice(-MAX_TOAST_ITEMS));
  }, []);

  const syncProjectsMeta = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/projects`);
      const data = await res.json();
      if (data.projects) setServerMeta(data.projects);
    } catch (error) {
      // Silent background refresh for UI state.
    }
  }, []);

  useEffect(() => {
    syncProjectsMeta();
    const interval = setInterval(syncProjectsMeta, SERVER_SYNC_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [syncProjectsMeta]);

  const loadDomainCatalog = useCallback(async (forceReload = false) => {
    setDomainCatalogLoading(true);
    try {
      const endpoint = forceReload ? `${API_BASE}/api/domains/reload` : `${API_BASE}/api/domains/catalog`;
      const method = forceReload ? 'POST' : 'GET';
      const res = await fetch(endpoint, { method });
      const data = await res.json();
      if (res.ok) {
        setDomainCatalog({
          baseDomains: Array.isArray(data.baseDomains) ? data.baseDomains : [],
          fqdnExamples: Array.isArray(data.fqdnExamples) ? data.fqdnExamples : [],
          sourceMeta: data.sourceMeta || null,
        });
      }
    } catch (error) {
      addToast(`Domain catalog load failed: ${error.message}`, 'error');
    } finally {
      setDomainCatalogLoading(false);
    }
  }, [addToast]);

  useEffect(() => {
    loadDomainCatalog(false);
  }, [loadDomainCatalog]);

  useEffect(() => {
    fetch(`${API_BASE}/api/self/info`)
      .then((r) => r.json())
      .then((data) => {
        setSelfUpdateTarget({
          enabled: Boolean(data?.enabled),
          folder: String(data?.folder || ''),
        });
      })
      .catch(() => {
        setSelfUpdateTarget({ enabled: false, folder: '' });
      });
  }, []);

  const addActivity = useCallback((entry) => {
    const item = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      icon: entry.icon || 'terminal',
      message: entry.message || 'System event',
      target: entry.target || '',
      color: entry.color || 'text-primary',
      time: entry.time || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };
    setActivityEvents((prev) => [item, ...prev].slice(0, MAX_ACTIVITY_ITEMS));
  }, []);

  const prettyAction = (action) => {
    if (action === 'update') return 'Update';
    if (action === 'offair') return 'Maintenance';
    if (action === 'deploy') return 'Deploy';
    if (action === 'rollback_apply') return 'Backversion';
    if (action === 'delete_hard') return 'Delete';
    return action;
  };

  const addDetailedLineToast = useCallback((folder, line) => {
    if (!line?.text) return;
    const text = String(line.text || '').trim();
    if (!text) return;
    const isError = line.stream === 'stderr';
    const importantStdout = /(started|running|completed|built|failed|error|warning|stopped|recreated|pull|deploy|update)/i.test(text);
    if (!isError && !importantStdout) return;

    const shortText = text.length > 96 ? `${text.slice(0, 96)}...` : text;
    const key = `${folder}:${line.stream}:${shortText}`;
    const now = Date.now();
    const lastTs = toastDedupRef.current.get(key) || 0;
    if (now - lastTs < 3500) return;

    toastDedupRef.current.set(key, now);
    // Cleanup stale fingerprints to keep memory bounded.
    for (const [existingKey, ts] of toastDedupRef.current.entries()) {
      if (now - ts > 20000) toastDedupRef.current.delete(existingKey);
    }

    addToast(`[${folder}] ${shortText}`, isError ? 'error' : 'info');
  }, [addToast]);

  const pollJob = useCallback(async (jobId, action, folder) => {
    let nextOffset = 0;
    let done = false;
    let attempts = 0;

    while (!done && attempts < 180) {
      attempts += 1;
      try {
        const res = await fetch(`${API_BASE}/api/jobs/${jobId}?from=${nextOffset}`);
        const data = await res.json();
        if (!res.ok) {
          addActivity({
            icon: 'error',
            message: `Job ${prettyAction(action)} status failed`,
            target: folder,
            color: 'text-red-600',
          });
          return;
        }

        const lines = Array.isArray(data.lines) ? data.lines : [];
        lines.forEach((line) => addDetailedLineToast(folder, line));

        nextOffset = Number(data.nextOffset || nextOffset);
        if (data.status && data.status !== 'running') {
          done = true;
          const success = data.status === 'success';
          await syncProjectsMeta();
          addActivity({
            icon: success ? 'check_circle' : 'error',
            message: success ? `${prettyAction(action)} completed` : `${prettyAction(action)} failed`,
            target: folder,
            color: success ? 'text-emerald-500' : 'text-red-600',
          });
        } else {
          await new Promise((resolve) => setTimeout(resolve, 1500));
        }
      } catch (error) {
        addToast(`Job polling error on ${folder}: ${error.message}`, 'error');
        addActivity({
          icon: 'error',
          message: `Job polling error: ${error.message}`,
          target: folder,
          color: 'text-red-600',
        });
        return;
      }
    }
  }, [addActivity, addDetailedLineToast, addToast, syncProjectsMeta]);

  const normalizeHost = (value) => {
    const raw = String(value || '').trim();
    if (!raw) return '';
    try {
      const parsed = new URL(raw.includes('://') ? raw : `https://${raw}`);
      return parsed.hostname;
    } catch {
      return raw.replace(/^https?:\/\//i, '').split('/')[0];
    }
  };

  const isIPv4 = (host) => /^(\d{1,3}\.){3}\d{1,3}$/.test(host);
  const isDomainLike = (host) => host.includes('.') && !isIPv4(host);

  const resolveProductionDomain = (project) => {
    const hostCandidates = [
      project?.runtime?.domain,
      project?.productionDomain,
      project?.productionUrl,
      project?.endpoint,
    ]
      .map(normalizeHost)
      .filter(Boolean);

    return hostCandidates.find(isDomainLike) || '';
  };

  const getBaseDomain = (fqdn) => {
    const host = normalizeHost(fqdn);
    if (!host) return '';
    const matchingBase = [...(domainCatalog.baseDomains || [])]
      .sort((a, b) => b.length - a.length)
      .find((base) => host === base || host.endsWith(`.${base}`));
    if (matchingBase) return matchingBase;
    const labels = host.split('.').filter(Boolean);
    if (labels.length < 2) return '';
    return labels.slice(-2).join('.');
  };

  const buildFqdn = (baseDomain, subdomain) => {
    const base = normalizeHost(baseDomain || '');
    const sub = String(subdomain || '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
    if (!base) return '';
    return sub ? `${sub}.${base}` : base;
  };

  const normalizeTagName = (value) => String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const formatTagName = (value) => {
    const normalized = normalizeTagName(value);
    return normalized ? normalized.replace(/\b\w/g, (m) => m.toUpperCase()) : '';
  };
  const getProjectTags = (project) => {
    const tags = Array.isArray(project?.tags) ? project.tags : [];
    const seen = new Set();
    return tags
      .map((tag) => ({
        name: formatTagName(tag?.name || ''),
        color: TAG_COLOR_OPTIONS.includes(tag?.color) ? tag.color : TAG_COLOR_OPTIONS[0],
      }))
      .filter((tag) => {
        const key = normalizeTagName(tag.name);
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  };

  const parseTunnelIdFromTarget = (target) => {
    const normalized = normalizeHost(target || '');
    if (!normalized.endsWith('.cfargotunnel.com')) return '';
    return normalized.replace(/\.cfargotunnel\.com$/i, '');
  };

  const updateProjectDraft = (key, value) => {
    setSelectedProject((prev) => (prev ? { ...prev, [key]: value } : prev));
  };

  const saveProjectSettings = () => {
    if (!selectedProject?.folder) return;
    setProjects((prev) =>
      prev.map((project) => {
        if (project.folder !== selectedProject.folder) return project;
        return {
          ...project,
          repo: selectedProject.repo || project.repo,
          endpoint: normalizeHost(selectedProject.fqdn || selectedProject.endpoint || selectedProject.productionDomain || project.endpoint),
          productionDomain: normalizeHost(selectedProject.fqdn || selectedProject.productionDomain || selectedProject.endpoint || project.productionDomain),
          baseDomain: selectedProject.baseDomain || project.baseDomain || '',
          subdomain: selectedProject.subdomain || project.subdomain || '',
          fqdn: selectedProject.fqdn || project.fqdn || '',
          maintenanceEndTime: selectedProject.maintenanceEndTime || project.maintenanceEndTime || '',
          tags: getProjectTags(selectedProject),
        };
      }),
    );
    addToast(`Saved settings for ${selectedProject.folder}`, 'success');
  };

  const copyText = async (text, label = 'Value') => {
    try {
      const value = String(text || '').trim();
      if (!value) {
        addToast(`${label} is empty`, 'error');
        return;
      }

      const fallbackCopy = () => {
        const textarea = document.createElement('textarea');
        textarea.value = value;
        textarea.setAttribute('readonly', 'readonly');
        textarea.style.position = 'fixed';
        textarea.style.top = '-9999px';
        textarea.style.left = '-9999px';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        textarea.setSelectionRange(0, textarea.value.length);
        const copied = document.execCommand('copy');
        document.body.removeChild(textarea);
        return copied;
      };

      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(value);
      } else {
        const copied = fallbackCopy();
        if (!copied) throw new Error('Clipboard not available in this browser context');
      }

      addToast(`Copied ${label}`, 'success');
    } catch (error) {
      addToast(`Copy failed: ${error.message}`, 'error');
    }
  };

  const checkDns = async () => {
    const domain = normalizeHost(selectedProject?.fqdn || resolveProductionDomain(selectedProject));
    if (!domain) {
      setDnsStatus({ ok: false, check: 'failed', detail: 'Please enter production domain first.' });
      return;
    }
    setDnsChecking(true);
    try {
      const res = await fetch(`${API_BASE}/api/check-dns?domain=${encodeURIComponent(domain)}`);
      const data = await res.json();
      if (data.error) {
        setDnsStatus({ ok: false, check: 'failed', detail: data.error });
      } else {
        const hasRecord = typeof data.hasRecord === 'boolean' ? data.hasRecord : data.status === 'online';
        const tunnelId =
          data?.tunnelRoute?.tunnelId ||
          parseTunnelIdFromTarget(data?.cnameTarget) ||
          '';
        setDnsStatus({
          ok: Boolean(hasRecord),
          check: hasRecord ? 'ok' : 'failed',
          detail: hasRecord ? '' : `No DNS record found for ${domain}`,
          tunnelId,
          tunnelTarget: tunnelId ? `${tunnelId}.cfargotunnel.com` : '',
        });
      }
    } catch (error) {
      setDnsStatus({ ok: false, check: 'failed', detail: error.message });
    } finally {
      setDnsChecking(false);
    }
  };

  const executeAction = async (folder, action, params = {}) => {
    if (isBusy) return;
    setIsBusy(true);
    addToast(`Triggering ${action} on ${folder}...`);
    addActivity({
      icon: 'play_circle',
      message: `${prettyAction(action)} running`,
      target: folder,
      color: 'text-primary',
    });
    try {
      const res = await fetch(`${API_BASE}/api/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, folder, realtime: true, ...params }),
      });
      const data = await res.json();
      if (data.jobId) {
        addToast(`Action ${action} initialized`, 'success');
        pollJob(data.jobId, action, folder);
      } else {
        const errText = data.error || 'Request failed';
        addToast(errText, 'error');
        addActivity({
          icon: 'error',
          message: errText,
          target: folder,
          color: 'text-red-600',
        });
      }
    } catch (e) {
      addToast(e.message, 'error');
      addActivity({
        icon: 'error',
        message: e.message,
        target: folder,
        color: 'text-red-600',
      });
    } finally {
      setIsBusy(false);
    }
  };

  const runSelfUpdate = async () => {
    if (!selfUpdateTarget.enabled || !selfUpdateTarget.folder) {
      addToast('Self-update chưa được bật ở backend', 'error');
      return;
    }

    if (isBusy) return;
    setIsBusy(true);
    addToast(`Triggering self-update on ${selfUpdateTarget.folder}...`);
    addActivity({
      icon: 'system_update',
      message: 'Self update running',
      target: selfUpdateTarget.folder,
      color: 'text-primary',
    });

    try {
      const res = await fetch(`${API_BASE}/api/self/update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json();

      if (!res.ok || !data.jobId) {
        const errText = data.error || 'Self-update request failed';
        addToast(errText, 'error');
        addActivity({
          icon: 'error',
          message: errText,
          target: selfUpdateTarget.folder,
          color: 'text-red-600',
        });
        return;
      }

      addToast('Self-update đã bắt đầu. Dashboard có thể ngắt kết nối tạm thời trong lúc restart.', 'success');
      const waitForSelfRecovery = async () => {
        const maxAttempts = 80; // ~3m20s with 2.5s interval
        for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
          await new Promise((resolve) => setTimeout(resolve, 2500));
          try {
            const ping = await fetch(`${API_BASE}/api/self/info`, { cache: 'no-store' });
            if (!ping.ok) continue;

            addToast('Dashboard backend đã online lại sau self-update.', 'success');
            addActivity({
              icon: 'check_circle',
              message: 'Self update completed',
              target: selfUpdateTarget.folder,
              color: 'text-emerald-500',
            });
            syncProjectsMeta();
            return;
          } catch {
            // Expected while container is restarting.
          }
        }

        addToast('Self-update đã chạy nhưng backend chưa phản hồi lại. Hãy refresh sau 1-2 phút.', 'error');
        addActivity({
          icon: 'error',
          message: 'Self update timeout waiting for backend',
          target: selfUpdateTarget.folder,
          color: 'text-red-600',
        });
      };

      waitForSelfRecovery();
    } catch (error) {
      addToast(`Self-update error: ${error.message}`, 'error');
      addActivity({
        icon: 'error',
        message: error.message,
        target: selfUpdateTarget.folder,
        color: 'text-red-600',
      });
    } finally {
      setIsBusy(false);
    }
  };

  const filteredProjects = useMemo(() => {
    const keyword = searchTerm.toLowerCase();
    return projects.filter((p) => {
      const matchesSearch = p.name.toLowerCase().includes(keyword) || String(p.folder || '').toLowerCase().includes(keyword);
      const matchesTag = activeTagFilter === 'all' || getProjectTags(p).some((tag) => normalizeTagName(tag.name) === activeTagFilter);
      return matchesSearch && matchesTag;
    });
  }, [projects, searchTerm, activeTagFilter]);
  const mergedFilteredProjects = useMemo(
    () => filteredProjects.map((project) => ({ ...project, ...(serverMeta[project.folder] || {}) })),
    [filteredProjects, serverMeta],
  );
  const tagCatalog = useMemo(() => {
    const map = new Map();
    projects.forEach((project) => {
      getProjectTags(project).forEach((tag) => {
        const key = normalizeTagName(tag.name);
        const current = map.get(key) || { key, name: tag.name, color: tag.color, count: 0 };
        current.count += 1;
        if (!current.color && tag.color) current.color = tag.color;
        map.set(key, current);
      });
    });
    return Array.from(map.values()).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }, [projects]);

  const openRollbackModal = useCallback((project) => {
    setRollbackModal(project);
    setCommitsLoading(true);
    fetch(`${API_BASE}/api/rollback/${project.folder}/list`)
      .then((r) => r.json())
      .then((d) => {
        setCommits(d.commits || []);
        setCommitsLoading(false);
      });
  }, []);

  const openSettingsModal = useCallback((project) => {
    const resolvedDomain = normalizeHost(project.fqdn || project.productionDomain || project.endpoint || project.runtime?.domain || '');
    const baseFromDomain = project.baseDomain || getBaseDomain(resolvedDomain);
    const subFromDomain =
      project.subdomain ||
      (baseFromDomain && resolvedDomain.endsWith(`.${baseFromDomain}`)
        ? resolvedDomain.slice(0, -1 * (`.${baseFromDomain}`).length)
        : resolvedDomain);
    setSelectedProject({
      ...project,
      repo: project.repo || '',
      endpoint: resolvedDomain,
      productionDomain: resolvedDomain,
      baseDomain: baseFromDomain,
      subdomain: subFromDomain === resolvedDomain ? '' : subFromDomain,
      fqdn: resolvedDomain,
      maintenanceEndTime: project.maintenanceEndTime || '',
      tags: getProjectTags(project),
    });
    setTagDraft('');
    setTagColorDraft(TAG_COLOR_OPTIONS[0]);
    setDnsStatus(null);
  }, []);

  const runUpdateQuickAction = useCallback((project) => {
    executeAction(project.folder, 'update');
  }, []);

  const persistProjectTags = useCallback((folder, nextTags) => {
    const safeTags = getProjectTags({ tags: nextTags });
    setProjects((prev) =>
      prev.map((project) => (project.folder === folder ? { ...project, tags: safeTags } : project)),
    );
    setServerMeta((prev) => ({
      ...prev,
      [folder]: {
        ...(prev[folder] || {}),
        tags: safeTags,
      },
    }));
  }, []);

  const addTagToSelectedProject = () => {
    if (!selectedProject) return;
    const tagName = formatTagName(tagDraft);
    if (!tagName) {
      addToast('Tag name is empty', 'error');
      return;
    }
    const key = normalizeTagName(tagName);
    const currentTags = getProjectTags(selectedProject);
    if (currentTags.some((tag) => normalizeTagName(tag.name) === key)) {
      addToast('Tag already exists', 'error');
      return;
    }
    const nextTags = [...currentTags, { name: tagName, color: tagColorDraft }];
    persistProjectTags(selectedProject.folder, nextTags);
    setSelectedProject((prev) => ({ ...prev, tags: nextTags }));
    setTagDraft('');
    addToast(`Added tag ${tagName} (saved)`, 'success');
  };

  const removeTagFromSelectedProject = (tagName) => {
    if (!selectedProject) return;
    const key = normalizeTagName(tagName);
    const nextTags = getProjectTags(selectedProject).filter((tag) => normalizeTagName(tag.name) !== key);
    persistProjectTags(selectedProject.folder, nextTags);
    setSelectedProject((prev) => ({ ...prev, tags: nextTags }));
    addToast(`Removed tag ${formatTagName(tagName)} (saved)`, 'success');
  };

  const guideSubdomain = String(selectedProject?.subdomain || '').trim().toLowerCase() || '@';
  const guideTunnelId = dnsStatus?.tunnelId || DEFAULT_TUNNEL_ID;
  const guideTunnelTarget = `${guideTunnelId}.cfargotunnel.com`;

  return (
    <div className="min-h-screen bg-surface">
      {/* SideNavBar */}
      <aside className={`h-full w-64 fixed left-0 top-0 flex flex-col p-5 bg-surface-container-low z-50 border-r border-outline-variant/10 transition-transform duration-200 ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'} lg:translate-x-0`}>
        <div className="mb-12">
          <div className="flex items-center gap-2 mb-1">
             <div className="h-2 w-2 rounded-full bg-primary shadow-[0_0_10px_rgba(0,123,255,100)]" />
             <h1 className="text-xl font-black tracking-tighter text-on-surface uppercase">Pristine</h1>
          </div>
          <p className="text-[10px] uppercase tracking-[0.2em] text-on-surface-variant font-bold">System Terminal</p>
        </div>
        <nav className="flex-1 space-y-1.5">
          <NavItem icon="dashboard" label="Dashboard" active />
          <NavItem icon="developer_board" label="Infrastructure" />
          <NavItem icon="security" label="Security & DNS" />
        </nav>
        <div className="mt-auto pt-6 space-y-4">
          <button onClick={() => setShowNewModal(true)} className="w-full py-4 px-4 metric-gradient text-white rounded-2xl text-[10px] font-black uppercase tracking-[0.2em] shadow-lg shadow-primary/20 hover:opacity-90 active:scale-95 transition-all flex items-center justify-center gap-2">
            <span className="material-symbols-outlined text-[16px] font-black">add</span>
            New Deployment
          </button>
          <button onClick={() => setIsDark(!isDark)} className="w-full py-3 px-4 bg-surface-container-high text-on-surface-variant rounded-2xl text-[10px] font-bold uppercase tracking-widest hover:bg-surface-variant transition-colors flex items-center justify-center gap-2">
            <span className="material-symbols-outlined text-sm">{isDark ? 'light_mode' : 'dark_mode'}</span>
            {isDark ? 'Light' : 'Dark'} Mode
          </button>
        </div>
      </aside>
      {isSidebarOpen ? (
        <button
          aria-label="Close sidebar"
          onClick={() => setIsSidebarOpen(false)}
          className="fixed inset-0 z-40 bg-black/30 lg:hidden"
        />
      ) : null}

      {/* TopNavBar */}
      <header className="fixed top-0 right-0 left-0 lg:left-64 z-40 bg-surface/90 backdrop-blur-md flex justify-between items-center px-4 sm:px-6 lg:px-8 py-3 sm:py-4 border-b border-outline-variant/10">
        <div className="flex items-center flex-1 max-w-3xl gap-2 sm:gap-3">
          <button
            onClick={() => setIsSidebarOpen(true)}
            className="inline-flex lg:hidden h-10 w-10 items-center justify-center rounded-xl bg-surface-container-low ring-1 ring-outline-variant/20"
          >
            <span className="material-symbols-outlined text-base">menu</span>
          </button>
          <div className="relative w-full group">
            <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-outline-variant text-sm group-focus-within:text-primary transition-colors">search</span>
            <input 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-surface-container-low border-none rounded-2xl py-2.5 pl-10 pr-3 text-xs font-semibold focus:ring-1 focus:ring-primary/20 placeholder:text-outline-variant/60 outline-none transition-all" 
              placeholder="Search infrastructure nodes..." 
              type="text"
            />
          </div>
          <select
            value={activeTagFilter}
            onChange={(e) => setActiveTagFilter(e.target.value)}
            className="hidden sm:block min-w-[160px] rounded-2xl bg-surface-container-low px-3 py-2.5 text-xs font-black uppercase tracking-wider text-on-surface ring-1 ring-outline-variant/20 outline-none focus:ring-primary/30"
          >
            <option value="all">All Tags ({projects.length})</option>
            {tagCatalog.map((tag) => (
              <option key={tag.key} value={tag.key}>
                {tag.name} ({tag.count})
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-3 sm:gap-4 ml-2 sm:ml-6 text-on-surface-variant">
           <div className="flex items-center gap-2">
              <button
                onClick={runSelfUpdate}
                disabled={!selfUpdateTarget.enabled || isBusy}
                className="rounded-xl border border-primary/20 bg-primary/10 px-2.5 sm:px-3 py-2 text-[9px] sm:text-[10px] font-black uppercase tracking-widest text-primary transition hover:bg-primary/15 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Self Update
              </button>
              <button className="hidden sm:inline-flex h-8 w-8 items-center justify-center rounded-lg hover:bg-surface-container-low">
                <span className="material-symbols-outlined cursor-pointer hover:text-primary transition-colors opacity-60 hover:opacity-100 text-[20px]">refresh</span>
              </button>
              <button className="hidden sm:inline-flex h-8 w-8 items-center justify-center rounded-lg hover:bg-surface-container-low">
                <span className="material-symbols-outlined cursor-pointer hover:text-primary transition-colors opacity-60 hover:opacity-100 text-[20px]">history</span>
              </button>
           </div>
           <button onClick={() => setIsDark(!isDark)} className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-surface-container-low ring-1 ring-outline-variant/20">
             <span className="material-symbols-outlined text-[18px]">{isDark ? 'light_mode' : 'dark_mode'}</span>
           </button>
           <div className="hidden sm:flex h-9 w-9 rounded-2xl bg-primary/10 items-center justify-center overflow-hidden border border-primary/20">
              <img src="https://ui-avatars.com/api/?name=Horaus&background=005bc0&color=fff" className="h-full w-full object-cover" alt="User" />
           </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="lg:ml-64 pt-24 sm:pt-24 px-4 sm:px-6 lg:px-8 pb-10 min-h-screen">
        {/* Hero Metrics */}
        <section className="grid grid-cols-1 lg:grid-cols-2 gap-7 sm:gap-10 mb-10 sm:mb-14 items-end">
          <Metric 
            label="Active Services" 
            value={projects.length} 
            detail={
              <span className="text-emerald-500 flex items-center text-xs font-black uppercase tracking-widest bg-emerald-50 px-3 py-1.5 rounded-full ring-1 ring-emerald-500/10">
                <span className="material-symbols-outlined text-[14px] mr-1.5 font-black">check_circle</span>
                Operational
              </span>
            }
          />
          <Metric 
            label="Global Uptime" 
            value="99.98" 
            detail={<span className="text-4xl text-outline-variant font-black">%</span>}
          />
        </section>

        {/* Bento Grid */}
        <section className="mb-16">
          <div className="flex items-center justify-between mb-6 sm:mb-8 gap-3">
            <h2 className="text-lg sm:text-2xl font-black tracking-tighter uppercase">Infrastructure Node Grid</h2>
            <div className="h-px flex-1 bg-surface-container mx-2 sm:mx-6"></div>
            <span className="hidden sm:inline text-[10px] font-black text-outline uppercase tracking-widest">Real-time Telemetry</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 2xl:grid-cols-4 gap-4 sm:gap-5">
            {mergedFilteredProjects.map(project => (
              <ProjectCard 
                key={project.id} 
                project={project}
                onSync={runUpdateQuickAction}
                onOpenBack={openRollbackModal}
                onOpenSettings={openSettingsModal}
                onOpenDelete={(p) => setDeleteModal(p)}
                isBusy={isBusy}
              />
            ))}
          </div>
        </section>

        {/* Activity Stream */}
        <section>
          <div className="flex items-center gap-4 mb-8">
            <h2 className="text-[10px] font-black uppercase tracking-[0.3em] text-on-surface">System Event Log</h2>
            <span className="h-2 w-2 rounded-full bg-primary animate-pulse shadow-[0_0_10px_rgba(0,123,255,0.8)]"></span>
          </div>
          <div className="bg-surface-container-lowest dark:bg-slate-900/80 rounded-3xl overflow-hidden ring-1 ring-outline-variant/10 shadow-xl shadow-on-surface/5">
            <div className="divide-y divide-surface-container">
              {activityEvents.length === 0 ? (
                <div className="px-8 py-8 text-xs text-outline-variant">No runtime events yet. Trigger an action to stream logs.</div>
              ) : (
                activityEvents.map((event) => <ActivityItem key={event.id} {...event} />)
              )}
            </div>
          </div>
        </section>
      </main>

      {/* Modals Layer */}
      {selectedProject && (
        <ModalWrapper title={`${selectedProject.name} Configuration`} onClose={() => setSelectedProject(null)}>
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 sm:gap-5 items-start">
            <div className="rounded-xl border border-surface-container bg-surface-container-low p-3 space-y-3">
              <p className="text-[10px] font-black uppercase tracking-widest text-on-surface-variant">Source & Domain</p>
              <div className="space-y-2">
                <label className="text-[10px] uppercase tracking-widest text-outline-variant font-bold">GitHub Repository</label>
                <input
                  value={selectedProject.repo || ''}
                  onChange={(e) => updateProjectDraft('repo', e.target.value)}
                  placeholder="owner/repository"
                  className="w-full rounded-xl border border-surface-container bg-surface px-3 py-2 text-xs outline-none focus:ring-1 focus:ring-primary/30"
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <div className="col-span-1 space-y-2">
                  <label className="text-[10px] uppercase tracking-widest text-outline-variant font-bold">Subdomain</label>
                  <input
                    value={selectedProject.subdomain || ''}
                    onChange={(e) => {
                      const sub = String(e.target.value || '').toLowerCase().replace(/[^a-z0-9-]/g, '');
                      const fqdn = buildFqdn(selectedProject.baseDomain, sub);
                      updateProjectDraft('subdomain', sub);
                      updateProjectDraft('fqdn', fqdn);
                      updateProjectDraft('productionDomain', fqdn);
                      updateProjectDraft('endpoint', fqdn);
                    }}
                    placeholder="app"
                    className="w-full rounded-xl border border-surface-container bg-surface px-3 py-2 text-xs outline-none focus:ring-1 focus:ring-primary/30"
                  />
                </div>
                <div className="col-span-2 space-y-2">
                  <label className="text-[10px] uppercase tracking-widest text-outline-variant font-bold">Base Domain</label>
                  <div className="flex gap-2">
                    <select
                      value={selectedProject.baseDomain || ''}
                      onChange={(e) => {
                        const base = normalizeHost(e.target.value);
                        const fqdn = buildFqdn(base, selectedProject.subdomain);
                        updateProjectDraft('baseDomain', base);
                        updateProjectDraft('fqdn', fqdn);
                        updateProjectDraft('productionDomain', fqdn);
                        updateProjectDraft('endpoint', fqdn);
                      }}
                      className="w-full rounded-xl border border-surface-container bg-surface px-3 py-2 text-xs outline-none focus:ring-1 focus:ring-primary/30"
                    >
                      <option value="">Select base domain</option>
                      {(domainCatalog.baseDomains || []).map((base) => (
                        <option key={base} value={base}>{base}</option>
                      ))}
                    </select>
                    <button
                      onClick={() => loadDomainCatalog(true)}
                      className="rounded-xl bg-surface px-3 py-2 text-[10px] font-black uppercase tracking-widest ring-1 ring-outline-variant/20"
                    >
                      {domainCatalogLoading ? 'Reloading' : 'Reload'}
                    </button>
                  </div>
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-[10px] uppercase tracking-widest text-outline-variant font-bold">Full Domain</label>
                <input
                  value={selectedProject.fqdn || ''}
                  readOnly
                  className="w-full rounded-xl border border-surface-container bg-surface px-3 py-2 text-xs text-on-surface-variant"
                />
                <div className="flex justify-end">
                  <button
                    onClick={saveProjectSettings}
                    className="rounded-lg bg-primary px-3 py-2 text-[10px] font-black uppercase tracking-widest text-white"
                  >
                    Save Domain
                  </button>
                </div>
              </div>
              <div className="rounded-xl border border-surface-container bg-surface p-3">
                <p className="text-[10px] font-black uppercase tracking-widest text-on-surface-variant mb-2">Cloudflare Guide</p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <button
                    onClick={() => copyText('cname', 'record type')}
                    className="rounded-lg border border-surface-container bg-surface-container-low px-3 py-2 text-left"
                    title="Click to copy"
                  >
                    <p className="text-[9px] uppercase tracking-widest text-on-surface-variant">Type</p>
                    <p className="text-xs font-bold text-on-surface">cname</p>
                  </button>
                  <button
                    onClick={() => copyText(guideSubdomain, 'subdomain')}
                    className="rounded-lg border border-surface-container bg-surface-container-low px-3 py-2 text-left"
                    title="Click to copy"
                  >
                    <p className="text-[9px] uppercase tracking-widest text-on-surface-variant">Subdomain</p>
                    <p className="text-xs font-bold text-on-surface break-all">{guideSubdomain}</p>
                  </button>
                  <button
                    onClick={() => copyText(guideTunnelTarget, 'tunnel target')}
                    className="rounded-lg border border-surface-container bg-surface-container-low px-3 py-2 text-left"
                    title="Click to copy"
                  >
                    <p className="text-[9px] uppercase tracking-widest text-on-surface-variant">Target</p>
                    <p className="text-xs font-bold text-on-surface break-all">{guideTunnelTarget}</p>
                  </button>
                </div>
                <div className="mt-3 flex items-center gap-2">
                  <a
                    href="https://dash.cloudflare.com/"
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-lg bg-surface-container-high px-3 py-2 text-[10px] font-black uppercase tracking-widest ring-1 ring-outline-variant/20"
                  >
                    Open Cloudflare Dashboard
                  </a>
                  <button
                    onClick={checkDns}
                    disabled={dnsChecking}
                    className="rounded-lg bg-surface px-3 py-2 text-[10px] font-black uppercase tracking-widest ring-1 ring-outline-variant/20 disabled:opacity-50"
                  >
                    {dnsChecking ? 'Checking...' : 'Check DNS'}
                  </button>
                </div>
                {dnsStatus ? (
                  <div className="mt-2 space-y-1">
                    <p className={`text-[10px] font-bold uppercase ${dnsStatus.ok ? 'text-emerald-500' : 'text-red-500'}`}>check : {dnsStatus.check}</p>
                    {dnsStatus.detail ? <p className="text-[10px] text-on-surface-variant">{dnsStatus.detail}</p> : null}
                  </div>
                ) : null}
              </div>
              <div className="rounded-xl border border-surface-container bg-surface p-3 space-y-3">
                <p className="text-[10px] font-black uppercase tracking-widest text-on-surface-variant">Tags</p>
                <div className="flex gap-2">
                  <input
                    value={tagDraft}
                    onChange={(e) => setTagDraft(e.target.value)}
                    placeholder="tag name"
                    className="w-full rounded-xl border border-surface-container bg-surface px-3 py-2 text-xs outline-none focus:ring-1 focus:ring-primary/30"
                  />
                  <button onClick={addTagToSelectedProject} className="rounded-xl bg-primary px-3 py-2 text-[10px] font-black uppercase tracking-widest text-white">
                    Add
                  </button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {TAG_COLOR_OPTIONS.map((color) => (
                    <button
                      key={color}
                      onClick={() => setTagColorDraft(color)}
                      className={`h-6 w-6 rounded-full ring-2 ${tagColorDraft === color ? 'ring-on-surface' : 'ring-transparent'}`}
                      style={{ backgroundColor: color }}
                    />
                  ))}
                </div>
                <div className="flex flex-wrap gap-2">
                  {getProjectTags(selectedProject).map((tag) => (
                    <button
                      key={tag.name}
                      onClick={() => removeTagFromSelectedProject(tag.name)}
                      className="rounded-lg px-2 py-1 text-[10px] font-black uppercase tracking-wider"
                      style={{ backgroundColor: `${tag.color}22`, color: tag.color }}
                      title="Remove tag"
                    >
                      {tag.name} ×
                    </button>
                  ))}
                </div>
                <div className="pt-1">
                  <p className="mb-2 text-[10px] font-black uppercase tracking-widest text-on-surface-variant">Suggested tags</p>
                  <div className="flex flex-wrap gap-2">
                    {tagCatalog.length === 0 ? (
                      <span className="text-[10px] text-on-surface-variant">No tags yet</span>
                    ) : (
                      tagCatalog.map((tag) => (
                        <button
                          key={`suggest-${tag.key}`}
                          onClick={() => {
                            setTagDraft(tag.name);
                            setTagColorDraft(tag.color || TAG_COLOR_OPTIONS[0]);
                          }}
                          className="rounded-lg px-2 py-1 text-[10px] font-black uppercase tracking-wider"
                          style={{ backgroundColor: `${tag.color}22`, color: tag.color }}
                        >
                          {tag.name} ({tag.count})
                        </button>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-surface-container bg-surface-container-low p-3 space-y-3 xl:sticky xl:top-0">
              <p className="text-[10px] font-black uppercase tracking-widest text-on-surface-variant">Maintenance & Scheduling</p>
              <div className="space-y-2">
                <label className="text-[10px] uppercase tracking-widest text-outline-variant font-bold">Maintenance Notice End Time</label>
                <input
                  type="datetime-local"
                  value={selectedProject.maintenanceEndTime || ''}
                  onChange={(e) => updateProjectDraft('maintenanceEndTime', e.target.value)}
                  className="w-full rounded-xl border border-surface-container bg-surface px-3 py-2 text-xs outline-none focus:ring-1 focus:ring-primary/30"
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <button
                  onClick={() => {
                    saveProjectSettings();
                    executeAction(selectedProject.folder, 'update');
                    setSelectedProject(null);
                  }}
                  className="w-full py-2.5 bg-primary text-white rounded-xl text-[10px] font-black uppercase tracking-widest"
                >
                  Update
                </button>
                <button
                  onClick={() => {
                    setRollbackModal(selectedProject);
                    setCommitsLoading(true);
                    fetch(`${API_BASE}/api/rollback/${selectedProject.folder}/list`)
                      .then((r) => r.json())
                      .then((d) => {
                        setCommits(d.commits || []);
                        setCommitsLoading(false);
                        setSelectedProject(null);
                      });
                  }}
                  className="w-full py-2.5 bg-surface-container-high rounded-xl text-[10px] font-black uppercase tracking-widest"
                >
                  Backversion
                </button>
                <button
                  onClick={() => {
                    setDeleteModal(selectedProject);
                    setSelectedProject(null);
                  }}
                  className="w-full py-2.5 bg-red-600 text-white rounded-xl text-[10px] font-black uppercase tracking-widest"
                >
                  Delete
                </button>
              </div>
              <button
                onClick={() => {
                  const domain = normalizeHost(selectedProject?.fqdn || resolveProductionDomain(selectedProject));
                  if (!domain) {
                    addToast(`Missing production domain for ${selectedProject.folder}.`, 'error');
                    return;
                  }
                  saveProjectSettings();
                  const isMaintenance = selectedProject.lifecycle === 'maintenance';
                  if (isMaintenance) {
                    executeAction(selectedProject.folder, 'deploy', { type: 'production', domain });
                  } else {
                    const endTimeIso = selectedProject.maintenanceEndTime ? new Date(selectedProject.maintenanceEndTime).toISOString() : undefined;
                    executeAction(selectedProject.folder, 'offair', { domain, endTime: endTimeIso });
                  }
                  setSelectedProject(null);
                }}
                className={`w-full py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest ${
                  selectedProject.lifecycle === 'maintenance' ? 'bg-emerald-600 text-white' : 'bg-amber-600 text-white'
                }`}
              >
                {selectedProject.lifecycle === 'maintenance' ? 'Exit Maintenance Mode' : 'Enter Maintenance Mode'}
              </button>
            </div>
          </div>
        </ModalWrapper>
      )}

      {showNewModal && (
        <ModalWrapper title="Initialize Node" onClose={() => setShowNewModal(false)}>
           <p className="text-xs text-on-surface-variant mb-6 italic">Provision a new isolated environment container.</p>
           <button onClick={() => setShowNewModal(false)} className="w-full py-4 metric-gradient text-white rounded-2xl text-[10px] font-black uppercase tracking-widest">Start Provisioning</button>
        </ModalWrapper>
      )}

      {deleteModal && (
        <ModalWrapper title="Decommission Node" onClose={() => setDeleteModal(null)}>
           <div className="space-y-6 text-center">
              <div className="mx-auto h-16 w-16 rounded-3xl bg-red-50 text-red-600 flex items-center justify-center ring-1 ring-red-500/10 mb-4">
                 <span className="material-symbols-outlined text-3xl font-black">warning</span>
              </div>
              <p className="text-xs font-bold text-on-surface uppercase tracking-widest">Are you absolutely sure?</p>
              <button onClick={() => { executeAction(deleteModal.folder, 'delete_hard'); setDeleteModal(null); }} className="w-full py-4 bg-red-600 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest shadow-xl shadow-red-600/20">Destroy Production Data</button>
           </div>
        </ModalWrapper>
      )}

      {rollbackModal && (
        <ModalWrapper title={`Sync History: ${rollbackModal.name}`} onClose={() => setRollbackModal(null)}>
           <div className="max-h-64 overflow-auto space-y-2 pr-2 custom-scrollbar">
              {commitsLoading ? (
                 <div className="py-12 text-center text-[10px] font-bold uppercase text-on-surface-variant animate-pulse">Scanning Snapshot Registry...</div>
              ) : (
                commits.map(c => (
                  <div key={c.sha} onClick={() => { executeAction(rollbackModal.folder, 'rollback_apply', { sha: c.sha }); setRollbackModal(null); }} className="p-4 rounded-2xl border border-surface-container hover:border-primary/30 hover:bg-primary/5 cursor-pointer transition-all group">
                    <p className="text-xs font-black uppercase text-on-surface group-hover:text-primary truncate">{c.message}</p>
                    <p className="text-[9px] font-bold text-outline uppercase mt-1.5">{c.sha.slice(0,8)} • {c.time}</p>
                  </div>
                ))
              )}
           </div>
        </ModalWrapper>
      )}

      {/* Toasts Container */}
      <div className="fixed bottom-4 right-3 sm:bottom-10 sm:right-10 z-[200] flex w-[min(92vw,360px)] flex-col gap-2 sm:gap-4 pointer-events-none">
        {toasts.map(t => <Toast key={t.id} {...t} onClose={() => setToasts((prev) => prev.filter(x => x.id !== t.id))} />)}
      </div>
    </div>
  );
}

const ActivityItem = ({ icon, message, target, time, color }) => (
  <div className="px-8 py-5 flex items-center gap-5 transition-colors duration-75 group cursor-pointer text-on-surface dark:text-slate-300 hover:bg-surface-container dark:hover:bg-black/75 dark:hover:text-white">
    <span className={`material-symbols-outlined ${color} text-base`} style={{ fontVariationSettings: "'FILL' 1" }}>{icon}</span>
    <div className="flex-1">
      <p className="text-sm font-semibold text-on-surface dark:text-slate-200 group-hover:text-on-surface dark:group-hover:text-white">
        {message}
        {target ? <span className="text-primary dark:text-sky-300 group-hover:text-primary dark:group-hover:text-white font-black uppercase tracking-tight"> {target}</span> : null}
      </p>
      <p className="text-[10px] text-outline-variant dark:text-slate-400 group-hover:text-outline dark:group-hover:text-slate-100 font-black uppercase tracking-widest mt-1.5">System Event • {time}</p>
    </div>
    <span className="material-symbols-outlined text-outline-variant dark:text-slate-300 opacity-0 group-hover:opacity-100 transition-all translate-x-1 group-hover:translate-x-0">chevron_right</span>
  </div>
);

export default App;

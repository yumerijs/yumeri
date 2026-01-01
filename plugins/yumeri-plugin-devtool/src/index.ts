import { Context, Session, Logger, Schema } from 'yumeri';
import path from 'path';
import { registerRoutes, attachCoreEvents } from './server/router';

const logger = new Logger("devtool");

export interface DevtoolConfig {
  theme: 'auto' | 'dark' | 'light';
  assetsRoot: string;
}

export const config: Schema<DevtoolConfig> = Schema.object({
  theme: Schema.enum(['auto', 'dark', 'light'], 'Devtool 主题').default('dark'),
  assetsRoot: Schema.string('静态资源根目录').default('public'),
});

export async function apply(ctx: Context, config: DevtoolConfig) {
  const version = readVersion();

  // 监听核心事件，推送到 devtool 内部缓冲
  attachCoreEvents(ctx);
  registerRoutes(ctx, {
    assetsRoot: config.assetsRoot,
  });

  // 后置中间件：仅在路由执行完且响应为 HTML 时追加调试面板
  ctx.use('devtool-overlay', async (session: Session, next: () => Promise<void>) => {
    await next();
    if (session.responseHandled) return;
    const contentType = (session.head['Content-Type'] || '').toString().toLowerCase();
    const isHtml = contentType.includes('text/html') || looksLikeHtml(session.body);
    if (!isHtml) return;
    if (typeof session.body !== 'string') return;

    session.body = injectOverlay(session.body as string, {
      node: process.version,
      yumeri: version,
      plugin: 'yumeri-plugin-devtool',
      mode: process.env.NODE_ENV || 'production',
      path: session.pathname,
      method: session.client?.req?.method || '',
      theme: config.theme || 'dark',
    });
    // 确保 mime 为 html
    session.setMime('text/html');
  });

  logger.info('Devtool overlay middleware registered');
}

function looksLikeHtml(body: any): boolean {
  if (typeof body !== 'string') return false;
  const sample = body.slice(0, 200).toLowerCase();
  return sample.includes('<html') || sample.includes('<!doctype html') || sample.includes('<body');
}

function injectOverlay(html: string, info: Record<string, string>) {
  const panel = buildPanel(info);
  if (html.includes('</body>')) {
    return html.replace('</body>', `${panel}</body>`);
  }
  return html + panel;
}

function buildPanel(info: Record<string, string>) {
  const infoLines = Object.entries(info)
    .map(([k, v]) => `<div class="ydev-row"><span class="ydev-key">${escapeHtml(k)}</span><span class="ydev-val">${escapeHtml(v)}</span></div>`)
    .join('');

  const infoJson = JSON.stringify(info);

  return `
<style>
#ydev-btn {
  position: fixed;
  bottom: 16px;
  right: 16px;
  z-index: 2147483000;
  padding: 8px 12px;
  background: linear-gradient(135deg, #6366f1, #22d3ee);
  color: #0b1220;
  border-radius: 10px;
  border: none;
  box-shadow: 0 12px 30px rgba(99, 102, 241, 0.35);
  cursor: pointer;
  font-weight: 700;
}
#ydev-panel {
  position: fixed;
  bottom: 64px;
  right: 16px;
  width: 400px;
  max-height: 72vh;
  overflow: auto;
  background: rgba(15, 23, 42, 0.95);
  color: #e2e8f0;
  border: 1px solid rgba(148, 163, 184, 0.2);
  border-radius: 14px;
  padding: 12px;
  box-shadow: 0 20px 60px rgba(0,0,0,0.45);
  z-index: 2147483001;
  backdrop-filter: blur(10px);
  display: none;
}
#ydev-panel.ydev-show { display: block; }
.ydev-header { display:flex; justify-content: space-between; align-items:center; }
#ydev-panel .ydev-title { font-weight: 700; margin-bottom: 6px; }
.ydev-tabs { display:flex; gap:6px; margin:8px 0 12px 0; flex-wrap:wrap; }
.ydev-tab-btn { padding:6px 10px; border-radius:8px; border:1px solid rgba(148,163,184,.25); background:rgba(255,255,255,.04); color:#e2e8f0; cursor:pointer; }
.ydev-tab-btn.ydev-active { background:rgba(99,102,241,.18); border-color:rgba(99,102,241,.5); }
.ydev-tab-content { display:block; }
.ydev-tab-content.ydev-hidden { display:none; }
.ydev-section { margin-bottom: 12px; }
.ydev-row { display: flex; justify-content: space-between; font-size: 12px; margin: 4px 0; }
.ydev-key { color: #94a3b8; }
.ydev-val { color: #e2e8f0; max-width: 240px; text-align: right; word-break: break-all; }
.ydev-sub { font-size: 11px; color: #94a3b8; margin: 6px 0; }
.ydev-list { max-height: 220px; overflow: auto; border: 1px solid rgba(148, 163, 184, 0.15); border-radius: 10px; }
.ydev-net { font-size: 12px; padding: 8px; border-bottom: 1px solid rgba(148, 163, 184, 0.1); }
.ydev-net:last-child { border-bottom: none; }
.ydev-badge { display: inline-flex; align-items: center; gap: 4px; padding: 2px 6px; border-radius: 999px; font-size: 11px; }
.ydev-badge-get { background: rgba(34,197,94,.15); color: #4ade80; }
.ydev-badge-post { background: rgba(59,130,246,.15); color: #60a5fa; }
.ydev-badge-err { background: rgba(239,68,68,.15); color: #f87171; }
.ydev-inspect-tip { font-size: 11px; color: #94a3b8; margin-top: 4px; }
.ydev-highlight { position: absolute; pointer-events: none; border: 2px dashed #22d3ee; background: rgba(34,211,238,0.08); z-index: 2147482999; }
.ydev-card { border:1px solid rgba(148,163,184,.15); border-radius:10px; padding:8px; background:rgba(255,255,255,.02); }
.ydev-btn-ghost { padding:6px 10px;border-radius:8px;border:1px solid rgba(148,163,184,.2);background:rgba(255,255,255,.04);color:#e2e8f0;cursor:pointer; }
.ydev-actions { display:flex; gap:6px; margin-bottom:6px; }
.ydev-assets-controls { display:flex; gap:6px; align-items:center; margin-bottom:8px; }
.ydev-assets-controls input { flex:1; padding:6px 8px; border-radius:8px; border:1px solid rgba(148,163,184,.25); background:rgba(255,255,255,.06); color:#e2e8f0; }
.ydev-assets-list { max-height:220px; overflow:auto; border:1px solid rgba(148,163,184,.15); border-radius:10px; }
.ydev-asset-row { display:flex; justify-content:space-between; padding:8px; border-bottom:1px solid rgba(148,163,184,.08); cursor:pointer; }
.ydev-asset-row:hover { background:rgba(255,255,255,.04); }
.ydev-asset-row:last-child { border-bottom:none; }
.ydev-asset-name { display:flex; gap:6px; align-items:center; }
.ydev-asset-meta { font-size:11px; color:#94a3b8; }
#ydev-panel.ydev-theme-light { background: #f8fafc; color:#0f172a; border-color: #cbd5e1; }
#ydev-panel.ydev-theme-light .ydev-key { color:#475569; }
#ydev-panel.ydev-theme-light .ydev-val { color:#0f172a; }
#ydev-panel.ydev-theme-light .ydev-sub { color:#475569; }
#ydev-panel.ydev-theme-light .ydev-tabs { gap:6px; }
#ydev-panel.ydev-theme-light .ydev-tab-btn { background:#e2e8f0; color:#0f172a; border-color:#cbd5e1; }
#ydev-panel.ydev-theme-light .ydev-tab-btn.ydev-active { background:#cbd5e1; border-color:#94a3b8; }
#ydev-panel.ydev-theme-light .ydev-list { border-color: #cbd5e1; background:#fff; }
#ydev-panel.ydev-theme-light .ydev-net { background: #fff; color:#0f172a; }
#ydev-panel.ydev-theme-light .ydev-card { background: #fff; border-color: #cbd5e1; }
#ydev-panel.ydev-theme-light .ydev-btn-ghost { background: #e2e8f0; color:#0f172a; border-color: #cbd5e1; }
#ydev-panel.ydev-theme-light .ydev-asset-row { background:#fff; }
#ydev-panel.ydev-theme-light .ydev-asset-row:hover { background: #e2e8f0; }
#ydev-panel.ydev-theme-light .ydev-assets-controls input { background:#fff; color:#0f172a; border-color:#cbd5e1; }
</style>
<div id="ydev-panel">
  <div class="ydev-header">
    <div>
      <div class="ydev-title">Yumeri Devtool</div>
      <div class="ydev-sub">轻量调试面板 · 类 Vite Devtools</div>
    </div>
  </div>
  <div id="ydev-tabs" class="ydev-tabs">
    <button class="ydev-tab-btn ydev-active" data-tab="overview">概览</button>
    <button class="ydev-tab-btn" data-tab="network">网络</button>
    <button class="ydev-tab-btn" data-tab="inspect">探查</button>
    <button class="ydev-tab-btn" data-tab="events">事件</button>
    <button class="ydev-tab-btn" data-tab="assets">Assets</button>
    <button class="ydev-tab-btn" data-tab="settings">设置</button>
  </div>

  <div id="ydev-tab-overview" class="ydev-tab-content">
    <div class="ydev-section ydev-card">${infoLines}</div>
    <div class="ydev-section">
      <div class="ydev-sub">当前路由</div>
      <div id="ydev-route-info" class="ydev-card"></div>
    </div>
  </div>

  <div id="ydev-tab-network" class="ydev-tab-content ydev-hidden">
    <div class="ydev-sub">网络 (最近 20 条)</div>
    <div id="ydev-netlist" class="ydev-list"></div>
  </div>

  <div id="ydev-tab-inspect" class="ydev-tab-content ydev-hidden">
    <div class="ydev-sub">元素探查</div>
    <button id="ydev-inspect" class="ydev-btn-ghost">开启探查</button>
    <div class="ydev-inspect-tip">点击页面高亮元素，显示 tag/id/class/尺寸</div>
    <div id="ydev-inspect-info" class="ydev-inspect-tip"></div>
  </div>

  <div id="ydev-tab-events" class="ydev-tab-content ydev-hidden">
    <div class="ydev-sub">服务端事件</div>
    <div class="ydev-actions">
      <button id="ydev-events-btn" class="ydev-btn-ghost">刷新</button>
      <button id="ydev-events-clear" class="ydev-btn-ghost">清空</button>
    </div>
    <div id="ydev-events" class="ydev-list"></div>
  </div>

  <div id="ydev-tab-assets" class="ydev-tab-content ydev-hidden">
    <div class="ydev-sub">轻量资源浏览（仅限静态目录）</div>
    <div class="ydev-assets-controls">
      <button id="ydev-assets-up" class="ydev-btn-ghost" title="上一级">⬆</button>
      <input id="ydev-assets-path" value="/" />
      <button id="ydev-assets-refresh" class="ydev-btn-ghost">刷新</button>
    </div>
    <div id="ydev-assets-list" class="ydev-assets-list"></div>
  </div>

  <div id="ydev-tab-settings" class="ydev-tab-content ydev-hidden">
    <div class="ydev-sub">主题</div>
    <div class="ydev-actions">
      <select id="ydev-theme-select" class="ydev-btn-ghost" style="padding:6px 10px; width:140px;">
        <option value="auto">跟随系统</option>
        <option value="dark">深色</option>
        <option value="light">浅色</option>
      </select>
    </div>
    <div class="ydev-sub">设置仅保存在本地浏览器</div>
  </div>
  <div class="ydev-sub">点击下方按钮隐藏</div>
</div>
<button id="ydev-btn">Dev</button>
<script>
(() => {
  const serverInfo = ${infoJson};
  const maxItems = 20;
  const state = { net: [], inspectOn: false, highlight: null, route: null, assetsPath: '/' };
  const btn = document.getElementById('ydev-btn');
    const panel = document.getElementById('ydev-panel');
    const list = document.getElementById('ydev-netlist');
    const inspectBtn = document.getElementById('ydev-inspect');
    const inspectInfo = document.getElementById('ydev-inspect-info');
    const eventBtn = document.getElementById('ydev-events-btn');
    const eventList = document.getElementById('ydev-events');
    const eventClearBtn = document.getElementById('ydev-events-clear');
    const routeBox = document.getElementById('ydev-route-info');
    const assetsList = document.getElementById('ydev-assets-list');
    const assetsPathInput = document.getElementById('ydev-assets-path');
    const assetsUpBtn = document.getElementById('ydev-assets-up');
    const assetsRefreshBtn = document.getElementById('ydev-assets-refresh');
    const themeSelect = document.getElementById('ydev-theme-select');
    const tabButtons = Array.from(document.querySelectorAll('#ydev-tabs .ydev-tab-btn'));
    const tabContents = {
      overview: document.getElementById('ydev-tab-overview'),
      network: document.getElementById('ydev-tab-network'),
      inspect: document.getElementById('ydev-tab-inspect'),
      events: document.getElementById('ydev-tab-events'),
      assets: document.getElementById('ydev-tab-assets'),
      settings: document.getElementById('ydev-tab-settings'),
    };

    if (!btn || !panel) return;
    btn.addEventListener('click', () => panel.classList.toggle('ydev-show'));

  function switchTab(tab) {
    tabButtons.forEach((b) => b.classList.toggle('ydev-active', b.dataset.tab === tab));
    Object.entries(tabContents).forEach(([name, el]) => {
      if (!el) return;
      if (name === tab) el.classList.remove('ydev-hidden');
      else el.classList.add('ydev-hidden');
    });
  }
  tabButtons.forEach((b) => b.addEventListener('click', () => switchTab(b.dataset.tab)));
  switchTab('overview');

  function resolveTheme(theme) {
    if (theme === 'auto') {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    return theme;
  }
  function applyTheme(theme) {
    const mode = resolveTheme(theme);
    if (panel) {
      panel.classList.toggle('ydev-theme-light', mode === 'light');
      panel.classList.toggle('ydev-theme-dark', mode === 'dark');
    }
  }

  // Theme handling
  const localTheme = window.localStorage.getItem('ydev-theme');
  const defaultTheme = localTheme || serverInfo.theme || 'dark';
  applyTheme(defaultTheme);
  if (themeSelect) {
    themeSelect.value = defaultTheme;
    themeSelect.addEventListener('change', () => {
      const value = themeSelect.value || 'auto';
      applyTheme(value);
      window.localStorage.setItem('ydev-theme', value);
    });
  }
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  media.addEventListener('change', () => {
    const cur = window.localStorage.getItem('ydev-theme') || 'auto';
    if (cur === 'auto') applyTheme('auto');
  });

  function addNet(entry) {
    state.net.unshift(entry);
    if (state.net.length > maxItems) state.net.pop();
    renderNet();
  }

  function renderNet() {
    if (!list) return;
    list.innerHTML = state.net.map((n) => {
      const badge = n.ok ? 'ydev-badge' : 'ydev-badge ydev-badge-err';
      const methClass = n.method === 'GET' ? 'ydev-badge ydev-badge-get' :
                       n.method === 'POST' ? 'ydev-badge ydev-badge-post' : 'ydev-badge';
      return '<div class="ydev-net">' +
        '<div class=\"' + methClass + '\">' + n.method + '</div> ' +
        '<span>' + escapeHtml(n.url) + '</span>' +
        '<div style=\"display:flex;justify-content:space-between;font-size:11px;color:#94a3b8;margin-top:2px;\">' +
          '<span>Status ' + n.status + '</span><span>' + n.duration + 'ms</span>' +
        '</div></div>';
    }).join('');
  }

  function escapeHtml(str) {
    return str.replace(/[&<>"']/g, (c) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    }[c] || ''));
  }

  // fetch hook
  if (window.fetch) {
    const origFetch = window.fetch;
    window.fetch = async (...args) => {
      const start = performance.now();
      const req = args[0];
      const infoUrl = typeof req === 'string' ? req : (req?.url || '');
      const method = (args[1]?.method || 'GET').toUpperCase();
      try {
        const res = await origFetch(...args);
        addNet({ url: infoUrl, method, status: res.status, duration: Math.round(performance.now() - start), ok: res.ok });
        return res;
      } catch (err) {
        addNet({ url: infoUrl, method, status: 0, duration: Math.round(performance.now() - start), ok: false });
        throw err;
      }
    };
  }

  // XHR hook
  (function() {
    const origOpen = XMLHttpRequest.prototype.open;
    const origSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function(method, url, async, user, password) {
      this.__ydev = { method: (method || 'GET').toUpperCase(), url };
      return origOpen.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function(body) {
      const start = performance.now();
      this.addEventListener('loadend', () => {
        const info = this.__ydev || {};
        addNet({
          url: info.url || '',
          method: info.method || 'GET',
          status: this.status || 0,
          duration: Math.round(performance.now() - start),
          ok: (this.status || 0) < 400
        });
      });
      return origSend.apply(this, arguments);
    };
  })();

  // Inspect mode
  function enableInspect() {
    state.inspectOn = true;
    if (inspectBtn) inspectBtn.textContent = '关闭探查';
    document.addEventListener('click', inspectHandler, true);
  }
  function disableInspect() {
    state.inspectOn = false;
    if (inspectBtn) inspectBtn.textContent = '开启探查';
    document.removeEventListener('click', inspectHandler, true);
    removeHighlight();
    if (inspectInfo) inspectInfo.textContent = '';
  }
  function inspectHandler(e) {
    if (!state.inspectOn) return;
    const target = e.target;
    if (target && target.closest && (target.closest('#ydev-panel') || target.id === 'ydev-btn')) {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    const el = e.target;
    highlight(el);
    const rect = el.getBoundingClientRect();
    if (inspectInfo) {
      inspectInfo.textContent = '<' + el.tagName.toLowerCase() + ' id=\"' + (el.id||'') + '\" class=\"' + (el.className||'') + '\"> ' + Math.round(rect.width) + 'x' + Math.round(rect.height);
    }
  }
  function highlight(el) {
    removeHighlight();
    const rect = el.getBoundingClientRect();
    const hl = document.createElement('div');
    hl.className = 'ydev-highlight';
    hl.style.left = rect.left + window.scrollX + 'px';
    hl.style.top = rect.top + window.scrollY + 'px';
    hl.style.width = rect.width + 'px';
    hl.style.height = rect.height + 'px';
    document.body.appendChild(hl);
    state.highlight = hl;
  }
  function removeHighlight() {
    if (state.highlight) state.highlight.remove();
    state.highlight = null;
  }

  if (inspectBtn) {
    inspectBtn.addEventListener('click', () => {
      if (state.inspectOn) disableInspect(); else enableInspect();
    });
  }

      // devtool events polling
    async function fetchEvents() {
      try {
        const res = await fetch('/devtool/events');
        const json = await res.json();
        renderEvents(json.events || []);
      } catch (e) {
        // ignore
      }
    }
    function renderEvents(events) {
      if (!eventList) return;
      eventList.innerHTML = events.slice(0,20).map(ev => {
        const payload = typeof ev.payload === 'object' ? JSON.stringify(ev.payload) : String(ev.payload);
        return '<div class=\"ydev-net\"><div class=\"ydev-row\"><span class=\"ydev-key\">' + ev.type + '</span><span class=\"ydev-val\">' + new Date(ev.time).toLocaleTimeString() + '</span></div><div class=\"ydev-sub\">' + escapeHtml(payload) + '</div></div>'
      }).join('');
    }
    if (eventBtn) {
      eventBtn.addEventListener('click', () => fetchEvents());
      fetchEvents();
    }
    if (eventClearBtn) {
      eventClearBtn.addEventListener('click', async () => {
        try {
          await fetch('/devtool/events/clear');
          renderEvents([]);
        } catch (e) {
          // ignore
        }
      });
    }

    async function fetchRouteInfo() {
      try {
        const res = await fetch('/devtool/context', { credentials: 'include' });
        const data = await res.json();
        state.route = data.route || null;
        renderRoute(state.route);
      } catch (e) {
        renderRoute(null);
      }
    }
    function renderRoute(route) {
      if (!routeBox) return;
      if (!route) {
        routeBox.innerHTML = '<div class=\"ydev-sub\">暂无匹配记录</div>';
        return;
      }
      const rows = [
        ['Path', route.path || ''],
        ['Route', route.route || ''],
        ['Plugin', route.plugin || ''],
        ['Method', route.method || ''],
        ['Status', route.status ?? ''],
        ['耗时', route.duration ? route.duration + 'ms' : ''],
      ].map(([k,v]) => '<div class=\"ydev-row\"><span class=\"ydev-key\">' + escapeHtml(k) + '</span><span class=\"ydev-val\">' + escapeHtml(String(v)) + '</span></div>').join('');
      routeBox.innerHTML = rows;
    }
    fetchRouteInfo();

    async function fetchAssets(pathStr) {
      if (!pathStr) pathStr = '/';
      state.assetsPath = pathStr;
      if (assetsPathInput) assetsPathInput.value = pathStr;
      try {
        const res = await fetch('/devtool/assets?path=' + encodeURIComponent(pathStr));
        const data = await res.json();
        renderAssets(data.items || []);
      } catch (e) {
        renderAssets([]);
      }
    }
    function renderAssets(items) {
      if (!assetsList) return;
      if (!items.length) {
        assetsList.innerHTML = '<div class=\"ydev-sub\" style=\"padding:8px;\">空目录或无权限</div>';
        return;
      }
      assetsList.innerHTML = items.map((item) => {
        const meta = item.type === 'file' ? (item.size || 0) + ' B' : '目录';
        return '<div class=\"ydev-asset-row\" data-name=\"' + item.name + '\" data-type=\"' + item.type + '\"><div class=\"ydev-asset-name\">' + (item.type === 'dir' ? '📁' : '📄') + '<span>' + escapeHtml(item.name) + '</span></div><div class=\"ydev-asset-meta\">' + meta + '</div></div>';
      }).join('');
      assetsList.querySelectorAll('.ydev-asset-row').forEach((row) => {
        row.addEventListener('click', () => {
          const name = row.getAttribute('data-name') || '';
          const type = row.getAttribute('data-type');
          if (type === 'dir') {
            let next = state.assetsPath;
            if (!next.endsWith('/')) next += '/';
            next = (next + name).replace(/\\\\/g,'/');
            if (!next.startsWith('/')) next = '/' + next;
            fetchAssets(next);
          }
        });
      });
    }
    if (assetsRefreshBtn) assetsRefreshBtn.addEventListener('click', () => fetchAssets(state.assetsPath || '/'));
    if (assetsPathInput) assetsPathInput.addEventListener('change', () => fetchAssets(assetsPathInput.value || '/'));
    if (assetsUpBtn) assetsUpBtn.addEventListener('click', () => {
      const parts = state.assetsPath.split('/').filter(Boolean);
      parts.pop();
      const parent = '/' + parts.join('/');
      fetchAssets(parent === '//' ? '/' : parent || '/');
    });
    fetchAssets('/');
})();
</script>
`;
}

function escapeHtml(str: string) {
  return str.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[c] as string));
}

function readVersion(): string {
  try {
    const pkgPath = path.resolve(process.cwd(), 'package', 'yumeri', 'package.json');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const pkg = require(pkgPath);
    return pkg.version || 'unknown';
  } catch {
    return 'unknown';
  }
}

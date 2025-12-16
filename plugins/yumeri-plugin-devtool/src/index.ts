import { Context, Config, Session, Logger, ConfigSchema } from 'yumeri';
import path from 'path';
import { registerRoutes, attachCoreEvents } from './server/router';

const logger = new Logger("devtool");

export const config = {} as Record<string, ConfigSchema>

export async function apply(ctx: Context, config: Config) {
  const version = readVersion();

  // 监听核心事件，推送到 devtool 内部缓冲
  attachCoreEvents(ctx);
  registerRoutes(ctx);

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
  width: 360px;
  max-height: 70vh;
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
#ydev-panel .ydev-title { font-weight: 700; margin-bottom: 6px; }
.ydev-section { margin-bottom: 10px; }
.ydev-row { display: flex; justify-content: space-between; font-size: 12px; margin: 4px 0; }
.ydev-key { color: #94a3b8; }
.ydev-val { color: #e2e8f0; max-width: 220px; text-align: right; word-break: break-all; }
.ydev-sub { font-size: 11px; color: #94a3b8; margin-top: 6px; }
.ydev-list { max-height: 220px; overflow: auto; border: 1px solid rgba(148, 163, 184, 0.15); border-radius: 10px; }
.ydev-net { font-size: 12px; padding: 8px; border-bottom: 1px solid rgba(148, 163, 184, 0.1); }
.ydev-net:last-child { border-bottom: none; }
.ydev-badge { display: inline-flex; align-items: center; gap: 4px; padding: 2px 6px; border-radius: 999px; font-size: 11px; }
.ydev-badge-get { background: rgba(34,197,94,.15); color: #4ade80; }
.ydev-badge-post { background: rgba(59,130,246,.15); color: #60a5fa; }
.ydev-badge-err { background: rgba(239,68,68,.15); color: #f87171; }
.ydev-inspect-tip { font-size: 11px; color: #94a3b8; margin-top: 4px; }
.ydev-highlight { position: absolute; pointer-events: none; border: 2px dashed #22d3ee; background: rgba(34,211,238,0.08); z-index: 2147482999; }
</style>
<div id="ydev-panel">
  <div class="ydev-title">Yumeri Devtool</div>
  <div class="ydev-section">${infoLines}</div>
  <div class="ydev-section">
    <div class="ydev-sub">网络 (最近 20 条)</div>
    <div id="ydev-netlist" class="ydev-list"></div>
  </div>
  <div class="ydev-section">
    <div class="ydev-sub">元素探查</div>
    <button id="ydev-inspect" style="padding:6px 10px;border-radius:8px;border:1px solid rgba(148,163,184,.2);background:rgba(255,255,255,.04);color:#e2e8f0;cursor:pointer;">开启/关闭探查</button>
    <div class="ydev-inspect-tip">点击页面高亮元素，显示 tag/id/class/尺寸</div>
    <div id="ydev-inspect-info" class="ydev-inspect-tip"></div>
  </div>
  <div class="ydev-section">
    <div class="ydev-sub">服务端事件</div>
    <button id="ydev-events-btn" style="padding:6px 10px;border-radius:8px;border:1px solid rgba(148,163,184,.2);background:rgba(255,255,255,.04);color:#e2e8f0;cursor:pointer;margin-bottom:6px;">刷新事件</button>
    <div id="ydev-events" class="ydev-list"></div>
  </div>
  <div class="ydev-sub">点击下方按钮隐藏</div>
</div>
<button id="ydev-btn">Dev</button>
<script>
(() => {
  const serverInfo = ${infoJson};
  const maxItems = 20;
  const state = { net: [], inspectOn: false, highlight: null };
  const btn = document.getElementById('ydev-btn');
    const panel = document.getElementById('ydev-panel');
    const list = document.getElementById('ydev-netlist');
    const inspectBtn = document.getElementById('ydev-inspect');
    const inspectInfo = document.getElementById('ydev-inspect-info');
    const eventBtn = document.getElementById('ydev-events-btn');
    const eventList = document.getElementById('ydev-events');

    if (!btn || !panel) return;
    btn.addEventListener('click', () => panel.classList.toggle('ydev-show'));

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
        '<div class="' + methClass + '">' + n.method + '</div> ' +
        '<span>' + escapeHtml(n.url) + '</span>' +
        '<div style="display:flex;justify-content:space-between;font-size:11px;color:#94a3b8;margin-top:2px;">' +
          '<span>Status ' + n.status + '</span><span>' + n.duration + 'ms</span>' +
        '</div></div>';
    }).join('');
  }

  function escapeHtml(str) {
    return str.replace(/[&<>\"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',\"'\":'&#39;'}[c]));
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
    document.addEventListener('click', inspectHandler, true);
  }
  function disableInspect() {
    state.inspectOn = false;
    document.removeEventListener('click', inspectHandler, true);
    removeHighlight();
    if (inspectInfo) inspectInfo.textContent = '';
  }
  function inspectHandler(e) {
    if (!state.inspectOn) return;
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
        return '<div class="ydev-net"><div class="ydev-row"><span class="ydev-key">' + ev.type + '</span><span class="ydev-val">' + new Date(ev.time).toLocaleTimeString() + '</span></div><div class="ydev-sub">' + escapeHtml(payload) + '</div></div>'
      }).join('');
    }
    if (eventBtn) {
      eventBtn.addEventListener('click', () => fetchEvents());
      fetchEvents();
    }
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

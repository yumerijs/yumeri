import { Context, Config, Session, Logger, ConfigSchema } from 'yumeri';
import path from 'path';

const logger = new Logger("devtool");

export const config = {} as Record<string, ConfigSchema>

export async function apply(ctx: Context, config: Config) {
  const version = readVersion();

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
    .map(([k, v]) => `<div class="ydev-row"><span class="ydev-key">${k}</span><span class="ydev-val">${escapeHtml(v)}</span></div>`)
    .join('');

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
  width: 320px;
  max-height: 60vh;
  overflow: auto;
  background: rgba(15, 23, 42, 0.92);
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
.ydev-row { display: flex; justify-content: space-between; font-size: 12px; margin: 4px 0; }
.ydev-key { color: #94a3b8; }
.ydev-val { color: #e2e8f0; max-width: 200px; text-align: right; word-break: break-all; }
.ydev-sub { font-size: 11px; color: #94a3b8; margin-top: 6px; }
</style>
<div id="ydev-panel">
  <div class="ydev-title">Yumeri Devtool</div>
  ${infoLines}
  <div class="ydev-sub">点击下方按钮隐藏</div>
</div>
<button id="ydev-btn">Dev</button>
<script>
  (() => {
    const btn = document.getElementById('ydev-btn');
    const panel = document.getElementById('ydev-panel');
    if (!btn || !panel) return;
    const toggle = () => panel.classList.toggle('ydev-show');
    btn.addEventListener('click', toggle);
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

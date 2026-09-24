import { createHash } from 'node:crypto';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Context, Schema, Service, Session } from 'yumeri';

export const depend: string[] = [];
export const provide = ['frontend-react'];

export interface FrontendReactConfig {
  path: string;
}

export const config: Schema<FrontendReactConfig> = Schema.object({
  path: Schema.string('React 前端访问路径').key('frontend-react.config.path').default('frontend'),
});

export interface FrontendReactEntry {
  id?: string;
  dev?: string | string[];
  prod: string | string[];
  plugin?: string;
  data?: Record<string, unknown>;
}

export interface FrontendReactEntryHandle {
  id: string;
  remove(): void;
}

export interface FrontendReactManifestFile {
  id: string;
  url: string;
  mime?: string;
}

export interface FrontendReactManifestEntry {
  id: string;
  plugin?: string;
  data?: Record<string, unknown>;
  files: FrontendReactManifestFile[];
}

export interface FrontendReactManifest {
  revision: string;
  entries: FrontendReactManifestEntry[];
}

export interface FrontendReactService {
  addEntry(entry: FrontendReactEntry): FrontendReactEntryHandle;
  removeEntry(id: string): boolean;
}

interface Asset {
  id: string;
  file: string;
  mime?: string;
}

interface EntryState {
  id: string;
  plugin?: string;
  data?: Record<string, unknown>;
  assets: Asset[];
  handle: FrontendReactEntryHandle;
}

interface State {
  entries: Map<string, EntryState>;
  assets: Map<string, Asset>;
  revision: number;
}

const states = new WeakMap<Context, State>();

function stateFor(context: Context): State {
  const existing = states.get(context);
  if (existing) return existing;
  const state: State = { entries: new Map(), assets: new Map(), revision: 0 };
  states.set(context, state);
  return state;
}

function mimeFor(file: string): string | undefined {
  return {
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
  }[path.extname(file).toLowerCase()];
}

function filesOf(value: string | string[]): string[] {
  return (Array.isArray(value) ? value : [value]).flatMap((file) => {
    if (!existsSync(file) || !statSync(file).isDirectory()) return [file];
    return ['index.js', 'style.css'].map((name) => path.join(file, name)).filter(existsSync);
  });
}

export class FrontendReact extends Service implements FrontendReactService {
  private readonly state: State;

  constructor(context: Context) {
    super(context);
    this.state = stateFor(context);
  }

  addEntry(entry: FrontendReactEntry): FrontendReactEntryHandle {
    const files = filesOf(entry.prod);
    if (!files.length) throw new Error('Frontend React entry has no files');
    const id = entry.id ?? entry.plugin ?? createHash('md5').update(files.join('\0')).digest('hex');
    this.removeEntry(id);
    const assets = files.map((file, index) => ({
      id: `${id}-${index}`,
      file: path.resolve(file),
      mime: index === 0 ? 'application/javascript; charset=utf-8' : mimeFor(file),
    }));
    const handle: FrontendReactEntryHandle = {
      id,
      remove: () => {
        const current = this.state.entries.get(id);
        if (!current || current.handle !== handle) return;
        this.state.entries.delete(id);
        current.assets.forEach((asset) => this.state.assets.delete(asset.id));
        this.state.revision += 1;
      },
    };
    this.state.entries.set(id, { id, plugin: entry.plugin, data: entry.data, assets, handle });
    assets.forEach((asset) => this.state.assets.set(asset.id, asset));
    this.state.revision += 1;
    return handle;
  }

  removeEntry(id: string): boolean {
    const entry = this.state.entries.get(id);
    if (!entry) return false;
    entry.handle.remove();
    return true;
  }
}

declare module 'yumeri' {
  interface Components {
    'frontend-react': FrontendReactService;
  }
}

export function apply(ctx: Context, pluginConfig: FrontendReactConfig) {
  ctx.registerService('frontend-react', FrontendReact);
  const state = stateFor(ctx);
  const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const staticRoot = path.join(packageRoot, 'static');
  const basePath = pluginConfig.path.replace(/^\/+|\/+$/g, '');

  ctx.route(`/api/${basePath}/manifest`).methods('GET').action((session: Session) => {
    const entries = [...state.entries.values()].map((entry) => ({
      id: entry.id,
      plugin: entry.plugin,
      data: entry.data,
      files: entry.assets.map((asset) => ({
        id: asset.id,
        mime: asset.mime,
        url: `/api/${basePath}/asset?file=${encodeURIComponent(asset.id)}`,
      })),
    }));
    session.respond({ revision: String(state.revision), entries } satisfies FrontendReactManifest, 'json');
  });

  ctx.route(`/api/${basePath}/asset`).methods('GET').action((session: Session, query: URLSearchParams) => {
    const asset = state.assets.get(query.get('file') ?? '');
    if (!asset || !existsSync(asset.file)) {
      session.status = 404;
      session.respond({ error: 'Frontend React asset not found' }, 'json');
      return;
    }
    session.setMime(asset.mime ?? 'application/octet-stream');
    session.sendFile(asset.file);
  });

  ctx.route(`/${basePath}`).methods('GET').action((session: Session) => {
    session.status = 302;
    session.head.Location = `/${basePath}/`;
    session.respond('', 'plain');
  });
  ctx.route(`/${basePath}/`).methods('GET').action((session: Session) => {
    const index = path.join(staticRoot, 'index.html');
    session.setMime('text/html; charset=utf-8');
    session.file(index, { maxAge: 0, etag: true });
  });
  ctx.route(`/${basePath}/:file+`).methods('GET').action((session: Session, _query: URLSearchParams, file: string) => {
    const requested = path.resolve(staticRoot, file);
    if (!requested.startsWith(staticRoot) || !existsSync(requested)) {
      session.status = 404;
      session.respond('Not Found', 'plain');
      return;
    }
    session.setMime(mimeFor(requested) ?? 'application/octet-stream');
    session.sendFile(requested);
  });
}
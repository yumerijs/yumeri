/**
 * @time: 2025/08/14 09:48
 * @author: FireGuo
 * WindyPear-Team All right reserved
 **/
import { Session } from './session.js';
import { Middleware } from './middleware.js';
import { WebSocketServer } from 'ws';
import { Context } from './context.js';
import { isIP } from 'node:net';

export type RouteHandler = (
  session: Session,
  queryParams: URLSearchParams,
  ...pathParams: string[]
) => Promise<void> | void;

type ParamInfo = { name: string; modifier: '' | '?' | '*' | '+' };
type Segment =
  | { type: 'static'; value: string }
  | { type: 'param'; name: string; modifier: '' | '?' | '*' | '+' };
type HostPattern = {
  hostSegments: Segment[];
  portSegment?: Segment;
  matchWholeHost: boolean;
};
type ParsedAuthority = {
  hostname: string;
  port?: string;
  kind: 'ipv4' | 'ipv6' | 'domain';
};

function parsePatternToSegments(pattern: string): { segments: Segment[]; params: ParamInfo[] } {
  // Normalize: remove leading/trailing slashes for consistent splitting
  const norm = pattern.replace(/^\/+|\/+$/g, '');
  const rawSegs = norm === '' ? [] : norm.split('/');

  const segments: Segment[] = [];
  const params: ParamInfo[] = [];

  for (const seg of rawSegs) {
    if (!seg.startsWith(':')) {
      segments.push({ type: 'static', value: seg });
      continue;
    }

    let name = seg.slice(1);
    let modifier: '' | '?' | '*' | '+' = '';

    const lastChar = name[name.length - 1];
    if (lastChar === '?' || lastChar === '*' || lastChar === '+') {
      modifier = lastChar as '?' | '*' | '+';
      name = name.slice(0, -1);
    }

    segments.push({ type: 'param', name, modifier });
    params.push({ name, modifier });
  }

  return { segments, params };
}

function parseSegmentToken(part: string): Segment {
  if (!part.startsWith(':')) {
    return { type: 'static', value: part };
  }

  let name = part.slice(1);
  let modifier: '' | '?' | '*' | '+' = '';
  const lastChar = name[name.length - 1];
  if (lastChar === '?' || lastChar === '*' || lastChar === '+') {
    modifier = lastChar as '?' | '*' | '+';
    name = name.slice(0, -1);
  }

  return { type: 'param', name, modifier };
}

function splitHostAndPortPattern(pattern: string): { hostPart: string; portPart?: string } {
  const normalized = pattern.trim().toLowerCase();

  if (normalized.startsWith('[')) {
    const end = normalized.indexOf(']');
    if (end === -1) return { hostPart: normalized };
    const hostPart = normalized.slice(1, end);
    const rest = normalized.slice(end + 1);
    if (rest.startsWith(':')) {
      return { hostPart, portPart: rest.slice(1) };
    }
    return { hostPart };
  }

  const colonCount = (normalized.match(/:/g) || []).length;
  const lastColon = normalized.lastIndexOf(':');
  const hasDots = normalized.includes('.');

  if (lastColon === -1) {
    return { hostPart: normalized };
  }

  const suffix = normalized.slice(lastColon + 1);
  const prefix = normalized.slice(0, lastColon);
  const isPortToken = /^\d+$/.test(suffix) || /^:[a-z_][a-z0-9_]*[?*+]?$/.test(`:${suffix}`);

  if (!isPortToken) {
    return { hostPart: normalized };
  }

  if (normalized.startsWith(':') && !hasDots) {
    const paramBody = prefix.slice(1);
    if (/^[a-z_][a-z0-9_]*$/.test(paramBody)) {
      return { hostPart: prefix, portPart: suffix };
    }
  }

  if (colonCount === 1 && !normalized.startsWith(':')) {
    return { hostPart: prefix, portPart: suffix };
  }

  if (hasDots) {
    return { hostPart: prefix, portPart: suffix };
  }

  return { hostPart: normalized };
}

function parseHostPattern(hostPattern: string): HostPattern {
  const { hostPart, portPart } = splitHostAndPortPattern(hostPattern);
  const matchWholeHost = !hostPart.includes('.') || hostPart.includes(':');
  const rawParts = matchWholeHost ? [hostPart] : hostPart.split('.');

  return {
    hostSegments: rawParts.map(parseSegmentToken),
    portSegment: portPart ? parseSegmentToken(portPart) : undefined,
    matchWholeHost,
  };
}

function parseAuthority(host: string): ParsedAuthority {
  const normalized = host.trim().toLowerCase();

  if (normalized.startsWith('[')) {
    const end = normalized.indexOf(']');
    if (end !== -1) {
      const hostname = normalized.slice(1, end);
      const rest = normalized.slice(end + 1);
      const port = rest.startsWith(':') ? rest.slice(1) : undefined;
      return { hostname, port, kind: 'ipv6' };
    }
  }

  if (isIP(normalized) === 6) {
    return { hostname: normalized, kind: 'ipv6' };
  }

  const lastColon = normalized.lastIndexOf(':');
  if (lastColon !== -1 && normalized.indexOf(':') === lastColon) {
    const maybePort = normalized.slice(lastColon + 1);
    if (/^\d+$/.test(maybePort)) {
      const hostname = normalized.slice(0, lastColon);
      if (isIP(hostname) === 4) {
        return { hostname, port: maybePort, kind: 'ipv4' };
      }
      return { hostname, port: maybePort, kind: 'domain' };
    }
  }

  if (isIP(normalized) === 4) {
    return { hostname: normalized, kind: 'ipv4' };
  }

  return { hostname: normalized, kind: 'domain' };
}

function matchSingleSegment(
  seg: Segment,
  value: string | undefined,
  params: Record<string, string | undefined>,
): boolean {
  if (seg.type === 'static') {
    return value === seg.value;
  }

  switch (seg.modifier) {
    case '':
    case '+':
    case '*':
      if (value == null || value === '') {
        if (seg.modifier === '*') {
          params[seg.name] = undefined;
          return true;
        }
        return false;
      }
      params[seg.name] = value;
      return true;
    case '?':
      params[seg.name] = value || undefined;
      return true;
    default:
      return false;
  }
}

function matchHostSegments(
  segments: Segment[],
  parts: string[],
  joiner: string,
  params: Record<string, string | undefined>,
): boolean {
  let hi = 0;
  let hj = 0;

  while (hi < segments.length) {
    const seg = segments[hi];
    const nextSegIsStatic = !!segments[hi + 1] && segments[hi + 1].type === 'static';

    if (seg.type === 'static') {
      if (hj >= parts.length || parts[hj] !== seg.value) return false;
      hi++;
      hj++;
      continue;
    }

    switch (seg.modifier) {
      case '':
        if (hj >= parts.length) return false;
        params[seg.name] = parts[hj];
        hi++;
        hj++;
        break;
      case '?':
        if (hj < parts.length) {
          if (nextSegIsStatic && parts[hj] === (segments[hi + 1] as any).value) {
            params[seg.name] = undefined;
            hi++;
          } else {
            params[seg.name] = parts[hj];
            hi++;
            hj++;
          }
        } else {
          params[seg.name] = undefined;
          hi++;
        }
        break;
      case '+': {
        if (hj >= parts.length) return false;
        let end = parts.length;
        if (nextSegIsStatic) {
          const nextStatic = (segments[hi + 1] as any).value;
          const found = parts.indexOf(nextStatic, hj);
          if (found === -1 || found === hj) return false;
          end = found;
        }
        params[seg.name] = parts.slice(hj, end).join(joiner);
        hj = end;
        hi++;
        break;
      }
      case '*': {
        let end = parts.length;
        if (nextSegIsStatic) {
          const nextStatic = (segments[hi + 1] as any).value;
          const found = parts.indexOf(nextStatic, hj);
          if (found !== -1) end = found;
        }
        const value = parts.slice(hj, end).join(joiner);
        params[seg.name] = value || undefined;
        hj = end;
        hi++;
        break;
      }
      default:
        return false;
    }
  }

  return hj === parts.length;
}

/**
 * Route class using segment-based matching (no fragile capture-group-index mapping).
 * Behavior matches the SimpleRouter in the webpage:
 * - pathname and pattern are split on '/'
 * - supports :param (single required), :param? (single optional), :param+ (one or more segments),
 *   :param* (zero or more segments)
 * - honors "no trailing slash" expectation (we normalize input)
 */
export class Route {
  private segments: Segment[];
  private paramsInfo: ParamInfo[];
  private handler: RouteHandler | null = null;
  public middlewares: Middleware[] = [];
  public allowedMethods: string[] = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD'];
  public ws: WebSocketServer = null;
  public context: Context;
  private routehost: string[] = null;

  /**
   * 创建路由
   * @param path 路由路径
   * @param context 插件上下文
   */
  constructor(public path: string, context: Context) {
    this.context = context;
    const { segments, params } = parsePatternToSegments(path);
    this.segments = segments;
    this.paramsInfo = params;
  }

  /**
   * 设置路由处理器
   * @param handler 路由处理器
   * @returns this
   */
  action(handler: RouteHandler): this {
    this.handler = handler;
    return this;
  }

  /**
   * 设置允许的host
   * @param host host列表
   * @returns this
   */
  host(host: string[] | string): this {
    if (typeof host === 'string') {
      this.routehost = [host];
    } else {
      this.routehost = host;
    }
    return this;
  }

  /**
   * 挂载中间件
   * @param middleware 中间件
   * @returns this
   */
  use(middleware: Middleware): this {
    this.middlewares.push(middleware);
    return this;
  }

  /**
   * 匹配路由
   * @param pathname 请求路径
   * @param host 请求host
   * @returns 匹配结果
   */
  match(pathname: string, host?: string): { params: Record<string, string | undefined>; pathParams: string[]; hostParams: Record<string, string> } | null {
    let hostParams: Record<string, string | undefined> = {};
    // Host 匹配逻辑开始
    if (this.routehost && this.routehost.length > 0) {
      if (!host) return null; // 如果设置了 host 限制但没有传入 host，直接失败

      const actual = parseAuthority(host);
      let hostMatched = false;
      for (const pattern of this.routehost) {
        const parsedPattern = parseHostPattern(pattern);
        const hostParts = parsedPattern.matchWholeHost || actual.kind === 'ipv6'
          ? [actual.hostname]
          : actual.hostname.split('.');
        const joiner = parsedPattern.matchWholeHost || actual.kind === 'ipv6' ? ':' : '.';
        let tempParams: Record<string, string | undefined> = {};
        const hostOk = matchHostSegments(parsedPattern.hostSegments, hostParts, joiner, tempParams);
        if (!hostOk) continue;

        if (parsedPattern.portSegment) {
          const portOk = matchSingleSegment(parsedPattern.portSegment, actual.port, tempParams);
          if (!portOk) continue;
        }

        hostMatched = true;
        hostParams = tempParams;
        break; // 只要匹配到一个 host pattern 就行
      }

      if (!hostMatched) return null;
    }
    // Host 匹配逻辑结束
    // 路由匹配逻辑开始
    if (pathname.startsWith('/')) {
      // normalize pathname: remove leading/trailing slashes
      const normPath = pathname.replace(/^\/+|\/+$/g, '');
      const parts = normPath === '' ? [] : normPath.split('/');

      const params: Record<string, string | undefined> = {};
      const pathParams: string[] = [];

      let i = 0; // index into segments (pattern)
      let j = 0; // index into parts (path)

      while (i < this.segments.length) {
        const seg = this.segments[i];

        // static must match exactly
        if (seg.type === 'static') {
          if (j >= parts.length) return null;
          if (parts[j] !== seg.value) return null;
          i++; j++;
          continue;
        }

        // seg.type === 'param'
        const nextSegIsStatic = (() => {
          const next = this.segments[i + 1];
          return !!next && next.type === 'static';
        })();

        switch (seg.modifier) {
          case '': { // required single segment
            if (j >= parts.length) return null;
            params[seg.name] = parts[j];
            pathParams.push(parts[j]);
            i++; j++;
            break;
          }

          case '?': { // optional single segment
            // If next segment is static, we should not consume the part when it equals that static
            if (j < parts.length) {
              if (nextSegIsStatic) {
                // peek: if current part equals next static, then this optional param is absent
                const nextStatic = (this.segments[i + 1] as any).value;
                if (parts[j] === nextStatic) {
                  params[seg.name] = undefined;
                  pathParams.push('');
                  i++;
                  break;
                }
              }
              // otherwise consume one segment as the optional param
              params[seg.name] = parts[j];
              pathParams.push(parts[j]);
              j++;
            } else {
              params[seg.name] = undefined;
              pathParams.push('');
            }
            i++;
            break;
          }

          case '+': { // required multi (one or more segments)
            if (j >= parts.length) return null; // must have at least one
            // find boundary where next static occurs (if any)
            let end = parts.length;
            if (nextSegIsStatic) {
              const nextStatic = (this.segments[i + 1] as any).value;
              let found = -1;
              for (let k = j; k < parts.length; k++) {
                if (parts[k] === nextStatic) { found = k; break; }
              }
              if (found === -1) return null; // next static not found -> cannot satisfy pattern
              end = found;
              if (end === j) return null; // need at least one segment
            }
            // consume parts[j..end-1]
            const value = parts.slice(j, end).join('/');
            params[seg.name] = value;
            pathParams.push(value);
            j = end;
            i++;
            break;
          }

          case '*': { // optional multi (zero or more)
            // If next static exists, consume until that static; else consume all remainder (may be zero)
            let end = parts.length;
            if (nextSegIsStatic) {
              const nextStatic = (this.segments[i + 1] as any).value;
              let found = -1;
              for (let k = j; k < parts.length; k++) {
                if (parts[k] === nextStatic) { found = k; break; }
              }
              if (found === -1) {
                // next static not found => we cannot match the remainder to the next pattern,
                // but '*' can consume all remainder (and then next static will fail later)
                end = parts.length;
              } else {
                end = found;
              }
            }
            const value = parts.slice(j, end).join('/');
            params[seg.name] = value === '' ? undefined : value;
            pathParams.push(value === '' ? '' : value);
            j = end;
            i++;
            break;
          }

          default:
            return null;
        }
      }

      // after finishing pattern, path must be fully consumed (no extra segments)
      if (j !== parts.length) return null;
      const result = { params, pathParams, hostParams };
      return result;
    } else if (pathname.startsWith('root') && this.path == pathname) {
      const result = { params: { pathname }, pathParams: [pathname], hostParams };
      return result;
    }
    return null;
  }

  /**
   * 执行路由处理器
   * @param session 会话对象
   * @param params 查询参数
   * @param pathParams 路由参数
   */
  async executeHandler(
    session: Session,
    params: URLSearchParams,
    pathParams: string[],
    hostParams: Record<string, string>
  ): Promise<void> {
    if (this.handler) {
      await this.handler(session, params, ...pathParams, ...Object.values(hostParams));
    }
  }

  /**
   * 设置可用方法
   * @param methods 可用方法
   * @returns this
   */
  methods(...methods: string[]): Route {
    this.allowedMethods = methods;
    return this;
  }

  /**
    * 注册Ws处理器
    * @param handler 处理器
    */
  wsOn(event: string, handler: (...args: any[]) => void) {
    if (!this.ws) this.ws = new WebSocketServer({ noServer: true });
    this.ws.on(event, handler);
    return this;
  }
}

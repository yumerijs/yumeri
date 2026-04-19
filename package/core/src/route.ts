/**
 * @time: 2025/08/14 09:48
 * @author: FireGuo
 * WindyPear-Team All right reserved
 **/
import { Session } from './session.js';
import { Middleware } from './middleware.js';
import { WebSocketServer } from 'ws';
import { Context } from './context.js';

export type RouteHandler = (
  session: Session,
  queryParams: URLSearchParams,
  ...pathParams: string[]
) => Promise<void> | void;

type ParamInfo = { name: string; modifier: '' | '?' | '*' | '+' };
type Segment =
  | { type: 'static'; value: string }
  | { type: 'param'; name: string; modifier: '' | '?' | '*' | '+' };

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

function parseHostToSegments(hostPattern: string) {
  // 移除可能的空格，按 . 分割
  const parts = hostPattern.split('.');
  return parts.map(part => {
    // 简单的参数解析逻辑
    if (part.startsWith(':')) {
      const lastChar = part[part.length - 1];
      const hasModifier = ['?', '+', '*'].includes(lastChar);
      return {
        type: 'param',
        name: hasModifier ? part.slice(1, -1) : part.slice(1),
        modifier: hasModifier ? lastChar : '',
      };
    }
    return { type: 'static', value: part };
  });
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

      const actualHost = host.toLowerCase().split(':')[0]; // 移除端口并转小写
      const hostParts = actualHost.split('.');
      let hostMatched = false;
      for (const pattern of this.routehost) {
        const hSegments = parseHostToSegments(pattern); // 这里的 parsePattern 应该和你 path 解析逻辑一致

        let hi = 0; // pattern segment index
        let hj = 0; // actual host parts index
        let tempParams: Record<string, string | undefined> = {};
        let possible = true;

        while (hi < hSegments.length) {
          const seg = hSegments[hi];
          const nextSegIsStatic = !!hSegments[hi + 1] && hSegments[hi + 1].type === 'static';

          if (seg.type === 'static') {
            if (hj >= hostParts.length || hostParts[hj] !== seg.value.toLowerCase()) {
              possible = false; break;
            }
            hi++; hj++;
          } else {
            // 参数匹配逻辑 (:, ?, +, *)
            switch (seg.modifier) {
              case '': // required single
                if (hj >= hostParts.length) { possible = false; break; }
                tempParams[seg.name] = hostParts[hj];
                hi++; hj++; break;
              case '?': // optional single
                if (hj < hostParts.length) {
                  if (nextSegIsStatic && hostParts[hj] === hSegments[hi + 1].value.toLowerCase()) {
                    tempParams[seg.name] = undefined; hi++;
                  } else {
                    tempParams[seg.name] = hostParts[hj]; hj++; hi++;
                  }
                } else { tempParams[seg.name] = undefined; hi++; }
                break;
              case '+': // required multi
                if (hj >= hostParts.length) { possible = false; break; }
                let endP = hostParts.length;
                if (nextSegIsStatic) {
                  let found = hostParts.indexOf(hSegments[hi + 1].value.toLowerCase(), hj);
                  if (found === -1) { possible = false; break; }
                  endP = found;
                }
                if (endP === hj) { possible = false; break; }
                tempParams[seg.name] = hostParts.slice(hj, endP).join('.');
                hj = endP; hi++; break;
              case '*': // optional multi
                let endS = hostParts.length;
                if (nextSegIsStatic) {
                  let found = hostParts.indexOf(hSegments[hi + 1].value.toLowerCase(), hj);
                  if (found !== -1) endS = found;
                }
                const val = hostParts.slice(hj, endS).join('.');
                tempParams[seg.name] = val === '' ? undefined : val;
                hj = endS; hi++; break;
              default: possible = false; break;
            }
            if (!possible) break;
          }
        }

        if (possible && hj === hostParts.length) {
          hostMatched = true;
          hostParams = tempParams;
          break; // 只要匹配到一个 host pattern 就行
        }
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

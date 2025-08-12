// route.ts
import { Session } from './session';
import { Middleware } from './middleware';

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

  constructor(public path: string) {
    const { segments, params } = parsePatternToSegments(path);
    this.segments = segments;
    this.paramsInfo = params;
  }

  action(handler: RouteHandler): this {
    this.handler = handler;
    return this;
  }

  use(middleware: Middleware): this {
    this.middlewares.push(middleware);
    return this;
  }

  /**
   * match pathname against pattern.
   * - pathname should be provided without trailing slash, but we normalize anyway.
   * - returns { params: Record<name,string>, pathParams: string[] } or null
   */
  match(pathname: string): { params: Record<string, string | undefined>; pathParams: string[] } | null {
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

    return { params, pathParams };
  }

  async executeHandler(
    session: Session,
    params: URLSearchParams,
    pathParams: string[]
  ): Promise<void> {
    if (this.handler) {
      await this.handler(session, params, ...pathParams);
    }
  }
}

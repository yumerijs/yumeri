import { Context, Config, Session, Logger, ConfigSchema } from 'yumeri';
import path from 'path';
import fse from 'fs-extra';
import { PagesComponent } from 'yumeri-plugin-pages'; // 仅类型引用

const logger = new Logger('frontend');
const depend = ['pages'];

// 获取模板目录
function getTemplates(): string[] {
  const dir = path.join(process.cwd(), 'data/templates');
  fse.ensureDirSync(dir);
  return fse.readdirSync(dir);
}

// 配置项
export const config = {
  schema: {
    template: {
      type: 'string',
      default: 'default',
      description: '前端模板风格',
      enum: getTemplates(),
    },
    urlStyle: {
      type: 'string',
      default: 'pretty',
      enum: ['query', 'prefix'],
      description: 'URL 风格（query: ?page=title, prefix: /page/title）',
    },
    postPrefix: {
      type: 'string',
      default: 'post',
      description: '文章路径前缀（仅在 prefix 模式下生效）',
    },
    pagePrefix: {
      type: 'string',
      default: 'page',
      description: '页面路径前缀（仅在 prefix 模式下生效）',
    },
  } as Record<string, ConfigSchema>,
};

// 读取模板目录下 config.json
function getTemplateConfig(template: string) {
  const cfgPath = path.join(process.cwd(), 'data/templates', template, 'config.json');
  if (fse.existsSync(cfgPath)) {
    try {
      return JSON.parse(fse.readFileSync(cfgPath, 'utf-8'));
    } catch (err) {
      logger.warn(`解析模板 config.json 出错: ${err}`);
      return {};
    }
  }
  return {};
}

// parsed 类型定义（宽松，允许后续修改 type/slug）
interface ParsedRoute {
  type: 'home' | 'query' | 'post' | 'page' | 'auto';
  slug?: string;
  templatePath?: string;
}

// 路由解析
function parseRoute(pathname: string, config: Config): ParsedRoute {
  const urlStyle = config.get<string>('urlStyle');
  const postPrefix = config.get<string>('postPrefix');
  const pagePrefix = config.get<string>('pagePrefix');

  if (!pathname || pathname === '/') return { type: 'home' };

  const clean = pathname.replace(/^\/|\/$/g, '');
  const segments = clean.split('/').filter(Boolean);

  switch (urlStyle) {
    case 'prefix':
      if (segments[0] === postPrefix) return { type: 'post', slug: segments[1] ?? 'index' };
      if (segments[0] === pagePrefix) return { type: 'page', slug: segments[1] ?? 'index' };
      return { type: 'auto', slug: segments[0] ?? 'index' };
    case 'query':
      return { type: 'query' };
    default:
      return { type: 'auto', slug: segments[0] ?? 'index' };
  }
}

/**
 * 合并 frontend:render hook 的返回
 * - 支持形态：单个对象 / 对象数组 / 多个 hook 返回的嵌套数组等
 * - 按顺序合并，后到覆盖先到（"先来后到"）
 */
function mergeHookResults(raw: any): Record<string, string> {
  const merged: Record<string, string> = {};
  if (!raw) return merged;

  const outer = Array.isArray(raw) ? raw : [raw];
  for (const entry of outer) {
    if (Array.isArray(entry)) {
      for (const obj of entry) {
        if (obj && typeof obj === 'object') {
          for (const [k, v] of Object.entries(obj)) {
            merged[k] = v == null ? '' : String(v);
          }
        }
      }
    } else if (entry && typeof entry === 'object') {
      for (const [k, v] of Object.entries(entry)) {
        merged[k] = v == null ? '' : String(v);
      }
    } else {
      logger.warn('frontend:render hook 返回了非对象/非数组类型，已忽略');
    }
  }
  return merged;
}

// 替换模板占位符（全局替换）
function applyReplacements(content: string, replacements: Record<string, string>): string {
  let result = content;
  for (const [key, value] of Object.entries(replacements)) {
    result = result.split(`{{${key}}}`).join(value);
  }
  return result;
}

export async function apply(ctx: Context, config: Config) {
  try {
    const pages = ctx.getComponent('pages') as PagesComponent | undefined;
    if (pages) {
      await pages.insert({
        name: 'Hello World',
        description: '这是自动插入的测试文章，用于 frontend 渲染测试。',
        type: 'post',
        content: '<h1>Hello, Yumeri!</h1><p>自动插入的测试文章内容。</p>',
        created_at: new Date(),
        updated_at: new Date(),
        author_id: 1,
        status: 'publish',
        comment_status: 'open',
      });
      logger.info('已插入测试文章: Hello World');
    } else {
      logger.warn('pages 组件未注册，跳过插入测试文章');
    }
  } catch (err) {
    logger.warn(`插入测试文章失败: ${err}`);
  }

  // 注册路由处理
  ctx.route('root').action(async (session: Session, params: URLSearchParams) => {
    try {
      const pathname = (session.pathname || '/').replace(/\/+$/, '') || '/';
      const templateName = config.get<string>('template');
      const templatePath = path.join(process.cwd(), 'data/templates', templateName);

      // 解析路由（宽松 ParsedRoute）
      const parsed: ParsedRoute = parseRoute(pathname, config);
      const templateCfg = getTemplateConfig(templateName);

      logger.info(`使用模板: ${templateName}, 路由解析结果: ${JSON.stringify(parsed)}`);

      // query 模式解析并允许修改 parsed.type/slug（类型是联合，不会报错）
      if (parsed.type === 'query') {
        if (params && params.has('post')) {
          parsed.type = 'post';
          parsed.slug = params.get('post') ?? 'index';
        } else if (params && params.has('page')) {
          parsed.type = 'page';
          parsed.slug = params.get('page') ?? 'index';
        } else {
          parsed.type = 'home';
        }
      }

      // 决定模板文件：home 交由模板定义；非 home 尝试 pages/slug.html 或 fallback
      let filePath: string | null = null;
      if (parsed.type === 'home') {
        if (templateCfg && templateCfg.home) {
          filePath = path.join(templatePath, templateCfg.home);
        } else {
          const base = templatePath;
          const found = ['index.html', 'home.html'].map(n => path.join(base, n)).find(fse.existsSync);
          filePath = found ?? null;
        }
      } else {
        const base = path.join(templatePath, 'pages');
        const slug = parsed.slug ?? 'index';
        const fallback = path.join(templatePath, 'pages', parsed.type + '.html');
        if (fse.existsSync(fallback)) filePath = fallback;
        else {
          const rootDefault = path.join(templatePath, 'default.html');
          filePath = fse.existsSync(rootDefault) ? rootDefault : null;
        }
      }

      if (!filePath || !fse.existsSync(filePath)) {
        session.status = 404;
        session.body = '404 Not Found';
        return;
      }

      // 读取模板内容（字符串）
      let content = fse.readFileSync(filePath, 'utf-8');

      // 获取 pages 组件并读取页面数据（如果适用）
      const pages = ctx.getComponent('pages') as PagesComponent | undefined;
      let pageData: any = null;
      if (pages && parsed.type !== 'home') {
        try {
          const condition =
            parsed.type === 'post'
              ? { type: 'post', name: parsed.slug }
              : parsed.type === 'page'
                ? { type: 'page', name: parsed.slug }
                : { name: parsed.slug };
          const found = await pages.get(condition);
          pageData = Array.isArray(found) ? found[0] : found;
        } catch (err) {
          logger.warn(`从 pages 组件获取内容失败: ${err}`);
        }
      }

      // 默认 internal 数据（hook 的 internal:* 可以覆盖这些）
      const defaultInternal: Record<string, string> = {
        'internal:title': pageData?.name ?? '默认标题',
        'internal:path': pathname,
        'internal:slug': parsed.slug ?? 'index',
        'internal:content': pageData?.content ?? '',
      };

      // 调用 frontend:render hook，传入解析后的数据（供 hook 使用）
      let hookRawResult: any = null;
      try {
        hookRawResult = await ctx.executeHook('frontend:render', {
          pathname,
          route: parsed,
          template: templateName,
          page: pageData,
        });
      } catch (err) {
        logger.warn(`执行 frontend:render hook 失败: ${err}`);
        hookRawResult = null;
      }

      // 合并 hook 返回（后到覆盖先到）
      const mergedFromHooks = mergeHookResults(hookRawResult);

      // 如果 hooks 中存在 internal:content，则直接用该值覆盖模板源 content（这是你特别要求的行为）
      if (mergedFromHooks['internal:content'] !== undefined) {
        content = mergedFromHooks['internal:content'];
      }

      // non-internal from hooks
      const nonInternalFromHooks: Record<string, string> = {};
      const internalFromHooks: Record<string, string> = {};
      for (const [k, v] of Object.entries(mergedFromHooks)) {
        if (k.startsWith('internal:')) internalFromHooks[k] = v;
        else nonInternalFromHooks[k] = v;
      }

      // internal 最终 = defaultInternal 被 internalFromHooks 覆盖 (hook 的 internal 覆盖默认)
      const finalInternal: Record<string, string> = { ...defaultInternal, ...internalFromHooks };

      // 最终替换表：先放 hooks 的非 internal，再放 internal（保证 internal 最终可以覆盖）
      const finalReplace: Record<string, string> = { ...nonInternalFromHooks, ...finalInternal };

      // 执行替换（替换所有 {{key}}）
      content = applyReplacements(content, finalReplace);

      // 最终必须是字符串
      session.body = String(content);
      session.setMime('html');
    } catch (err) {
      logger.error(`frontend 渲染出错: ${err}`);
      session.status = 500;
      session.body = 'Internal Server Error';
    }
  });
}
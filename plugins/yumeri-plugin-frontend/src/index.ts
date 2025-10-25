import { Context, Config, Session, Logger, ConfigSchema } from 'yumeri'
import path from 'path'
import fse from 'fs-extra'
import { PagesComponent } from 'yumeri-plugin-pages' // 仅类型引用

const logger = new Logger('frontend')
export const depend = ['pages']
export const provide = ['frontend']

function getTemplates(): string[] {
  const dir = path.join(process.cwd(), 'data/templates')
  fse.ensureDirSync(dir)
  return fse.readdirSync(dir)
}

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
      enum: ['query', 'prefix', 'id'],
      description: 'URL 风格（query: ?post=slug, prefix: /post/slug, id: /post/1）',
    },
    pageUrlStyle: {
      type: 'string',
      default: 'pretty',
      enum: ['slug', 'slugHtml'],
      description: '页面 URL 风格（slug: /about, slugHtml: /about.html）',
    },
    postPrefix: {
      type: 'string',
      default: 'post',
      description: '文章路径前缀',
    },
  } as Record<string, ConfigSchema>,
}

function getTemplateConfig(template: string) {
  const cfgPath = path.join(process.cwd(), 'data/templates', template, 'config.json')
  if (fse.existsSync(cfgPath)) {
    try {
      return JSON.parse(fse.readFileSync(cfgPath, 'utf-8'))
    } catch (err) {
      logger.warn(`解析模板 config.json 出错: ${err}`)
      return {}
    }
  }
  return {}
}

interface ParsedRoute {
  type: 'home' | 'post' | 'page' | string
  slug?: string
  id?: number
}

function parseRoute(pathname: string, config: Config): ParsedRoute {
  const urlStyle = config.get<string>('urlStyle')
  const pageUrlStyle = config.get<string>('pageUrlStyle')
  const postPrefix = config.get<string>('postPrefix')

  if (!pathname || pathname === '/') return { type: 'home' }

  const clean = pathname.replace(/^\/|\/$/g, '')
  const segments = clean.split('/').filter(Boolean)

  // 页面特殊处理
  if (pageUrlStyle === 'slugHtml' && /\.html$/.test(clean)) {
    const slug = clean.replace(/\.html$/, '')
    return { type: 'page', slug }
  }
  if (pageUrlStyle === 'slug') {
    if (segments.length === 1) return { type: 'page', slug: segments[0] }
  }

  // 文章模式
  switch (urlStyle) {
    case 'id': {
      if (segments[0] === postPrefix) {
        const id = segments[1];
        if (!/^\d+$/.test(id)) return { type: '404' };
        return { type: 'post', id: parseInt(id, 10) };
      }
      return { type: 'auto', slug: segments[0] ?? 'index' };
    }

    case 'prefix':
      if (segments[0] === postPrefix)
        return { type: 'post', slug: segments[1] ?? 'index' };
      return { type: 'auto', slug: segments[0] ?? 'index' };

    default:
      return { type: 'auto', slug: segments[0] ?? 'index' };
  }
}

function mergeHookResults(raw: any): Record<string, string> {
  const merged: Record<string, string> = {}
  if (!raw) return merged
  const outer = Array.isArray(raw) ? raw : [raw]
  for (const entry of outer) {
    if (Array.isArray(entry)) {
      for (const obj of entry) {
        if (obj && typeof obj === 'object') {
          for (const [k, v] of Object.entries(obj)) merged[k] = String(v ?? '')
        }
      }
    } else if (entry && typeof entry === 'object') {
      for (const [k, v] of Object.entries(entry)) merged[k] = String(v ?? '')
    } else logger.warn('frontend:render hook 返回了非对象/非数组类型，已忽略')
  }
  return merged
}

function applyReplacements(content: string, replacements: Record<string, string>): string {
  let result = content
  for (const [key, value] of Object.entries(replacements))
    result = result.split(`{{${key}}}`).join(value)
  return result
}

export async function apply(ctx: Context, config: Config) {
  ctx.route('root').action(async (session: Session, params: URLSearchParams) => {
    try {
      const pathname = (session.pathname || '/').replace(/\/+$/, '') || '/'
      const templateName = config.get<string>('template')
      const templatePath = path.join(process.cwd(), 'data/templates', templateName)
      const parsed = parseRoute(pathname, config)
      const templateCfg = getTemplateConfig(templateName)

      const pages = ctx.getComponent('pages') as PagesComponent | undefined
      let pageData: any = null
      let metas: any[] = []
      if (parsed.type == '404') {
        const file404 = path.join(templatePath, '404.html')
        if (fse.existsSync(file404)) {
          session.status = 404
          session.body = fse.readFileSync(file404, 'utf-8')
        } else {
          session.status = 404
          session.body = '404 Not Found'
        }
        return
      }

      if (pages && parsed.type !== 'home') {
        try {
          let condition: any = {}
          if (parsed.id) condition.id = parsed.id
          if (parsed.slug) condition.name = parsed.slug
          const found = await pages.get(condition)
          const arr = Array.isArray(found) ? found : found ? [found] : []
          pageData = arr[0] ?? null
          if (pageData?.id) metas = await pages.getMetadatas(pageData.id)
        } catch (err) {
          logger.warn(`获取页面内容失败: ${err}`)
        }
      }

      if (!pageData && parsed.type !== 'home') {
        const file404 = path.join(templatePath, '404.html')
        if (fse.existsSync(file404)) {
          session.status = 404
          session.body = fse.readFileSync(file404, 'utf-8')
          session.setMime('html')
        } else {
          session.status = 404
          session.body = '404 Not Found'
        }
        return
      }

      let filePath: string | null = null
      if (parsed.type === 'home') {
        const homeCandidate = templateCfg.home
          ? path.join(templatePath, templateCfg.home)
          : path.join(templatePath, 'index.html')
        filePath = fse.existsSync(homeCandidate) ? homeCandidate : null
      } else {
        const candidates = [
          path.join(templatePath, `single-${pageData?.type}.html`),
          path.join(templatePath, `${pageData?.type}.html`),
          path.join(templatePath, 'single.html'),
          path.join(templatePath, 'index.html'),
        ]
        filePath = candidates.find(fse.existsSync) ?? null
      }

      if (!filePath) {
        session.status = 404
        session.body = '404 Not Found'
        return
      }

      let content = fse.readFileSync(filePath, 'utf-8')

      let hookRawResult: any = null
      // 提取模板中可用的 hook 点位（{{xxx}}）
      const hookPoints = Array.from(content.matchAll(/{{(.*?)}}/g)).map(m => m[1])
      try {
        hookRawResult = await ctx.executeHook('frontend:render', {
          pathname,
          route: parsed,
          template: templateName,
          page: pageData,
          metadatas: metas,
          hooks: hookPoints,
        })
      } catch (err) {
        logger.warn(`执行 frontend:render hook 失败: ${err}`)
      }

      const mergedHooks = mergeHookResults(hookRawResult)
      if (mergedHooks['internal:content'] !== undefined)
        content = mergedHooks['internal:content']

      const finalInternal = {
        'internal:title': pageData?.name ?? '默认标题',
        'internal:content': pageData?.content ?? '',
        'internal:slug': parsed.slug ?? '',
        'internal:path': pathname,
      }
      const finalReplace = { ...mergedHooks, ...finalInternal }
      content = applyReplacements(content, finalReplace)

      session.setMime('html')
      session.body = content
    } catch (err) {
      logger.error(`frontend 渲染出错: ${err}`)
      session.status = 500
      session.body = 'Internal Server Error'
    }
  })
}
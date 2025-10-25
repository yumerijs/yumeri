import { Context, Config, Logger, ConfigSchema } from 'yumeri';
import { PagesComponent } from 'yumeri-plugin-pages';

const logger = new Logger("tinytools");
export const depend = ['pages'];

export const config = {} as Record<string, ConfigSchema>

const tools = {
  postlist: async function(pages: PagesComponent, info: any) {
    const limit = parseInt(info.args?.[0], 10) || 5;
    const pagesList = await pages.get({ type: 'post', status: 'publish' }) as any[];
    const sliced = (pagesList || []).slice(0, limit);
    return `<ul>${sliced.map(p => `<li>${p.name}</li>`).join('')}</ul>`;
  }
}

export async function apply(ctx: Context, config: Config) {
  const pages = ctx.getComponent('pages') as PagesComponent;

  ctx.hook('frontend:render', 'tinytools', async (info) => {
    const result: Record<string, string> = {};

    if (!info.hooks || !Array.isArray(info.hooks)) return result;

    for (const hook of info.hooks) {
      if (!hook.startsWith('tinytools:')) continue;

      const parts = hook.split(':'); // ['tinytools', 'postlist', ...可选参数]
      const toolName = parts[1];
      const args = parts.slice(2);
      const toolFn = tools[toolName as keyof typeof tools];

      if (toolFn) {
        try {
          result[hook] = await toolFn(pages, { ...info, args });
        } catch (err) {
          logger.error(`tinytools error on hook ${hook}:`, err);
          result[hook] = '';
        }
      }
    }

    return result;
  });
}
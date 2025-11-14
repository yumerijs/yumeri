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

    // 返回 HTML
    return `
      <style>
        .tinytools-postlist {
          display: flex;
          flex-direction: column;
          gap: 10px;
          padding: 0;
          list-style: none;
        }
        .tinytools-postlist li {
          background: #fff;
          border-radius: 8px;
          box-shadow: 0 2px 5px rgba(0,0,0,0.1);
          padding: 12px 16px;
          transition: transform 0.2s, box-shadow 0.2s;
          cursor: pointer;
        }
        .tinytools-postlist li:hover {
          transform: translateY(-2px);
          box-shadow: 0 5px 15px rgba(0,0,0,0.2);
        }
        .tinytools-postlist li a {
          text-decoration: none;
          color: #333;
          font-weight: 500;
        }
      </style>
      <ul class="tinytools-postlist">
        ${sliced.map(p => `<li><a href="/post/${p.id}">${p.name}</a></li>`).join('')}
      </ul>
    `;
  }
}

export async function apply(ctx: Context, config: Config) {
  const pages = ctx.component.pages;

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
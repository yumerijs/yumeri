import { Context, Config, Session, Middleware, Logger, ConfigSchema } from 'yumeri';

const logger = new Logger("analyse");
import { Database } from '@yumerijs/types/dist/database'

export const depend = ['database'];

export const config = {
  schema: {
    paths: {
      type: 'array',
      default: ['api'],
      description: '排除url开头（不加前后斜线）'
    }
  } as Record<string, ConfigSchema>
};

const analyseHtml = `<div class="module-section">
    <h3 class="module-title">访问统计</h3>
    <div class="grid" id="statsGrid">
        <div class="block" style="cursor:default">
            <i class="fa-solid fa-chart-line"></i>
            <h3>总浏览次数</h3>
            <p class="stat-value" id="totalViews">加载中</p>
        </div>
        <div class="block" style="cursor:default">
            <i class="fa-solid fa-calendar-day"></i>
            <h3>今日浏览</h3>
            <p class="stat-value" id="todayViews">加载中</p>
        </div>
        <div class="block" style="cursor:default">
            <i class="fa-solid fa-calendar-alt"></i>
            <h3>本月浏览</h3>
            <p class="stat-value" id="monthViews">加载中</p>
        </div>
    </div>
</div>`

const analyseJs = `async function loadStats() {
    const totalEl = document.getElementById('totalViews');
    const todayEl = document.getElementById('todayViews');
    const monthEl = document.getElementById('monthViews');

    totalEl.textContent = todayEl.textContent = monthEl.textContent = '加载中...';

    async function fetchJSON(url) {
        const resp = await fetch(url);
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        const data = await resp.json();
        return Number(data.total) || 0;
    }

    try {
        const [total, today, month] = await Promise.all([
            fetchJSON('/api/analyse-total'),
            fetchJSON('/api/analyse/1'),
            fetchJSON('/api/analyse/30')
        ]);

        totalEl.textContent = total.toLocaleString();
        todayEl.textContent = today.toLocaleString();
        monthEl.textContent = month.toLocaleString();
    } catch (err) {
        console.error('加载统计数据失败：', err);
        totalEl.textContent = todayEl.textContent = monthEl.textContent = '加载失败';
    }
}

loadStats();`

export async function apply(ctx: Context, config: Config) {
  const db = ctx.getComponent('database') as Database
  if (!await db.tableExists('analyse')) {
    await db.createTable('analyse', {
      day: { type: 'number', primaryKey: true },
      times: { type: 'number', default: 0 }
    })
  }
  ctx.hook('console:home', 'analyse', async () => {
    return analyseHtml;
  })
  ctx.hook('console:homejs', 'analyse', async () => {
    return analyseJs;
  })
  const getStartWith = (pathname: string) => {
    const paths = config.get<string[]>('paths', [])
    for (const path of paths) {
      if (pathname.startsWith('/' + path)) {
        return false
      }
    }
    return true
  }
  ctx.use('analyse:mdw', async (session, next) => {
    await next();
    if (getStartWith(session.pathname) && session.head['Content-Type'] === 'text/html') {
      // 统计浏览次数
      const day = (new Date().getDate()) + 100 * (new Date().getMonth()) + 10000 * (new Date().getFullYear())
      const analyse = await db.findOne('analyse', { day })
      if (analyse) {
        await db.update('analyse', { times: analyse.times + 1 }, { day })
      } else {
        await db.insert('analyse', { day, times: 1 })
      }
    }
  })
  ctx.route('/api/analyse/:range')
    .action(async (session, _, range) => {
      try {
        const ranges = parseInt(range) - 1
        const day = (new Date().getDate()) + 100 * (new Date().getMonth()) + 10000 * (new Date().getFullYear())
        const year = parseInt(day.toString().slice(0, 4), 10);
        const month = parseInt(day.toString().slice(4, 6), 10) - 1; // 月份从0开始
        const date = parseInt(day.toString().slice(6, 8), 10);

        // 创建日期对象并减去 range 天
        const currentDate = new Date(year, month, date);
        currentDate.setDate(currentDate.getDate() - ranges);

        // 重新拼成 YYYYMMDD 格式
        const foreDate =
          currentDate.getFullYear().toString() +
          String(currentDate.getMonth() + 1).padStart(2, '0') +
          String(currentDate.getDate()).padStart(2, '0');
        const analyse = await db.all(`SELECT * FROM analyse WHERE day >= ${foreDate} AND day <= ${day}`)
        const total = analyse.reduce((total, current) => total + current.times, 0)
        session.setMime('json')
        session.body = JSON.stringify({ total })
      } catch (error) {
        logger.error(error)
        session.status = 500
      }

    })

  // 总浏览量
  ctx.route('/api/analyse-total')
    .action(async (session) => {
      try {
        const analyse = await db.find('analyse')
        // 计算总浏览数
        const total = analyse.reduce((total, current) => total + current.times, 0)
        session.setMime('json')
        session.body = JSON.stringify({ total })
      } catch (error) {
        logger.error(error)
        session.status = 500
      }
    })
}
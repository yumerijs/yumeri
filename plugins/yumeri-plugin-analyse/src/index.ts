import { Context, Config, Logger, ConfigSchema } from 'yumeri';
import { Database } from '@yumerijs/types';
import './types';

const logger = new Logger("analyse");

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

// HTML and JS for the console page remain the same
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
</div>`;

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

loadStats();`;

export async function apply(ctx: Context, config: Config) {
  const db = ctx.getComponent('database') as Database

  await db.extend('analyse', {
    day: 'unsigned', // Use a more specific type
    times: 'unsigned',
  }, { primary: 'day' });

  ctx.hook('console:home', 'analyse', async () => analyseHtml);
  ctx.hook('console:homejs', 'analyse', async () => analyseJs);

  const getStartWith = (pathname: string) => {
    const paths = config.get<string[]>('paths', []);
    return !paths.some(path => pathname.startsWith('/' + path));
  };

  ctx.use('analyse:mdw', async (session, next) => {
    await next();
    if (getStartWith(session.pathname) && session.head['Content-Type'] === 'text/html') {
      const day = (new Date().getDate()) + 100 * (new Date().getMonth() + 1) + 10000 * (new Date().getFullYear());
      
      // Use a single atomic SQL statement to prevent race conditions.
      const sql = `INSERT INTO analyse (day, times) VALUES (?, 1) ON CONFLICT(day) DO UPDATE SET times = times + 1`;
      await db.run(sql, [day]);
    }
  });

  ctx.route('/api/analyse/:range').action(async (session, _, range) => {
    try {
      const ranges = parseInt(range, 10) - 1;
      const today = new Date();
      const pastDate = new Date(today);
      pastDate.setDate(today.getDate() - ranges);

      const formatDate = (date: Date) => (date.getDate()) + 100 * (date.getMonth() + 1) + 10000 * (date.getFullYear());

      const dayEnd = formatDate(today);
      const dayStart = formatDate(pastDate);

      // Use select() with query operators for cleaner, safer queries
      const analyses = await db.select('analyse', {
        day: { $gte: dayStart, $lte: dayEnd }
      });

      const total = analyses.reduce((sum, current) => sum + current.times, 0);
      session.setMime('json');
      session.body = JSON.stringify({ total });
    } catch (error) {
      logger.error(error);
      session.status = 500;
    }
  });

  ctx.route('/api/analyse-total').action(async (session) => {
    try {
      // Use select() to get all records
      const analyses = await db.select('analyse', {});
      const total = analyses.reduce((sum, current) => sum + current.times, 0);
      session.setMime('json');
      session.body = JSON.stringify({ total });
    } catch (error) {
      logger.error(error);
      session.status = 500;
    }
  });
}

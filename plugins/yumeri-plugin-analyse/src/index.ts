import { Context, Config, Session, Middleware, Logger, ConfigSchema } from 'yumeri';

const logger = new Logger("analyse");

export const config = {
  schema: {
    content: {
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
            <p class="stat-value" id="totalViews">12,834</p>
        </div>
        <div class="block" style="cursor:default">
            <i class="fa-solid fa-calendar-day"></i>
            <h3>今日浏览</h3>
            <p class="stat-value" id="todayViews">324</p>
        </div>
        <div class="block" style="cursor:default">
            <i class="fa-solid fa-calendar-alt"></i>
            <h3>本月浏览</h3>
            <p class="stat-value" id="monthViews">4,276</p>
        </div>
    </div>
</div>`

export async function apply(ctx: Context, config: Config) {
  ctx.hook('console:home', 'analyse', async () => {
    return analyseHtml;
  })
  ctx.use('analyse:mdw', async (session, next) => {
    await next();
  })
}
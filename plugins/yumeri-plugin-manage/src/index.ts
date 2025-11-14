import { Context, Logger, Session } from 'yumeri'
import 'yumeri-plugin-console'

const logger = new Logger("manage")

export const depend = ['console']

// 控制台 HTML
const manageHtml = `
<div class="module-section">
  <h3 class="module-title">进程管理</h3>
  <div class="grid">
    <div class="block" onclick="manageAction('restart')">
      <i class="fa-solid fa-rotate-right"></i>
      <h3>重启进程</h3>
      <p>立即重启框架</p>
    </div>
    <div class="block" onclick="manageAction('shutdown')">
      <i class="fa-solid fa-power-off"></i>
      <h3>关闭进程</h3>
      <p>停止当前框架进程</p>
    </div>
  </div>
</div>
`

// 控制台 JS（关键是挂到 window）
const manageJs = `
window.manageAction = async function(action) {
  if (!confirm('确定要执行 ' + (action === 'restart' ? '重启' : '关闭') + ' 吗？')) return;
  try {
    const resp = await fetch('/api/manage?action=' + action);
    const data = await resp.json();
    alert(data.message || '操作完成');
  } catch (err) {
    alert('操作失败：' + err);
  }
};
`

export async function apply(ctx: Context) {
  const consoleApi = ctx.component.console

  const requireLogin = (
    handler: (session: Session, params: URLSearchParams) => Promise<void>
  ) => {
    return async (session: Session, params: URLSearchParams) => {
      if (consoleApi.getloginstatus(session)) {
        await handler(session, params)
      } else {
        session.setMime('json')
        session.body = JSON.stringify({ success: false, message: '请先登录' })
      }
    }
  }

  // 在控制台注册显示模块
  ctx.hook('console:home', 'manage', async () => manageHtml)
  ctx.hook('console:homejs', 'manage', async () => manageJs)

  // 注册接口
  ctx.route('/api/manage').action(requireLogin(async (session, params) => {
    try {
      const action = params.get('action')

      if (!action) {
        session.setMime('json')
        session.body = JSON.stringify({ success: false, message: '缺少操作参数' })
        return
      }

      if (action === 'restart') {
        session.setMime('json')
        session.body = JSON.stringify({ success: true, message: '正在重启进程...' })
        logger.info('Restarting Yumeri...')
        setTimeout(() => process.exit(10), 100)
      } else if (action === 'shutdown') {
        session.setMime('json')
        session.body = JSON.stringify({ success: true, message: '正在关闭进程...' })
        logger.info('Shutting down Yumeri...')
        setTimeout(() => process.exit(0), 100)
      } else {
        session.setMime('json')
        session.body = JSON.stringify({ success: false, message: '未知的操作类型' })
      }
    } catch (err) {
      logger.error(err)
      session.status = 500
    }
  }))
}
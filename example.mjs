import pkg from 'yumeri';
const { Core, Context } = pkg;
const serverconfig = {
    port: 8080,
    host: '0.0.0.0'
}
const core = new Core(null , serverconfig)
const ctx = new Context(core, 'MyAPP')
let count = 0
core.runCore()
ctx.route('/hello/:name/:age/:others+')
    .action(async (session, _, name, age, others) => {
        session.setMime('html')
        count++
        session.body = '<meta charset="utf-8"><h1>这是一个标题</h1><p>你好，' + name + '！</p><p>你的年龄是：' + age + '</p><p>其他参数：' + others + '</p><p>访问次数：' + count + '</p>'
})
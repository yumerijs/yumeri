import pkg from 'yumeri';
const { Core, Loader, Context, Config } = pkg;
import * as server from 'yumeri-plugin-server';
const loader = new Loader()
const core = new Core(loader)
const ctx = new Context(core, 'MyAPP')
const serverconfig = new Config('server', {
    port: 8080,
    host: '0.0.0.0'
})
server.apply(ctx, serverconfig)
ctx.route('/hello')
    .action(async (session, _) => {
    session.body = 'Hello, Yumeri!'
})
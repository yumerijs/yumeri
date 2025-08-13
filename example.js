import { Core, Context, Config } from 'yumeri';
import PluginLoader from 'yumeri';
import * as server from 'yumeri-plugin-server';
const loader = new PluginLoader()
const core = new Core(loader)
const ctx = new Context(core, 'MyAPP')
const serverconfig = new Config('server', {
    port: 8080,
    host: '0.0.0.0'
})
server.apply(ctx, serverconfig)
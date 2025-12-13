import { Context, Config, Session, Logger } from 'yumeri';
import path from 'path';
import { fileURLToPath } from 'url';
import HelloComponent from './views/Hello.vue';

// Declare the renderer
export const render = 'vue';

const logger = new Logger('{{name}}');
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const sfcPath = path.resolve(__dirname, '../src/views/Hello.vue');
(HelloComponent as any).__file ??= sfcPath;

// The apply function is the entry point for the plugin
export async function apply(ctx: Context, _config: Config) {
  
  // Register a route
  ctx.route('/hello-ui').action(async (session: Session) => {
    
    // Use the new render API
    // The data object will be passed to the Vue component as props
    await session.renderView(HelloComponent, { from: 'Yumeri Server' });
  });

  logger.info('Hello UI Plugin loaded successfully!');
}

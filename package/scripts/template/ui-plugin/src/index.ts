import { Context, Config, Session, Logger } from 'yumeri';
import HelloComponent from './views/Hello.vue';

// Declare the renderer
export const render = 'vue';

const logger = new Logger('{{name}}');

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

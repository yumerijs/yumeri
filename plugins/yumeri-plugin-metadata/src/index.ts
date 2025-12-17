import { Context, Config, Session, Logger, ConfigSchema } from 'yumeri';

const logger = new Logger('metadata');

export const usage = `
介绍:<br/>
提供了一些修改响应头和响应体的功能。<br/>
可以用于添加跨域头、在html中注入脚本等。<br/>
<br/>
使用:<br/>
配置文件中可以配置以下选项：<br/>
- headers: 响应头。对于需要多个值的响应头（如Set-Cookie或Content-Security-Policy），请将所有值合并为一个字符串（例如，用逗号分隔）。<br/>
- head: 一个字符串，将被注入到html的&lt;/head&gt;标签之前。<br/>
- script: 一个字符串，将被注入到html的&lt;/body&gt;标签之前。<br/>
- presets: 预设功能<br/>
  - cors: 配置跨域。<br/>
  - security: 开启安全头，可以防止一些常见的web攻击<br/>
`;

export interface MetadataConfig {
  headers: Array<{ name: string; value: string; }>; // Changed to string for schema compatibility
  head: string;
  script: string;
  presets: {
    cors: {
      enabled: boolean;
      origin: string;
      methods: string;
    };
    security: boolean;
  }
}

export const config = {
  schema: {
    headers: {
      type: 'array',
      default: [],
      description: '响应头键值对',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', required: true },
          value: { type: 'string', required: true } // Changed to string
        }
      }
    },
    head: {
      type: 'string',
      default: '',
      description: 'head标签注入内容',
    },
    script: {
      type: 'string',
      default: '',
      description: 'body标签注入内容',
    },
    presets: {
      type: 'object',
      default: {},
      description: '预设功能',
      properties: {
        cors: {
          type: 'object',
          description: '配置跨域',
          default: {},
          properties: {
            enabled: { type: 'boolean', default: false, description: '是否启用'},
            origin: { type: 'string', default: '*', description: '允许的域名'},
            methods: { type: 'string', default: 'GET,HEAD,PUT,PATCH,POST,DELETE', description: '允许的方法'},
          }
        },
        security: {
          type: 'boolean',
          default: false,
          description: '开启安全头，可以防止一些常见的web攻击',
        },
      },
    },
  } as Record<string, ConfigSchema>,
};

export async function apply(ctx: Context, config: Config) {
  const head = config.get<string>('head', '');
  const script = config.get<string>('script', '');
  const presets = config.get<MetadataConfig['presets']>('presets');
  // Changed type to string[] for compatibility with schema.
  // The Node.js setHeader method handles string[] by joining with ', '.
  const userHeaders = config.get<Array<{ name: string; value: string; }>>('headers', []);

  // Pre-middleware for headers
  ctx.use('metadata-headers', async (session: Session, next: () => Promise<void>) => {
    let finalHeaders: Array<{ name: string; value: string; }> = [];

    // Security preset
    if (presets?.security) {
      finalHeaders.push(
        { name: 'X-Content-Type-Options', value: 'nosniff' },
        { name: 'X-Frame-Options', value: 'DENY' },
        { name: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
        { name: 'X-XSS-Protection', value: '1; mode=block' },
      );
    }

    // CORS preset
    if (presets?.cors?.enabled) {
      finalHeaders.push(
        { name: 'Access-Control-Allow-Origin', value: presets.cors.origin },
        { name: 'Access-Control-Allow-Methods', value: presets.cors.methods },
        { name: 'Access-Control-Allow-Headers', value: 'Content-Type,Authorization' },
      );
    }
    
    // Handle OPTIONS pre-flight requests for CORS
    if (presets?.cors?.enabled && session.client.req.method === 'OPTIONS') {
        const corsHeaders: Record<string, string> = {
            'Access-Control-Allow-Origin': presets.cors.origin,
            'Access-Control-Allow-Methods': presets.cors.methods,
            'Access-Control-Allow-Headers': session.client.req.headers['access-control-request-headers'] || 'Content-Type,Authorization'
        };
        for (const key in corsHeaders) {
            session.client.res.setHeader(key, corsHeaders[key]);
        }
        session.status = 204; // No Content
        session.endsession('');
        return;
    }


    // Apply user-defined headers (will override or append to presets if names match, depending on header type)
    finalHeaders = finalHeaders.concat(userHeaders);

    for (const header of finalHeaders) {
      session.client.res.setHeader(header.name, header.value);
    }

    await next();
  });

  // Post-middleware for body injection
  ctx.use('metadata-body', async (session: Session, next: () => Promise<void>) => {
    await next();

    const contentType = session.head['Content-Type'];
    if (typeof contentType === 'string' && contentType.includes('text/html')) {
      let body = session.body;
      if (typeof body === 'string') {
        if (head) {
          body = body.replace('</head>', `${head}</head>`);
        }
        if (script) {
          body = body.replace('</body>', `${script}</body>`);
        }
        session.body = body;
      }
    }
  });

  logger.info('Metadata plugin loaded.');
}

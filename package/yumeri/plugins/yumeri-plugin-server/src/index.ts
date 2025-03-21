import { Core } from 'yumeri';
import http from 'http';

export class Server {
  private core: Core;
  private port: number;
  private httpServer: http.Server | null = null;

  constructor(core: Core, port: number = 14510) {
    this.core = core;
    this.port = port;
  }

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.httpServer = http.createServer((req, res) => {
        // 默认处理
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('Hello, World from Yumeri Plugin Server!');

        // 这里可以触发事件，让其他插件监听
        this.core.emit('yumeri-plugin-server:request', { req, res });
      });

      this.httpServer.listen(this.port, () => {
        console.log(`Yumeri Server listening on port ${this.port}`);
        resolve();
      }).on('error', (err) => {
        console.error(`Failed to start Yumeri Server on port ${this.port}:`, err);
        reject(err);
      });
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.httpServer) {
        this.httpServer.close((err) => {
          if (err) {
            console.error('Failed to stop Yumeri Server:', err);
            reject(err);
          } else {
            console.log('Yumeri Server stopped.');
            resolve();
          }
        });
      } else {
        resolve(); // 如果服务器没有启动，直接 resolve
      }
    });
  }
}

// 插件入口函数
export function apply(core: Core, config: Config) {
  const server = new Server(core, config.content.port);
  server.start();
}
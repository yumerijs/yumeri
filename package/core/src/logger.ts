/**
 * @time: 2025/03/25 18:01
 * @author: FireGuo
 * WindyPear-Team All right reserved
 */

import colors from 'ansi-colors'; // 引入 ansi-colors

export class Logger {
  private title: string;
  private titleColor: any;

  constructor(title: string) {
    this.title = title;
    this.titleColor = this.getRandomColor();
  }

  private getRandomColor() {
    const availableColors = [colors.red, colors.green, colors.yellow, colors.blue, colors.magenta, colors.cyan, colors.white, colors.gray];
    const randomIndex = Math.floor(Math.random() * availableColors.length);
    return availableColors[randomIndex];
  }

  private log(level: string, ...args: any[]) {
    const now = new Date();
    const timestamp = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
    console.log(`${timestamp} [${level}] ${this.titleColor(this.title)} `, ...args);
  }

  info(...args: any[]) {
    this.log('I', ...args);
  }

  warn(...args: any[]) {
    this.log('W', ...args);
  }

  error(...args: any[]) {
    this.log('E', ...args);
  }
}
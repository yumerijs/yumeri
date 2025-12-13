export * from './database'
export * from './virtualAssets'

export interface IRenderer {
  /**
   * 渲染器的名称, 例如 'vue', 'react'.
   */
  name: string;

  /**
   * 渲染一个组件为 HTML 字符串.
   * @param component 组件对象 (例如 Vue 组件定义, React 函数组件).
   * @param data 传递给组件的 props 或数据.
   * @param options 渲染附加选项.
   * @returns 返回渲染后的 HTML 字符串的 Promise.
   */
  render(component: any, data: Record<string, any>, options?: RenderOptions): Promise<string>;
}

/**
 * 渲染选项接口，目前为空，保留扩展性。
 */
export interface RenderOptions {
  /**
   * 当前渲染所属插件名（如果有）。
   */
  pluginName?: string;

  /**
   * 自定义客户端入口，若提供则渲染器直接使用该路径。
   */
  clientEntry?: string;
}

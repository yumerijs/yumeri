/// <reference types="vite/client" />
/// <reference types="vue/macros-global" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  // Vue SFCs are treated as components when imported in TS files
  const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, any>
  export default component
}

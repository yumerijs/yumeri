export * from '@yumerijs/core';
export { default as Loader } from '@yumerijs/loader';
import { Database } from '@yumerijs/types'
export {
    Tables,
    FieldType,
    FieldDefinition,
    IndexDefinition,
    Operator,
    Query,
    UpdateData,
    // Database is imported separately above
} from '@yumerijs/types'
export type { Database } from '@yumerijs/types'

export {
    VirtualAssetResponse,
    VirtualAssetResolver,
    registerVirtualAssetResolver,
    resolveVirtualAsset
} from '@yumerijs/types'

export type {
    IRenderer,
    RenderOptions
} from '@yumerijs/types'

// 之所以不在context里面直接预留一个，是因为考虑到可能有人会直接使用core模块
declare module '@yumerijs/core' {
  interface Components {
      database: Database
  }
}
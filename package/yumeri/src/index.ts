export * from '@yumerijs/core';
export { default as Loader } from '@yumerijs/loader';
import { Database } from '@yumerijs/types'
export * from '@yumerijs/types'

// 之所以不在context里面直接预留一个，是因为考虑到可能有人会直接使用core模块
declare module '@yumerijs/core' {
  interface Components {
      database: Database
  }
}
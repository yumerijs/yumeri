
export interface Permission {
  id: number;
  permit: number;
}

declare module '@yumerijs/types' {
  interface Tables {
    permission: Permission;
  }
}


export interface Permission {
  username: string;
  permit: number;
}

declare module '@yumerijs/types' {
  interface Tables {
    permission: Permission;
  }
}


// Note: The password field is intentionally omitted from the default selection set
// to prevent accidental exposure. It should only be used in specific queries.
export interface User {
  id: number;
  username: string;
  password?: string;
  email?: string | null;
  phone?: string | null;
  createAt: Date;
  updateAt: Date;
}

declare module '@yumerijs/types' {
  interface Tables {
    // The table name is configurable, but we use 'user' as the default key for type safety.
    user: User;
  }
}

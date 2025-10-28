
export interface Analyse {
  day: number;
  times: number;
}

declare module '@yumerijs/types' {
  interface Tables {
    analyse: Analyse;
  }
}

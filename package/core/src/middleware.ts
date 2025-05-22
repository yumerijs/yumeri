import { Session } from './session';
export type Middleware = (session: Session, next: () => Promise<void>) => Promise<void>;

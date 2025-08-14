/**
 * @time: 2025/08/14 09:48
 * @author: FireGuo
 * WindyPear-Team All right reserved
 **/
import { Session } from './session';
export type Middleware = (session: Session, next: () => Promise<void>) => Promise<void>;

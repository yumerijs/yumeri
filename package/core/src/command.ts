import { Session } from './session';
import Core from './core';


export class Command {
  public command: string;
  public session: Session;
  constructor(command: string, session: Session) {
    this.command = command;
    this.session = session
  }
  
  excute(core: Core) {
    core.emit('onexcute',this.session);
    core.emit('oncommand',this.command,this.session)
  }
}
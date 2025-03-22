export class Config {
    public name: string = '';
    public content: { [name: string]: any } = {};

    constructor(name: string, content: { [name: string]: any }) {
        this.name = name;
        this.content = content;
    }
}
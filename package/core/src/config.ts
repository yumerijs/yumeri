export class Config {
    public name: string = '';
    public content: { [name: string]: string } = {};

    constructor(name: string, content: { [name: string]: string }) {
        this.name = name;
        this.content = content;
    }
}
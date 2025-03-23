export class Config {
    public name: string = '';
    public content: { [name: string]: any } = {};

    constructor(name: string, content?: { [name: string]: any }) {
        this.name = name;
        this.content = content || {}; // 如果 content 是 undefined，则赋值为空对象
    }
}
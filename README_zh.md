# Yumerijs —— 新一代模块化Web应用构建平台

[English](README.md) | [简体中文 🇨🇳](README_zh.md)

[![FOSSA Status](https://app.fossa.com/api/projects/git%2Bgithub.com%2Fyumerijs%2Fyumeri.svg?type=shield&issueType=license)](https://app.fossa.com/projects/git%2Bgithub.com%2Fyumerijs%2Fyumeri?ref=badge_shield&issueType=license)

## 什么是Yumeri

Yumeri是一个基于Node.js的新一代模块化Web应用构建平台。作为一个现代化的框架，Yumeri通过插件系统提供了高度的可扩展性和灵活性，使开发者能够快速构建模块化的Web应用。

## 名称由来

"Yumeri"这个名字来自日语的ゆめり，意为梦莉，代表的是FireGuo为他的机器人设定的OC。在风梨团队的产品线中，yumeri代表着开源与共享，因此以Yumeri命名的项目（包括Yumerijs、Yumeri Chat、Yumeri Bot）等都传递着风梨团队的开放开源理念。

## 设计理念

Yumeri的核心设计理念是模块化和可扩展性。通过精心设计的插件系统，Yumeri实现了功能的高度解耦，使得开发者可以根据需求灵活组合各种功能模块，同时也便于团队协作开发和代码维护。

### 核心特点

1. **模块化架构**：Yumeri采用模块化设计，核心功能和扩展功能通过插件系统清晰分离，便于维护和扩展。

2. **插件与中间件双驱动**：作为模块化框架，Yumeri的各个操作都通过插件和中间件完成。插件系统是Yumeri的核心，中间件就像洋葱一般包裹在插件外部，提供了强大的扩展能力。

3. **路由系统**：快速定义路由及请求方式，开发者仅需关注业务逻辑，无需关心底层实现。

4. **TypeScript支持**：Yumeri使用TypeScript开发，提供了类型安全和更好的开发体验。

## 框架结构

Yumeri框架主要由以下几个部分组成：

1. **核心模块（core）**：提供框架的基础功能和API，是整个框架的核心。

2. **加载器（loader）**：负责加载和管理插件，是连接核心和插件的桥梁。

3. **插件系统**：Yumeri的插件采用npm包形式，包名前缀为yumeri-plugin-，用于识别此为Yumeri的插件。框架自带了几个基础插件：
   - yumeri-plugin-console：控制台插件
   - yumeri-plugin-echo：（测试专用）输出内容插件
   - yumeri-plugin-sqlite: SQLite数据库插件

## 适用场景

Yumeri适合构建各种类型的Web应用，特别是那些需要高度模块化和可扩展性的项目。无论是简单的网站还是复杂的Web应用，Yumeri都能提供灵活的解决方案。

## 开源协议

Yumeri是一个开源项目，遵循MIT开源协议，**在标明原作者的情况下**允许随意分发与商务使用。我们非常鼓励社区贡献和参与。
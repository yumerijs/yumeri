# Yumerijs — A New-Generation Modular Web Application Framework

[English](README.md) | [简体中文 🇨🇳](README_zh.md)

[![FOSSA Status](https://app.fossa.com/api/projects/git%2Bgithub.com%2Fyumerijs%2Fyumeri.svg?type=shield&issueType=license)](https://app.fossa.com/projects/git%2Bgithub.com%2Fyumerijs%2Fyumeri?ref=badge_shield&issueType=license)

## What is Yumeri?

**Yumeri** is a next-generation modular web application framework based on Node.js. As a modern framework, it offers high extensibility and flexibility through its powerful plugin system, enabling developers to rapidly build modular and scalable web applications.

## Origin of the Name

The name **"Yumeri"** (Japanese: ゆめり) comes from FireGuo's original character (OC) concept of "梦莉 (Mengli)", representing openness and sharing in the product ecosystem of the *Fengli Team*. Projects named after Yumeri (such as **Yumerijs**, **Yumeri Chat**, **Yumeri Bot**) are built with the spirit of open source and free software in mind.

## Design Philosophy

Yumeri is designed with modularity and extensibility as its core principles. Through a carefully designed plugin architecture, it decouples core functionalities, allowing developers to mix and match features as needed. This approach also facilitates collaborative development and long-term maintainability.

### Core Features

1. **Modular Architecture**  
   Yumeri separates core features and extended functionality through a plugin system, making it easy to maintain, scale, and customize.

2. **Plugin & Middleware Driven**  
   All operations in Yumeri are driven by plugins and middleware. Plugins are the heart of Yumeri, while middleware wraps around them like layers of an onion, enabling powerful extension capabilities.

3. **Built-in Routing System**  
   Quickly define routes and request methods. Developers can focus on business logic without worrying about low-level implementation details.

4. **TypeScript Support**  
   Yumeri is fully written in TypeScript, ensuring type safety and a better developer experience.

## Framework Structure

The Yumeri framework consists of the following components:

1. **Core Module (`core`)**  
   Provides the base functionality and APIs of the framework — the foundation of everything.

2. **Loader (`loader`)**  
   Manages plugin loading and lifecycle — acting as the bridge between core and plugins.

3. **Plugin System**  
   Yumeri plugins are distributed as npm packages with the prefix `yumeri-plugin-` for easy recognition. The framework currently includes several built-in plugins:
   - `yumeri-plugin-console`: Console interface plugin  
   - `yumeri-plugin-echo`: A testing plugin that outputs content  
   - `yumeri-plugin-server`: HTTP server plugin  
   - `yumeri-plugin-sqlite`: SQLite database support plugin

## Use Cases

Yumeri is suitable for building various types of web applications, especially those requiring a high degree of modularity and extensibility. Whether it’s a simple website or a complex web service, Yumeri offers a flexible and robust foundation.

## License

Yumeri is an open-source project under the [MIT License](https://opensource.org/licenses/MIT).  
You are free to use, modify, and distribute it — even commercially — as long as the original author is credited.  
Community contributions are highly encouraged and welcome!
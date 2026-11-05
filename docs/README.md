# Folia for Android 文档

本目录是 Folia for Android 的文档地图。根目录 [README](../README.md) 提供产品概览和快速入口；Android 相关实现与构建说明见 [ANDROID_PORT.md](../ANDROID_PORT.md)。

> 本仓库是面向 Android/Capacitor 的 fork。部分桌面端、Web 部署和打包文档继承自上游，但相关代码或产物不一定包含在本 fork 中。

## 入门与构建

- [Android 移植与构建](../ANDROID_PORT.md)：Capacitor 容器、构建步骤和平台桥。
- [技术与开发说明](technical.md)：本地开发、环境变量、Web 部署、Stage API 和常用脚本。
- [代码地图](CODEMAP.md)：由 TypeScript 编译器生成的模块分布、枢纽模块和动态注册点；生成规则见文件头。

## 功能与使用

- [本地音乐库管理](local-library-management.md)：导入、扫描、匹配、歌单和缓存。
- [歌词接口](lyric-api.md)：Electron 桌面端本机只读歌词 API。
- [壁纸模式](wallpaper-mode.md)：桌面端窗口层级、交互与平台差异。
- [波点音乐桌面接入](bodian.md)：独立 provider、受限 IPC 和服务边界。
- [Ponder 教程清单](ponder-plan.md) 与 [Ponder 文案对照](ponder-copy.md)：思索教程覆盖面和中文文案维护。

## 开发与架构

- [音乐库 core 与 UI suites](library-suites.md)：headless core、UI suite 和实现边界。
- [酷狗与 Omni 能力对齐](kugou-omni-capability-alignment.md)：provider 能力和调用链。
- [酷狗接口文档](ku-go-api-docs.md)：上游脚本接口与请求字段参考。
- [客户端日志](client-logging.md)：renderer 日志的写入和读取方式。
- [Automix 内存优化](automix-memory-optimization.md)：内存诊断、运行时边界和后续工作。
- [Linux 字形缓存 fd 泄漏](linux-glyph-cache-fd-leak.md)：已定位问题的机制与修复开关。
- [QQ 音乐部署](qq-music-deployment.md)：Vercel、Cloudflare、Docker 和裸 Node.js 形态。

## 模组与历史说明

- [Folium API 参考](folium/api.md)：由契约文件生成的公开类型参考。
- [Folium 模组开发与贡献](folium/contributing.md)：开发、调试、发布和审查。
- [Folium 首页页面](folium/home-tabs.md)：首页注册表和页面容器。
- [旧视图弃用与迁移](chore/legacy-view-deprecation.md)：旧首页与列表视图的保留范围。
- [已知非 Bug 问题](chore/known-non-bug-issues.md)：容易误判为回归的环境问题。
- [macOS 应用损坏提示](desktop/macos-app-damaged.md)：上游桌面版的 Gatekeeper 说明。

## 文档维护

- 新增文档时，先更新本索引，再从根 README 或相关代码附近添加入口。
- `docs/CODEMAP.md` 和 `docs/folium/api.md` 由生成器产出，不手工改写；修改源文件后按对应脚本重新生成。
- 本 fork 不包含 `deploy/docker/` 与 `packaging/` 目录；Docker、桌面打包和模组平台规范请查阅上游 Folia 文档。

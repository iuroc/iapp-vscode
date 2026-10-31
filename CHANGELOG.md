# Changelog

## 0.7.0 - 2026-11-01

### Changed

- 独立为单独仓库，按本地 VSIX 分发，不依赖工作区、CI 或 Marketplace。
- 补齐 publisher、MIT license、icon、repository、keywords 等发行元数据。
- 移除只适用于原工作区的真实工程测试与 benchmark 脚本。

## 0.6.0 - 2026-11-01

### Added

- iyu 标签 Hover：`View`、`ppt`、`event`、`UIEventset`、`eventItme` 的用途、属性与子标签说明。
- iyu 标签补全：`<` / `</` 补全标签名；`View` 内补 `id`/`did`/`type`，`eventItme` 内补 `type`。
- iyu 标签诊断：未知标签（error）、未知属性（warning）、`eventItme` 缺 `type`（error）。

## 0.5.2 - 2026-11-01

### Fixed

- 方法注释允许与声明之间隔着最多两个空行；只有分隔线的注释块仍视为分节标题，不挂到方法。

## 0.5.1 - 2026-11-01

### Fixed

- Hover 与补全说明里的注释改为纯文本渲染：保留原始换行，不再把 `---`、`*`、单换行当成 Markdown 语法重排。

## 0.5.0 - 2026-11-01

### Added

- 模块文件注释：读取文件开头第一个连续注释块（`//`、`/** */`、`/* */`），空行截断。
- 文件注释显示在 `i.fn` 模块 Hover、模块补全说明与工程树模块 tooltip。

## 0.4.0 - 2026-11-01

### Added

- 变量定位：局部变量、形参、模块字段、循环变量与 `catch` 变量的定义跳转。
- 变量引用查找：局部变量限定在方法内，字段扫描整个模块；排除成员名、方法名、字符串与注释。
- 变量 Hover 与补全（只提示光标前已声明的局部变量）。

## 0.3.0 - 2026-11-01

### Added

- 方法注释：读取声明正上方的 `/** ... */` 与连续 `//`，在 Hover 与补全说明中显示；支持 `@param` 等标签行。
- Java 源码方法/字段/类的注释提取与 mjava 共用同一规则；空行分隔的分节注释不挂到声明。

## 0.2.0 - 2026-11-01

### Added

- mjava 补全：本模块/加载集/全局方法，`i.` 内置成员，`i.fn` 模块名，`i.uigo` 页面名，`i.call` 的 `模块.方法`。
- Java 成员补全：接收者类型可推断时，沿继承链列出方法与字段，显示签名与 javadoc。
- iyu 补全：`eventItme type` 事件类型与 `call` 目标。
- 方法补全使用 snippet 参数占位；已有括号时只插入方法名。

## 0.1.0 - 2026-11-01

### Added

- 方法引用查找（Shift+F12）：mjava 方法声明/调用、`i.call`、iyu 入口，以及接收者类型可推断的 Java 成员调用。
- 修正 `i.call` 的语言参数位置：实际签名是 `i.call("mjava", "mod.method", ...)`，定义跳转、Hover 与参数个数诊断同步修正。

## 0.0.1 - 2026-11-01

### Added

- mjava / iyu 语言注册、TextMate 高亮与语言配置。
- 工程识别、模块/页面/方法索引、文件监听与增量刷新。
- 定义跳转：mjava 裸调用、`i.fn`、`i.uigo`、`i.call`、iyu `call` 入口。
- Java 源码查阅：JDK `src.zip`、Android framework、AndroidX/Material sources；继承链方法、重载候选、javadoc Hover。
- 轻量类型推断：局部变量、形参、`new`、强转、返回类型、字段、字符串拼接、一维数组。
- `i`（`Aid_javaCode`）与 `activity` 固定类型 stub。
- 诊断：八条 mjava 致命写法、未定义目标、加载顺序、iyu 书写规则、参数个数、重名覆盖；行内 `noqa` 与规则开关。
- 资源管理器「iApp 工程」树，节点可点击跳转，文件变化自动刷新。
- `iapp.jdkHome`、`iapp.androidSources`、`iapp.extraSourceJars` 设置与自动探测。
- 「iApp: 安装 Android 源码」命令：约 48 MB，确认后下载到 global storage，可取消。

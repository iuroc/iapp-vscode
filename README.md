# iApp 开发助手（VS Code 扩展）

为 iApp 工程（`.mjava` + `.iyu`）提供方法定义跳转、Java/JDK/Android 源码查阅、工程信息与 lint 诊断。

## 安装（本地 VSIX）

当前仅按本地/内部分发使用：从源码打包 VSIX 后安装，不依赖 Marketplace 或 CI。

```bash
npm install
npm run compile
npx @vscode/vsce package
code --install-extension iapp-vscode-0.7.0.vsix
```

开发调试：

```bash
npm install
npm run compile
code --extensionDevelopmentPath=.
```

需要 VS Code 1.90 及以上、桌面版（扩展使用 Node `fs` / `https`，不支持 vscode.dev）。

## 语言支持

| 语言 | 扩展名 | 高亮 | 语言配置 |
| --- | --- | --- | --- |
| mjava | `.mjava` | Java 关键字/类型/方法/字符串/注释/数值，顶层 `import` 与方法不要求 class 外壳 | `//`、`/* */`，`{}`/`[]`/`()` 配对，字符串自动闭合 |
| iyu | `.iyu` | `<View>`、`<ppt>`、`<event>`、`<UIEventset>`、`<eventItme>`、属性、`call`/`addv` | `//`、`<!-- -->`，`<`/`>` 与引号自动闭合 |

- iyu 允许多个根 `<View>`，语法不要求单一根节点。
- mjava 是 BeanShell 解释的 Java 子集：没有 `class` 外壳、模块名即文件名；高亮层不校验语义。

## 导航

| 位置 | 示例 | 跳转到 |
| --- | --- | --- |
| mjava 裸调用 | `lib_wire()` | 按解析顺序找到的方法 |
| mjava 加载模块 | `i.fn("ui")` | `ui.mjava` 文件开头 |
| mjava 跳页面 | `i.uigo("search.iyu")` | `search.iyu` 文件开头 |
| mjava 显式调用 | `i.call("mjava", "home.first")` | `home.mjava` 的 `first` |
| iyu 事件入口 | `call(null, "mjava", "home.first")` | `home.mjava` 的 `first` |

裸调用解析顺序：

1. 当前模块里同名且实参个数匹配的方法；
2. 当前模块经 `i.fn` 可达的模块（加载边传递闭包，属于过近似，不区分 `i.fn` 与调用点先后）；
3. 全工程同名且个数匹配的唯一方法；
4. 仍不唯一时返回全部候选，由编辑器的 Peek 列表选择，不猜。

`key`、`first` 这类入口方法在多个模块重名时，优先命中当前模块或已加载模块；跨模块调用应写显式限定名。无法推断的接收者不会制造跳转。

Hover 显示签名、所属模块与实参个数；大纲列出 mjava 方法与顶层变量、iyu 事件及其 `call` 目标。

方法声明正上方的 `/** ... */` 或连续 `//` 注释会作为文档显示在 Hover 与补全说明里：

```java
// 版本名：打包态读包自身；开发态显示「开发版」。
public String ui_versionText() { ... }
```

```java
/**
 * 计算总和。
 * @param a 第一个数
 */
public int sum(int a, int b) { ... }
```

注释与方法之间允许最多两个空行；只有分隔线的注释块（如 `// ---------- 日志 ----------`）视为分节标题，不挂到方法上。模块文件注释仍以空行截断，规则不同。

Hover 与补全说明中的注释按**纯文本**渲染：保留原始换行，`---`、`*`、`#` 等不会被当作 Markdown 语法重排。

### 模块文件注释

文件开头的**第一个连续注释块**会作为模块说明：

```java
// 我的 Tab：主题切换、阅读历史、关于。

import android.view.View;
```

- 支持连续 `//`、`/** ... */`、`/* ... */`；块注释与紧随其后的 `//` 行（中间没有空行）合并。
- 空行截断：只取第一段，空行后的注释不并入；`//` 这种空注释行不算空行。
- 文件开头允许先有空行；文件不是以注释开头则没有模块说明。
- 显示位置：`i.fn("mine")` 的 Hover、模块名补全的说明、工程树模块节点的 tooltip。

### 变量定位

```java
String[] hints = {"继续阅读与精选", "分类浏览"};
body.addView(ui_text(hints[idx], 15, th_ink2()));
```

- `F12` / 转到定义：局部变量、形参、模块字段；循环变量（`for (String hint : hints)`）与 `catch (Exception e)` 也支持。
- `Shift+F12` / 查找所有引用：
  - 局部变量与形参只扫描所在方法；
  - 模块字段扫描整个模块；
  - 排除成员名（`obj.hints`）、方法名、字符串与注释；
  - 同名变量按最近一次声明解析，`this.field` 按字段处理。
- Hover 显示类型、变量类别与声明位置。
- 补全列表包含当前光标前已声明的局部变量、形参与模块字段。

已知限制：匿名类/回调内部的同名局部变量按外层方法作用域近似处理；模块字段的引用不跨模块扫描。

### 查找引用

`Shift+F12` 或右键“查找所有引用”：

- mjava 方法声明/调用：列出工程内指向同一方法的裸调用、`i.call("mjava", "mod.method")` 与 iyu 入口。
- iyu 的 `"home.first"` 字符串：列出同一方法的全部 mjava 调用与其它 iyu 入口。
- Java 成员（例如 `TextView.setText`）：列出工程内接收者类型可推断、且声明落在同一成员上的调用；声明本身可选择包含。
- 重名或无法消歧时返回候选并集；接收者类型未知的调用不会被列为引用。扫描范围只限当前工程。

## Java 源码查阅

源码集：

| 设置 | 内容 | 自动探测 |
| --- | --- | --- |
| `iapp.jdkHome` | JDK 根目录（需含 `lib/src.zip`） | `JAVA_HOME`、常见 JDK 安装目录 |
| `iapp.androidSources` | Android 源码目录（如 `sources/android-34`） | `ANDROID_HOME`、`ANDROID_SDK_ROOT`、常见 SDK 路径 |
| `iapp.extraSourceJars` | 额外源码 jar（AndroidX / Material） | 不自动探测，按配置顺序参与索引 |

能力：

- 类名、import、成员调用可跳到真实源码；继承链上的方法落到声明处，接口方法同理。
- 同参数个数的多个重载返回全部候选；不做随机选择。
- Hover 显示签名与 javadoc 摘要。
- `i` 固定为内置 stub `com.iapp.app.Aid_javaCode`，`activity` 固定为 `android.app.Activity`。

类型推断限制（推断不出时返回空，不制造错误跳转）：

- 泛型按原始类型处理，`ArrayList<String>.get` 退化为 `Object`。
- 反射、`getClass().getMethod(...)`、从动态调用得到的值、跨文件重新赋值等写法无法推断。
- 支持局部变量、形参、`new`、强转、方法返回类型、字段、字符串拼接与一维数组取值。
- Android 源码缺失时 `TextView` 等跳转返回空，lint 也不会把未解析的 Java 引用报成错误。

### 安装 Android 源码

命令面板运行 **iApp: 安装 Android 源码**：

- 下载 Android 34 framework 源码（`sources-34_r01.zip`，45.5 MB）与 AndroidX core / Material 源码 jar，合计约 48 MB。
- 下载前会弹出确认框；取消后 JDK 功能不受影响。
- 内容存到扩展的 global storage（`<globalStorage>/android-sources/`），不写入工程目录。
- 安装完成后自动重建索引；也可以在设置里用 `iapp.androidSources` 指向本地源码目录，或用 `iapp.extraSourceJars` 指定本地 jar。

离线使用：

- JDK：保持 `iapp.jdkHome` 指向含 `lib/src.zip` 的目录即可，不需要联网。
- Android：把已有的 `sources/android-34` 目录填进 `iapp.androidSources`，或把源码 zip/jar 填进 `iapp.extraSourceJars`。

清理缓存（回到 JDK-only 状态）：

1. 删除 `<globalStorage>/android-sources/` 目录；
2. 清空 `iapp.androidSources` 与 `iapp.extraSourceJars`；
3. 重新加载窗口。之后 Android 类跳转返回空，JDK 类仍可查。

## iyu 标签提示

iyu 只支持 5 个标签：`View`、`ppt`、`event`、`UIEventset`、`eventItme`。

- 悬停标签名：用途、允许的属性与子标签；悬停属性名：该属性的含义。
- 输入 `<` 补全标签名；输入 `</` 补全闭合标签。
- 在 `<View` 内补全 `id`、`did`、`type`；在 `<eventItme` 内补全 `type`。
- 字符串与注释内不触发标签补全。

## 补全

| 位置 | 候选 |
| --- | --- |
| mjava 代码里的标识符 | 当前模块方法 → `i.fn` 加载集方法 → 工程内其它方法；detail 显示签名，说明显示模块 |
| `i.` | 内置 stub `Aid_javaCode` 的方法与字段（`fn`、`sss`、`syso`、`uigo`、`us`、`call`…） |
| `i.fn("` | 工程模块名 |
| `i.uigo("` | 工程页面名（含 `.iyu`） |
| `i.call("mjava", "` | `模块.方法` |
| 接收者后的 `.`，如 `tv.`、`activity.`、`activity.getResources().` | 类型的成员，沿继承链列出；子类成员优先，Object 成员排最后 |
| iyu `eventItme type="` | 内置事件 + 工程里已出现的事件类型 |
| iyu `call(..., "` | `模块.方法` |

- 方法候选默认插入 snippet（带参数占位符）；光标前后已经有 `(` 时只插入方法名，避免重复括号。
- 字符串补全会替换整个已输入内容，不会出现 `home.home.first`。
- 接收者类型推断不出来（反射、动态表达式）时不返回成员候选，也不会给出无关的模糊类名。
- 不做实参类型过滤，也不做自动 import。

## 诊断

| 规则 ID | 级别 | 内容 |
| --- | --- | --- |
| `MJAVA-FINAL` / `MJAVA-LAMBDA` / `MJAVA-VARARGS` | error | `final`、`->`、`...` 会让整个模块失效 |
| `MJAVA-HEX` | error | 超出 int 范围的十六进制字面量 |
| `MJAVA-BSH` | error | `new bsh.*` |
| `MJAVA-FQN-TYPE` / `MJAVA-FQN-NEW` | error | 类型声明或 `new` 使用全限定类名 |
| `MJAVA-ESCAPE` | error | 字符串里的非法转义（`\s` 等） |
| `IAPP-UNDEFINED-METHOD` | error | 带模块前缀但工程内没有定义的方法 |
| `IAPP-MISSING-MODULE` / `IAPP-MISSING-METHOD` / `IAPP-MISSING-PAGE` | error | `i.fn`、`i.call`、iyu `call`、`uigo` 指向不存在的目标 |
| `IAPP-LOAD-ORDER` | warning | 跨模块调用前缺少 `i.fn`；动态加载无法静态确认时不报 |
| `IAPP-ARITY` | warning | 实参个数与声明不一致 |
| `IAPP-DUPLICATE-METHOD` | information | 同一加载链里同名方法被后加载者覆盖 |
| `IYU-UNSUPPORTED-STATEMENT` | error | 事件体出现 `call`/`addv` 之外的语句 |
| `IYU-TRAILING-COMMENT` | error | 事件体行尾注释 |
| `IYU-PPT-SPACES` | warning | `ppt` 里 `key = value` 两边带空格 |
| `IYU-DUPLICATE-ID` | warning | 控件 id 重复 |
| `IYU-UNKNOWN-TAG` | error | 标签不是 `View`/`ppt`/`event`/`UIEventset`/`eventItme` |
| `IYU-UNKNOWN-ATTRIBUTE` | warning | 属性不在该标签的允许列表（`View`: id/did/type；`eventItme`: type） |
| `IYU-MISSING-EVENT-TYPE` | error | `<eventItme>` 缺少 `type` |

抑制与开关：

- 行内标记 `// noqa` 抑制该行全部诊断；`// noqa: IAPP-ARITY,MJAVA-HEX` 只抑制列出的规则。mjava 里也兼容 `# noqa`。
- `iapp.lint.enabled` 关闭全部 iApp 诊断；`iapp.lint.disabledRules` 按规则 ID 关闭。
- 动态加载、反射、无法静态展开的写法不报错。

## 工程视图

资源管理器侧栏的「iApp 工程」视图：

```
com.example.app
├─ home                 4 方法
│  └─ first
├─ ui                   46 方法
├─ mian                 3 事件
│  └─ loading           1 调用
│     └─ home.first      call
```

- 点击模块/页面打开文件；点击方法、事件或 `call` 目标定位到对应行列。
- 新增、删除、修改 `.mjava` / `.iyu` 后自动刷新，不需要重载窗口；标题栏的刷新按钮可手动重建。

## 项目模型

工程识别：目录含 `AndroidManifest.xml` 且根元素为 `<iapp>`，或含 `src/mian.iyu`。索引以工程根为界，同名模块不跨工程解析。

`ProjectModel` 字段：

| 字段 | 内容 |
| --- | --- |
| `root` | 工程根绝对路径 |
| `manifest` | `packageName`、`title`、`versionName`、`versionCode`、`sdk`、`permissions` |
| `modules` | `Map<模块名, { name, filePath, parsed }>`；`parsed.methods` 只含模块顶层方法 |
| `pages` | `Map<页面名, { name, filePath, parsed }>`；`parsed.views`、`parsed.events` |
| `loadEdges` | `i.fn("mod")` 形成的 `fromModule -> toModule` 边 |
| `entryEdges` | iyu 事件 `call(null, "mjava", "mod.method")` 形成的入口边与解析出的 `target` |

刷新规则：

- 文件监听 `*.mjava`、`*.iyu`、`AndroidManifest.xml`，按工程根去抖 80 ms。
- 修改单个文件只重解析该文件，并重建加载边/入口边；新增或删除文件会更新模块清单。
- `AndroidManifest.xml` 变化时重新读取清单字段；工程不再满足识别条件时移除缓存。
- 不需要重载窗口。

## 开发

```bash
npm install
npm run compile
code --extensionDevelopmentPath=.
```

类型检查：`npm run typecheck`；单元测试：`npm test`（会自动先编译测试）。

### 构建产物

- 运行期依赖 `@lezer/java` 与 `yauzl` 均为纯 JS，无 native 模块。
- `node scripts/verify-bundle.mjs` 可复现依赖打包检查。

## License

MIT

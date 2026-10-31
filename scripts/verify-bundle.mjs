// 校验运行期依赖能被打进单文件扩展，且不引入 native 模块。
import * as esbuild from "esbuild";

const result = await esbuild.build({
  stdin: {
    contents: `
      import { parser } from "@lezer/java";
      import * as yauzl from "yauzl";
      export const probe = { parser, yauzl };
    `,
    resolveDir: process.cwd(),
    sourcefile: "bundle-probe.ts",
    loader: "ts",
  },
  bundle: true,
  write: false,
  external: ["vscode"],
  format: "cjs",
  platform: "node",
  target: "node20",
  metafile: true,
  logLevel: "silent",
});

const output = result.outputFiles[0];
const inputs = Object.keys(result.metafile.inputs);
const nativeInputs = inputs.filter((path) => path.endsWith(".node"));

console.log(`bundle bytes: ${output.contents.byteLength}`);
console.log(`bundled inputs: ${inputs.length}`);
console.log(`native inputs: ${nativeInputs.length}`);
for (const path of inputs) {
  console.log(`  ${path}`);
}

if (nativeInputs.length > 0) {
  console.error("发现 native 模块:", nativeInputs.join(", "));
  process.exit(1);
}

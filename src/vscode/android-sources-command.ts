import path from "node:path";
import * as vscode from "vscode";
import {
  ANDROID_SOURCES_ITEMS,
  ensureAndroidSources,
} from "../core/java/android-sources.js";
import { JavaService } from "./java-service.js";

export function registerAndroidSourcesCommand(
  context: vscode.ExtensionContext,
  java: JavaService,
): vscode.Disposable {
  return vscode.commands.registerCommand("iapp.installAndroidSources", async () => {
    const storageDir = path.join(context.globalStorageUri.fsPath, "android-sources");
    const sizeMb = Math.round(
      ANDROID_SOURCES_ITEMS.reduce((sum, item) => sum + item.sizeHint, 0) / 1024 / 1024,
    );
    const choice = await vscode.window.showWarningMessage(
      `将下载 Android 源码约 ${sizeMb} MB 到扩展缓存（不写入工程目录）。继续？`,
      { modal: true },
      "下载",
      "取消",
    );
    if (choice !== "下载") {
      return;
    }

    let lastPercent = 0;
    const succeeded = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "下载 Android 源码",
        cancellable: true,
      },
      async (progress, token) => {
        const controller = new AbortController();
        token.onCancellationRequested(() => controller.abort());
        try {
          await ensureAndroidSources({
            storageDir,
            signal: controller.signal,
            onProgress: (percent) => {
              progress.report({
                increment: Math.max(0, percent - lastPercent),
                message: `${percent}%`,
              });
              lastPercent = percent;
            },
          });
          return true;
        } catch (error) {
          if (controller.signal.aborted) {
            void vscode.window.showInformationMessage("已取消下载，JDK 功能不受影响。");
          } else {
            void vscode.window.showErrorMessage(
              `Android 源码下载失败：${error instanceof Error ? error.message : String(error)}`,
            );
          }
          return false;
        }
      },
    );

    if (!succeeded) {
      return;
    }
    await java.reload();
    void vscode.window.showInformationMessage("Android 源码已安装，TextView 等跳转已可用。");
  });
}

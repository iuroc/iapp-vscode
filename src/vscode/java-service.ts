import * as vscode from "vscode";
import { installedAndroidSources } from "../core/java/android-sources.js";
import { IAPP_STUB_FQCN, IAPP_STUB_SOURCE } from "../core/java/iapp-stubs.js";
import { JavaSourceRepository } from "../core/java/java-repository.js";
import { JavaTypeResolver } from "../core/java/java-resolver.js";
import {
  findAndroidSources,
  findJdkHome,
} from "../core/java/source-discovery.js";
import { MjavaTypeInference } from "../core/java/type-inference.js";

export interface JavaEngine {
  repository: JavaSourceRepository;
  resolver: JavaTypeResolver;
  inference: MjavaTypeInference;
}

export class JavaService implements vscode.Disposable {
  private engine?: Promise<JavaEngine>;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(private readonly storageDir: string) {
    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration("iapp.jdkHome") ||
            event.affectsConfiguration("iapp.androidSources") ||
            event.affectsConfiguration("iapp.extraSourceJars")) {
          this.reset();
        }
      }),
    );
  }

  ready(): Promise<JavaEngine> {
    if (!this.engine) {
      this.engine = this.load();
    }
    return this.engine;
  }

  async reload(): Promise<void> {
    this.reset();
    await this.ready();
  }

  dispose(): void {
    this.reset();
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
  }

  private reset(): void {
    const previous = this.engine;
    this.engine = undefined;
    previous?.then((engine) => engine.repository.dispose()).catch(() => undefined);
  }

  private async load(): Promise<JavaEngine> {
    const config = vscode.workspace.getConfiguration("iapp");
    const explicitJdk = (config.get<string>("jdkHome") ?? "").trim() || undefined;
    const explicitAndroid = (config.get<string>("androidSources") ?? "").trim() || undefined;
    const configuredJars = config.get<string[]>("extraSourceJars") ?? [];
    const installed = installedAndroidSources(this.storageDir);

    const repository = await JavaSourceRepository.create({
      jdkHome: findJdkHome({ explicit: explicitJdk }),
      androidSources:
        findAndroidSources({ explicit: explicitAndroid }) ?? installed.androidSourceZip,
      extraSourceJars: [...new Set([...configuredJars, ...installed.jars])],
    });
    repository.addMemorySource(IAPP_STUB_FQCN, IAPP_STUB_SOURCE);
    const resolver = new JavaTypeResolver(repository);
    return {
      repository,
      resolver,
      inference: new MjavaTypeInference(repository, resolver),
    };
  }
}

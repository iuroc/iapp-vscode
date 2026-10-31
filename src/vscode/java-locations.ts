import path from "node:path";
import * as vscode from "vscode";
import { ClassSourceKind, ClassSourceLocation } from "../core/java/class-source.js";
import { JavaClassContext } from "../core/java/java-repository.js";
import { JavaMemberMatch } from "../core/java/java-resolver.js";
import { toRange } from "./providers/shared.js";

export const JAVA_SOURCE_SCHEME = "iapp-java";

export function javaSourceUri(location: ClassSourceLocation): vscode.Uri {
  if (location.kind === "dir") {
    return vscode.Uri.file(path.join(location.root, location.path));
  }
  const name =
    location.kind === "memory"
      ? `${location.path.split(".").pop() ?? "Stub"}.java`
      : path.posix.basename(location.path);
  const query = new URLSearchParams({
    kind: location.kind,
    root: location.root,
    path: location.path,
  }).toString();
  return vscode.Uri.from({ scheme: JAVA_SOURCE_SCHEME, path: `/${name}`, query });
}

export function javaLocationFromUri(uri: vscode.Uri): ClassSourceLocation {
  const params = new URLSearchParams(uri.query);
  return {
    kind: (params.get("kind") as ClassSourceKind | null) ?? "zip",
    root: params.get("root") ?? "",
    path: params.get("path") ?? "",
  };
}

export function methodLocation(match: JavaMemberMatch): vscode.Location | undefined {
  const source = match.context.file.source;
  if (!source) {
    return undefined;
  }
  return new vscode.Location(javaSourceUri(source), toRange(match.method.nameRange));
}

export function classLocation(context: JavaClassContext): vscode.Location | undefined {
  const source = context.file.source;
  if (!source) {
    return undefined;
  }
  return new vscode.Location(javaSourceUri(source), toRange(context.class.nameRange));
}

export interface IappManifest {
  packageName: string;
  title: string;
  versionName: string;
  versionCode: number | null;
  sdk: number | null;
  permissions: string[];
}

const EMPTY_MANIFEST: IappManifest = {
  packageName: "",
  title: "",
  versionName: "",
  versionCode: null,
  sdk: null,
  permissions: [],
};

export function isIappManifest(text: string): boolean {
  const normalized = text
    .replace(/^﻿/, "")
    .replace(/<\?[\s\S]*?\?>/g, "")
    .replace(/<!--[\s\S]*?-->/g, "");
  return /<\s*iapp(?:\s|>)/.test(normalized);
}

export function parseManifest(text: string): IappManifest {
  const versionCode = readNumber(text, "versionint");
  return {
    packageName: readText(text, "packageName"),
    title: readText(text, "title"),
    versionName: readText(text, "versionName"),
    versionCode,
    sdk: readNumber(text, "sdk"),
    permissions: readPermissions(text),
  };
}

export const emptyManifest = (): IappManifest => ({ ...EMPTY_MANIFEST, permissions: [] });

function readText(text: string, tag: string): string {
  const match = new RegExp(`<${tag}>\\s*([\\s\\S]*?)\\s*</${tag}>`).exec(text);
  return match ? match[1].trim() : "";
}

function readNumber(text: string, tag: string): number | null {
  const value = Number.parseInt(readText(text, tag), 10);
  return Number.isFinite(value) ? value : null;
}

function readPermissions(text: string): string[] {
  const match = /<Permissions>\s*([\s\S]*?)\s*<\/Permissions>/i.exec(text);
  if (!match) {
    return [];
  }
  return match[1]
    .split(/\s+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

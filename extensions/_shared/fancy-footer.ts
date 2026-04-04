/// <reference path="./pi-fancy-footer-shim.d.ts" />

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { FancyFooterWidgetContribution } from "pi-fancy-footer/api";

type FancyFooterApi = {
  contributeFancyFooterWidgets: typeof import("pi-fancy-footer/api").contributeFancyFooterWidgets;
  requestFancyFooterWidgetDiscovery: typeof import("pi-fancy-footer/api").requestFancyFooterWidgetDiscovery;
  requestFancyFooterRefresh: typeof import("pi-fancy-footer/api").requestFancyFooterRefresh;
};

let apiPromise: Promise<FancyFooterApi | null> | null = null;

async function loadFancyFooterApi(): Promise<FancyFooterApi | null> {
  if (!apiPromise) {
    apiPromise = import("pi-fancy-footer/api")
      .then((mod) => ({
        contributeFancyFooterWidgets: mod.contributeFancyFooterWidgets,
        requestFancyFooterWidgetDiscovery: mod.requestFancyFooterWidgetDiscovery,
        requestFancyFooterRefresh: mod.requestFancyFooterRefresh,
      }))
      .catch(() => null);
  }
  return apiPromise;
}

export async function registerFancyFooterWidget(
  pi: ExtensionAPI,
  widget:
    | FancyFooterWidgetContribution
    | (() => FancyFooterWidgetContribution | undefined),
): Promise<boolean> {
  const api = await loadFancyFooterApi();
  if (!api) return false;
  api.contributeFancyFooterWidgets(pi, widget);
  api.requestFancyFooterWidgetDiscovery(pi);
  return true;
}

export async function refreshFancyFooter(pi: ExtensionAPI): Promise<boolean> {
  const api = await loadFancyFooterApi();
  if (!api) return false;
  api.requestFancyFooterRefresh(pi);
  return true;
}

declare module "pi-fancy-footer/api" {
  import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

  export type FooterWidgetAlign = "left" | "middle" | "right";
  export type FooterWidgetFill = "none" | "grow";
  export type FooterWidgetColor =
    | "text"
    | "accent"
    | "muted"
    | "dim"
    | "success"
    | "error"
    | "warning";

  export interface FancyFooterWidgetContribution {
    id: string;
    label?: string;
    description: string;
    defaults: {
      row: number;
      position: number;
      align: FooterWidgetAlign;
      fill: FooterWidgetFill;
      minWidth?: number;
    };
    icon?: string | false | Record<string, string> | ((iconFamily: string) => string | undefined);
    textColor?: FooterWidgetColor;
    styled?: boolean;
    visible?: (ctx: unknown) => boolean;
    renderText: (ctx: unknown, availableWidth?: number) => string;
  }

  export function contributeFancyFooterWidgets(
    pi: ExtensionAPI,
    provider:
      | FancyFooterWidgetContribution
      | readonly FancyFooterWidgetContribution[]
      | (() => FancyFooterWidgetContribution | readonly FancyFooterWidgetContribution[] | undefined)
      | undefined,
  ): void;

  export function requestFancyFooterWidgetDiscovery(pi: ExtensionAPI): void;
  export function requestFancyFooterRefresh(pi: ExtensionAPI): void;
}

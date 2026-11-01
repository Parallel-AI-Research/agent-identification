"use client";

import { ThemeSwitch, type ThemeSwitchProps } from "fumadocs-ui/layouts/shared/slots/theme-switch";
import { DashboardButton } from "./dashboard-button";

/** The docs navbar has no end slot, so the button follows the theme toggle here. */
export function DocsNavEnd(props: ThemeSwitchProps) {
  return (
    <>
      <ThemeSwitch {...props} />
      <DashboardButton />
    </>
  );
}

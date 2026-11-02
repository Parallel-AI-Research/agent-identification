import type { BaseLayoutProps, LinkItemType } from "fumadocs-ui/layouts/shared";
import { DashboardButton } from "@/components/dashboard-button";
import { DashboardMenuLink } from "@/components/dashboard-links";
import { appName } from "./shared";

const TABS: LinkItemType[] = [
  { text: "Docs", url: "/docs", active: "nested-url" },
  { text: "Changelog", url: "/changelog", active: "nested-url" },
];

/** The same navigation across the public site, docs and dashboard. */
export function baseOptions(): BaseLayoutProps {
  return { nav: { title: appName }, links: TABS };
}

export function publicOptions(): BaseLayoutProps {
  return {
    ...baseOptions(),
    links: [
      ...TABS,
      { type: "custom", secondary: true, on: "nav", children: <DashboardButton /> },
      // The navbar button is hidden below full width, so the menu needs its own way in: in the
      // list on phones, and beside the theme toggle on tablets, which hide that list.
      { text: "Dashboard", url: "/dashboard", on: "menu" },
      {
        type: "custom",
        secondary: true,
        on: "menu",
        children: <DashboardMenuLink className="block max-sm:hidden" />,
      },
    ],
  };
}

import { DocsLayout } from "fumadocs-ui/layouts/notebook";
import type { ReactNode } from "react";
import { DocsNavEnd } from "@/components/docs-nav-end";
import { DocsTabs } from "@/components/docs-tabs";
import { baseOptions } from "@/lib/layout.shared";
import { source } from "@/lib/source";

export default function Layout({ children }: { children: ReactNode }) {
  const { nav, links = [], ...options } = baseOptions();
  return (
    <DocsLayout
      tree={source.getPageTree()}
      {...options}
      links={links.map((link) => ({ ...link, on: "menu" as const }))}
      nav={{ ...nav, mode: "top", children: <DocsTabs /> }}
      sidebar={{ collapsible: false }}
      slots={{ themeSwitch: DocsNavEnd }}
    >
      {children}
    </DocsLayout>
  );
}

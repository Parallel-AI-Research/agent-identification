import { createGetUrl } from "fumadocs-core/source";

export const appName = "Agent analytics";
export const docsRoute = "/docs";
export const docsContentRoute = "/llms.mdx/docs";
export const repository = "https://github.com/Parallel-AI-Research/agent-identification";

const getContentUrl = createGetUrl(docsContentRoute);

export function getPageMarkdownUrl(page: { slugs: string[]; locale?: string }) {
  const segments = [...page.slugs, "content.md"];
  return { segments, url: getContentUrl(segments, page.locale) };
}

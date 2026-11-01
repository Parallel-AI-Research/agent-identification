import { llms, loader } from "fumadocs-core/source";
import { metaSchema, pageSchema } from "fumadocs-core/source/schema";
import { defineDocs } from "fumadocs-mdx/macro";
import { z } from "zod";
import { docsRoute } from "./shared";

const docs = defineDocs({
  dir: "content/docs",
  docs: {
    schema: pageSchema,
    postprocess: { includeProcessedMarkdown: true },
  },
  meta: { schema: metaSchema },
});

const updates = defineDocs({
  dir: "content/changelog",
  docs: { schema: pageSchema.extend({ date: z.coerce.date() }) },
  meta: { schema: metaSchema },
});

export const source = loader({ baseUrl: docsRoute, source: docs.toFumadocsSource() });
export const changelog = loader({ baseUrl: "/changelog", source: updates.toFumadocsSource() });

export const docsLlms = llms(source, {
  renderPage: async (page) => `# ${page.data.title} (${page.url})

${await page.data.getText("processed")}`,
});

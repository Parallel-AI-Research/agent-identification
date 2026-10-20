import { createRuntime } from "../scripts/runtime.js";
let runtime: ReturnType<typeof createRuntime> | undefined;
export default {
  async fetch(request: Request): Promise<Response> {
    try {
      runtime ??= createRuntime({ vercel: true });
      return await runtime.handler(request);
    } catch {
      return Response.json(
        { error: "service_unavailable" },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    }
  },
};

export type CreatedScreen = { screen_id: string; api_key: string; screen_url: string };

export type BbsClientDeps = { baseUrl: string; fetch?: typeof fetch };

const TIMEOUT_MS = 8_000;

export class BbsClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(deps: BbsClientDeps) {
    this.baseUrl = deps.baseUrl.replace(/\/$/, "");
    this.fetchImpl = deps.fetch ?? fetch;
  }

  private async req(key: string, method: string, path: string, body?: unknown): Promise<Response> {
    return this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers: { "X-API-Key": key, ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  }

  async createScreen(accountKey: string, name: string): Promise<CreatedScreen> {
    const res = await this.req(accountKey, "POST", "/api/v1/screens", { name });
    if (!res.ok) throw new Error(`createScreen failed: ${res.status}`);
    return (await res.json()) as CreatedScreen;
  }

  async screenExists(accountKey: string, screenId: string): Promise<boolean> {
    const res = await this.req(accountKey, "GET", `/api/v1/screens/${screenId}`);
    if (res.ok) return true;
    if (res.status === 404) return false;
    throw new Error(`screenExists failed: ${res.status}`);
  }

  async updateScreen(screenKey: string, screenId: string, patch: Record<string, unknown>): Promise<void> {
    const res = await this.req(screenKey, "PATCH", `/api/v1/screens/${screenId}`, patch);
    if (!res.ok) throw new Error(`updateScreen failed: ${res.status}`);
  }

  async putPage(screenKey: string, screenId: string, pageName: string, body: Record<string, unknown>): Promise<void> {
    const res = await this.req(screenKey, "POST", `/api/v1/screens/${screenId}/pages/${pageName}`, body);
    if (!res.ok) throw new Error(`putPage ${pageName} failed: ${res.status}`);
  }

  async deletePage(screenKey: string, screenId: string, pageName: string): Promise<void> {
    const res = await this.req(screenKey, "DELETE", `/api/v1/screens/${screenId}/pages/${pageName}`);
    if (!res.ok && res.status !== 404) throw new Error(`deletePage ${pageName} failed: ${res.status}`);
  }
}

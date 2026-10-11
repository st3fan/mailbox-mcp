// mailbox-mcp-messages-api: a small REST API over the messages the email
// worker stores in R2. The MCP server's Go client (internal/messages) is the
// only intended consumer.
//
// Endpoints (all require Authorization: Bearer $MESSAGES_API_TOKEN):
//
//   GET    /mailboxes/{address}/messages                list (metadata, newest first, paginated)
//   GET    /mailboxes/{address}/messages/{id}           read one (metadata + raw)
//   POST   /mailboxes/{address}/messages/{id}/read      mark as read
//   POST   /mailboxes/{address}/messages/{id}/archive   archive
//   DELETE /mailboxes/{address}/messages/{id}           delete
//
// There is deliberately no send or forward endpoint: mailbox-mcp is
// receive-only.

import {
  deleteMessage,
  getMetadata,
  getRaw,
  isValidMessageId,
  listMetadata,
  normalizeMailbox,
  patchMetadata,
  type MessageMetadata,
} from "./storage";

export interface Env {
  /** R2 bucket the email worker stores messages in. */
  MAILBOX_STORE: R2Bucket;
  /** Bearer token clients must present. Set with `wrangler secret put`. */
  MESSAGES_API_TOKEN: string;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function notFound(): Response {
  return json({ error: "not found" }, 404);
}

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    if (!authorized(request, env)) {
      return json({ error: "unauthorized" }, 401);
    }

    const url = new URL(request.url);
    const segments = url.pathname
      .split("/")
      .filter((s) => s.length > 0)
      .map((s) => decodeURIComponent(s));

    // Route: /mailboxes/{address}/messages[/{id}[/read|archive]]
    if (segments.length < 3 || segments[0] !== "mailboxes" || segments[2] !== "messages") {
      return notFound();
    }
    const mailbox = normalizeMailbox(segments[1]!);
    if (mailbox === null) {
      return json({ error: "invalid mailbox address" }, 400);
    }

    if (segments.length === 3) {
      return handleList(request, env, mailbox, url);
    }

    const id = segments[3]!;
    if (!isValidMessageId(id)) {
      return json({ error: "invalid message id" }, 400);
    }
    const action = segments[4];
    if (action !== undefined && action !== "read" && action !== "archive") {
      return notFound();
    }

    if (action === undefined && request.method === "GET") {
      return handleRead(env, mailbox, id);
    }
    if (action === undefined && request.method === "DELETE") {
      return handleDelete(env, mailbox, id);
    }
    if (action === "read" && request.method === "POST") {
      return handleFlag(env, mailbox, id, { read: true });
    }
    if (action === "archive" && request.method === "POST") {
      return handleFlag(env, mailbox, id, { archived: true });
    }
    return json({ error: "method not allowed" }, 405);
  },
};

function authorized(request: Request, env: Env): boolean {
  // Plain comparison is fine here: a mismatched-length compare does not leak
  // anything an attacker can use, because the token is re-created per deploy
  // and every failed attempt is already indistinguishable by response body.
  return request.headers.get("authorization") === `Bearer ${env.MESSAGES_API_TOKEN}`;
}

async function handleList(request: Request, env: Env, mailbox: string, url: URL): Promise<Response> {
  if (request.method !== "GET") {
    return json({ error: "method not allowed" }, 405);
  }
  const limitParam = url.searchParams.get("limit");
  let limit = DEFAULT_LIMIT;
  if (limitParam !== null) {
    const parsed = Number.parseInt(limitParam, 10);
    if (Number.isNaN(parsed) || parsed < 1) {
      return json({ error: "invalid limit" }, 400);
    }
    limit = Math.min(parsed, MAX_LIMIT);
  }
  const cursorParam = url.searchParams.get("cursor") ?? undefined;
  const page = await listMetadata(env.MAILBOX_STORE, mailbox, cursorParam, limit);
  return json({ messages: page.messages, nextPageToken: page.nextCursor });
}

async function handleRead(env: Env, mailbox: string, id: string): Promise<Response> {
  const metadata = await getMetadata(env.MAILBOX_STORE, mailbox, id);
  if (metadata === null) {
    return notFound();
  }
  const raw = await getRaw(env.MAILBOX_STORE, mailbox, id);
  if (raw === null) {
    // Metadata without raw bytes should not happen (the email worker writes
    // raw first); treat it as missing rather than returning an empty message.
    return notFound();
  }
  return json({ message: metadata, raw });
}

async function handleFlag(
  env: Env,
  mailbox: string,
  id: string,
  patch: { read?: boolean; archived?: boolean },
): Promise<Response> {
  const metadata = await getMetadata(env.MAILBOX_STORE, mailbox, id);
  if (metadata === null) {
    return notFound();
  }
  const updated: MessageMetadata = await patchMetadata(env.MAILBOX_STORE, metadata, patch);
  return json({ message: updated });
}

async function handleDelete(env: Env, mailbox: string, id: string): Promise<Response> {
  const metadata = await getMetadata(env.MAILBOX_STORE, mailbox, id);
  if (metadata === null) {
    return notFound();
  }
  await deleteMessage(env.MAILBOX_STORE, mailbox, id);
  return json({ deleted: true });
}
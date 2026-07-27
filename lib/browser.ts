import { chromium, type Browser, type Page } from "playwright-core";

// Server-side only. Controls a remote, managed browser via Steel.dev.
//
// This project is a single personal assistant for one user, so a single
// in-memory "current browser session" and "current pending confirmation"
// is enough — no per-user/per-conversation keying. That also means this
// state only survives while the Node process stays warm: fine on a
// persistent host (Railway, Fly, a VPS), but it will NOT persist across
// invocations on a cold-start serverless platform like Vercel. If Phase 6
// deploys there, this needs a real store (e.g. Redis) instead.

interface BrowserSession {
  id: string;
  browser: Browser;
  page: Page;
}

interface PendingAction {
  description: string;
  run: () => Promise<string>;
}

let activeSession: BrowserSession | null = null;
let pendingConfirmation: PendingAction | null = null;

function apiKey(): string {
  const key = process.env.STEEL_API_KEY;
  if (!key) throw new Error("STEEL_API_KEY is not configured on the server");
  return key;
}

async function ensureSession(): Promise<BrowserSession> {
  if (activeSession) return activeSession;

  const res = await fetch("https://api.steel.dev/v1/sessions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Steel-Api-Key": apiKey(),
    },
    body: JSON.stringify({}),
  });
  if (!res.ok) {
    throw new Error(`Failed to create browser session: ${await res.text()}`);
  }
  const session = (await res.json()) as { id: string };

  const browser = await chromium.connectOverCDP(
    `wss://connect.steel.dev?apiKey=${apiKey()}&sessionId=${session.id}`
  );
  const context = browser.contexts()[0] ?? (await browser.newContext());
  const page = context.pages()[0] ?? (await context.newPage());

  activeSession = { id: session.id, browser, page };
  return activeSession;
}

async function extractVisibleText(page: Page): Promise<string> {
  const text = await page.evaluate(() => document.body?.innerText ?? "");
  return text.trim().slice(0, 3000);
}

// Finds an element by natural-language description, trying the most
// semantic locator strategies first and falling back to treating the
// description as a raw CSS selector for power-user cases.
async function locate(page: Page, description: string) {
  const pattern = new RegExp(escapeRegExp(description), "i");

  const byRole = page
    .getByRole("button", { name: pattern })
    .or(page.getByRole("link", { name: pattern }));
  if (await byRole.count()) return byRole.first();

  const byLabel = page.getByLabel(description, { exact: false });
  if (await byLabel.count()) return byLabel.first();

  const byPlaceholder = page.getByPlaceholder(description, { exact: false });
  if (await byPlaceholder.count()) return byPlaceholder.first();

  const byText = page.getByText(description, { exact: false });
  if (await byText.count()) return byText.first();

  return page.locator(description).first();
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function requestConfirmation(
  description: string,
  run: () => Promise<string>
): string {
  pendingConfirmation = { description, run };
  return (
    `This action needs the user's explicit confirmation before it happens: ` +
    `${description}. Ask them out loud and wait for their next reply — do ` +
    `not assume yes. Once they actually respond, call browser_confirm with ` +
    `confirmed=true or confirmed=false.`
  );
}

export async function browserOpen(url: string): Promise<string> {
  const { page } = await ensureSession();
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
  const title = await page.title();
  const text = await extractVisibleText(page);
  return `Opened "${title}" (${page.url()}).\n\n${text}`;
}

export async function browserClick(args: {
  description: string;
  sensitive?: boolean;
}): Promise<string> {
  if (!activeSession) return "No browser session is open. Use browser_open first.";
  const session = activeSession;
  const run = async () => {
    const el = await locate(session.page, args.description);
    await el.click({ timeout: 10000 });
    return `Clicked "${args.description}".\n\n${await extractVisibleText(
      session.page
    )}`;
  };
  if (args.sensitive) return requestConfirmation(`click "${args.description}"`, run);
  return run();
}

export async function browserType(args: {
  description: string;
  text: string;
  sensitive?: boolean;
}): Promise<string> {
  if (!activeSession) return "No browser session is open. Use browser_open first.";
  const session = activeSession;
  const run = async () => {
    const el = await locate(session.page, args.description);
    await el.fill(args.text, { timeout: 10000 });
    return `Typed into "${args.description}".`;
  };
  if (args.sensitive) {
    return requestConfirmation(`type into "${args.description}"`, run);
  }
  return run();
}

export async function browserExtract(): Promise<string> {
  if (!activeSession) return "No browser session is open. Use browser_open first.";
  return extractVisibleText(activeSession.page);
}

export async function browserConfirm(confirmed: boolean): Promise<string> {
  if (!pendingConfirmation) {
    return "There is no pending action waiting for confirmation.";
  }
  const { description, run } = pendingConfirmation;
  pendingConfirmation = null;
  if (!confirmed) return `Cancelled: ${description}.`;
  try {
    return await run();
  } catch (err) {
    return `Failed to ${description}: ${
      err instanceof Error ? err.message : String(err)
    }`;
  }
}

export async function browserClose(): Promise<string> {
  if (!activeSession) return "No browser session is open.";
  const { id, browser } = activeSession;
  activeSession = null;
  pendingConfirmation = null;
  await browser.close().catch(() => {});
  await fetch(`https://api.steel.dev/v1/sessions/${id}/release`, {
    method: "POST",
    headers: { "Steel-Api-Key": apiKey() },
  }).catch(() => {});
  return "Browser session closed.";
}

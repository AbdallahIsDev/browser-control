import type { Page, Dialog as PlaywrightDialog } from "playwright";
import { logger } from "../shared/logger";
import { redactString } from "../observability/redaction";

const log = logger.withComponent("dialog_supervisor");

export type DialogType = "alert" | "confirm" | "prompt" | "beforeunload";

export interface DialogInfo {
  id: string;
  type: DialogType;
  message: string;
  defaultValue?: string;
  frameId?: string;
  createdAt: string;
}

export type DialogAction = "accept" | "dismiss";

export type DialogHandlingMode =
  | "must_respond"
  | "auto_accept"
  | "auto_dismiss"
  | "defer";

export interface DialogResponse {
  handled: boolean;
  dialog: DialogInfo;
}

export interface DialogAuditEvent {
  timestamp: string;
  sessionId: string;
  dialogId: string;
  type: DialogType;
  action: "detected" | "auto_accept" | "auto_dismiss" | "respond" | "timed_out" | "error";
  response?: DialogAction;
}

interface PendingDialog {
  dialog: PlaywrightDialog | null;
  info: DialogInfo;
  handled: boolean;
  timeout?: NodeJS.Timeout;
}

interface PageHandlers {
  dialog: (d: PlaywrightDialog) => void;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CdpClient = any;

interface CdpSessionEntry {
  client: CdpClient;
  handler: (params: Record<string, unknown>) => void;
}

export class BrowserDialogSupervisor {
  private sessions = new Map<string, Map<string, PendingDialog>>();
  private pageHandlers = new WeakMap<Page, PageHandlers>();
  private cdpSessions = new WeakMap<Page, CdpSessionEntry>();
  private idCounters = new Map<string, number>();

  private handlingMode: DialogHandlingMode = "must_respond";
  private timeoutMs = 10000;
  private onAuditEvent?: (event: DialogAuditEvent) => void;

  setHandlingMode(mode: DialogHandlingMode): void {
    this.handlingMode = mode;
  }

  getHandlingMode(): DialogHandlingMode {
    return this.handlingMode;
  }

  setDefaultTimeout(ms: number): void {
    this.timeoutMs = ms;
  }

  getDefaultTimeout(): number {
    return this.timeoutMs;
  }

  setAuditCallback(cb: (event: DialogAuditEvent) => void): void {
    this.onAuditEvent = cb;
  }

  private ensureSession(sessionId: string): Map<string, PendingDialog> {
    let session = this.sessions.get(sessionId);
    if (!session) {
      session = new Map();
      this.sessions.set(sessionId, session);
    }
    return session;
  }

  private nextId(sessionId: string): string {
    const counter = this.idCounters.get(sessionId) ?? 0;
    this.idCounters.set(sessionId, counter + 1);
    return `dlg-${sessionId}-${counter + 1}`;
  }

  attachToPage(page: Page, sessionId = "default"): void {
    if (this.pageHandlers.has(page)) return;
    if (typeof (page as any).on !== "function") return;

    const dialogHandler = (dialog: PlaywrightDialog): void => {
      this.handlePlaywrightDialog(dialog, page, sessionId);
    };

    page.on("dialog", dialogHandler);

    this.pageHandlers.set(page, { dialog: dialogHandler });
  }

  detachFromPage(page: Page): void {
    const handlers = this.pageHandlers.get(page);
    if (!handlers) return;
    if (typeof (page as any).off === "function") {
      page.off("dialog", handlers.dialog);
    }
    this.tryDetachCdp(page);
    this.pageHandlers.delete(page);
  }

  private async tryAttachCdp(page: Page, handler: (params: Record<string, unknown>) => void): Promise<void> {
    try {
      const client = (await page.context().newCDPSession(page)) as unknown as {
        on: (event: string, handler: (...args: unknown[]) => void) => void;
        off: (event: string, handler: (...args: unknown[]) => void) => void;
        send: (method: string, params?: Record<string, unknown>) => Promise<unknown>;
      };
      client.on("Page.javascriptDialogOpening", handler as unknown as (...args: unknown[]) => void);
      client.on("Page.javascriptDialogClosed", ((params: Record<string, unknown>) => {
        this.handleCdpDialogClosed(params);
      }) as unknown as (...args: unknown[]) => void);
      this.cdpSessions.set(page, { client, handler });
    } catch {
      // CDP not available — Playwright events are sufficient
    }
  }

  private tryDetachCdp(page: Page): void {
    const entry = this.cdpSessions.get(page);
    if (entry) {
      try {
        entry.client.off("Page.javascriptDialogOpening", entry.handler as (...args: unknown[]) => void);
      } catch { /* ignore */ }
      this.cdpSessions.delete(page);
    }
  }

  private async respondViaCdp(page: Page, action: DialogAction, text?: string): Promise<boolean> {
    try {
      const entry = this.cdpSessions.get(page);
      if (entry) {
        await entry.client.send("Page.handleJavaScriptDialog", {
          accept: action === "accept",
          promptText: text,
        });
      } else {
        const client = (await page.context().newCDPSession(page)) as unknown as {
          send: (method: string, params?: Record<string, unknown>) => Promise<unknown>;
        };
        await client.send("Page.handleJavaScriptDialog", {
          accept: action === "accept",
          promptText: text,
        });
      }
      return true;
    } catch {
      return false;
    }
  }

  private handlePlaywrightDialog(dialog: PlaywrightDialog, page: Page, sessionId: string): void {
    const id = this.nextId(sessionId);
    const message = dialog.message();
    const info: DialogInfo = {
      id,
      type: dialog.type() as DialogType,
      message: this.redactMessage(message),
      defaultValue: dialog.defaultValue() || undefined,
      createdAt: new Date().toISOString(),
    };

    const session = this.ensureSession(sessionId);
    session.set(id, { dialog, info, handled: false });

    log.info("Dialog detected (Playwright)", { id, type: info.type, sessionId });
    this.emitAudit({ timestamp: info.createdAt, sessionId, dialogId: id, type: info.type, action: "detected" });
    this.startAutoHandling(id, sessionId, page);
  }

  private handleCdpDialogOpening(params: Record<string, unknown>, page: Page, sessionId: string): void {
    const { type, message, defaultPrompt } = params as { type: DialogType; message: string; defaultPrompt?: string };

    const session = this.ensureSession(sessionId);
    for (const [, entry] of session) {
      if (!entry.handled) {
        const age = Date.now() - new Date(entry.info.createdAt).getTime();
        if (age < 500 && entry.info.type === type) {
          return;
        }
      }
    }

    const id = this.nextId(sessionId);
    const info: DialogInfo = {
      id,
      type,
      message: this.redactMessage(message),
      defaultValue: defaultPrompt || undefined,
      createdAt: new Date().toISOString(),
    };

    session.set(id, { dialog: null, info, handled: false });

    log.info("Dialog detected (CDP)", { id, type: info.type, sessionId });
    this.emitAudit({ timestamp: info.createdAt, sessionId, dialogId: id, type: info.type, action: "detected" });
    this.startAutoHandling(id, sessionId, page);
  }

  private handleCdpDialogClosed(_params: Record<string, unknown>): void {
    // CDP dialog closed event — dialog was handled externally or by page
    // Best-effort; pending dialog cleanup happens via getPendingDialogs filtering
  }

  private startAutoHandling(id: string, sessionId: string, page: Page): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    const entry = session.get(id);
    if (!entry || entry.handled) return;

    if (this.handlingMode === "auto_accept") {
      this.executeAuto(id, sessionId, page, "accept");
    } else if (this.handlingMode === "auto_dismiss") {
      this.executeAuto(id, sessionId, page, "dismiss");
    } else {
      this.scheduleSafetyTimeout(id, sessionId, page);
    }
  }

  private executeAuto(id: string, sessionId: string, page: Page, action: DialogAction): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    const entry = session.get(id);
    if (!entry || entry.handled) return;

    entry.handled = true;
    if (entry.dialog) {
      if (action === "accept") entry.dialog.accept().catch(() => {});
      else entry.dialog.dismiss().catch(() => {});
    } else {
      this.respondViaCdp(page, action).catch(() => {});
    }

    log.info(`Dialog auto-${action}ed`, { id, sessionId });
    this.emitAudit({
      timestamp: new Date().toISOString(),
      sessionId, dialogId: id, type: entry.info.type,
      action: action === "accept" ? "auto_accept" : "auto_dismiss",
    });
  }

  private scheduleSafetyTimeout(id: string, sessionId: string, page: Page): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    const entry = session.get(id);
    if (!entry || entry.handled) return;

    entry.timeout = setTimeout(() => {
      const current = session.get(id);
      if (current && !current.handled) {
        current.handled = true;
        if (current.dialog) current.dialog.dismiss().catch(() => {});
        else this.respondViaCdp(page, "dismiss").catch(() => {});
        log.warn("Dialog safety timeout — dismissed", { id, timeoutMs: this.timeoutMs, sessionId });
        this.emitAudit({
          timestamp: new Date().toISOString(),
          sessionId, dialogId: id, type: current.info.type,
          action: "timed_out", response: "dismiss",
        });
      }
    }, this.timeoutMs);
    if (entry.timeout) entry.timeout.unref();
  }

  getPendingDialogs(sessionId = "default"): DialogInfo[] {
    const session = this.sessions.get(sessionId);
    if (!session) return [];
    return Array.from(session.values())
      .filter((e) => !e.handled)
      .map((e) => e.info);
  }

  getPendingDialog(id: string, sessionId = "default"): DialogInfo | undefined {
    const session = this.sessions.get(sessionId);
    if (!session) return undefined;
    const entry = session.get(id);
    if (!entry || entry.handled) return undefined;
    return entry.info;
  }

  respond(id: string, action: DialogAction, page?: Page, text?: string, sessionId = "default"): DialogResponse {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Dialog not found: ${id} in session ${sessionId}`);

    const entry = session.get(id);
    if (!entry) throw new Error(`Dialog not found: ${id}`);
    if (entry.handled) throw new Error(`Dialog ${id} has already been handled`);

    if (entry.timeout) {
      clearTimeout(entry.timeout);
      entry.timeout = undefined;
    }

    entry.handled = true;

    if (entry.dialog) {
      if (action === "accept") entry.dialog.accept(text).catch(() => {});
      else entry.dialog.dismiss().catch(() => {});
    } else if (page) {
      this.respondViaCdp(page, action, text).catch(() => {});
    }

    log.info("Dialog responded", { id, action, sessionId });
    this.emitAudit({
      timestamp: new Date().toISOString(),
      sessionId, dialogId: id, type: entry.info.type,
      action: "respond", response: action,
    });

    return { handled: true, dialog: entry.info };
  }

  cleanHandled(sessionId = "default"): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    for (const [id, entry] of session) {
      if (entry.handled) {
        if (entry.timeout) clearTimeout(entry.timeout);
        session.delete(id);
      }
    }
  }

  clearSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      for (const [, entry] of session) {
        if (entry.timeout) clearTimeout(entry.timeout);
      }
      this.sessions.delete(sessionId);
      this.idCounters.delete(sessionId);
    }
  }

  clearAll(): void {
    for (const sessionId of this.sessions.keys()) {
      this.clearSession(sessionId);
    }
  }

  private emitAudit(event: DialogAuditEvent): void {
    try {
      this.onAuditEvent?.(event);
    } catch {
      // audit callback must not break dialog handling
    }
  }

  private redactMessage(message: string): string {
    return redactString(message);
  }
}

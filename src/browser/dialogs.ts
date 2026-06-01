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
  page: Page;
  dialog: PlaywrightDialog;
  info: DialogInfo;
  handled: boolean;
  timeout?: NodeJS.Timeout;
}

interface PageHandlers {
  dialog: (d: PlaywrightDialog) => void;
  close: () => void;
  sessionId: string;
}

export class BrowserDialogSupervisor {
  private sessions = new Map<string, Map<string, PendingDialog>>();
  private pageHandlers = new WeakMap<Page, PageHandlers>();
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
      this.handlePlaywrightDialog(dialog, sessionId, page);
    };
    const closeHandler = (): void => {
      this.detachFromPage(page);
    };

    page.on("dialog", dialogHandler);
    page.on("close", closeHandler);

    this.pageHandlers.set(page, { dialog: dialogHandler, close: closeHandler, sessionId });
  }

  detachFromPage(page: Page): void {
    const handlers = this.pageHandlers.get(page);
    if (!handlers) return;
    if (typeof (page as any).off === "function") {
      page.off("dialog", handlers.dialog);
      page.off("close", handlers.close);
    }
    this.pageHandlers.delete(page);
    this.clearPageDialogs(page, handlers.sessionId);
  }

  private clearPageDialogs(page: Page, sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    for (const [id, entry] of session) {
      if (entry.page !== page) continue;
      if (entry.timeout) clearTimeout(entry.timeout);
      session.delete(id);
    }
    if (session.size === 0) {
      this.sessions.delete(sessionId);
      this.idCounters.delete(sessionId);
    }
  }

  private handlePlaywrightDialog(dialog: PlaywrightDialog, sessionId: string, page: Page): void {
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
    session.set(id, { page, dialog, info, handled: false });

    log.info("Dialog detected (Playwright)", { id, type: info.type, sessionId });
    this.emitAudit({ timestamp: info.createdAt, sessionId, dialogId: id, type: info.type, action: "detected" });
    this.startAutoHandling(id, sessionId);
  }

  private startAutoHandling(id: string, sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    const entry = session.get(id);
    if (!entry || entry.handled) return;

    if (this.handlingMode === "auto_accept") {
      this.executeAuto(id, sessionId, "accept");
    } else if (this.handlingMode === "auto_dismiss") {
      this.executeAuto(id, sessionId, "dismiss");
    } else {
      this.scheduleSafetyTimeout(id, sessionId);
    }
  }

  private executeAuto(id: string, sessionId: string, action: DialogAction): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    const entry = session.get(id);
    if (!entry || entry.handled) return;

    entry.handled = true;
    if (action === "accept") entry.dialog.accept().catch(() => {});
    else entry.dialog.dismiss().catch(() => {});

    log.info(`Dialog auto-${action}ed`, { id, sessionId });
    this.emitAudit({
      timestamp: new Date().toISOString(),
      sessionId, dialogId: id, type: entry.info.type,
      action: action === "accept" ? "auto_accept" : "auto_dismiss",
    });
  }

  private scheduleSafetyTimeout(id: string, sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    const entry = session.get(id);
    if (!entry || entry.handled) return;

    entry.timeout = setTimeout(() => {
      const current = session.get(id);
      if (current && !current.handled) {
        current.handled = true;
        current.dialog.dismiss().catch(() => {});
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

  respond(id: string, action: DialogAction, _page?: Page, text?: string, sessionId = "default"): DialogResponse {
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

    if (action === "accept") entry.dialog.accept(text).catch(() => {});
    else entry.dialog.dismiss().catch(() => {});

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

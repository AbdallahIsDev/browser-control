import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import {
  BrowserDialogSupervisor,
  type DialogInfo,
} from "../../src/browser/dialogs";

type DialogEventHandler = (dialog: {
  type: () => string;
  message: () => string;
  defaultValue: () => string;
  accept: (text?: string) => Promise<void>;
  dismiss: () => Promise<void>;
}) => void;

interface FakePage {
  dialogHandler?: DialogEventHandler;
  on: (event: string, handler: DialogEventHandler) => void;
  off: (event: string, handler: DialogEventHandler) => void;
  context: () => {
    newCDPSession: () => Promise<{
      on: (e: string, cb: (...args: unknown[]) => void) => void;
      off: (e: string, cb: (...args: unknown[]) => void) => void;
      send: (method: string, params?: Record<string, unknown>) => Promise<unknown>;
    }>;
  };
}

function makeFakeDialog(
  overrides: Partial<{
    type: string;
    message: string;
    defaultValue: string;
    accept: (text?: string) => Promise<void>;
    dismiss: () => Promise<void>;
  }> = {},
) {
  return {
    type: () => overrides.type ?? "alert",
    message: () => overrides.message ?? "Hello",
    defaultValue: () => overrides.defaultValue ?? "",
    accept: overrides.accept ?? mock.fn(() => Promise.resolve()),
    dismiss: overrides.dismiss ?? mock.fn(() => Promise.resolve()),
  };
}

function makeFakePage(): FakePage {
  let handler: DialogEventHandler | undefined;
  return {
    get dialogHandler() {
      return handler;
    },
    on(event: string, h: DialogEventHandler) {
      handler = h;
    },
    off(event: string, h: DialogEventHandler) {
      if (handler === h) handler = undefined;
    },
    context: () => ({
      newCDPSession: mock.fn(() =>
        Promise.reject(new Error("CDP unavailable")),
      ),
    }),
  };
}

function triggerDialogEvent(page: FakePage, dialog: ReturnType<typeof makeFakeDialog>): void {
  if (page.dialogHandler) {
    page.dialogHandler(dialog);
  } else {
    throw new Error("No dialog handler registered on page");
  }
}

describe("BrowserDialogSupervisor", () => {
  describe("session scoping", () => {
    it("isolates dialogs by session ID (separate pages)", () => {
      const sup = new BrowserDialogSupervisor();

      sup.setHandlingMode("must_respond");

      const pageA = makeFakePage();
      const pageB = makeFakePage();

      sup.attachToPage(pageA as unknown as Parameters<typeof sup.attachToPage>[0], "session-a");
      sup.attachToPage(pageB as unknown as Parameters<typeof sup.attachToPage>[0], "session-b");

      triggerDialogEvent(pageA, makeFakeDialog({ type: "alert" }));
      triggerDialogEvent(pageB, makeFakeDialog({ type: "confirm" }));

      const dialogsA = sup.getPendingDialogs("session-a");
      const dialogsB = sup.getPendingDialogs("session-b");

      assert.equal(dialogsA.length, 1);
      assert.equal(dialogsA[0].type, "alert");
      assert.equal(dialogsB.length, 1);
      assert.equal(dialogsB[0].type, "confirm");

      sup.respond(dialogsA[0].id, "accept", undefined, undefined, "session-a");

      assert.equal(sup.getPendingDialogs("session-a").length, 0);
      assert.equal(sup.getPendingDialogs("session-b").length, 1);
    });

    it("getPendingDialogs returns default session by default", () => {
      const sup = new BrowserDialogSupervisor();
      const page = makeFakePage();

      sup.setHandlingMode("must_respond");
      sup.attachToPage(page as unknown as Parameters<typeof sup.attachToPage>[0]);

      triggerDialogEvent(page, makeFakeDialog());

      assert.equal(sup.getPendingDialogs().length, 1);
    });

    it("clearSession removes only one session", () => {
      const sup = new BrowserDialogSupervisor();
      const pageA = makeFakePage();
      const pageB = makeFakePage();

      sup.setHandlingMode("must_respond");
      sup.attachToPage(pageA as unknown as Parameters<typeof sup.attachToPage>[0], "session-a");
      sup.attachToPage(pageB as unknown as Parameters<typeof sup.attachToPage>[0], "session-b");

      triggerDialogEvent(pageA, makeFakeDialog());
      triggerDialogEvent(pageB, makeFakeDialog());

      sup.clearSession("session-a");

      assert.equal(sup.getPendingDialogs("session-a").length, 0);
      assert.equal(sup.getPendingDialogs("session-b").length, 1);
    });
  });

  describe("handling modes", () => {
    it("auto_accept immediately accepts dialogs", () => {
      const sup = new BrowserDialogSupervisor();
      let accepted = false;
      const page = makeFakePage();

      sup.setHandlingMode("auto_accept");
      sup.attachToPage(page as unknown as Parameters<typeof sup.attachToPage>[0]);

      triggerDialogEvent(page, makeFakeDialog({
        accept: mock.fn(() => { accepted = true; return Promise.resolve(); }),
      }));

      assert.equal(sup.getPendingDialogs().length, 0);
      assert.ok(accepted);
    });

    it("auto_dismiss immediately dismisses dialogs", () => {
      const sup = new BrowserDialogSupervisor();
      let dismissed = false;
      const page = makeFakePage();

      sup.setHandlingMode("auto_dismiss");
      sup.attachToPage(page as unknown as Parameters<typeof sup.attachToPage>[0]);

      triggerDialogEvent(page, makeFakeDialog({
        dismiss: mock.fn(() => { dismissed = true; return Promise.resolve(); }),
      }));

      assert.equal(sup.getPendingDialogs().length, 0);
      assert.ok(dismissed);
    });

    it("must_respond keeps dialogs pending until responded", () => {
      const sup = new BrowserDialogSupervisor();
      const page = makeFakePage();

      sup.setHandlingMode("must_respond");
      sup.attachToPage(page as unknown as Parameters<typeof sup.attachToPage>[0]);

      triggerDialogEvent(page, makeFakeDialog({ type: "confirm" }));

      const pending = sup.getPendingDialogs();
      assert.equal(pending.length, 1);
      assert.equal(pending[0].type, "confirm");
    });
  });

  describe("respond", () => {
    it("accepts a dialog and marks it handled", async () => {
      const sup = new BrowserDialogSupervisor();
      let accepted = false;
      const page = makeFakePage();

      sup.setHandlingMode("must_respond");
      sup.attachToPage(page as unknown as Parameters<typeof sup.attachToPage>[0]);

      triggerDialogEvent(page, makeFakeDialog({
        type: "prompt",
        defaultValue: "default",
        accept: mock.fn(async (text?: string) => { accepted = true; }),
      }));

      const pending = sup.getPendingDialogs();
      assert.equal(pending.length, 1);

      const result = sup.respond(pending[0].id, "accept", undefined, "hello");
      assert.equal(result.handled, true);
      assert.equal(result.dialog.type, "prompt");
      assert.ok(accepted);
      assert.equal(sup.getPendingDialogs().length, 0);
    });

    it("dismisses a dialog", () => {
      const sup = new BrowserDialogSupervisor();
      let dismissed = false;
      const page = makeFakePage();

      sup.setHandlingMode("must_respond");
      sup.attachToPage(page as unknown as Parameters<typeof sup.attachToPage>[0]);

      triggerDialogEvent(page, makeFakeDialog({
        type: "confirm",
        dismiss: mock.fn(() => { dismissed = true; return Promise.resolve(); }),
      }));

      const pending = sup.getPendingDialogs();
      sup.respond(pending[0].id, "dismiss");

      assert.ok(dismissed);
    });

    it("throws for unknown dialog ID", () => {
      const sup = new BrowserDialogSupervisor();
      assert.throws(() => sup.respond("nonexistent", "accept"), /Dialog not found/);
    });

    it("throws for already handled dialog", () => {
      const sup = new BrowserDialogSupervisor();
      const page = makeFakePage();

      sup.setHandlingMode("must_respond");
      sup.attachToPage(page as unknown as Parameters<typeof sup.attachToPage>[0]);

      triggerDialogEvent(page, makeFakeDialog());

      const pending = sup.getPendingDialogs();
      sup.respond(pending[0].id, "accept");
      assert.throws(() => sup.respond(pending[0].id, "dismiss"), /already been handled/);
    });
  });

  describe("cleanHandled", () => {
    it("removes handled dialogs from pending", () => {
      const sup = new BrowserDialogSupervisor();
      const page = makeFakePage();

      sup.setHandlingMode("must_respond");
      sup.attachToPage(page as unknown as Parameters<typeof sup.attachToPage>[0]);

      triggerDialogEvent(page, makeFakeDialog());
      triggerDialogEvent(page, makeFakeDialog({ type: "confirm" }));

      const pending = sup.getPendingDialogs();
      sup.respond(pending[0].id, "accept");

      assert.equal(sup.getPendingDialogs().length, 1);
      sup.cleanHandled();
      assert.equal(sup.getPendingDialogs().length, 1);

      sup.respond(pending[1].id, "dismiss");
      sup.cleanHandled();
      assert.equal(sup.getPendingDialogs().length, 0);
    });
  });

  describe("clearAll", () => {
    it("removes all dialogs from all sessions", () => {
      const sup = new BrowserDialogSupervisor();
      const pageA = makeFakePage();
      const pageB = makeFakePage();

      sup.setHandlingMode("must_respond");
      sup.attachToPage(pageA as unknown as Parameters<typeof sup.attachToPage>[0], "s1");
      sup.attachToPage(pageB as unknown as Parameters<typeof sup.attachToPage>[0], "s2");

      triggerDialogEvent(pageA, makeFakeDialog());
      triggerDialogEvent(pageB, makeFakeDialog());

      sup.clearAll();

      assert.equal(sup.getPendingDialogs("s1").length, 0);
      assert.equal(sup.getPendingDialogs("s2").length, 0);
    });
  });

  describe("DialogInfo structure", () => {
    it("includes createdAt (not timestamp) and excludes handled", () => {
      const sup = new BrowserDialogSupervisor();
      const page = makeFakePage();

      sup.setHandlingMode("must_respond");
      sup.attachToPage(page as unknown as Parameters<typeof sup.attachToPage>[0]);

      triggerDialogEvent(page, makeFakeDialog({ type: "confirm", message: "Are you sure?" }));

      const pending = sup.getPendingDialogs();
      assert.equal(pending.length, 1);
      const dlg = pending[0];
      const d = dlg as unknown as Record<string, unknown>;
      assert.ok("createdAt" in d);
      assert.equal(d.timestamp, undefined);
      assert.equal(d.handled, undefined);
      assert.equal(dlg.type, "confirm");
      assert.equal(dlg.message, "Are you sure?");
      assert.ok(dlg.id.startsWith("dlg-"));
    });
  });

  describe("redaction", () => {
    it("redacts sensitive patterns from dialog messages", () => {
      const sup = new BrowserDialogSupervisor();
      const page = makeFakePage();

      sup.setHandlingMode("must_respond");
      sup.attachToPage(page as unknown as Parameters<typeof sup.attachToPage>[0]);

      triggerDialogEvent(page, makeFakeDialog({
        type: "prompt",
        message: "Enter password: mysecret123",
      }));

      const pending = sup.getPendingDialogs();
      assert.equal(pending.length, 1);
      assert.ok(pending[0].message.includes("[REDACTED]"), `Should redact, got: ${pending[0].message}`);
      assert.ok(!pending[0].message.includes("mysecret123"), "Should not contain raw secret");
    });
  });

  describe("audit events", () => {
    it("emits audit events for detected and responded dialogs", () => {
      const sup = new BrowserDialogSupervisor();
      const page = makeFakePage();
      const events: Array<{ action: string }> = [];

      sup.setAuditCallback((e) => events.push(e));
      sup.setHandlingMode("must_respond");
      sup.attachToPage(page as unknown as Parameters<typeof sup.attachToPage>[0]);

      triggerDialogEvent(page, makeFakeDialog({ type: "alert" }));

      assert.equal(events.length, 1);
      assert.equal(events[0].action, "detected");

      const pending = sup.getPendingDialogs();
      sup.respond(pending[0].id, "accept");

      assert.equal(events.length, 2);
      assert.equal(events[1].action, "respond");
    });

    it("emits auto_accept audit event", () => {
      const sup = new BrowserDialogSupervisor();
      const page = makeFakePage();
      const events: Array<{ action: string }> = [];

      sup.setAuditCallback((e) => events.push(e));
      sup.setHandlingMode("auto_accept");
      sup.attachToPage(page as unknown as Parameters<typeof sup.attachToPage>[0]);

      triggerDialogEvent(page, makeFakeDialog());

      assert.equal(events.length, 2);
      assert.equal(events[0].action, "detected");
      assert.equal(events[1].action, "auto_accept");
    });
  });

  describe("getPendingDialog", () => {
    it("returns undefined for unknown id", () => {
      const sup = new BrowserDialogSupervisor();
      assert.equal(sup.getPendingDialog("nonexistent"), undefined);
    });

    it("returns dialog info for a valid id", () => {
      const sup = new BrowserDialogSupervisor();
      const page = makeFakePage();

      sup.setHandlingMode("must_respond");
      sup.attachToPage(page as unknown as Parameters<typeof sup.attachToPage>[0]);

      triggerDialogEvent(page, makeFakeDialog({ type: "beforeunload" }));

      const pending = sup.getPendingDialogs();
      const dlg = sup.getPendingDialog(pending[0].id);
      assert.ok(dlg);
      assert.equal(dlg!.type, "beforeunload");
    });
  });

  describe("lifecycle", () => {
    it("detachFromPage removes listeners", () => {
      const sup = new BrowserDialogSupervisor();
      const page = makeFakePage();

      sup.setHandlingMode("must_respond");
      sup.attachToPage(page as unknown as Parameters<typeof sup.attachToPage>[0]);

      assert.ok(page.dialogHandler, "handler should be registered");

      sup.detachFromPage(page as unknown as Parameters<typeof sup.detachFromPage>[0]);

      assert.equal(page.dialogHandler, undefined, "handler should be removed");
    });

    it("multiple attachToPage calls are idempotent", () => {
      const sup = new BrowserDialogSupervisor();
      const page = makeFakePage();

      sup.attachToPage(page as unknown as Parameters<typeof sup.attachToPage>[0]);
      sup.attachToPage(page as unknown as Parameters<typeof sup.attachToPage>[0]);

      assert.ok(page.dialogHandler, "handler should be registered exactly once");
    });
  });
});

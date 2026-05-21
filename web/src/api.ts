function getToken() {
	return sessionStorage.getItem("bc-token") || "";
}

export function hasToken(): boolean {
	return sessionStorage.getItem("bc-token") !== null;
}

const hashParams = new URLSearchParams(window.location.hash.slice(1));

const hashToken = hashParams.get("token");

if (hashToken) {
	sessionStorage.setItem("bc-token", hashToken);

	hashParams.delete("token");

	const nextHash = hashParams.toString();

	window.history.replaceState(
		null,

		document.title,

		`${window.location.pathname}${window.location.search}${nextHash ? `#${nextHash}` : ""}`,
	);
}

export async function apiFetch<T>(
	path: string,
	options: RequestInit = {},
): Promise<T> {
	const headers = new Headers(options.headers);
	const hasBody = options.body !== undefined && options.body !== null;
	if (hasBody && !headers.has("content-type")) {
		headers.set("content-type", "application/json");
	}
	headers.set("authorization", `Bearer ${getToken()}`);

	const response = await fetch(path, {
		...options,
		headers,
	});

	const text = await response.text();
	const contentType = response.headers.get("content-type");
	const isJson = contentType?.includes("application/json");

	let body: unknown;
	try {
		body = isJson && text ? JSON.parse(text) : text;
	} catch (_e) {
		throw new Error(
			`Failed to parse response from ${path} (${response.status}): ${text.slice(0, 50)}...`,
		);
	}

	if (!response.ok) {
		const errorMessage =
			typeof body === "string"
				? body || response.statusText
				: (body as { error?: string })?.error || response.statusText;
		throw new Error(errorMessage);
	}

	return body as T;
}

export async function listBrowserDialogs(): Promise<{
	success: boolean;
	data?: { dialogs: import("./types").BrowserDialogInfo[] };
	error?: string;
}> {
	return apiFetch("/api/browser/dialog", {
		method: "POST",
		body: JSON.stringify({ action: "list" }),
	});
}

export async function respondToBrowserDialog(
	dialogId: string,
	response: "accept" | "dismiss",
	text?: string,
): Promise<{
	success: boolean;
	data?: { handled: boolean; dialog: import("./types").BrowserDialogInfo };
	error?: string;
}> {
	return apiFetch("/api/browser/dialog", {
		method: "POST",
		body: JSON.stringify({
			action: "respond",
			dialog_id: dialogId,
			response,
			text,
		}),
	});
}

export async function openBrowserUrl(url: string): Promise<unknown> {
	return apiFetch("/api/browser/open", {
		method: "POST",
		body: JSON.stringify({ url }),
	});
}

export async function takeBrowserScreenshot(): Promise<unknown> {
	return apiFetch("/api/browser/screenshot", {
		method: "POST",
		body: JSON.stringify({}),
	});
}

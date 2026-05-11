function getToken() {
	return sessionStorage.getItem("bc-token") || "";
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
	const response = await fetch(path, {
		...options,
		headers: {
			"content-type": "application/json",
			authorization: `Bearer ${getToken()}`,
			...(options.headers || {}),
		},
	});

	const text = await response.text();
	const body = text ? JSON.parse(text) : {};

	if (!response.ok) {
		throw new Error(body.error || response.statusText);
	}

	return body as T;
}

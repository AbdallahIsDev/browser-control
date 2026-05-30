import { useCallback, useEffect, useState } from "react";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { ErrorState } from "@/components/common/ErrorState";
import { PageShell } from "@/components/layout/PageShell";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { apiFetch } from "../api";
import { isProductionFeatureEnabled } from "../featureFlags";

interface Settings {
	theme?: string;
	dataHome?: string;
	policyProfile?: string;
	provider?: string;
	browserProvider?: string;
}

interface ProviderConfig {
	name: string;
	type: "local" | "custom" | "browserless" | "browserbase";
	endpoint?: string;
}

interface ProviderListResult {
	providers: ProviderConfig[];
	activeProvider: string;
	builtIn: string[];
}

interface ProviderHealthReport {
	name: string;
	type: ProviderConfig["type"];
	ok: boolean;
	state: "healthy" | "degraded" | "unhealthy";
	score: number;
	checkedAt: string;
	latencyMs: number;
	authValid: boolean | null;
	endpointReachable: boolean | null;
	launchSupported: boolean;
	attachSupported: boolean;
	recentFailures: number;
	summary: string;
	endpoint?: string;
}

interface ProviderCatalogEntry {
	name: ProviderConfig["type"];
	label: string;
	description: string;
	remote: boolean;
	risk: "low" | "moderate" | "high";
	requiresEndpoint: boolean;
	requiresAuth: boolean;
	launchSupported: boolean;
	attachSupported: boolean;
	defaultConfigured: boolean;
	setupHint: string;
}

interface ActionResult<T> {
	success: boolean;
	data?: T;
	error?: string;
}

interface VaultSummary {
	count: number;
	scopes: string[];
	withValues: number;
	missingValues: number;
}

interface SecretGrantSummary {
	count: number;
	activeCount: number;
	revokedCount: number;
}

interface NetworkRule {
	id: string;
	pattern: string;
	ruleType: string;
	resourceTypes?: string[];
	enabled: boolean;
	source: string;
}

export function SettingsView() {
	const [settings, setSettings] = useState<Settings>({});
	const [error, setError] = useState("");
	const [providerName, setProviderName] = useState("local");
	const [cleanupConfirm, setCleanupConfirm] = useState("");
	const [message, setMessage] = useState("");
	const [modelProvider, setModelProvider] = useState("openrouter");
	const [modelEndpoint, setModelEndpoint] = useState("");
	const [modelKey, setModelKey] = useState("");
	const [modelName, setModelName] = useState("");
	const [vaultSummary, setVaultSummary] = useState<VaultSummary>({
		count: 0,
		scopes: [],
		withValues: 0,
		missingValues: 0,
	});
	const [secretGrantSummary, setSecretGrantSummary] =
		useState<SecretGrantSummary>({
			count: 0,
			activeCount: 0,
			revokedCount: 0,
		});
	const [networkRules, setNetworkRules] = useState<NetworkRule[]>([]);
	const [secretScope, setSecretScope] = useState("site");
	const [secretScopeName, setSecretScopeName] = useState("");
	const [secretName, setSecretName] = useState("");
	const [secretValue, setSecretValue] = useState("");
	const [networkPattern, setNetworkPattern] = useState("");
	const [networkRuleType, setNetworkRuleType] = useState("denylist");
	const [confirmCleanup, setConfirmCleanup] = useState(false);
	const [pendingNetworkRuleRemoval, setPendingNetworkRuleRemoval] =
		useState<NetworkRule | null>(null);
	const [providerList, setProviderList] = useState<ProviderListResult>({
		providers: [],
		activeProvider: "local",
		builtIn: [],
	});
	const [providerHealth, setProviderHealth] = useState<ProviderHealthReport[]>(
		[],
	);
	const [providerCatalog, setProviderCatalog] = useState<
		ProviderCatalogEntry[]
	>([]);
	const [providerLoading, setProviderLoading] = useState(false);

	const loadSecurity = useCallback(async () => {
		const [vault, grants, rules] = await Promise.all([
			apiFetch<VaultSummary>("/api/vault").catch(() => ({
				count: 0,
				scopes: [],
				withValues: 0,
				missingValues: 0,
			})),
			apiFetch<SecretGrantSummary>("/api/vault/grants").catch(() => ({
				count: 0,
				activeCount: 0,
				revokedCount: 0,
			})),
			apiFetch<NetworkRule[]>("/api/network/rules").catch(() => []),
		]);
		setVaultSummary(vault);
		setSecretGrantSummary(grants);
		setNetworkRules(Array.isArray(rules) ? rules : []);
	}, []);

	const loadProviders = useCallback(async () => {
		setProviderLoading(true);
		try {
			const [list, catalogResult, healthResult] = await Promise.all([
				apiFetch<ProviderListResult>("/api/browser/providers"),
				apiFetch<ActionResult<ProviderCatalogEntry[]>>(
					"/api/browser/providers/catalog",
				),
				apiFetch<ActionResult<ProviderHealthReport[]>>(
					"/api/browser/providers/health",
				),
			]);
			setProviderList({
				providers: list.providers || [],
				activeProvider: list.activeProvider || "local",
				builtIn: list.builtIn || [],
			});
			setProviderName(list.activeProvider || "local");
			setProviderCatalog(catalogResult.data || []);
			setProviderHealth(healthResult.data || []);
		} finally {
			setProviderLoading(false);
		}
	}, []);

	useEffect(() => {
		apiFetch<Settings>("/api/settings")
			.catch((): Settings => ({}))
			.then((next) => {
				setSettings(next);
				setProviderName(next.browserProvider || next.provider || "local");
			})
			.catch((err: unknown) =>
				setError(err instanceof Error ? err.message : String(err)),
			);
		loadSecurity().catch((err: unknown) =>
			setMessage(
				`Security settings unavailable: ${err instanceof Error ? err.message : String(err)}`,
			),
		);
		loadProviders().catch((err: unknown) =>
			setMessage(
				`Provider diagnostics unavailable: ${err instanceof Error ? err.message : String(err)}`,
			),
		);
	}, [loadSecurity, loadProviders]);

	const saveProvider = async () => {
		setMessage("Saving provider...");
		try {
			await apiFetch("/api/browser/providers/use", {
				method: "POST",
				body: JSON.stringify({ name: providerName }),
			});
			setMessage(`Provider saved: ${providerName}`);
			await loadProviders();
		} catch (err: unknown) {
			setMessage(
				`Provider save failed: ${err instanceof Error ? err.message : String(err)}`,
			);
		}
	};

	const runProviderHealth = async () => {
		setMessage("Refreshing provider diagnostics...");
		try {
			await loadProviders();
			setMessage("Provider diagnostics refreshed");
		} catch (err: unknown) {
			setMessage(
				`Provider diagnostics failed: ${err instanceof Error ? err.message : String(err)}`,
			);
		}
	};

	const providerRows = [
		...(providerList.builtIn || []).map((name) => {
			const health = providerHealth.find((entry) => entry.name === name);
			return {
				name,
				type: health?.type || (name as ProviderConfig["type"]),
				endpoint: health?.endpoint || "Built-in",
				configured: false,
				health,
			};
		}),
		...(providerList.providers || []).map((provider) => ({
			...provider,
			endpoint: provider.endpoint || "Configured",
			configured: true,
			health: providerHealth.find((entry) => entry.name === provider.name),
		})),
	];

	const runCleanup = async (dryRun: boolean, confirm?: string) => {
		setMessage(dryRun ? "Running cleanup preview..." : "Running cleanup...");
		try {
			const result = await apiFetch<{
				deleted?: string[];
				wouldDelete?: string[];
				freedBytes?: number;
				error?: string;
			}>("/api/data/cleanup", {
				method: "POST",
				body: JSON.stringify({ dryRun, confirm }),
			});
			const count = (result.deleted || result.wouldDelete || []).length;
			setMessage(
				`${dryRun ? "Cleanup preview" : "Cleanup"} complete: ${count} runtime paths, ${result.freedBytes || 0} bytes.`,
			);
		} catch (err: unknown) {
			setMessage(
				`Cleanup blocked: ${err instanceof Error ? err.message : String(err)}`,
			);
		}
	};

	const storeSecret = async () => {
		setMessage("Storing secret reference...");
		try {
			await apiFetch("/api/vault", {
				method: "POST",
				body: JSON.stringify({
					scope: secretScope,
					scopeName: secretScopeName,
					secretName,
					value: secretValue,
					confirm: "STORE_SECRET",
				}),
			});
			setSecretValue("");
			setMessage(
				`Secret stored: secret://${secretScope}/${secretScopeName}/${secretName}`,
			);
			await loadSecurity();
		} catch (err: unknown) {
			setMessage(
				`Secret store failed: ${err instanceof Error ? err.message : String(err)}`,
			);
		}
	};

	const addNetworkRule = async () => {
		setMessage("Adding network rule...");
		try {
			await apiFetch("/api/network/rules", {
				method: "POST",
				body: JSON.stringify({
					pattern: networkPattern,
					ruleType: networkRuleType,
				}),
			});
			setNetworkPattern("");
			setMessage(`Network rule added: ${networkPattern}`);
			await loadSecurity();
		} catch (err: unknown) {
			setMessage(
				`Network rule failed: ${err instanceof Error ? err.message : String(err)}`,
			);
		}
	};

	const removeNetworkRule = async (rule: NetworkRule) => {
		setMessage("Removing network rule...");
		try {
			await apiFetch(`/api/network/rules/${encodeURIComponent(rule.id)}`, {
				method: "DELETE",
			});
			setMessage(
				`${rule.source === "built-in" ? "Network rule disabled" : "Network rule removed"}: ${rule.id}`,
			);
			await loadSecurity();
		} catch (err: unknown) {
			setMessage(
				`Network rule removal failed: ${err instanceof Error ? err.message : String(err)}`,
			);
		}
	};

	if (error) {
		return (
			<PageShell>
				<ErrorState message={error} />
			</PageShell>
		);
	}

	return (
		<PageShell>
			<div className="space-y-5 md:space-y-6">
				<div className="mb-2">
					<h2 className="text-lg font-semibold tracking-tight">Settings</h2>
					<p className="text-sm text-muted-foreground mt-1">
						Configure system, model providers, credentials, and privacy rules.
					</p>
				</div>
				{message && (
					<Alert>
						<AlertDescription>{message}</AlertDescription>
					</Alert>
				)}

				<Card>
					<CardHeader>
						<CardTitle>System</CardTitle>
					</CardHeader>
					<CardContent className="space-y-4">
						<div>
							<Label className="text-xs text-muted-foreground">
								Data Home Directory
							</Label>
							<p className="mt-1 rounded-md border border-input px-3 py-2 text-sm font-mono break-all">
								{settings.dataHome || "Not configured"}
							</p>
						</div>
						{isProductionFeatureEnabled("advancedProviders") && (
							<div>
								<Label className="text-xs text-muted-foreground">
									Browser Provider
								</Label>
								<div className="mt-1 flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
									<Input
										className="h-9 sm:max-w-xs"
										value={providerName}
										onChange={(event) => setProviderName(event.target.value)}
										placeholder="local"
									/>
									<Button
										type="button"
										size="sm"
										onClick={saveProvider}
										className="sm:w-auto w-full"
									>
										Save
									</Button>
								</div>
							</div>
						)}
						{isProductionFeatureEnabled("advancedProviders") && (
							<div className="space-y-3">
								<div>
									<Label className="text-xs text-muted-foreground">
										Provider Catalog
									</Label>
									<p className="text-xs text-muted-foreground mt-1">
										Read-only setup guide; selecting remote providers still
										requires explicit configuration and policy approval.
									</p>
								</div>
								<div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
									{providerCatalog.map((entry) => (
										<div
											key={entry.name}
											className="rounded-md border border-border p-3"
										>
											<div className="flex flex-wrap items-center gap-2">
												<p className="font-medium">{entry.label}</p>
												<Badge
													variant={entry.remote ? "destructive" : "secondary"}
												>
													{entry.remote ? "Remote" : "Local"}
												</Badge>
											</div>
											<p className="mt-2 text-xs text-muted-foreground">
												{entry.description}
											</p>
											<div className="mt-3 flex flex-wrap gap-2">
												<Badge variant="outline">risk {entry.risk}</Badge>
												<Badge variant="outline">
													{entry.requiresEndpoint ? "Endpoint" : "No endpoint"}
												</Badge>
												<Badge variant="outline">
													{entry.requiresAuth ? "Credential" : "No credential"}
												</Badge>
											</div>
											<p className="mt-3 text-xs text-muted-foreground">
												{entry.setupHint}
											</p>
										</div>
									))}
								</div>
							</div>
						)}
						{isProductionFeatureEnabled("advancedProviders") && (
							<div className="space-y-3">
								<div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
									<div>
										<Label className="text-xs text-muted-foreground">
											Provider Health
										</Label>
										<p className="text-xs text-muted-foreground mt-1">
											Remote providers are opt-in; diagnostics do not switch the
											active provider.
										</p>
									</div>
									<Button
										type="button"
										size="sm"
										variant="outline"
										onClick={runProviderHealth}
										disabled={providerLoading}
										className="sm:w-auto w-full"
									>
										Refresh Health
									</Button>
								</div>
								<div className="space-y-3 md:hidden">
									{providerRows.map((provider) => (
										<div
											key={`mobile-${provider.name}-${provider.configured}`}
											className="rounded-md border border-border p-3"
										>
											<div className="flex flex-wrap items-center justify-between gap-2">
												<div>
													<p className="font-medium">{provider.name}</p>
													<p className="text-xs text-muted-foreground">
														{provider.type}
													</p>
												</div>
												<div className="flex flex-wrap gap-2">
													{provider.name === providerList.activeProvider && (
														<Badge variant="secondary">Active</Badge>
													)}
													<Badge
														variant={
															provider.health?.state === "healthy"
																? "default"
																: provider.health?.state === "degraded"
																	? "secondary"
																	: "destructive"
														}
													>
														{provider.health?.state || "Unknown"}
													</Badge>
												</div>
											</div>
											<p className="mt-2 text-xs text-muted-foreground">
												{provider.health?.summary || "Health not checked."}
											</p>
											<dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
												<div>
													<dt className="text-muted-foreground">Score</dt>
													<dd>{provider.health?.score ?? "-"}</dd>
												</div>
												<div>
													<dt className="text-muted-foreground">
														Capabilities
													</dt>
													<dd>
														{provider.health
															? `${provider.health.launchSupported ? "launch" : "no launch"} / ${
																	provider.health.attachSupported
																		? "attach"
																		: "no attach"
																}`
															: "-"}
													</dd>
												</div>
												<div className="col-span-2 min-w-0">
													<dt className="text-muted-foreground">Endpoint</dt>
													<dd className="break-all font-mono">
														{provider.endpoint}
													</dd>
												</div>
											</dl>
											<Button
												type="button"
												size="sm"
												variant="outline"
												onClick={async () => {
													setProviderName(provider.name);
													setMessage(`Saving provider: ${provider.name}`);
													try {
														await apiFetch("/api/browser/providers/use", {
															method: "POST",
															body: JSON.stringify({ name: provider.name }),
														});
														await loadProviders();
														setMessage(`Provider saved: ${provider.name}`);
													} catch (err: unknown) {
														setMessage(
															`Provider save failed: ${
																err instanceof Error ? err.message : String(err)
															}`,
														);
													}
												}}
												disabled={provider.name === providerList.activeProvider}
												className="mt-3 w-full"
											>
												Use Provider
											</Button>
										</div>
									))}
								</div>
								<div className="hidden overflow-x-auto md:block">
									<Table>
										<TableHeader>
											<TableRow>
												<TableHead>Name</TableHead>
												<TableHead>Type</TableHead>
												<TableHead>State</TableHead>
												<TableHead>Score</TableHead>
												<TableHead>Capabilities</TableHead>
												<TableHead>Endpoint</TableHead>
												<TableHead>Action</TableHead>
											</TableRow>
										</TableHeader>
										<TableBody>
											{providerRows.map((provider) => (
												<TableRow
													key={`${provider.name}-${provider.configured}`}
												>
													<TableCell className="font-medium">
														<div className="flex flex-wrap items-center gap-2">
															<span>{provider.name}</span>
															{provider.name ===
																providerList.activeProvider && (
																<Badge variant="secondary">Active</Badge>
															)}
															{provider.configured && (
																<Badge variant="outline">Configured</Badge>
															)}
														</div>
													</TableCell>
													<TableCell className="text-sm">
														{provider.type}
													</TableCell>
													<TableCell>
														<Badge
															variant={
																provider.health?.state === "healthy"
																	? "default"
																	: provider.health?.state === "degraded"
																		? "secondary"
																		: "destructive"
															}
														>
															{provider.health?.state || "Unknown"}
														</Badge>
														<p className="mt-1 max-w-72 text-xs text-muted-foreground">
															{provider.health?.summary ||
																"Health not checked."}
														</p>
													</TableCell>
													<TableCell className="text-sm">
														{provider.health?.score ?? "-"}
													</TableCell>
													<TableCell className="text-xs">
														{provider.health
															? `${provider.health.launchSupported ? "launch" : "no launch"} / ${
																	provider.health.attachSupported
																		? "attach"
																		: "no attach"
																}`
															: "-"}
													</TableCell>
													<TableCell className="max-w-72 break-all font-mono text-xs">
														{provider.endpoint}
													</TableCell>
													<TableCell>
														<Button
															type="button"
															size="sm"
															variant="outline"
															onClick={async () => {
																setProviderName(provider.name);
																setMessage(`Saving provider: ${provider.name}`);
																try {
																	await apiFetch("/api/browser/providers/use", {
																		method: "POST",
																		body: JSON.stringify({
																			name: provider.name,
																		}),
																	});
																	await loadProviders();
																	setMessage(
																		`Provider saved: ${provider.name}`,
																	);
																} catch (err: unknown) {
																	setMessage(
																		`Provider save failed: ${
																			err instanceof Error
																				? err.message
																				: String(err)
																		}`,
																	);
																}
															}}
															disabled={
																provider.name === providerList.activeProvider
															}
															className="sm:w-auto w-full"
														>
															Use
														</Button>
													</TableCell>
												</TableRow>
											))}
											{providerRows.length === 0 && (
												<TableRow>
													<TableCell
														colSpan={7}
														className="text-center text-muted-foreground"
													>
														No providers available.
													</TableCell>
												</TableRow>
											)}
										</TableBody>
									</Table>
								</div>
							</div>
						)}
					</CardContent>
				</Card>

				{isProductionFeatureEnabled("generalAgentUi") && (
					<Card>
						<CardHeader>
							<CardTitle>Model Provider</CardTitle>
						</CardHeader>
						<CardContent className="space-y-4">
							<div className="flex flex-col sm:flex-row sm:items-center gap-3">
								<Label
									htmlFor="model-provider"
									className="text-xs text-muted-foreground shrink-0"
								>
									Provider:
								</Label>
								<Select
									value={modelProvider}
									onValueChange={(value) =>
										setModelProvider(value ?? "openrouter")
									}
								>
									<SelectTrigger
										id="model-provider"
										className="h-9 w-full sm:w-56"
									>
										<SelectValue placeholder="Provider" />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="openrouter">OpenRouter</SelectItem>
										<SelectItem value="ollama">Ollama</SelectItem>
										<SelectItem value="openai-compatible">
											Custom (OpenAI Compatible)
										</SelectItem>
									</SelectContent>
								</Select>
							</div>
							{modelProvider === "openai-compatible" && (
								<div>
									<Label
										htmlFor="model-endpoint"
										className="text-xs text-muted-foreground"
									>
										Endpoint:
									</Label>
									<Input
										id="model-endpoint"
										className="mt-1 h-9"
										value={modelEndpoint}
										onChange={(e) => setModelEndpoint(e.target.value)}
										placeholder="http://localhost:8080/v1"
									/>
								</div>
							)}
							<div>
								<Label
									htmlFor="model-key"
									className="text-xs text-muted-foreground"
								>
									API Key:
								</Label>
								<Input
									id="model-key"
									type="password"
									className="mt-1 h-9"
									value={modelKey}
									onChange={(e) => setModelKey(e.target.value)}
									placeholder="API Key"
								/>
							</div>
							<div>
								<Label
									htmlFor="model-name"
									className="text-xs text-muted-foreground"
								>
									Model Name:
								</Label>
								<Input
									id="model-name"
									className="mt-1 h-9"
									value={modelName}
									onChange={(e) => setModelName(e.target.value)}
									placeholder="gpt-4o"
								/>
							</div>
							<Button
								type="button"
								size="sm"
								onClick={async () => {
									setMessage("Saving model config...");
									try {
										await apiFetch("/api/config/modelProvider", {
											method: "POST",
											body: JSON.stringify({
												modelProvider,
												modelEndpoint,
												modelKey,
												modelName,
											}),
										});
										setMessage("Model config saved");
									} catch (e: unknown) {
										setMessage(`Failed: ${String(e)}`);
									}
								}}
								className="sm:w-auto w-full"
							>
								Save Model Config
							</Button>
						</CardContent>
					</Card>
				)}

				<Card>
					<CardHeader>
						<CardTitle>Credential Vault</CardTitle>
					</CardHeader>
					<CardContent className="space-y-4">
						<div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-end gap-3">
							<div className="sm:flex-1 min-w-0">
								<Label
									htmlFor="secret-scope"
									className="text-xs text-muted-foreground"
								>
									Scope
								</Label>
								<Select
									value={secretScope}
									onValueChange={(value) => setSecretScope(value ?? "site")}
								>
									<SelectTrigger id="secret-scope" className="mt-1 h-9 w-full">
										<SelectValue placeholder="Scope" />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="site">Site</SelectItem>
										<SelectItem value="package">Package</SelectItem>
										<SelectItem value="workflow">Workflow</SelectItem>
									</SelectContent>
								</Select>
							</div>
							<div className="sm:flex-1 min-w-0">
								<Label
									htmlFor="secret-scope-name"
									className="text-xs text-muted-foreground"
								>
									Scope Name
								</Label>
								<Input
									id="secret-scope-name"
									className="mt-1 h-9 w-full"
									value={secretScopeName}
									onChange={(event) => setSecretScopeName(event.target.value)}
									placeholder="example.com"
								/>
							</div>
							<div className="sm:flex-1 min-w-0">
								<Label
									htmlFor="secret-name"
									className="text-xs text-muted-foreground"
								>
									Secret Name
								</Label>
								<Input
									id="secret-name"
									className="mt-1 h-9 w-full"
									value={secretName}
									onChange={(event) => setSecretName(event.target.value)}
									placeholder="login"
								/>
							</div>
							<div className="sm:flex-1 min-w-0">
								<Label
									htmlFor="secret-value"
									className="text-xs text-muted-foreground"
								>
									Value
								</Label>
								<Input
									id="secret-value"
									type="password"
									className="mt-1 h-9 w-full"
									value={secretValue}
									onChange={(event) => setSecretValue(event.target.value)}
									placeholder="Secret value"
								/>
							</div>
							<Button
								type="button"
								size="sm"
								onClick={storeSecret}
								disabled={!secretScopeName || !secretName || !secretValue}
								className="sm:w-auto w-full"
							>
								Store Secret
							</Button>
						</div>

						<div className="overflow-x-auto">
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead>Metric</TableHead>
										<TableHead>Value</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									<TableRow>
										<TableCell>Stored secrets</TableCell>
										<TableCell>{vaultSummary.count}</TableCell>
									</TableRow>
									<TableRow>
										<TableCell>Scope types</TableCell>
										<TableCell>
											{vaultSummary.scopes.length > 0
												? vaultSummary.scopes.join(", ")
												: "None"}
										</TableCell>
									</TableRow>
									<TableRow>
										<TableCell>Values stored</TableCell>
										<TableCell>{vaultSummary.withValues}</TableCell>
									</TableRow>
									<TableRow>
										<TableCell>Missing values</TableCell>
										<TableCell>{vaultSummary.missingValues}</TableCell>
									</TableRow>
								</TableBody>
							</Table>
						</div>
						<p className="text-xs text-muted-foreground">
							{secretGrantSummary.activeCount} active grant(s),{" "}
							{secretGrantSummary.revokedCount} revoked;{" "}
							{"raw values are never displayed"}, and credential identifiers are
							summarized.
						</p>
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<CardTitle>Privacy Network Rules</CardTitle>
					</CardHeader>
					<CardContent className="space-y-4">
						<div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-end gap-3">
							<div className="sm:flex-1 min-w-0">
								<Label
									htmlFor="network-pattern"
									className="text-xs text-muted-foreground"
								>
									Domain Pattern
								</Label>
								<Input
									id="network-pattern"
									className="mt-1 h-9 w-full"
									value={networkPattern}
									onChange={(event) => setNetworkPattern(event.target.value)}
									placeholder="*.analytics.example"
								/>
							</div>
							<div className="sm:flex-1 min-w-0">
								<Label
									htmlFor="network-rule-type"
									className="text-xs text-muted-foreground"
								>
									Type
								</Label>
								<Select
									value={networkRuleType}
									onValueChange={(value) =>
										setNetworkRuleType(value ?? "denylist")
									}
								>
									<SelectTrigger
										id="network-rule-type"
										className="mt-1 h-9 w-full"
									>
										<SelectValue placeholder="Type" />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="denylist">Denylist</SelectItem>
										<SelectItem value="allowlist">Allowlist</SelectItem>
										<SelectItem value="tracker">Tracker</SelectItem>
									</SelectContent>
								</Select>
							</div>
							<Button
								type="button"
								size="sm"
								onClick={addNetworkRule}
								disabled={!networkPattern}
								className="sm:w-auto w-full"
							>
								Add Rule
							</Button>
						</div>

						<div className="overflow-x-auto">
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead>Pattern</TableHead>
										<TableHead>Type</TableHead>
										<TableHead>Source</TableHead>
										<TableHead>Status</TableHead>
										<TableHead>Action</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{networkRules.slice(0, 20).map((rule) => (
										<TableRow key={rule.id}>
											<TableCell className="text-sm">{rule.pattern}</TableCell>
											<TableCell className="text-sm">{rule.ruleType}</TableCell>
											<TableCell className="text-sm">{rule.source}</TableCell>
											<TableCell className="text-sm">
												{rule.enabled ? "Enabled" : "Disabled"}
											</TableCell>
											<TableCell>
												<Button
													type="button"
													size="sm"
													variant="outline"
													onClick={() => setPendingNetworkRuleRemoval(rule)}
													className="sm:w-auto w-full"
												>
													{rule.source === "built-in" ? "Disable" : "Remove"}
												</Button>
											</TableCell>
										</TableRow>
									))}
									{networkRules.length === 0 && (
										<TableRow>
											<TableCell
												colSpan={5}
												className="text-center text-muted-foreground"
											>
												No network rules configured.
											</TableCell>
										</TableRow>
									)}
								</TableBody>
							</Table>
						</div>
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<CardTitle>Runtime Cleanup</CardTitle>
					</CardHeader>
					<CardContent className="space-y-4">
						<Button
							type="button"
							variant="outline"
							size="sm"
							onClick={() => runCleanup(true)}
							className="sm:w-auto w-full"
						>
							Preview Cleanup
						</Button>

						<Alert variant="destructive" className="space-y-3">
							<AlertTitle>Destructive Action</AlertTitle>
							<AlertDescription>
								This will delete all temporary runtime data, including session
								logs and transient browser profiles. Type{" "}
								<strong>DELETE_RUNTIME_TEMP</strong> to confirm.
							</AlertDescription>
							<div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
								<Input
									className="h-9 flex-1"
									value={cleanupConfirm}
									onChange={(event) => setCleanupConfirm(event.target.value)}
									placeholder="DELETE_RUNTIME_TEMP"
								/>
								<Button
									type="button"
									size="sm"
									variant="destructive"
									disabled={cleanupConfirm !== "DELETE_RUNTIME_TEMP"}
									onClick={() => setConfirmCleanup(true)}
									className="sm:w-auto w-full"
								>
									Delete Permanently
								</Button>
							</div>
						</Alert>
					</CardContent>
				</Card>

				<ConfirmDialog
					open={confirmCleanup}
					onOpenChange={setConfirmCleanup}
					title="Delete Runtime Data"
					description="This will permanently delete all temporary runtime data. This action cannot be undone."
					confirmLabel="Delete Permanently"
					variant="destructive"
					onConfirm={() => {
						runCleanup(false, cleanupConfirm);
						setCleanupConfirm("");
						setConfirmCleanup(false);
					}}
				/>
				<ConfirmDialog
					open={pendingNetworkRuleRemoval !== null}
					onOpenChange={(open) => {
						if (!open) setPendingNetworkRuleRemoval(null);
					}}
					title={
						pendingNetworkRuleRemoval?.source === "built-in"
							? "Disable Network Rule"
							: "Remove Network Rule"
					}
					description={
						pendingNetworkRuleRemoval
							? `${pendingNetworkRuleRemoval.source === "built-in" ? "Disable" : "Remove"} privacy rule "${pendingNetworkRuleRemoval.pattern}"? This changes real browser traffic filtering.`
							: ""
					}
					confirmLabel={
						pendingNetworkRuleRemoval?.source === "built-in"
							? "Disable"
							: "Remove"
					}
					variant="destructive"
					onConfirm={() => {
						if (pendingNetworkRuleRemoval) {
							void removeNetworkRule(pendingNetworkRuleRemoval);
							setPendingNetworkRuleRemoval(null);
						}
					}}
				/>
			</div>
		</PageShell>
	);
}

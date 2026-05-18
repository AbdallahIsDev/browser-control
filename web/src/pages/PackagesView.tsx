import { useCallback, useEffect, useState } from "react";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { EmptyState } from "@/components/common/EmptyState";
import { ErrorState } from "@/components/common/ErrorState";
import { LoadingState } from "@/components/common/LoadingState";
import { StatusBadge } from "@/components/common/StatusBadge";
import { PageShell } from "@/components/layout/PageShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { apiFetch } from "../api";

interface PackageInfo {
	name: string;
	version: string;
	source: string;
	installedAt: string;
	enabled: boolean;
	permissions: Array<{ kind: string; granted: boolean }>;
	validationStatus: string;
	workflows: string[];
	trustStatus?: string;
	signer?: string;
	digest?: string;
	lastEvalResult?: {
		total: number;
		passed: number;
		failed: number;
		runAt: string;
	};
}

interface EvalRecord {
	id: string;
	packageName: string;
	status: string;
	durationMs: number;
	totalEvals: number;
	passedEvals: number;
	failedEvals: number;
	failedStep?: string;
	runAt: string;
}

interface ReviewRecord {
	id: string;
	packageName: string;
	version: string;
	status: string;
	reviewedAt: string;
	reviewedBy: string;
	riskSummary?: {
		riskLevel: string;
		warnings: string[];
		details: string;
	};
	digest?: string;
}

interface PackagesViewProps {
	onOpenTrading?: () => void;
}

export function PackagesView({ onOpenTrading }: PackagesViewProps) {
	const [packages, setPackages] = useState<PackageInfo[]>([]);
	const [evalHistory, setEvalHistory] = useState<EvalRecord[]>([]);
	const [reviewHistory, setReviewHistory] = useState<ReviewRecord[]>([]);
	const [selectedPkg, setSelectedPkg] = useState<PackageInfo | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState("");
	const [notice, setNotice] = useState("");
	const [installOpen, setInstallOpen] = useState(false);
	const [installSource, setInstallSource] = useState("");
	const [confirmAction, setConfirmAction] = useState<{
		type: "review";
		name: string;
		status: string;
	} | null>(null);

	const loadAll = useCallback(async () => {
		setLoading(true);
		try {
			const [pkgs, evals] = await Promise.all([
				apiFetch<PackageInfo[]>("/api/packages"),
				apiFetch<{ data?: EvalRecord[] }>("/api/packages/eval-history").catch(
					() => ({ data: [] }),
				),
			]);
			setPackages(pkgs ?? []);
			setEvalHistory(evals.data ?? []);
		} catch (err: unknown) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setLoading(false);
		}
	}, []);

	const loadReviewHistory = async (name: string) => {
		try {
			const result = await apiFetch<{ data?: ReviewRecord[] }>(
				`/api/packages/${encodeURIComponent(name)}/review-history`,
			);
			setReviewHistory(result.data ?? []);
		} catch {
			setReviewHistory([]);
		}
	};

	useEffect(() => {
		loadAll();
	}, [loadAll]);

	const handleInstall = async () => {
		const source = installSource.trim();
		if (!source) return;
		setNotice(`Installing ${source}...`);
		setInstallOpen(false);
		setInstallSource("");
		try {
			await apiFetch("/api/packages", {
				method: "POST",
				body: JSON.stringify({ source }),
			});
			setNotice(`Package installed: ${source}`);
			await loadAll();
		} catch (err: unknown) {
			setError(`Install failed: ${String(err)}`);
		}
	};

	const handleReview = async (name: string, status: string) => {
		try {
			await apiFetch(`/api/packages/${encodeURIComponent(name)}/review`, {
				method: "POST",
				body: JSON.stringify({ status, reviewedBy: "web-user" }),
			});
			setNotice(`Review ${status} for ${name}`);
			await loadAll();
			if (selectedPkg?.name === name) {
				await loadReviewHistory(name);
			}
		} catch (err: unknown) {
			setError(`Review failed: ${String(err)}`);
		}
	};

	const handleEval = async (name: string) => {
		setNotice(`Running eval for ${name}...`);
		try {
			await apiFetch(`/api/packages/${encodeURIComponent(name)}/eval`, {
				method: "POST",
			});
			setNotice(`Eval completed for ${name}`);
			await loadAll();
		} catch (err: unknown) {
			setError(`Eval failed: ${String(err)}`);
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
			<div className="space-y-4 md:space-y-6">
				<Card>
					<CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
						<div className="space-y-1">
							<CardTitle>Optional automation skills</CardTitle>
							<p className="text-sm text-muted-foreground">
								Specialized use cases live here so Browser Control stays a
								general automation product.
							</p>
						</div>
					</CardHeader>
					<CardContent>
						<div className="rounded border border-border bg-card p-4">
							<div className="flex flex-wrap items-start justify-between gap-4">
								<div className="min-w-0 space-y-2">
									<div className="flex flex-wrap items-center gap-2">
										<h3 className="text-sm font-semibold">
											TradingView ICT Analysis
										</h3>
										<Badge variant="secondary" className="rounded">
											Optional skill
										</Badge>
										<Badge variant="secondary" className="rounded">
											Analysis only
										</Badge>
									</div>
									<p className="max-w-3xl text-sm text-muted-foreground">
										Analyze a TradingView chart and prepare a reviewable trade
										plan. Live orders still require exact explicit approval.
									</p>
								</div>
								<Button
									type="button"
									size="sm"
									variant="outline"
									onClick={onOpenTrading}
									className="rounded"
									disabled={!onOpenTrading}
								>
									Open tools
								</Button>
							</div>
						</div>
					</CardContent>
				</Card>
				<Card>
					<CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
						<div>
							<CardTitle className="flex items-center gap-2">
								Installed Packages
								<Badge variant="secondary">{packages.length}</Badge>
							</CardTitle>
						</div>
						<Button
							type="button"
							size="sm"
							onClick={() => setInstallOpen(true)}
						>
							Install Package
						</Button>
					</CardHeader>
					<CardContent>
						{loading ? (
							<LoadingState message="Loading packages..." />
						) : packages.length === 0 ? (
							<EmptyState
								title="No packages installed"
								description="Install from a local directory or remote source."
								action={
									<Button
										type="button"
										size="sm"
										onClick={() => setInstallOpen(true)}
									>
										Install Package
									</Button>
								}
							/>
						) : (
							<div className="space-y-3">
								{(Array.isArray(packages) ? packages : []).map((pkg) => (
									<div
										key={pkg.name}
										className="rounded-md border border-[--border-subtle] bg-[--bg-card] p-4 space-y-3"
									>
										<div className="flex flex-wrap items-start justify-between gap-3">
											<div className="min-w-0">
												<div className="flex items-center gap-2 flex-wrap">
													<span className="font-semibold text-sm">
														{pkg.name}
													</span>
													<span className="text-xs text-[--text-tertiary]">
														v{pkg.version}
													</span>
													{pkg.signer && (
														<span className="text-xs text-[--text-tertiary]">
															signed: {pkg.signer}
														</span>
													)}
													{pkg.digest && (
														<span
															className="font-mono text-xs text-[--text-tertiary]"
															title={pkg.digest}
														>
															{pkg.digest.slice(0, 12)}...
														</span>
													)}
												</div>
												<div className="mt-2 flex flex-wrap gap-1.5">
													{pkg.permissions.map((p) => (
														<Badge
															key={`${pkg.name}-${p.kind}`}
															variant={p.granted ? "default" : "secondary"}
															className="text-xs"
														>
															{p.granted ? "✓" : "✗"} {p.kind}
														</Badge>
													))}
												</div>
												{pkg.lastEvalResult && (
													<p className="mt-2 text-xs text-[--text-tertiary]">
														Eval: {pkg.lastEvalResult.passed}/
														{pkg.lastEvalResult.total} passed at{" "}
														{pkg.lastEvalResult.runAt?.slice(0, 19)}
													</p>
												)}
											</div>
											<div className="flex items-center gap-2 flex-wrap">
												<StatusBadge
													label={pkg.validationStatus}
													variant={
														pkg.validationStatus === "valid" ? "ok" : "warn"
													}
												/>
												{pkg.trustStatus && (
													<Badge
														variant={
															pkg.trustStatus === "approved"
																? "default"
																: pkg.trustStatus === "rejected"
																	? "destructive"
																	: "secondary"
														}
														className="text-xs"
													>
														{pkg.trustStatus}
													</Badge>
												)}
											</div>
										</div>
										<div className="flex flex-wrap gap-2">
											<Button
												type="button"
												size="sm"
												variant="outline"
												onClick={() => {
													setSelectedPkg(pkg);
													loadReviewHistory(pkg.name);
												}}
											>
												Details
											</Button>
											{(!pkg.trustStatus ||
												pkg.trustStatus === "unreviewed") && (
												<>
													<Button
														type="button"
														size="sm"
														variant="outline"
														onClick={() =>
															setConfirmAction({
																type: "review",
																name: pkg.name,
																status: "approved",
															})
														}
													>
														Approve
													</Button>
													<Button
														type="button"
														size="sm"
														variant="outline"
														onClick={() =>
															setConfirmAction({
																type: "review",
																name: pkg.name,
																status: "rejected",
															})
														}
													>
														Reject
													</Button>
												</>
											)}
											{(pkg.trustStatus === "approved" ||
												pkg.trustStatus === "rejected") && (
												<Button
													type="button"
													size="sm"
													variant="outline"
													onClick={() =>
														setConfirmAction({
															type: "review",
															name: pkg.name,
															status: "unreviewed",
														})
													}
												>
													Reset Review
												</Button>
											)}
											<Button
												type="button"
												size="sm"
												onClick={() => handleEval(pkg.name)}
											>
												Run Eval
											</Button>
										</div>
									</div>
								))}
							</div>
						)}
						{notice && (
							<p className="mt-3 text-xs text-[--text-secondary]">{notice}</p>
						)}
					</CardContent>
				</Card>

				{evalHistory.length > 0 && (
					<Card>
						<CardHeader>
							<CardTitle>Eval History</CardTitle>
						</CardHeader>
						<CardContent>
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead>Package</TableHead>
										<TableHead>Status</TableHead>
										<TableHead>Passed</TableHead>
										<TableHead>Failed</TableHead>
										<TableHead>Duration</TableHead>
										<TableHead>Run At</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{evalHistory.slice(0, 20).map((ev) => (
										<TableRow key={ev.id}>
											<TableCell>{ev.packageName}</TableCell>
											<TableCell>
												<StatusBadge
													label={ev.status}
													variant={ev.status === "passed" ? "ok" : "warn"}
												/>
											</TableCell>
											<TableCell>{ev.passedEvals}</TableCell>
											<TableCell>{ev.failedEvals}</TableCell>
											<TableCell>
												{(ev.durationMs / 1000).toFixed(1)}s
											</TableCell>
											<TableCell className="text-xs">
												{ev.runAt?.slice(0, 19)}
											</TableCell>
										</TableRow>
									))}
								</TableBody>
							</Table>
						</CardContent>
					</Card>
				)}

				{selectedPkg && reviewHistory.length > 0 && (
					<Card>
						<CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
							<CardTitle>Review History — {selectedPkg.name}</CardTitle>
							<Button
								type="button"
								variant="ghost"
								size="sm"
								onClick={() => {
									setSelectedPkg(null);
									setReviewHistory([]);
								}}
							>
								Close
							</Button>
						</CardHeader>
						<CardContent className="space-y-4">
							{reviewHistory.map((review) => (
								<div
									key={review.id}
									className="rounded-md border border-[--border-subtle] p-3 space-y-2"
								>
									<div className="flex items-center gap-2 flex-wrap">
										<StatusBadge
											label={review.status}
											variant={
												review.status === "approved"
													? "ok"
													: review.status === "rejected"
														? "warn"
														: "neutral"
											}
										/>
										{review.riskSummary && (
											<Badge
												variant={
													review.riskSummary.riskLevel === "low"
														? "default"
														: review.riskSummary.riskLevel === "medium"
															? "secondary"
															: "destructive"
												}
												className="text-xs"
											>
												{review.riskSummary.riskLevel} risk
											</Badge>
										)}
										<span className="text-xs text-[--text-tertiary]">
											{review.reviewedBy} @ {review.reviewedAt?.slice(0, 19)}
										</span>
									</div>
									{review.riskSummary?.warnings &&
										review.riskSummary.warnings.length > 0 && (
											<div className="text-xs text-[--text-secondary]">
												<strong>Warnings:</strong>{" "}
												{review.riskSummary.warnings.join(", ")}
											</div>
										)}
									{review.digest && (
										<div className="font-mono text-xs text-[--text-tertiary]">
											Digest: {review.digest}
										</div>
									)}
								</div>
							))}
						</CardContent>
					</Card>
				)}

				<Dialog open={installOpen} onOpenChange={setInstallOpen}>
					<DialogContent>
						<DialogHeader>
							<DialogTitle>Install Package</DialogTitle>
							<DialogDescription>
								Enter a local directory path or remote source URL for the
								package.
							</DialogDescription>
						</DialogHeader>
						<div className="space-y-4 py-2">
							<div className="space-y-1">
								<Label htmlFor="install-source">Source</Label>
								<Input
									id="install-source"
									value={installSource}
									onChange={(e) => setInstallSource(e.target.value)}
									placeholder="C:\path\to\package or https://example.com/pkg.tar.gz"
								/>
							</div>
						</div>
						<DialogFooter>
							<Button
								variant="outline"
								onClick={() => {
									setInstallOpen(false);
									setInstallSource("");
								}}
							>
								Cancel
							</Button>
							<Button onClick={handleInstall} disabled={!installSource.trim()}>
								Install
							</Button>
						</DialogFooter>
					</DialogContent>
				</Dialog>

				<ConfirmDialog
					open={confirmAction !== null}
					onOpenChange={(open) => {
						if (!open) setConfirmAction(null);
					}}
					title="Review Package"
					description={
						confirmAction
							? `Set review status to "${confirmAction.status}" for ${confirmAction.name}?`
							: ""
					}
					confirmLabel="Confirm"
					onConfirm={() => {
						if (confirmAction) {
							handleReview(confirmAction.name, confirmAction.status);
							setConfirmAction(null);
						}
					}}
				/>
			</div>
		</PageShell>
	);
}

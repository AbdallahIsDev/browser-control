import fs from "node:fs";
import path from "node:path";
import { getDataHome } from "../shared/paths";
import type { PackageDraft } from "../observability/recorder";
import { validatePackageManifest } from "./manifest";

export interface MaterializedPackageDraft {
	packageDir: string;
	manifestPath: string;
	workflowPath: string;
	evalPath: string;
	name: string;
	version: string;
}

function safeSegment(value: string): string {
	return (
		value
			.toLowerCase()
			.replace(/[^a-z0-9-]+/g, "-")
			.replace(/^-+|-+$/g, "") || "package"
	);
}

export function materializePackageDraft(
	draft: PackageDraft,
	options: { dataHome?: string; overwrite?: boolean } = {},
): MaterializedPackageDraft {
	const dataHome = options.dataHome ?? getDataHome();
	const name = safeSegment(draft.manifest.name);
	const packageDir = path.join(dataHome, "packages", "drafts", name);
	const manifestPath = path.join(packageDir, "automation-package.json");
	const workflowRel = draft.manifest.workflows[0] ?? `workflows/${draft.workflow.id}.json`;
	const evalRel = draft.manifest.evals[0] ?? "evals/eval-basic.json";
	const workflowPath = path.join(packageDir, workflowRel);
	const evalPath = path.join(packageDir, evalRel);

	if (fs.existsSync(packageDir) && options.overwrite !== true) {
		throw new Error(`Package draft already exists: ${packageDir}`);
	}

	fs.mkdirSync(path.dirname(workflowPath), { recursive: true });
	fs.mkdirSync(path.dirname(evalPath), { recursive: true });
	fs.writeFileSync(manifestPath, `${JSON.stringify(draft.manifest, null, 2)}\n`, "utf8");
	fs.writeFileSync(workflowPath, `${JSON.stringify(draft.workflow, null, 2)}\n`, "utf8");
	fs.writeFileSync(evalPath, `${JSON.stringify([draft.evalDefinition], null, 2)}\n`, "utf8");

	const validation = validatePackageManifest(manifestPath, packageDir);
	if (!validation.valid) {
		throw new Error(`Materialized package is invalid: ${validation.errors.join("; ")}`);
	}

	return {
		packageDir,
		manifestPath,
		workflowPath,
		evalPath,
		name: draft.manifest.name,
		version: draft.manifest.version,
	};
}

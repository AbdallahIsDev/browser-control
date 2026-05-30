export const productionFeatureFlags: Record<string, boolean> = {
	advancedProviders: false,
	advancedSurfaces: false,
	captchaSolving: false,
	fullTerminalDashboard: false,
	generalAgentUi: false,
	proxyManager: false,
	stealthControls: false,
};

export type ProductionFeatureFlag =
	| "advancedProviders"
	| "advancedSurfaces"
	| "captchaSolving"
	| "fullTerminalDashboard"
	| "generalAgentUi"
	| "proxyManager"
	| "stealthControls";

export function isProductionFeatureEnabled(
	flag: ProductionFeatureFlag,
): boolean {
	return productionFeatureFlags[flag] === true;
}

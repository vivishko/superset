import type {
	TerminalProxyModeProject,
	TerminalProxyOverride,
	TerminalProxySettings,
} from "@superset/local-db";
import { Button } from "@superset/ui/button";
import { Input } from "@superset/ui/input";
import { Label } from "@superset/ui/label";
import { RadioGroup, RadioGroupItem } from "@superset/ui/radio-group";
import { toast } from "@superset/ui/sonner";
import { useEffect, useMemo, useState } from "react";
import { electronTrpc } from "renderer/lib/electron-trpc";
import { getTerminalProxyStateLabel } from "shared/terminal-proxy";

interface TerminalProxySectionProps {
	projectId: string;
	currentOverride: TerminalProxyOverride | null | undefined;
}

function normalizeOverride(
	override: TerminalProxyOverride | null | undefined,
): TerminalProxyOverride {
	return override ?? { mode: "inherit" };
}

function getManualFields(override: TerminalProxyOverride | null | undefined) {
	return {
		proxyUrl: override?.manual?.proxyUrl ?? "",
		noProxy: override?.manual?.noProxy ?? "",
	};
}

function getEffectiveStateLabel(params: {
	projectMode: TerminalProxyModeProject;
	globalSettings?: TerminalProxySettings | null;
	detectedHasProxy: boolean;
}): string {
	if (params.projectMode === "enabled") {
		return "Using project manual proxy";
	}

	const globalMode = params.globalSettings?.mode ?? "auto";

	if (params.projectMode === "inherit" && globalMode === "manual") {
		return "Using global (manual)";
	}
	if (
		params.projectMode === "inherit" &&
		globalMode === "auto" &&
		params.detectedHasProxy
	) {
		return "Using global (inherited)";
	}

	return getTerminalProxyStateLabel({
		projectMode: params.projectMode,
		globalMode,
		effective: { state: "none", source: "none" },
	});
}

export function TerminalProxySection({
	projectId,
	currentOverride,
}: TerminalProxySectionProps) {
	const utils = electronTrpc.useUtils();
	const { data: globalProxySettings } =
		electronTrpc.settings.getTerminalProxySettings.useQuery();
	const { data: detectedInheritedProxy } =
		electronTrpc.settings.getDetectedInheritedProxy.useQuery();

	const normalized = normalizeOverride(currentOverride);
	const [mode, setMode] = useState<TerminalProxyModeProject>(normalized.mode);
	const [proxyUrl, setProxyUrl] = useState(
		getManualFields(normalized).proxyUrl,
	);
	const [noProxy, setNoProxy] = useState(getManualFields(normalized).noProxy);

	useEffect(() => {
		const next = normalizeOverride(currentOverride);
		setMode(next.mode);
		const manual = getManualFields(next);
		setProxyUrl(manual.proxyUrl);
		setNoProxy(manual.noProxy);
	}, [currentOverride]);

	const updateProject = electronTrpc.projects.update.useMutation({
		onSuccess: () => {
			utils.projects.get.invalidate({ id: projectId });
		},
		onError: (error) => {
			toast.error("Failed to save project terminal proxy", {
				description: error.message,
			});
		},
	});

	const resetOverride =
		electronTrpc.projects.resetTerminalProxyOverride.useMutation({
			onSuccess: () => {
				utils.projects.get.invalidate({ id: projectId });
			},
			onError: (error) => {
				toast.error("Failed to reset project terminal proxy", {
					description: error.message,
				});
			},
		});

	const effectiveStateLabel = useMemo(
		() =>
			getEffectiveStateLabel({
				projectMode: mode,
				globalSettings: globalProxySettings,
				detectedHasProxy: detectedInheritedProxy?.hasProxy ?? false,
			}),
		[mode, globalProxySettings, detectedInheritedProxy?.hasProxy],
	);

	const handleModeChange = (nextMode: TerminalProxyModeProject) => {
		setMode(nextMode);

		if (nextMode === "enabled") {
			return;
		}

		updateProject.mutate({
			id: projectId,
			patch: {
				terminalProxyOverride: {
					mode: nextMode,
				},
			},
		});
	};

	const saveManualOverride = () => {
		updateProject.mutate({
			id: projectId,
			patch: {
				terminalProxyOverride: {
					mode: "enabled",
					manual: {
						proxyUrl,
						noProxy,
					},
				},
			},
		});
	};

	const isBusy = updateProject.isPending || resetOverride.isPending;

	return (
		<div className="space-y-3">
			<div className="space-y-0.5">
				<Label className="text-sm font-medium">Mode</Label>
				<p className="text-xs text-muted-foreground">
					Project override has priority over global terminal proxy settings.
				</p>
			</div>

			<RadioGroup
				value={mode}
				onValueChange={(value) =>
					handleModeChange(value as TerminalProxyModeProject)
				}
				disabled={isBusy}
				className="space-y-2"
			>
				<div className="flex items-start gap-2">
					<RadioGroupItem id="project-terminal-proxy-inherit" value="inherit" />
					<div>
						<Label htmlFor="project-terminal-proxy-inherit">
							Use global setting
						</Label>
					</div>
				</div>
				<div className="flex items-start gap-2">
					<RadioGroupItem id="project-terminal-proxy-enabled" value="enabled" />
					<div>
						<Label htmlFor="project-terminal-proxy-enabled">
							Override: Manual
						</Label>
					</div>
				</div>
				<div className="flex items-start gap-2">
					<RadioGroupItem
						id="project-terminal-proxy-disabled"
						value="disabled"
					/>
					<div>
						<Label htmlFor="project-terminal-proxy-disabled">
							Override: Disabled
						</Label>
					</div>
				</div>
			</RadioGroup>

			{mode === "enabled" && (
				<div className="rounded-md border border-border/60 p-3 space-y-3">
					<div className="space-y-1">
						<Label htmlFor="project-terminal-proxy-url">Proxy URL</Label>
						<Input
							id="project-terminal-proxy-url"
							value={proxyUrl}
							onChange={(event) => setProxyUrl(event.target.value)}
							placeholder="http://user:password@proxy.example.com:8080"
							disabled={isBusy}
						/>
					</div>
					<div className="space-y-1">
						<Label htmlFor="project-terminal-no-proxy">No proxy (CSV)</Label>
						<Input
							id="project-terminal-no-proxy"
							value={noProxy}
							onChange={(event) => setNoProxy(event.target.value)}
							placeholder="localhost,127.0.0.1,.internal.example.com"
							disabled={isBusy}
						/>
					</div>
					<div className="flex justify-end">
						<Button
							size="sm"
							disabled={isBusy || proxyUrl.trim().length === 0}
							onClick={saveManualOverride}
						>
							Save Project Proxy
						</Button>
					</div>
				</div>
			)}

			<div className="rounded-md border border-border/60 p-3 flex items-center justify-between gap-3">
				<div>
					<p className="text-xs text-muted-foreground">Effective state</p>
					<p className="text-sm font-medium">{effectiveStateLabel}</p>
					<p className="text-xs text-muted-foreground">
						Changes apply only to newly created terminal sessions.
					</p>
				</div>
				<Button
					variant="outline"
					size="sm"
					onClick={() => resetOverride.mutate({ id: projectId })}
					disabled={isBusy}
				>
					Reset for this project
				</Button>
			</div>
		</div>
	);
}

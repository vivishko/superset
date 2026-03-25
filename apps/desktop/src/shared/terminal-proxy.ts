import type {
	TerminalProxyConfig,
	TerminalProxyModeGlobal,
	TerminalProxyModeProject,
	TerminalProxyOverride,
	TerminalProxySettings,
} from "@superset/local-db";
import { z } from "zod";

export const PROXY_ENV_KEYS = [
	"HTTP_PROXY",
	"HTTPS_PROXY",
	"NO_PROXY",
	"ALL_PROXY",
	"FTP_PROXY",
	"http_proxy",
	"https_proxy",
	"no_proxy",
	"all_proxy",
	"ftp_proxy",
] as const;

const VALID_PROXY_PROTOCOLS = new Set([
	"http:",
	"https:",
	"socks:",
	"socks4:",
	"socks5:",
]);

export const PROXY_URL_CREDENTIALS_ERROR_MESSAGE =
	"Proxy URLs with embedded credentials are not allowed; use secure storage";

export function hasProxyUrlCredentials(value: string): boolean {
	try {
		const parsed = new URL(value);
		return parsed.username.length > 0 || parsed.password.length > 0;
	} catch {
		return false;
	}
}

const proxyUrlSchema = z
	.string()
	.trim()
	.min(1, "Proxy URL is required")
	.refine((value) => {
		try {
			const parsed = new URL(value);
			return (
				VALID_PROXY_PROTOCOLS.has(parsed.protocol) && parsed.hostname.length > 0
			);
		} catch {
			return false;
		}
	}, "Proxy URL must be a valid http(s)/socks URL");

const manualProxyUrlSchema = proxyUrlSchema.refine(
	(value) => !hasProxyUrlCredentials(value),
	PROXY_URL_CREDENTIALS_ERROR_MESSAGE,
);

const noProxySchema = z
	.string()
	.optional()
	.transform((value) => normalizeNoProxyCsv(value));

const terminalProxyConfigInputSchema = z.object({
	proxyUrl: manualProxyUrlSchema,
	noProxy: noProxySchema,
});

const inheritedTerminalProxyConfigInputSchema = z.object({
	proxyUrl: proxyUrlSchema,
	noProxy: noProxySchema,
});

export function normalizeNoProxyCsv(value?: string | null): string | undefined {
	if (!value) return undefined;

	const normalized = value
		.split(",")
		.map((token) => token.trim())
		.filter((token) => token.length > 0)
		.join(",");

	return normalized.length > 0 ? normalized : undefined;
}

export function validateTerminalProxyConfig(
	input: TerminalProxyConfig,
	options?: { allowCredentials?: boolean },
): TerminalProxyConfig {
	const schema = options?.allowCredentials
		? inheritedTerminalProxyConfigInputSchema
		: terminalProxyConfigInputSchema;
	const parsed = schema.parse(input);
	return {
		proxyUrl: parsed.proxyUrl,
		...(parsed.noProxy ? { noProxy: parsed.noProxy } : {}),
	};
}

export function maskProxyUrlCredentials(urlValue: string): string {
	try {
		const parsed = new URL(urlValue);
		if (!parsed.username && !parsed.password) {
			return parsed.toString();
		}
		parsed.username = parsed.username ? "***" : "";
		parsed.password = parsed.password ? "***" : "";
		return parsed.toString();
	} catch {
		return urlValue;
	}
}

export function stripProxyEnvVars(
	env: Record<string, string>,
): Record<string, string> {
	const result: Record<string, string> = { ...env };
	for (const key of PROXY_ENV_KEYS) {
		delete result[key];
	}
	return result;
}

export function buildProxyEnvVars(
	config: TerminalProxyConfig,
): Record<string, string> {
	const validated = validateTerminalProxyConfig(config, {
		allowCredentials: true,
	});
	const env: Record<string, string> = {
		HTTP_PROXY: validated.proxyUrl,
		HTTPS_PROXY: validated.proxyUrl,
		http_proxy: validated.proxyUrl,
		https_proxy: validated.proxyUrl,
	};

	if (validated.noProxy) {
		env.NO_PROXY = validated.noProxy;
		env.no_proxy = validated.noProxy;
	}

	return env;
}

export interface DetectedInheritedProxy {
	httpProxy?: string;
	httpsProxy?: string;
	noProxy?: string;
	proxyUrl?: string;
	hasProxy: boolean;
}

export function detectInheritedProxyFromEnv(
	env: Record<string, string>,
): DetectedInheritedProxy {
	const httpProxy = env.HTTP_PROXY || env.http_proxy;
	const httpsProxy = env.HTTPS_PROXY || env.https_proxy;
	const proxyUrl = httpsProxy || httpProxy;
	const noProxy = normalizeNoProxyCsv(env.NO_PROXY || env.no_proxy);
	const hasProxy = typeof proxyUrl === "string" && proxyUrl.trim().length > 0;

	return {
		...(proxyUrl ? { proxyUrl } : {}),
		...(httpProxy ? { httpProxy } : {}),
		...(httpsProxy ? { httpsProxy } : {}),
		...(noProxy ? { noProxy } : {}),
		hasProxy,
	};
}

export type EffectiveTerminalProxyState = "disabled" | "manual" | "none";
export type EffectiveTerminalProxySource =
	| "project"
	| "global-manual"
	| "global-auto"
	| "global-disabled"
	| "none";

export interface EffectiveTerminalProxy {
	state: EffectiveTerminalProxyState;
	source: EffectiveTerminalProxySource;
	config?: TerminalProxyConfig;
}

function toManualConfigOrNull(
	config?: TerminalProxyConfig,
	options?: { allowCredentials?: boolean },
): TerminalProxyConfig | null {
	if (!config) return null;
	try {
		return validateTerminalProxyConfig(config, options);
	} catch {
		return null;
	}
}

export function resolveEffectiveTerminalProxyFromSettings(params: {
	projectOverride?: TerminalProxyOverride | null;
	globalSettings?: TerminalProxySettings | null;
	inheritedProxy: DetectedInheritedProxy;
}): EffectiveTerminalProxy {
	const projectOverride = params.projectOverride ?? { mode: "inherit" };
	const globalSettings = params.globalSettings ?? { mode: "auto" };

	if (projectOverride.mode === "disabled") {
		return { state: "disabled", source: "project" };
	}

	if (projectOverride.mode === "enabled") {
		const projectManual = toManualConfigOrNull(projectOverride.manual);
		if (!projectManual) {
			return { state: "none", source: "none" };
		}
		return { state: "manual", source: "project", config: projectManual };
	}

	if (globalSettings.mode === "disabled") {
		return { state: "disabled", source: "global-disabled" };
	}

	if (globalSettings.mode === "manual") {
		const globalManual = toManualConfigOrNull(globalSettings.manual);
		if (!globalManual) {
			return { state: "none", source: "none" };
		}
		return { state: "manual", source: "global-manual", config: globalManual };
	}

	if (!params.inheritedProxy.hasProxy || !params.inheritedProxy.proxyUrl) {
		return { state: "none", source: "none" };
	}

	const inheritedManual = toManualConfigOrNull(
		{
			proxyUrl: params.inheritedProxy.proxyUrl,
			noProxy: params.inheritedProxy.noProxy,
		},
		{ allowCredentials: true },
	);
	if (!inheritedManual) {
		return { state: "none", source: "none" };
	}

	return {
		state: "manual",
		source: "global-auto",
		config: inheritedManual,
	};
}

export function getTerminalProxyStateLabel(params: {
	projectMode: TerminalProxyModeProject;
	globalMode: TerminalProxyModeGlobal;
	effective: EffectiveTerminalProxy;
}): string {
	if (params.projectMode === "disabled") {
		return "Proxy disabled for this project";
	}
	if (params.projectMode === "enabled" && params.effective.state === "manual") {
		return "Using project manual proxy";
	}
	if (
		params.projectMode === "inherit" &&
		params.globalMode === "manual" &&
		params.effective.state === "manual"
	) {
		return "Using global (manual)";
	}
	if (
		params.projectMode === "inherit" &&
		params.globalMode === "auto" &&
		params.effective.state === "manual"
	) {
		return "Using global (inherited)";
	}
	if (params.projectMode === "inherit" && params.globalMode === "disabled") {
		return "Proxy disabled (global setting)";
	}
	return "No proxy configured";
}

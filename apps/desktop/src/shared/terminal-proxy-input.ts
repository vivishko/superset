import {
	TERMINAL_PROXY_MODE_GLOBAL,
	TERMINAL_PROXY_MODE_PROJECT,
	type TerminalProxyOverride,
	type TerminalProxySettings,
} from "@superset/local-db";
import { z } from "zod";
import {
	hasProxyUrlCredentials,
	normalizeNoProxyCsv,
	PROXY_URL_CREDENTIALS_ERROR_MESSAGE,
	validateTerminalProxyConfig,
} from "./terminal-proxy";

export const terminalProxyConfigInputSchema = z
	.object({
		proxyUrl: z.string().trim().min(1),
		noProxy: z.string().optional(),
	})
	.superRefine((value, ctx) => {
		if (hasProxyUrlCredentials(value.proxyUrl)) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["proxyUrl"],
				message: PROXY_URL_CREDENTIALS_ERROR_MESSAGE,
			});
		}
	});

export const terminalProxySettingsInputSchema = z
	.object({
		mode: z.enum(TERMINAL_PROXY_MODE_GLOBAL),
		manual: terminalProxyConfigInputSchema.optional(),
	})
	.superRefine((value, ctx) => {
		if (value.mode === "manual" && !value.manual) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["manual"],
				message: "Manual proxy config is required in manual mode",
			});
		}
	});

export const terminalProxyOverrideInputSchema = z
	.object({
		mode: z.enum(TERMINAL_PROXY_MODE_PROJECT),
		manual: terminalProxyConfigInputSchema.optional(),
	})
	.superRefine((value, ctx) => {
		if (value.mode === "enabled" && !value.manual) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["manual"],
				message: "Manual proxy config is required when override is enabled",
			});
		}
	});

export function sanitizeTerminalProxySettingsInput(
	input: z.infer<typeof terminalProxySettingsInputSchema>,
): TerminalProxySettings {
	if (input.mode !== "manual") {
		return { mode: input.mode };
	}

	if (!input.manual) {
		throw new Error("Manual proxy config is required in manual mode");
	}

	const manual = validateTerminalProxyConfig({
		proxyUrl: input.manual.proxyUrl,
		noProxy: normalizeNoProxyCsv(input.manual.noProxy),
	});

	return { mode: "manual", manual };
}

export function sanitizeTerminalProxyOverrideInput(
	input: z.infer<typeof terminalProxyOverrideInputSchema>,
): TerminalProxyOverride {
	if (input.mode !== "enabled") {
		return { mode: input.mode };
	}

	if (!input.manual) {
		throw new Error("Manual proxy config is required when override is enabled");
	}

	const manual = validateTerminalProxyConfig({
		proxyUrl: input.manual.proxyUrl,
		noProxy: normalizeNoProxyCsv(input.manual.noProxy),
	});

	return { mode: "enabled", manual };
}

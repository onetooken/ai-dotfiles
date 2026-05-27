import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
	let providerStartMs: number | null = null;

	pi.on("before_provider_request", () => {
		providerStartMs = Date.now();
	});

	pi.on("message_end", (event, ctx) => {
		if (!ctx.hasUI) return;
		if (event.message.role !== "assistant") return;

		const usage = event.message.usage;
		const output = usage.output || 0;
		if (output <= 0 || providerStartMs === null) return;

		const elapsedMs = Date.now() - providerStartMs;
		providerStartMs = null;
		if (elapsedMs <= 0) return;

		const input = usage.input || 0;
		const cacheRead = usage.cacheRead || 0;
		const cacheWrite = usage.cacheWrite || 0;
		const totalTokens = usage.totalTokens || 0;

		const elapsedSeconds = elapsedMs / 1000;
		const tps = output / elapsedSeconds;
		const cacheRate =
			input + cacheRead + cacheWrite > 0
				? (cacheRead / (input + cacheRead + cacheWrite)) * 100
				: 0;

		const theme = ctx.ui.theme;
		const sep = theme.fg("dim", " │ ");

		// TPS: <20 red, 20-50 yellow, >50 green
		const tpsText = `${tps.toFixed(1)} tok/s`;
		let styledTps: string;
		if (tps < 20) {
			styledTps = theme.fg("error", tpsText);
		} else if (tps < 50) {
			styledTps = theme.fg("warning", tpsText);
		} else {
			styledTps = theme.fg("success", tpsText);
		}

		// Cache rate: <50% red, 50-90% yellow, >90% green
		const cacheText = `${cacheRate.toFixed(2)}%`;
		let styledCache: string;
		if (cacheRate < 50) {
			styledCache = theme.fg("error", cacheText);
		} else if (cacheRate < 90) {
			styledCache = theme.fg("warning", cacheText);
		} else {
			styledCache = theme.fg("success", cacheText);
		}

		// Details: token counts and time
		const details = theme.fg(
			"dim",
			`out ${output.toLocaleString()} in ${input.toLocaleString()} total ${totalTokens.toLocaleString()} ${elapsedSeconds.toFixed(1)}s`,
		);

		ctx.ui.setStatus(
			"stats",
			`TPS ${styledTps}${sep}cache ${styledCache}${sep}${details}`,
		);
	});
}

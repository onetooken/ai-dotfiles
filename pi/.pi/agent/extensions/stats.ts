import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

function colorThreshold(
	theme: ReturnType<ExtensionAPI["ui"]["theme"]>,
	value: number,
	lo: number,
	hi: number,
	text: string,
): string {
	if (value < lo) return theme.fg("error", text);
	if (value < hi) return theme.fg("warning", text);
	return theme.fg("success", text);
}

export default function (pi: ExtensionAPI) {
	let providerStartMs: number | null = null;
	let firstTokenMs: number | null = null;

	pi.on("before_provider_request", () => {
		providerStartMs = Date.now();
		firstTokenMs = null;
	});

	pi.on("message_update", () => {
		if (providerStartMs !== null && firstTokenMs === null) {
			firstTokenMs = Date.now();
		}
	});

	pi.on("message_end", (event, ctx) => {
		if (!ctx.hasUI) return;
		if (event.message.role !== "assistant") return;

		const usage = event.message.usage;
		const output = usage.output || 0;
		if (output <= 0 || providerStartMs === null) return;

		const startMs = providerStartMs;
		const tokenMs = firstTokenMs;
		providerStartMs = null;
		firstTokenMs = null;

		const elapsedMs = Date.now() - startMs;
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

		const styledTps = colorThreshold(theme, tps, 20, 50, tps.toFixed(1));

		// Generation TPS (excluding TTFT)
		let genTpsPart: string;
		if (tokenMs !== null) {
			const ttftMs = tokenMs - startMs;
			const genMs = elapsedMs - ttftMs;
			if (genMs >= 1000) {
				const genTps = output / (genMs / 1000);
				genTpsPart = `(⚡${colorThreshold(theme, genTps, 20, 50, genTps.toFixed(1))})`;
			} else {
				genTpsPart = theme.fg("dim", "(⚡-)");
			}
		} else {
			genTpsPart = theme.fg("dim", "(⚡-)");
		}

		const styledCache = colorThreshold(theme, cacheRate, 50, 90, `${cacheRate.toFixed(2)}%`);

		let styledTtft = "";
		if (tokenMs !== null) {
			const ttftSeconds = (tokenMs - startMs) / 1000;
			const ttftPercent = (ttftSeconds / elapsedSeconds) * 100;
			const ttftText = `${ttftSeconds.toFixed(1)}s(${ttftPercent.toFixed(2)}%)`;
			// TTFT is inverted: lower is better, so swap lo/hi semantics
			if (ttftSeconds < 1) {
				styledTtft = theme.fg("success", ttftText);
			} else if (ttftSeconds < 5) {
				styledTtft = theme.fg("warning", ttftText);
			} else {
				styledTtft = theme.fg("error", ttftText);
			}
		}

		// Details: token counts and time
		const details = theme.fg(
			"dim",
			`out ${output.toLocaleString()} in ${input.toLocaleString()} total ${totalTokens.toLocaleString()} ${elapsedSeconds.toFixed(1)}s`,
		);

		const ttftPart = styledTtft ? `TTFT ${styledTtft}${sep}` : "";
		ctx.ui.setStatus(
			"stats",
			`TPS ${styledTps}${genTpsPart} tok/s${sep}${ttftPart}CACHE ${styledCache}${sep}${details}`,
		);
	});
}

import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

function isAssistantMessage(message: unknown): message is AssistantMessage {
	if (!message || typeof message !== "object") return false;
	const role = (message as { role?: unknown }).role;
	return role === "assistant";
}

export default function (pi: ExtensionAPI) {
	let agentStartMs: number | null = null;
	let requestStartMs: number | null = null;
	let llmStartMs: number | null = null;
	let accumulatedLlmMs = 0;
	let accumulatedOutput = 0;

	pi.on("agent_start", () => {
		agentStartMs = Date.now();
		accumulatedLlmMs = 0;
		accumulatedOutput = 0;
	});

	// 请求发出时记录，包含 prefill + 网络延迟
	pi.on("before_provider_request", () => {
		requestStartMs = Date.now();
	});

	// 第一个 streaming chunk 到达，用更早的 requestStartMs（如果有）
	pi.on("message_start", (_event, ctx) => {
		if (!ctx.hasUI) return;
		if (!isAssistantMessage(_event.message)) return;
		llmStartMs = requestStartMs ?? Date.now();
		requestStartMs = null;
	});

	pi.on("message_end", (_event, ctx) => {
		if (!ctx.hasUI) return;
		if (!isAssistantMessage(_event.message)) return;
		if (llmStartMs === null) return;
		accumulatedLlmMs += Date.now() - llmStartMs;
		accumulatedOutput += _event.message.usage?.output || 0;
		llmStartMs = null;
	});

	pi.on("agent_end", (event, ctx) => {
		if (!ctx.hasUI) return;
		if (agentStartMs === null) return;

		const agentMs = Date.now() - agentStartMs;
		agentStartMs = null;
		if (agentMs <= 0) return;

		let input = 0;
		let output = 0;
		let cacheRead = 0;
		let cacheWrite = 0;
		let totalTokens = 0;

		for (const message of event.messages) {
			if (!isAssistantMessage(message)) continue;
			input += message.usage.input || 0;
			output += message.usage.output || 0;
			cacheRead += message.usage.cacheRead || 0;
			cacheWrite += message.usage.cacheWrite || 0;
			totalTokens += message.usage.totalTokens || 0;
		}

		// ESC 中断兜底：如果有未完成的 message，补上最后一段时间
		if (llmStartMs !== null) {
			accumulatedLlmMs += Date.now() - llmStartMs;
			llmStartMs = null;
		}

		// Message TPS 用 message_end 累计的 tokens，确保与时间匹配
		if (accumulatedOutput <= 0 && output <= 0) return;
		const safeOutput = accumulatedOutput > 0 ? accumulatedOutput : output;

		const agentSeconds = agentMs / 1000;
		const llmSeconds = accumulatedLlmMs / 1000;
		const agentTps = safeOutput / agentSeconds;
		const messageTps = llmSeconds > 0 ? safeOutput / llmSeconds : 0;

		const inputTotal = input + cacheRead + cacheWrite;
		const cacheHitRate = inputTotal > 0 ? (cacheRead / inputTotal) * 100 : 0;

		const message = [
			`Agent TPS ${agentTps.toFixed(1)} tok/s`,
			llmSeconds > 0 ? `Message TPS ${messageTps.toFixed(1)} tok/s` : null,
			`out ${safeOutput.toLocaleString()}`,
			`in ${input.toLocaleString()}`,
			`cache r/w ${cacheRead.toLocaleString()}/${cacheWrite.toLocaleString()} (${cacheHitRate.toFixed(2)}%)`,
			`total ${totalTokens.toLocaleString()}`,
			`agent ${agentSeconds.toFixed(1)}s`,
			llmSeconds > 0 ? `llm ${llmSeconds.toFixed(1)}s` : null,
		]
			.filter(Boolean)
			.join(", ");

		ctx.ui.notify(message, "info");
	});
}

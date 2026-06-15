import open from "open";
import { isJsonMode, isNonInteractiveMode } from "./output.js";

/**
 * Whether a browser can plausibly be launched from this process. A non-TTY
 * shell (an agent's Bash tool, a piped session) does NOT imply the browser is
 * unreachable — browser-based flows (OAuth login, hosted checkout) are driven
 * by a local callback server or the hosted page, not stdin. So gate on whether
 * a GUI is actually reachable: on Linux/BSD an X11 or Wayland display must be
 * exported; macOS and Windows always have a window server.
 */
export function canLaunchBrowser(): boolean {
	if (process.platform === "darwin" || process.platform === "win32") {
		return true;
	}
	return Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY);
}

/**
 * The browser opener injected into the billing engine for hosted-checkout
 * payment URLs. Returns `undefined` (engine skips opening) only when the caller
 * opted out via `--no-open` or no GUI is reachable. Crucially it opens in
 * `--json` mode too: the CLI runs on the user's machine, so opening the payment
 * page locally saves a manual click while the agent still receives `paymentUrl`
 * in the JSON envelope. Open failures are swallowed — the URL is always printed
 * textually as a fallback.
 */
export function paymentBrowserOpener(opts?: {
	noOpen?: boolean;
}): ((url: string) => Promise<void>) | undefined {
	if (opts?.noOpen || !canLaunchBrowser()) return undefined;
	return async (url: string) => {
		try {
			await open(url);
		} catch {
			// Headless / no display — caller surfaces the URL textually.
		}
	};
}

/**
 * Whether to skip the local y/n confirm on a paid plan change and go straight
 * to the hosted checkout. True only for an agent context (non-TTY, non-JSON)
 * that can open a browser, on a positive charge: there the StreamPay payment
 * page is the real consent surface, so a local confirm just halts the agent
 * with `needs_input`. `--json` keeps the structured handoff; net-zero/free
 * changes (no amount due) still confirm — they apply instantly with no payment
 * page to gate them.
 */
export function shouldAutoConfirmPaidCheckout(
	amountDueHalalas: number | undefined,
): boolean {
	const isPaidCheckout =
		typeof amountDueHalalas === "number" && amountDueHalalas > 0;
	return (
		!isJsonMode() &&
		isNonInteractiveMode() &&
		canLaunchBrowser() &&
		isPaidCheckout
	);
}

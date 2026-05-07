/**
 * Strip ANSI escape/control sequences from terminal output.
 */
export function stripAnsi(text: string): string {
	return (
		text
			// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI ESC sequence stripping requires matching ESC.
			.replace(/\x1b\[\??[0-9;]*[a-zA-Z]/g, "")
			// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI OSC sequence stripping requires matching ESC/BEL.
			.replace(/\x1b\][^\x07]*\x07/g, "")
			// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI charset sequence stripping requires matching ESC.
			.replace(/\x1b[()#][a-zA-Z0-9]/g, "")
			// biome-ignore lint/suspicious/noControlCharactersInRegex: General ANSI CSI stripping requires matching ESC.
			.replace(/\x1b(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, "")
	);
}

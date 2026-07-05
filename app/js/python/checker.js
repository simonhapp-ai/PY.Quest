// Pure, DOM-free validation logic for "build" tasks and Werkstatt-Projekte.
// Input is the raw result of runtime.runCheck(); output is a verdict the UI can render.

export function normalizeLine(line) {
  return line.trim().replace(/\s+/g, " ").replace(/'/g, '"');
}

function normalizedLines(stdout) {
  const lines = (stdout || "").split("\n");
  if (lines.length && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/**
 * @param {{stdout: string, userError: string|null, testError: string|null}} result
 * @param {{stdout?: string[], tests?: string}} check
 * @returns {{passed: boolean, reason?: string, detail?: string}}
 */
export function evaluateCheck(result, check) {
  if (result.userError) {
    return { passed: false, reason: "error", detail: result.userError };
  }

  if (check.stdout) {
    const actual = normalizedLines(result.stdout);
    const expected = check.stdout;
    const len = Math.max(actual.length, expected.length);
    for (let i = 0; i < len; i++) {
      const a = actual[i] !== undefined ? normalizeLine(actual[i]) : undefined;
      const e = expected[i] !== undefined ? normalizeLine(expected[i]) : undefined;
      if (a !== e) {
        return {
          passed: false,
          reason: "stdout-mismatch",
          detail: `Zeile ${i + 1} deiner Ausgabe: ${
            e !== undefined ? `"${e}" erwartet` : "hier wird nichts erwartet"
          }, ${a !== undefined ? `"${a}" erhalten` : "nichts erhalten"}.`,
        };
      }
    }
  }

  if (result.testError) {
    const lines = result.testError.trim().split("\n");
    const lastLine = lines[lines.length - 1];
    return { passed: false, reason: "test-failed", detail: lastLine };
  }

  return { passed: true };
}

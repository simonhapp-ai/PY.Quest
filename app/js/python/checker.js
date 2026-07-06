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
 * A `check.stdout` entry is normally an exact-match string. It can also be a pattern
 * object for content that has no single correct answer (e.g. "print your own name") —
 * currently just `{ any: true }`, meaning "any non-empty line is accepted".
 */
function matchesPattern(pattern, actualLine) {
  if (pattern.any) return actualLine !== undefined && normalizeLine(actualLine) !== "";
  return false;
}

/**
 * @param {{stdout: string, userError: string|null, testError: string|null}} result
 * @param {{stdout?: (string|{any:true})[], tests?: string}} check
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
      const expectedEntry = expected[i];
      if (expectedEntry && typeof expectedEntry === "object") {
        if (!matchesPattern(expectedEntry, actual[i])) {
          return {
            passed: false,
            reason: "stdout-mismatch",
            detail: `Zeile ${i + 1} deiner Ausgabe: hier wird eine beliebige, nicht-leere Zeile erwartet, ${
              actual[i] !== undefined ? `"${normalizeLine(actual[i])}" erhalten` : "nichts erhalten"
            }.`,
          };
        }
        continue;
      }
      const a = actual[i] !== undefined ? normalizeLine(actual[i]) : undefined;
      const e = expectedEntry !== undefined ? normalizeLine(expectedEntry) : undefined;
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
    // A bare "assert cond" with no message just prints "AssertionError" — tell the
    // learner their result was checked and didn't match, since the line alone says nothing.
    const detail =
      lastLine === "AssertionError"
        ? "Ein interner Test ist fehlgeschlagen — dein Ergebnis stimmt nicht mit dem erwarteten Wert überein. Schau dir deine Ausgabe/Rückgabe noch mal genau an."
        : lastLine;
    return { passed: false, reason: "test-failed", detail };
  }

  return { passed: true };
}

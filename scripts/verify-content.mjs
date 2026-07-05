#!/usr/bin/env node
// Runs every "build" aufgabe's and every Werkstatt-Projekt's `loesung` against its own
// `check` (exactly like the real app's Abgeben button, but headless via Pyodide-on-Node)
// and reports pass/fail. Run with: npm run verify-content
import { loadPyodide } from "pyodide";
import { registry } from "../app/js/registry.js";
import { evaluateCheck } from "../app/js/python/checker.js";

function collectTasks() {
  const tasks = [];
  for (const teil of registry) {
    for (const lek of teil.lektionen) {
      lek.aufgaben.forEach((auf, idx) => {
        if (auf.t !== "build") return;
        tasks.push({
          label: `${teil.id} / ${lek.id} / Aufgabe ${idx + 1}`,
          code: auf.loesung,
          check: auf.check,
        });
      });
    }
    for (const p of teil.werkstatt) {
      tasks.push({
        label: `${teil.id} / werkstatt / ${p.id}`,
        code: p.loesung,
        check: p.check,
      });
    }
  }
  return tasks;
}

async function runCheck(pyodide, code, tests, stdinQueue) {
  let stdoutBuf = "";
  let i = 0;
  pyodide.setStdout({ batched: (t) => (stdoutBuf += t + "\n") });
  pyodide.setStdin({ stdin: () => (i < stdinQueue.length ? stdinQueue[i++] : undefined) });

  const globals = pyodide.globals.get("dict")();
  let userError = null;
  try {
    await pyodide.runPythonAsync(code, { globals });
  } catch (err) {
    userError = String(err.message || err);
  }

  let testError = null;
  if (!userError && tests) {
    try {
      await pyodide.runPythonAsync(tests, { globals });
    } catch (err) {
      testError = String(err.message || err);
    }
  }

  globals.destroy();
  pyodide.setStdin({});
  return { stdout: stdoutBuf, userError, testError };
}

async function main() {
  const pyodide = await loadPyodide();
  const tasks = collectTasks();
  let passCount = 0;
  const failures = [];

  for (const task of tasks) {
    const result = await runCheck(pyodide, task.code, task.check.tests || "", task.check.stdin || []);
    const verdict = evaluateCheck(result, task.check);
    if (verdict.passed) {
      passCount++;
      console.log(`PASS  ${task.label}`);
    } else {
      failures.push({ label: task.label, detail: verdict.detail });
      console.log(`FAIL  ${task.label}\n      ${verdict.detail}`);
    }
  }

  console.log(`\n${passCount}/${tasks.length} passed.`);
  if (failures.length) {
    console.log(`\n${failures.length} failing task(s):`);
    for (const f of failures) console.log(`- ${f.label}: ${f.detail}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

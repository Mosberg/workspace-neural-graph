import { readFile } from "node:fs/promises";
import { CodeComplexity } from "./types";

const OPERATOR_REGEX =
  /(?:===|!==|==|!=|<=|>=|=>|\+\+|--|\+=|-=|\*=|\/=|%=|&&|\|\||\?|\:|\+|\-|\*|\/|%|<|>|&|\||\^|~|!|=|return|if|else|for|while|do|switch|case|default|break|continue|try|catch|throw|finally|import|export|function|class|new|typeof|instanceof)/g;
const DECISION_REGEX = /\b(if|else\s+if|for|while|case|catch|\?)\b|&&|\|\|/g;
const IDENTIFIER_REGEX = /\b([a-zA-Z_$][a-zA-Z0-9_$]*)\b/g;

export async function analyzeCodeMetrics(
  filePath: string,
): Promise<CodeComplexity | undefined> {
  try {
    const content = await readFile(filePath, "utf8");
    // Strip multi-line and single-line comments
    const cleanContent = content.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, "");
    const lines = content.split("\n").length;
    if (lines === 0) return undefined;

    // 1. Cyclomatic Complexity: 1 + decision points
    const decisionMatches = cleanContent.match(DECISION_REGEX);
    const cyclomatic = 1 + (decisionMatches ? decisionMatches.length : 0);

    // 2. Halstead Metrics
    const operators = cleanContent.match(OPERATOR_REGEX) || [];
    const identifiers = cleanContent.match(IDENTIFIER_REGEX) || [];

    const uniqueOperators = new Set(operators);
    const uniqueOperands = new Set(identifiers);

    const n1 = uniqueOperators.size;
    const n2 = uniqueOperands.size;
    const N1 = operators.length;
    const N2 = identifiers.length;

    const vocabulary = Math.max(1, n1 + n2);
    const length = N1 + N2;
    const volume = Math.max(1, length * Math.log2(vocabulary));
    const difficulty = Math.max(1, (n1 / 2) * (N2 / Math.max(1, n2)));
    const effort = volume * difficulty;

    // 3. Maintainability Index (MI = 171 - 5.2 * ln(V) - 0.23 * (CC) - 16.2 * ln(LOC))
    let mi = 171 - 5.2 * Math.log(volume) - 0.23 * cyclomatic - 16.2 * Math.log(Math.max(1, lines));
    mi = Math.max(0, Math.min(100, Math.round((mi * 100) / 171))); // Normalize 0 - 100

    let riskLevel: "low" | "moderate" | "high" | "critical" = "low";
    if (cyclomatic > 20 || mi < 40) riskLevel = "critical";
    else if (cyclomatic > 10 || mi < 65) riskLevel = "high";
    else if (cyclomatic > 6 || mi < 80) riskLevel = "moderate";

    return {
      cyclomaticComplexity: cyclomatic,
      maintainabilityIndex: mi,
      halstead: {
        vocabulary,
        length,
        volume: Math.round(volume),
        difficulty: parseFloat(difficulty.toFixed(1)),
        effort: Math.round(effort),
      },
      riskLevel,
    };
  } catch {
    return undefined;
  }
}

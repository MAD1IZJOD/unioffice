import type {
  ToolDefinition,
  ToolValidationResult,
} from "../tool.js";

export interface CalculatorInput {
  expression: string;
}

export interface CalculatorOutput {
  expression: string;

  result: number;
}

const MAX_EXPRESSION_CHARS = 200;

/**
 * Evaluates a numeric expression with a hand-rolled recursive-descent parser
 * rather than eval()/Function() so agent-supplied text can never reach the
 * JS runtime as code — only +, -, *, /, %, ^, parentheses and numbers.
 */
export const calculatorTool: ToolDefinition<
  CalculatorInput,
  CalculatorOutput
> = {
  id: "calculator",
  name: "Calculator",
  description:
    "Evaluates an arithmetic expression using +, -, *, /, %, ^ and parentheses.",
  version: "1.0.0",
  inputSchema: {
    type: "object",
    required: ["expression"],
    properties: {
      expression: {
        type: "string",
        description: "An arithmetic expression, e.g. \"(4 + 5) * 2\".",
      },
    },
  },

  validate(input): ToolValidationResult<CalculatorInput> {
    if (typeof input !== "object" || input === null) {
      return {
        valid: false,
        errors: [{ path: "", message: "Input must be an object." }],
      };
    }

    const expression = (input as Record<string, unknown>).expression;

    if (typeof expression !== "string" || expression.trim().length === 0) {
      return {
        valid: false,
        errors: [{
          path: "expression",
          message: "expression must be a non-empty string.",
        }],
      };
    }

    if (expression.length > MAX_EXPRESSION_CHARS) {
      return {
        valid: false,
        errors: [{
          path: "expression",
          message: `expression must not exceed ${MAX_EXPRESSION_CHARS} characters.`,
        }],
      };
    }

    return { valid: true, value: { expression } };
  },

  async execute(input): Promise<CalculatorOutput> {
    const result = evaluateExpression(input.expression);
    return { expression: input.expression, result };
  },
};

type Token =
  | { type: "number"; value: number }
  | { type: "operator"; value: "+" | "-" | "*" | "/" | "%" | "^" }
  | { type: "paren"; value: "(" | ")" };

function tokenize(expression: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;

  while (index < expression.length) {
    const char = expression[index];

    if (char === undefined) break;

    if (/\s/.test(char)) {
      index += 1;
      continue;
    }

    if (/[0-9.]/.test(char)) {
      let numberText = "";

      while (index < expression.length && /[0-9.]/.test(expression[index] ?? "")) {
        numberText += expression[index];
        index += 1;
      }

      const value = Number(numberText);

      if (Number.isNaN(value)) {
        throw new Error(`Invalid number in expression: "${numberText}"`);
      }

      tokens.push({ type: "number", value });
      continue;
    }

    if (char === "+" || char === "-" || char === "*" || char === "/" || char === "%" || char === "^") {
      tokens.push({ type: "operator", value: char });
      index += 1;
      continue;
    }

    if (char === "(" || char === ")") {
      tokens.push({ type: "paren", value: char });
      index += 1;
      continue;
    }

    throw new Error(`Unsupported character in expression: "${char}"`);
  }

  return tokens;
}

/**
 * Grammar (lowest to highest precedence):
 *   expr   := term (("+" | "-") term)*
 *   term   := power (("*" | "/" | "%") power)*
 *   power  := unary ("^" power)?      // right-associative
 *   unary  := "-" unary | primary
 *   primary:= number | "(" expr ")"
 */
function evaluateExpression(expression: string): number {
  const tokens = tokenize(expression);

  if (tokens.length === 0) {
    throw new Error("Expression is empty.");
  }

  let position = 0;

  function peek(): Token | undefined {
    return tokens[position];
  }

  function consume(): Token {
    const token = tokens[position];

    if (!token) {
      throw new Error("Unexpected end of expression.");
    }

    position += 1;
    return token;
  }

  function parseExpr(): number {
    let value = parseTerm();

    for (;;) {
      const token = peek();

      if (token?.type === "operator" && (token.value === "+" || token.value === "-")) {
        consume();
        const right = parseTerm();
        value = token.value === "+" ? value + right : value - right;
        continue;
      }

      break;
    }

    return value;
  }

  function parseTerm(): number {
    let value = parsePower();

    for (;;) {
      const token = peek();

      if (
        token?.type === "operator" &&
        (token.value === "*" || token.value === "/" || token.value === "%")
      ) {
        consume();
        const right = parsePower();

        if ((token.value === "/" || token.value === "%") && right === 0) {
          throw new Error("Division by zero.");
        }

        value = token.value === "*"
          ? value * right
          : token.value === "/"
            ? value / right
            : value % right;
        continue;
      }

      break;
    }

    return value;
  }

  function parsePower(): number {
    const base = parseUnary();
    const token = peek();

    if (token?.type === "operator" && token.value === "^") {
      consume();
      const exponent = parsePower();
      return base ** exponent;
    }

    return base;
  }

  function parseUnary(): number {
    const token = peek();

    if (token?.type === "operator" && token.value === "-") {
      consume();
      return -parseUnary();
    }

    return parsePrimary();
  }

  function parsePrimary(): number {
    const token = consume();

    if (token.type === "number") {
      return token.value;
    }

    if (token.type === "paren" && token.value === "(") {
      const value = parseExpr();
      const closing = consume();

      if (closing.type !== "paren" || closing.value !== ")") {
        throw new Error("Expected closing parenthesis.");
      }

      return value;
    }

    throw new Error("Expected a number or parenthesized expression.");
  }

  const result = parseExpr();

  if (position !== tokens.length) {
    throw new Error("Unexpected trailing input in expression.");
  }

  if (!Number.isFinite(result)) {
    throw new Error("Expression did not evaluate to a finite number.");
  }

  return result;
}

import { describe, expect, it } from "vitest";
import { parseYamlFile } from "../services/company-portability.js";

describe("parseYamlFile scalars", () => {
  it("unquotes single- and double-quoted strings", () => {
    const parsed = parseYamlFile([
      "agents:",
      "  analyst:",
      "    env:",
      "      SINGLE: '1'",
      "      DOUBLE: \"1\"",
      "      ESCAPED: 'it''s'",
      "      PLAIN: global",
    ].join("\n"));
    const env = (parsed.agents as any).analyst.env;
    expect(env).toEqual({ SINGLE: "1", DOUBLE: "1", ESCAPED: "it's", PLAIN: "global" });
  });
});

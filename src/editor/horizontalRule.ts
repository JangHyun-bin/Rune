import type { EditorState } from "@codemirror/state";
import type { BlockSpec } from "./blockWidgets";

export const horizontalRuleSpec: BlockSpec = {
  match: (_state: EditorState, name: string) => name === "HorizontalRule",
  key: () => "horizontal-rule",
  render: () => {
    const wrap = document.createElement("div");
    wrap.className = "cm-md-hr";
    wrap.appendChild(document.createElement("hr"));
    return wrap;
  },
};

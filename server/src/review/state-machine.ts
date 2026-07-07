// Pure state machine for a version. No DB, no IO. The single source of truth
// for what transitions are legal — the only place that decides is review/*.
// See docs/data-model.md §3 for the canonical transition table.

export type State = "draft" | "in_review" | "approved" | "superseded" | "rejected";

/** The complete set of legal (from, to) edges. */
const TRANSITIONS: Record<State, ReadonlyArray<State>> = {
  draft:      ["in_review"],
  in_review:  ["approved", "rejected"],
  approved:   ["superseded"],
  superseded: [],
  rejected:   [],
};

export class IllegalTransitionError extends Error {
  constructor(public readonly from: State, public readonly to: State) {
    super(`illegal transition: ${from} -> ${to}`);
    this.name = "IllegalTransitionError";
  }
}

export function canTransition(from: State, to: State): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from: State, to: State): void {
  if (!canTransition(from, to)) throw new IllegalTransitionError(from, to);
}

/** Every legal edge. Used in tests to assert exhaustively. */
export function allLegalTransitions(): Array<{ from: State; to: State }> {
  const out: Array<{ from: State; to: State }> = [];
  for (const from of Object.keys(TRANSITIONS) as State[]) {
    for (const to of TRANSITIONS[from]) out.push({ from, to });
  }
  return out;
}

export const STATES: ReadonlyArray<State> = [
  "draft", "in_review", "approved", "superseded", "rejected",
];

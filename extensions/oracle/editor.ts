import { CustomEditor } from "@mariozechner/pi-coding-agent";
import { matchesKey, truncateToWidth } from "@mariozechner/pi-tui";

const CURSOR_AT_END = "\x1b[7m \x1b[0m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

export class OracleEditor extends CustomEditor {
  private oracleSuggestions: string[] = [];
  private selectedSuggestionIndex = 0;
  private oracleEnabled = true;
  private onAcceptOracleSuggestion?: () => void;
  private onSelectOracleSuggestion?: ((index: number) => void) | undefined;
  private onDismissOracleSuggestion?: () => void;

  setOracleSuggestions(suggestions: string[], selectedIndex = 0): void {
    this.oracleSuggestions = suggestions.map((text) => text.trim()).filter(Boolean);
    this.selectedSuggestionIndex = Math.max(0, Math.min(selectedIndex, Math.max(0, this.oracleSuggestions.length - 1)));
    this.tui.requestRender();
  }

  setOracleEnabled(enabled: boolean): void {
    this.oracleEnabled = enabled;
    this.tui.requestRender();
  }

  clearOracleSuggestion(): void {
    this.oracleSuggestions = [];
    this.selectedSuggestionIndex = 0;
    this.tui.requestRender();
  }

  setOnAcceptOracleSuggestion(handler: (() => void) | undefined): void {
    this.onAcceptOracleSuggestion = handler;
  }

  setOnSelectOracleSuggestion(handler: ((index: number) => void) | undefined): void {
    this.onSelectOracleSuggestion = handler;
  }

  setOnDismissOracleSuggestion(handler: (() => void) | undefined): void {
    this.onDismissOracleSuggestion = handler;
  }

  private getSelectedSuggestion(): string | null {
    if (this.oracleSuggestions.length === 0) return null;
    return this.oracleSuggestions[this.selectedSuggestionIndex] ?? null;
  }

  private shouldShowOracleGhost(): boolean {
    return this.oracleEnabled && !!this.getSelectedSuggestion() && !this.isShowingAutocomplete() && this.getText().length === 0;
  }

  private cycleSelection(direction: -1 | 1): void {
    if (this.oracleSuggestions.length <= 1) return;
    const count = this.oracleSuggestions.length;
    this.selectedSuggestionIndex = (this.selectedSuggestionIndex + direction + count) % count;
    this.onSelectOracleSuggestion?.(this.selectedSuggestionIndex);
    this.tui.requestRender();
  }

  override handleInput(data: string): void {
    if (this.shouldShowOracleGhost()) {
      // Accept suggestion
      if (matchesKey(data, "tab") || matchesKey(data, "right")) {
        this.insertTextAtCursor(this.getSelectedSuggestion()!);
        this.clearOracleSuggestion();
        this.onAcceptOracleSuggestion?.();
        return;
      }
      // Dismiss suggestion — Up/Down then fall through to native message history
      if (matchesKey(data, "escape")) {
        this.clearOracleSuggestion();
        this.onDismissOracleSuggestion?.();
        return;
      }
      // Cycle through multiple suggestions with Alt+Up / Alt+Down
      if (this.oracleSuggestions.length > 1) {
        if (matchesKey(data, "alt+up")) {
          this.cycleSelection(-1);
          return;
        }
        if (matchesKey(data, "alt+down")) {
          this.cycleSelection(1);
          return;
        }
      }
      // Up/Down: dismiss oracle and fall through to native message history scroll
      if (matchesKey(data, "up") || matchesKey(data, "down")) {
        this.clearOracleSuggestion();
        this.onDismissOracleSuggestion?.();
        // fall through — no return
      }
    }

    super.handleInput(data);
  }

  override render(width: number): string[] {
    const lines = super.render(width);
    if (!this.shouldShowOracleGhost()) return lines;

    const editableLineIndex = lines.findIndex((line, index) => {
      if (index === 0 || index === lines.length - 1) return false;
      return line.includes(CURSOR_AT_END);
    });
    if (editableLineIndex === -1) return lines;

    const line = lines[editableLineIndex]!;
    const cursorIndex = line.indexOf(CURSOR_AT_END);
    if (cursorIndex === -1) return lines;

    const before = line.slice(0, cursorIndex + CURSOR_AT_END.length);
    const after = line.slice(cursorIndex + CURSOR_AT_END.length);
    const availableColumns = (after.match(/^\s+/)?.[0].length ?? 0);
    if (availableColumns <= 0) return lines;

    const ghost = truncateToWidth(this.getSelectedSuggestion()!, availableColumns, "");
    if (!ghost) return lines;

    const remainingSpaces = " ".repeat(Math.max(0, availableColumns - ghost.length));
    const rest = after.slice(availableColumns);
    lines[editableLineIndex] = `${before}${DIM}${ghost}${RESET}${remainingSpaces}${rest}`;
    return lines;
  }
}

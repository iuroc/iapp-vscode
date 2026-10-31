/** 0 基行列位置，与 VS Code 的 Position 语义一致。 */
export interface SourcePosition {
  line: number;
  character: number;
}

export interface SourceRange {
  start: SourcePosition;
  end: SourcePosition;
}

/** 把字符偏移量转成行列，供所有解析器共用。 */
export class LineIndex {
  private readonly starts: number[] = [0];

  constructor(private readonly text: string) {
    for (let i = 0; i < text.length; i++) {
      if (text.charCodeAt(i) === 10) {
        this.starts.push(i + 1);
      }
    }
  }

  positionAt(offset: number): SourcePosition {
    const clamped = Math.max(0, Math.min(offset, this.text.length));
    let low = 0;
    let high = this.starts.length - 1;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if (this.starts[mid] <= clamped) {
        low = mid;
      } else {
        high = mid - 1;
      }
    }
    return { line: low, character: clamped - this.starts[low] };
  }

  offsetAt(position: SourcePosition): number {
    const lineStart = this.starts[Math.min(position.line, this.starts.length - 1)] ?? 0;
    return lineStart + position.character;
  }

  rangeAt(from: number, to: number): SourceRange {
    return { start: this.positionAt(from), end: this.positionAt(to) };
  }
}
